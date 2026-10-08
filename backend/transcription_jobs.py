"""Durable asynchronous transcription orchestration and worker processing."""
from __future__ import annotations

import datetime
import json
import os
import re
from typing import Any, Dict, Optional

import google.auth
import requests
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2 import id_token

from backend.algolia_service import algolia_service
from backend.database import db_manager
from backend.rag_engine import pinecone_rag_engine
from backend.redis_service import redis_cache
from backend.vimeo_client import format_timestamp


def _required_config(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required to enable asynchronous transcription.")
    return value


def async_transcription_is_enabled() -> bool:
    return os.getenv("ASYNC_TRANSCRIPTION_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def enqueue_transcription_task(job_id: str) -> str:
    """Enqueue a task containing only the persistent job ID."""
    from google.cloud import tasks_v2

    project = _required_config("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("TRANSCRIPTION_TASKS_LOCATION", "us-central1").strip()
    queue = _required_config("TRANSCRIPTION_TASKS_QUEUE")
    dispatch_url = _required_config("TRANSCRIPTION_TASKS_DISPATCH_URL").rstrip("/")
    service_account = _required_config("TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT")
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)
    task_name = f"{parent}/tasks/transcription-{job_id}"
    task = {
        "name": task_name,
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{dispatch_url}/internal/transcription-jobs/dispatch",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"job_id": job_id}).encode("utf-8"),
            "oidc_token": {
                "service_account_email": service_account,
                "audience": dispatch_url,
            },
        },
    }
    from google.api_core.exceptions import AlreadyExists

    try:
        client.create_task(request={"parent": parent, "task": task})
    except AlreadyExists:
        pass
    return task_name


def verify_cloud_task_identity(authorization: Optional[str]) -> bool:
    expected_email = os.getenv("TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT", "").strip()
    audience = os.getenv("TRANSCRIPTION_TASKS_DISPATCH_URL", "").strip().rstrip("/")
    if not expected_email or not audience or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    try:
        claims = id_token.verify_oauth2_token(token, Request(), audience=audience)
    except (ValueError, GoogleAuthError, requests.RequestException):
        return False
    return claims.get("email") == expected_email and claims.get("email_verified") is True


def launch_transcription_cloud_run_job(job_id: str) -> str:
    """Start one Cloud Run Job execution with the job ID as its only override."""
    project = _required_config("GOOGLE_CLOUD_PROJECT")
    region = os.getenv("TRANSCRIPTION_CLOUD_RUN_JOB_REGION", "us-central1").strip()
    job_name = _required_config("TRANSCRIPTION_CLOUD_RUN_JOB")
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    session = AuthorizedSession(credentials)
    endpoint = (
        f"https://run.googleapis.com/v2/projects/{project}/locations/{region}"
        f"/jobs/{job_name}:run"
    )
    response = session.post(
        endpoint,
        json={
            "overrides": {
                "containerOverrides": [
                    {"env": [{"name": "TRANSCRIPTION_JOB_ID", "value": job_id}]}
                ]
            }
        },
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(f"Cloud Run Job launch failed with HTTP {response.status_code}.")
    result = response.json()
    return str(result.get("name") or "")


def _safe_error_message(error: Exception) -> str:
    message = str(error)
    message = re.sub(r"https?://\S+", "[remote service URL]", message)
    message = re.sub(
        r"(?i)(api[_-]?key|authorization|token|password|secret)\s*[:=]\s*\S+",
        r"\1=[redacted]",
        message,
    )
    return message[:500] or "Transcription failed."


def transcription_payload_to_cues(transcription: Dict[str, Any]) -> list[Dict[str, str]]:
    """Normalize the transcription service response to LectureScribe cue records."""
    cues: list[Dict[str, str]] = []
    raw_segments = transcription.get("segments")
    if isinstance(raw_segments, list):
        for segment in raw_segments:
            if not isinstance(segment, dict):
                continue
            text = str(segment.get("text") or "").strip()
            start = segment.get("start")
            if text and isinstance(start, (int, float)) and start >= 0:
                cues.append({
                    "time": format_timestamp(str(datetime.timedelta(seconds=int(start)))),
                    "text": text,
                })
    if not cues:
        transcript_text = str(transcription.get("text") or "").strip()
        if transcript_text:
            cues = [{"time": "00:00", "text": transcript_text}]
    return cues


def dispatch_transcription_job(job_id: str) -> None:
    job = db_manager.get_transcription_job(job_id)
    if not job:
        raise LookupError("Transcription job not found.")
    if job["status"] in {"completed", "failed", "processing"}:
        return
    if job.get("run_execution_name"):
        return
    if not db_manager.claim_transcription_dispatch(job_id):
        raise RuntimeError("Transcription dispatch is already in progress.")
    try:
        execution_name = launch_transcription_cloud_run_job(job_id)
    except Exception as exc:
        try:
            db_manager.reset_transcription_dispatch(job_id)
        except Exception:
            pass
        raise RuntimeError("Unable to start transcription.") from exc
    if execution_name:
        db_manager.record_transcription_execution(job_id, execution_name)


def process_transcription_job(job_id: str) -> None:
    """Run a persisted transcription job; safe against concurrent duplicate starts."""
    job = db_manager.get_transcription_job(job_id)
    if not job:
        raise LookupError("Transcription job not found.")
    if job["status"] == "completed":
        return
    if not db_manager.claim_transcription_job(job_id):
        return

    try:
        video = db_manager.get_saved_video(job["video_id"])
        if not video:
            raise RuntimeError("Imported lecture was not found.")
        cues = video.get("cues") or []
        if not any(str(cue.get("text") or "").strip() for cue in cues):
            service_url = _required_config("TRANSCRIPTION_SERVICE_URL").rstrip("/")
            response = requests.post(
                f"{service_url}/transcribe/url",
                json={"url": f"https://vimeo.com/{job['video_id']}"},
                timeout=(15, 900),
            )
            if not response.ok:
                raise RuntimeError(f"Transcription service returned HTTP {response.status_code}.")
            transcription = response.json()
            if not isinstance(transcription, dict):
                raise RuntimeError("Transcription service returned an invalid response.")
            cues = transcription_payload_to_cues(transcription)
            if not cues:
                raise RuntimeError("Transcription service returned no transcript text.")
            title = video.get("title") or f"Vimeo Video {job['video_id']}"
            source_url = video.get("sourceUrl") or f"https://vimeo.com/{job['video_id']}"
            db_manager.save_video_transcript(
                job["video_id"],
                title,
                video.get("duration") or "Unknown",
                source_url,
                "Groq Whisper",
                cues,
                video.get("summarySections") or [],
                user_email=job.get("requested_by"),
                course_name=video.get("course_name"),
            )
        else:
            title = video.get("title") or f"Vimeo Video {job['video_id']}"

        db_manager.update_transcription_job(job_id, "processing", "indexing")
        algolia_service.ingest_cues(job["video_id"], title, cues)
        pinecone_rag_engine.ingest_transcript(job["video_id"], title, cues)
        if redis_cache:
            redis_cache.invalidate_video(job["video_id"])
        db_manager.update_transcription_job(job_id, "completed", "completed")
    except Exception as exc:
        db_manager.update_transcription_job(
            job_id,
            "failed",
            "failed",
            error_message=_safe_error_message(exc),
        )
        raise


def transcription_job_status(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": str(job["job_id"]),
        "video_id": job["video_id"],
        "status": job["status"],
        "stage": job["stage"],
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
        "error": job.get("error_message"),
    }
