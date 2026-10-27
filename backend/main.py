"""
FastAPI Backend for LectureScribe
--------------------------------
Triad Architecture:
1. Relational DB (PostgreSQL) -> Source of Truth for Videos, Cues, Notes & Chat History.
2. Algolia Search -> Sub-10ms Instant Keyword & Typo-Tolerant Search for Transcript Drawer.
3. Pinecone Vector Store -> 768-dim Dense Vector Embeddings for Semantic RAG Chatbot.
"""
import os
import io
import re
import sys
import json
import time
import logging
import threading
import traceback
import concurrent.futures
import requests
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Union

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
)
logger = logging.getLogger("lecturescribe.api")
from pydantic import BaseModel, Field, AliasChoices, ConfigDict

from dotenv import load_dotenv

# Ensure .env is explicitly loaded from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)

import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Query, HTTPException, BackgroundTasks, Header, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse, Response
import socket
import ipaddress
from urllib.parse import urlparse
import httpx

from contextlib import asynccontextmanager

from backend.calendar_parser import calendar_service, SLOT_LABELS
from backend.calendar_ai_service import (
    extract_calendar_events_from_pdf,
    extract_calendar_events_from_transcript,
    sync_predicted_quizzes_to_calendar,
)
from backend.whatsapp_service import whatsapp_service

# Import extraction and service modules
from backend.video_client import (
    extract_video_id,
    fetch_player_config,
    get_text_tracks,
    fetch_vtt,
    parse_vtt,
    format_timestamp,
    get_video_download_streams,
)
from backend.rag_engine import pinecone_rag_engine
from backend.algolia_service import algolia_service
from backend.database import db_manager, extract_course_name, to_course_slug
from backend.mcp_integration import router as mcp_router
from backend.google_drive_service import google_drive_service
from backend.summary_generator import generate_summary_sections
from backend.redis_service import redis_cache
from backend.gcs_storage import gcs_storage_service, to_gcs_course_slug
from backend.transcription_jobs import (
    async_transcription_is_enabled,
    dispatch_transcription_job,
    enqueue_transcription_task,
    transcription_job_status,
    transcription_payload_to_cues,
    verify_cloud_task_identity,
)


# Slide & Reading Recommendation Services
from backend.slide_parser import parse_slide_document, format_slides_for_llm
from backend.reading_extractor import (
    fetch_google_books_metadata,
    search_web_reading_links,
    resolve_digital_book_reader,
    extract_readings_with_llm,
    search_academic_literature,
    search_academic_literature_async,
)
from backend.transcript_correction import (
    resolve_lecture_audio_file,
    review_transcript_cues,
    explain_selected_transcript_text,
)
from backend.podcast_service import (
    get_podcast_metadata,
    create_or_refresh_podcast,
    trigger_background_podcast_generation,
)
from backend.quiz_predictor import predict_quizzes_from_cues

_TRANSCRIPTION_JOB_ID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager: Initializes services safely without blocking container boot."""
    print("\n" + "=" * 60)
    print("🚀 LectureScribe Triad Server Starting Up...")
    print("=" * 60)

    # 1. Relational Database verification
    print("📦 [1/4] Verifying Relational DB (PostgreSQL)...")
    try:
        if db_manager and db_manager.postgres_url:
            db_manager._init_postgres_schema(_first_init=False)
            print("✅ [Database Startup] PostgreSQL database ready.")
        else:
            print("⚠️ [Database Startup Warning]: DATABASE_URL not yet configured. Deferring schema initialization.")
    except Exception as e:
        print(f"⚠️ [Database Startup Warning]: {e}")

    # 2. Pinecone Index creation & connection
    print("🌲 [2/4] Verifying/Creating Pinecone Vector Index...")
    try:
        pinecone_rag_engine.setup_index()
    except Exception as e:
        print(f"⚠️ [Pinecone Startup Warning]: {e}")

    # 3. Algolia Search Index verification & settings
    print("🔍 [3/4] Verifying/Configuring Algolia Search Index...")
    try:
        algolia_service.setup_index()
    except Exception as e:
        print(f"⚠️ [Algolia Startup Warning]: {e}")

    # 4. Cloud LLM Providers & Router connectivity
    print("🤖 [4/4] Probing Cloud LLM Providers & Intent Router...")
    try:
        pinecone_rag_engine.check_llm_connectivity()
    except Exception as e:
        print(f"⚠️ [LLM Startup Warning]: Could not complete connectivity probe: {e}")

    print("=" * 60)
    print("✨ Server ready and listening on port!")
    print("=" * 60 + "\n")

    yield

    print("\n🛑 LectureScribe Triad Server Shutting Down...")

app = FastAPI(
    title="LectureScribe Triad API (Postgres + Algolia + Pinecone)",
    lifespan=lifespan
)
app.include_router(mcp_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    video_id: Optional[str] = None
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, str]]] = None
    user_email: Optional[str] = None
    enable_web_search: Optional[bool] = True
    bypass_cache: Optional[bool] = False
    chat_history: Optional[List[Dict[str, Any]]] = None

class RAGQueryRequest(BaseModel):
    query: str
    video_id: Optional[str] = ""
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, str]]] = None
    top_k: Optional[int] = 10
    user_email: Optional[str] = None
    enable_web_search: Optional[bool] = True
    bypass_cache: Optional[bool] = False
    chat_history: Optional[List[Dict[str, Any]]] = None
    enforce_regenerate: Optional[bool] = False

class SubmissionRequest(BaseModel):
    original_text: str
    video_id: Optional[str] = None
    word_count: Optional[int] = 100
    user_email: Optional[str] = None

class AlgoliaSearchRequest(BaseModel):
    query: str
    video_id: Optional[str] = None
    limit: Optional[int] = 20

class RegenerateSummaryRequest(BaseModel):
    video_id: str


class GenerateLectureSummaryRequest(BaseModel):
    video_id: str
    summary_type: str = "comprehensive"
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, Any]]] = None
    user_email: Optional[str] = None
    bypass_cache: Optional[bool] = False


class SaveLectureProgressRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    video_id: str = Field(validation_alias=AliasChoices("video_id", "videoId"))
    user_email: Optional[str] = Field(default=None, validation_alias=AliasChoices("user_email", "userEmail", "email"))
    last_timestamp: str = Field(default="00:00", validation_alias=AliasChoices("last_timestamp", "lastTimestamp"))
    last_seconds: float = Field(default=0.0, validation_alias=AliasChoices("last_seconds", "lastSeconds"))
    duration_seconds: float = Field(default=0.0, validation_alias=AliasChoices("duration_seconds", "durationSeconds"))
    active_cue_idx: int = Field(default=0, validation_alias=AliasChoices("active_cue_idx", "activeCueIdx"))


class TranscriptionDispatchRequest(BaseModel):
    job_id: str


class CourseTutorChatRequest(BaseModel):
    message: str
    user_email: Optional[str] = None
    chat_history: Optional[List[Dict[str, Any]]] = None


class UpdateCueRequest(BaseModel):
    text: str


class CreateAnnotationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_email: Optional[str] = Field(default="anonymous", validation_alias=AliasChoices("user_email", "userEmail"))
    selected_text: str = Field(validation_alias=AliasChoices("selected_text", "selectedText"))
    annotation_type: str = Field(default="highlight", validation_alias=AliasChoices("annotation_type", "annotationType"))
    cue_id: Optional[Union[int, str]] = Field(default=None, validation_alias=AliasChoices("cue_id", "cueId"))
    start_seconds: Optional[float] = Field(default=0.0, validation_alias=AliasChoices("start_seconds", "startSeconds"))
    end_seconds: Optional[float] = Field(default=0.0, validation_alias=AliasChoices("end_seconds", "endSeconds"))
    color: Optional[str] = "yellow"
    note_text: Optional[str] = Field(default=None, validation_alias=AliasChoices("note_text", "noteText"))
    ai_prompt: Optional[str] = Field(default=None, validation_alias=AliasChoices("ai_prompt", "aiPrompt"))
    ai_response: Optional[str] = Field(default=None, validation_alias=AliasChoices("ai_response", "aiResponse"))


class ExplainSelectionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    selected_text: str = Field(validation_alias=AliasChoices("selected_text", "selectedText"))
    prompt_type: Optional[str] = Field(default="explain", validation_alias=AliasChoices("prompt_type", "promptType"))
    custom_prompt: Optional[str] = Field(default=None, validation_alias=AliasChoices("custom_prompt", "customPrompt"))
    cue_timestamp: Optional[str] = Field(default=None, validation_alias=AliasChoices("cue_timestamp", "cueTimestamp"))
    start_seconds: Optional[float] = Field(default=None, validation_alias=AliasChoices("start_seconds", "startSeconds"))
    end_seconds: Optional[float] = Field(default=None, validation_alias=AliasChoices("end_seconds", "endSeconds"))


class ReviewTranscriptRequest(BaseModel):
    review_mode: Optional[str] = "audio_grounded"


class ExtensionImportRequest(BaseModel):
    video_id: str
    player_config: Optional[Dict[str, Any]] = None
    video_details: Optional[Dict[str, Any]] = None
    lms_page_url: Optional[str] = None
    course_name: Optional[str] = None
    email: Optional[str] = None


class UpdateQuizReminderRequest(BaseModel):
    status: str




@app.get("/health")
def health_check():
    db_status = "PostgreSQL Ready" if (db_manager and db_manager.postgres_url) else "Pending Configuration"
    algolia_idx = getattr(algolia_service, "index_name", "lecturescribe_transcripts_v1")
    pinecone_idx = getattr(pinecone_rag_engine, "index_name", "lecturescribe-rag-index")
    pinecone_ns = getattr(pinecone_rag_engine, "namespace", "lecturescribe_v1")
    redis_info = redis_cache.get_status() if redis_cache else {"status": "Not configured"}
    try:
        llm_info = pinecone_rag_engine.check_llm_connectivity()
    except Exception as e:
        llm_info = {"status": "probe_error", "error": str(e), "providers": {}}
    return {
        "status": "ok",
        "service": "lecturescribe-triad-api",
        "database": db_status,
        "algolia_index": algolia_idx,
        "pinecone_index": pinecone_idx,
        "pinecone_namespace": pinecone_ns,
        "redis_cache": redis_info,
        "llm_providers": llm_info
    }

@app.get("/api/course/{course_name}/lecture/{video_id}")
def get_course_lecture_by_id(
    course_name: str,
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library")
):
    """Dedicated nested API endpoint for fetching a lecture within a course."""
    return get_transcript(url=video_id, email=email, course_name=course_name)


@app.get("/api/lecture/{video_id}")
def get_lecture_by_id(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library"),
    course_name: Optional[str] = Query(None, description="Optional course name to associate video with")
):
    """Dedicated API endpoint for fetching a lecture workspace by video ID."""
    return get_transcript(url=video_id, email=email, course_name=course_name)


@app.post("/api/lecture/{video_id}/transcribe")
def transcribe_lecture(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library")
):
    """Generate and persist a transcript for an imported lecture without captions."""
    if not email or not str(email).strip():
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Please sign in with Google to transcribe lecture videos."
        )
    if not re.fullmatch(r"\d+", video_id):
        raise HTTPException(status_code=400, detail="A valid video ID is required.")

    service_url = os.getenv("TRANSCRIPTION_SERVICE_URL", "").strip().rstrip("/")
    if not service_url:
        raise HTTPException(status_code=503, detail="Video transcription is not configured.")

    saved = db_manager.get_saved_video(video_id)
    if not saved:
        raise HTTPException(status_code=404, detail="Import this lecture before generating its transcript.")
    existing_cues = saved.get("cues") or []
    if any(str(cue.get("text") or "").strip() for cue in existing_cues):
        return {
            **saved,
            "videoId": video_id,
            "cues": existing_cues,
            "transcript_available": True,
            "transcript_message": None,
            "cached": True,
        }

    if async_transcription_is_enabled():
        try:
            job = db_manager.create_transcription_job(
                job_id=str(uuid.uuid4()),
                video_id=video_id,
                requested_by=email,
            )
        except Exception as exc:
            print(f"[Transcription Job Error] Could not create job for video '{video_id}': {exc}")
            raise HTTPException(status_code=503, detail="Unable to queue transcription right now.") from exc

        if job["created"]:
            try:
                task_name = enqueue_transcription_task(str(job["job_id"]))
            except Exception as exc:
                db_manager.update_transcription_job(
                    str(job["job_id"]),
                    "failed",
                    "failed",
                    error_message="Unable to schedule transcription. Please try again.",
                )
                print(f"[Transcription Job Error] Enqueue failed for job '{job['job_id']}': {exc}")
                raise HTTPException(
                    status_code=503,
                    detail="Unable to schedule transcription. Please try again.",
                ) from exc
            try:
                db_manager.record_transcription_task(str(job["job_id"]), task_name)
            except Exception as exc:
                print(
                    f"[Transcription Job Warning] Task was enqueued but its name could not be "
                    f"recorded for job '{job['job_id']}': {exc}"
                )
            try:
                refreshed_job = db_manager.get_transcription_job(str(job["job_id"]))
                if refreshed_job:
                    job = refreshed_job
            except Exception:
                pass

        return JSONResponse(
            status_code=202,
            content=transcription_job_status(job),
        )

    source_url = f"https://video.lecturescribe.local/{video_id}"
    try:
        response = requests.post(
            f"{service_url}/transcribe/url",
            json={"url": source_url},
            timeout=(15, 900),
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Transcription service request failed: {exc}") from exc

    if not response.ok:
        try:
            error_body = response.json()
        except ValueError:
            error_body = {}
        service_detail = error_body.get("detail") if isinstance(error_body, dict) else None
        if not isinstance(service_detail, str) or not service_detail.strip():
            service_detail = f"Transcription service returned HTTP {response.status_code}."
        raise HTTPException(
            status_code=502,
            detail=f"Transcription service failed: {service_detail.strip()[:1000]}",
        )

    try:
        transcription = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Transcription service returned invalid JSON.") from exc
    if not isinstance(transcription, dict):
        raise HTTPException(status_code=502, detail="Transcription service returned an invalid response.")

    cues = transcription_payload_to_cues(transcription)
    if not cues:
        raise HTTPException(status_code=502, detail="Transcription service returned no transcript text.")

    title = saved.get("title") or f"Video {video_id}"
    duration = saved.get("duration") or "Unknown"
    course_name = saved.get("course_name")
    db_manager.save_video_transcript(
        video_id,
        title,
        duration,
        source_url,
        "Groq Whisper",
        cues,
        [],
        user_email=email,
        course_name=course_name,
    )
    algolia_service.ingest_cues(video_id, title, cues)
    pinecone_chunks = pinecone_rag_engine.ingest_transcript(video_id, title, cues)
    if redis_cache:
        redis_cache.invalidate_video(video_id)

    return {
        **saved,
        "videoId": video_id,
        "title": title,
        "duration": duration,
        "sourceUrl": saved.get("sourceUrl") or source_url,
        "captionLabel": "Groq Whisper",
        "cues": cues,
        "summarySections": saved.get("summarySections") or [],
        "transcript_available": True,
        "transcript_message": None,
        "pineconeIndexedChunks": pinecone_chunks,
        "cached": False,
    }


@app.get("/api/lecture/transcription-jobs/{job_id}")
def get_transcription_job(
    job_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library"),
):
    if not _TRANSCRIPTION_JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(status_code=404, detail="Transcription job not found.")
    try:
        job = db_manager.get_transcription_job(job_id)
    except Exception as exc:
        print(f"[Transcription Job Error] Could not retrieve job '{job_id}': {exc}")
        raise HTTPException(status_code=503, detail="Unable to retrieve transcription status.") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Transcription job not found.")
    requested_by = job.get("requested_by")
    if requested_by and (not email or email.strip().lower() != requested_by):
        raise HTTPException(status_code=404, detail="Transcription job not found.")
    return transcription_job_status(job)


@app.post("/internal/transcription-jobs/dispatch")
def dispatch_transcription_job_request(
    payload: TranscriptionDispatchRequest,
    authorization: Optional[str] = Header(None),
):
    if not verify_cloud_task_identity(authorization):
        raise HTTPException(status_code=401, detail="Invalid task identity.")
    job_id = payload.job_id
    if not _TRANSCRIPTION_JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="A valid transcription job ID is required.")
    try:
        dispatch_transcription_job(job_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[Transcription Job Error] Dispatch failed for job '{job_id}': {exc}")
        raise HTTPException(status_code=503, detail="Unable to start transcription.") from exc
    return {"accepted": True, "job_id": job_id}


def determine_lecture_quiz_count(cues: Optional[List[Dict[str, Any]]] = None, duration_str: Optional[str] = None) -> int:
    """
    Dynamically scale quiz questions according to lecture duration and cue density.
    Scales from 5 (short lectures) up to 15 (long university lectures >75 mins).
    """
    duration_minutes = None

    # 1. Try parsing duration_str if provided (e.g. '1h 30m', '45m', '5400', '01:30:00')
    if duration_str and str(duration_str).strip():
        d_str = str(duration_str).strip().lower()
        if "h" in d_str or "m" in d_str:
            import re
            h_match = re.search(r"(\d+)\s*h", d_str)
            m_match = re.search(r"(\d+)\s*m", d_str)
            h = int(h_match.group(1)) if h_match else 0
            m = int(m_match.group(1)) if m_match else 0
            total_mins = h * 60 + m
            if total_mins > 0:
                duration_minutes = total_mins
        elif ":" in d_str:
            parts = [int(p) for p in d_str.split(":") if p.isdigit()]
            if len(parts) == 3:
                duration_minutes = parts[0] * 60 + parts[1]
            elif len(parts) == 2:
                duration_minutes = parts[0] + parts[1] / 60.0
        else:
            try:
                secs = float(d_str)
                if secs > 0:
                    duration_minutes = secs / 60.0
            except ValueError:
                pass

    # 2. Try inferring from cues if duration_minutes not resolved
    if (duration_minutes is None or duration_minutes <= 0) and cues:
        valid_cues = [c for c in cues if (c.get("text") or "").strip()]
        if valid_cues:
            last_cue = valid_cues[-1]
            if "start" in last_cue and isinstance(last_cue["start"], (int, float)):
                duration_minutes = float(last_cue["start"]) / 60.0
            elif "time" in last_cue:
                ts = str(last_cue["time"]).strip().replace("[", "").replace("]", "")
                parts = [int(p) for p in ts.split(":") if p.isdigit()]
                if len(parts) == 3:
                    duration_minutes = parts[0] * 60 + parts[1]
                elif len(parts) == 2:
                    duration_minutes = parts[0] + parts[1] / 60.0

    # 3. Determine count from duration
    if duration_minutes is not None and duration_minutes > 0:
        if duration_minutes <= 15:
            count = 5
        elif duration_minutes <= 30:
            count = 7
        elif duration_minutes <= 50:
            count = 9
        elif duration_minutes <= 75:
            count = 12
        else:
            count = 15
    elif cues:
        num_cues = len(cues)
        if num_cues <= 30:
            count = 5
        elif num_cues <= 80:
            count = 8
        elif num_cues <= 150:
            count = 10
        elif num_cues <= 250:
            count = 12
        else:
            count = 15
    else:
        count = 5

    return max(5, min(15, count))


class QuizGenerateRequest(BaseModel):
    regenerate: bool = False
    num_questions: Optional[int] = None


class CourseSummaryRequest(BaseModel):
    regenerate: bool = False
    user_email: Optional[str] = None


class QuizAnswersRequest(BaseModel):
    user_email: Optional[str] = None
    answers: Dict[str, int] = {}
    score: Optional[int] = 0
    completed: Optional[bool] = False
    quiz_id: Optional[str] = None


class CourseQuizExplanationRequest(BaseModel):
    question_id: Union[int, str]
    question: str
    options: List[str]
    correct_index: int
    explanation: Optional[str] = ""
    timestamp: Optional[str] = "00:00"
    lecture_id: Optional[str] = None
    course_name: Optional[str] = None
    regenerate: Optional[bool] = False


def sanitize_quiz_payload(quiz_data: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Filter out non-academic, greeting, or filler questions from cached/saved quizzes."""
    if not quiz_data or not isinstance(quiz_data, dict):
        return quiz_data
    qs = quiz_data.get("questions")
    if not isinstance(qs, list):
        return quiz_data

    clean_qs = []
    has_modified = False
    for q in qs:
        if not isinstance(q, dict):
            continue
        if pinecone_rag_engine._is_trivial_or_greeting_question(q):
            has_modified = True
            continue
        sanitized_q = dict(q)
        orig_text = str(sanitized_q.get("question") or "")
        clean_text = pinecone_rag_engine._sanitize_quiz_question_text(orig_text)
        if clean_text != orig_text:
            sanitized_q["question"] = clean_text
            has_modified = True
        clean_qs.append(sanitized_q)

    if has_modified:
        for idx, q in enumerate(clean_qs):
            q["id"] = idx + 1
        quiz_data = dict(quiz_data)
        quiz_data["questions"] = clean_qs
        quiz_data["total_questions"] = len(clean_qs)

    return quiz_data


def _lookup_saved_or_cached_quiz(clean_vid: str, email: Optional[str] = None) -> Optional[dict]:
    """Helper to check Redis cache and PostgreSQL for an existing quiz."""
    if redis_cache:
        cached_quiz = redis_cache.get_quiz(clean_vid)
        if cached_quiz:
            cached_quiz = sanitize_quiz_payload(cached_quiz)
            if cached_quiz and len(cached_quiz.get("questions") or []) > 0:
                print(f"⚡ [Redis Hit] Returning cached quiz for video '{clean_vid}'.")
                if email:
                    attempt = db_manager.get_quiz_attempt("lecture", clean_vid, email)
                    if attempt:
                        cached_quiz = dict(cached_quiz)
                        cached_quiz["user_answers"] = attempt.get("answers", {})
                        cached_quiz["user_score"] = attempt.get("score", 0)
                        cached_quiz["user_completed"] = attempt.get("completed", False)
                        cached_quiz["is_completed"] = attempt.get("completed", False)
                return cached_quiz

    db_quiz = db_manager.get_saved_quiz(clean_vid)
    if db_quiz and db_quiz.get("questions"):
        db_quiz = sanitize_quiz_payload(db_quiz)
        if db_quiz and len(db_quiz.get("questions") or []) > 0:
            print(f"💾 [PostgreSQL Hit] Returning persisted quiz for video '{clean_vid}'.")
            if redis_cache:
                redis_cache.set_quiz(clean_vid, db_quiz, ttl_seconds=86400)
            if email:
                attempt = db_manager.get_quiz_attempt("lecture", clean_vid, email)
                if attempt:
                    db_quiz = dict(db_quiz)
                    db_quiz["user_answers"] = attempt.get("answers", {})
                    db_quiz["user_score"] = attempt.get("score", 0)
                    db_quiz["user_completed"] = attempt.get("completed", False)
                    db_quiz["is_completed"] = attempt.get("completed", False)
            return db_quiz

    return None


@app.get("/api/lecture/{video_id}/quiz")
def get_lecture_quiz(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email")
):
    """Retrieve existing practice quiz from database/cache without triggering generation."""
    clean_vid = str(video_id).strip()
    existing = _lookup_saved_or_cached_quiz(clean_vid, email=email)
    if existing:
        return existing

    saved = db_manager.get_saved_video(clean_vid)
    if not saved:
        raise HTTPException(
            status_code=404,
            detail=f"Lecture '{clean_vid}' transcript not found in database. Ingest lecture first."
        )

    return {
        "video_id": clean_vid,
        "questions": [],
        "total_questions": 0
    }


@app.post("/api/lecture/{video_id}/quiz")
def generate_lecture_quiz_endpoint(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email"),
    body: Optional[QuizGenerateRequest] = None
):
    """Generate or regenerate interactive practice quiz using LLM."""
    clean_vid = str(video_id).strip()
    is_regenerate = body.regenerate if body else False
    req_count = body.num_questions if body and body.num_questions is not None else None

    # Check existing quiz unless regenerating
    if not is_regenerate:
        existing = _lookup_saved_or_cached_quiz(clean_vid, email=email)
        if existing:
            return existing

    # Retrieve Saved Video & Cues from DB
    saved = db_manager.get_saved_video(clean_vid)
    if not saved:
        raise HTTPException(
            status_code=404,
            detail=f"Lecture '{clean_vid}' transcript not found in database. Ingest lecture first."
        )

    title = saved.get("title", f"Lecture {clean_vid}")
    cues = saved.get("cues", [])
    if not cues:
        return {
            "video_id": clean_vid,
            "lecture_title": title,
            "questions": [],
            "total_questions": 0,
            "transcript_available": False,
            "message": "This video is imported, but no transcript or captions are available. Quiz generation requires transcript text."
        }

    if req_count is not None and req_count > 0:
        target_count = max(3, min(15, int(req_count)))
    else:
        target_count = determine_lecture_quiz_count(cues, saved.get("duration"))

    # Generate with LLM (No Fallbacks)
    try:
        quiz_data = pinecone_rag_engine.generate_lecture_quiz(
            video_id=clean_vid,
            lecture_title=title,
            cues=cues,
            num_questions=target_count
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate quiz via AI model: {str(e)}"
        )

    # Persist to Relational Database
    db_manager.save_quiz(clean_vid, quiz_data)

    # Save to Redis Cache (24 hours)
    if redis_cache:
        redis_cache.set_quiz(clean_vid, quiz_data, ttl_seconds=86400)

    if email:
        attempt = db_manager.get_quiz_attempt("lecture", clean_vid, email)
        if attempt:
            quiz_data = dict(quiz_data)
            quiz_data["user_answers"] = attempt.get("answers", {})
            quiz_data["user_score"] = attempt.get("score", 0)
            quiz_data["user_completed"] = attempt.get("completed", False)
            quiz_data["is_completed"] = attempt.get("completed", False)

    return quiz_data


@app.post("/api/lecture/{video_id}/quiz/answers")
def save_lecture_quiz_answers(video_id: str, req: QuizAnswersRequest):
    """Persist user quiz response state directly into the relational database."""
    clean_vid = str(video_id or "").strip()
    email = req.user_email or "anonymous"
    db_manager.save_quiz_attempt("lecture", clean_vid, email, req.answers, req.score or 0, req.completed or False)
    return {"status": "success", "success": True}


@app.delete("/api/lecture/{video_id}/quiz/answers")
def reset_lecture_quiz_answers(video_id: str, email: Optional[str] = Query(None)):
    """Reset user quiz response state in the relational database."""
    clean_vid = str(video_id or "").strip()
    db_manager.delete_quiz_attempt("lecture", clean_vid, email or "anonymous")
    return {"status": "success", "success": True}


class QuizExplanationRequest(BaseModel):
    question_id: int
    question: str
    options: List[str]
    correct_index: int
    explanation: str
    timestamp: str
    regenerate: bool = False


@app.post("/api/lecture/{video_id}/quiz/explanation")
def get_detailed_quiz_explanation(video_id: str, req: QuizExplanationRequest):
    """Generate or retrieve detailed explanation for a quiz question using RAG."""
    clean_vid = str(video_id or "").strip()

    # 1. Check cache first if not regenerating
    if not req.regenerate:
        cached = db_manager.get_quiz_explanation(clean_vid, req.question_id)
        if cached:
            return {
                "detailed_explanation": cached,
                "cached": True,
                "model": "Cached"
            }

    # 2. Get lecture data
    saved = db_manager.get_saved_video(clean_vid)
    if not saved:
        raise HTTPException(
            status_code=404,
            detail=f"Lecture '{clean_vid}' not found in database."
        )

    title = saved.get("title", f"Lecture {clean_vid}")
    cues = saved.get("cues", [])

    # 3. Generate detailed explanation using RAG
    try:
        explanation_data = pinecone_rag_engine.generate_detailed_quiz_explanation(
            video_id=clean_vid,
            lecture_title=title,
            question=req.question,
            options=req.options,
            correct_index=req.correct_index,
            explanation=req.explanation,
            timestamp=req.timestamp,
            cues=cues
        )

        # 4. Save to database
        db_manager.save_quiz_explanation(
            clean_vid,
            req.question_id,
            explanation_data["detailed_explanation"]
        )

        return explanation_data
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate detailed explanation: {str(e)}"
        )


_active_gcs_uploads: Dict[str, Dict[str, Any]] = {}
_gcs_upload_lock = threading.Lock()
# Small shared pool for fanning out independent request-path I/O (Postgres vs. GCS) concurrently.
_lecture_io_executor = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="lecture-io")
DEFAULT_LMS_REFERER = os.getenv("LMS_REFERER", "https://learning.iiitdwd.ac.in/")


def _trigger_background_gcs_upload(
    video_id: str,
    title: str,
    course_name: str,
    cues: List[Dict[str, Any]],
    player_config: Optional[Dict[str, Any]] = None,
    referer: Optional[str] = None,
    skip_existing_check: bool = False
) -> bool:
    """Safely start background video transfer to GCS if not already uploaded or in progress.

    Pass ``skip_existing_check=True`` when the caller has just run ``find_lecture_video``
    and got no result, to avoid a duplicate GCS listing round-trip.
    """
    if not video_id:
        return False

    if not skip_existing_check:
        existing_gcs = gcs_storage_service.find_lecture_video(video_id=video_id, course_name=course_name)
        if existing_gcs:
            return False

    with _gcs_upload_lock:
        if video_id in _active_gcs_uploads and _active_gcs_uploads[video_id].get("status") == "UPLOADING":
            return True
        _active_gcs_uploads[video_id] = {
            "video_id": video_id,
            "title": title,
            "course_name": course_name,
            "status": "UPLOADING",
            "stage": "Initializing Cloud Storage upload...",
            "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

    threading.Thread(
        target=_async_upload_video_to_gcs_worker,
        args=(video_id, title, course_name, cues, player_config, referer),
        daemon=True
    ).start()
    return True


def _async_upload_video_to_gcs_worker(
    video_id: str,
    title: str,
    course_name: str,
    cues: List[Dict[str, Any]],
    player_config: Optional[Dict[str, Any]],
    referer: Optional[str]
):
    eff_referer = referer or DEFAULT_LMS_REFERER
    try:
        with _gcs_upload_lock:
            if video_id in _active_gcs_uploads:
                _active_gcs_uploads[video_id]["stage"] = "Resolving video stream config..."

        config = player_config
        if not config:
            try:
                config = fetch_player_config(video_id, referer=eff_referer)
            except Exception as e:
                logger.warning(f"[GCS Background Upload Notice] Config fetch for {video_id}: {e}")

        streams_info = None
        if config:
            try:
                streams_info = get_video_download_streams(config, video_id)
            except Exception as e:
                logger.warning(f"[GCS Background Upload Notice] Streams parse for {video_id}: {e}")

        if not streams_info:
            logger.warning(f"[GCS Background Upload] No streams available for video {video_id}.")
            with _gcs_upload_lock:
                if video_id in _active_gcs_uploads:
                    _active_gcs_uploads[video_id]["status"] = "FAILED"
                    _active_gcs_uploads[video_id]["stage"] = "No stream format available"
            return

        cslug = to_gcs_course_slug(course_name)
        effective_prefix = f"courses/{cslug}/lectures"

        with _gcs_upload_lock:
            if video_id in _active_gcs_uploads:
                _active_gcs_uploads[video_id]["stage"] = "Transferring video to Google Cloud Storage..."

        def _on_stage_change(msg: str):
            with _gcs_upload_lock:
                if video_id in _active_gcs_uploads:
                    _active_gcs_uploads[video_id]["stage"] = msg

        logger.info(f"🚀 [GCS Background Upload] Starting video upload for '{video_id}' ({title})...")
        result = gcs_storage_service.upload_lecture_bundle(
            video_id=video_id,
            title=title,
            vtt_content="",
            cues=cues or [],
            summary_content="",
            streams_info=streams_info,
            prefix=effective_prefix,
            upload_video=True,
            referer=eff_referer,
            progress_callback=_on_stage_change
        )
        logger.info(f"✅ [GCS Background Upload Complete] Video '{video_id}' status: {result.get('status')}")
        video_details = result.get("video_details") or {}
        blob_name = video_details.get("blob_name")
        view_url = video_details.get("view_url")
        size_mb = video_details.get("size_mb")

        if blob_name:
            try:
                db_manager.update_video_gcs_blob(video_id, blob_name, title=title, course_name=course_name)
            except Exception as e:
                logger.warning(f"[GCS Background Upload] Could not update gcs_video_blob in DB: {e}")

        with _gcs_upload_lock:
            if video_id in _active_gcs_uploads:
                _active_gcs_uploads[video_id]["status"] = "SUCCESS"
                _active_gcs_uploads[video_id]["stage"] = "Uploaded successfully"
                _active_gcs_uploads[video_id]["blob_name"] = blob_name
                _active_gcs_uploads[video_id]["view_url"] = view_url
                _active_gcs_uploads[video_id]["size_mb"] = size_mb
    except Exception as exc:
        logger.error(f"❌ [GCS Background Upload Error] Video '{video_id}': {exc}")
        with _gcs_upload_lock:
            if video_id in _active_gcs_uploads:
                _active_gcs_uploads[video_id]["status"] = "FAILED"
                _active_gcs_uploads[video_id]["stage"] = f"Error: {exc}"
    finally:
        def _cleanup():
            time.sleep(300)
            with _gcs_upload_lock:
                _active_gcs_uploads.pop(video_id, None)
        threading.Thread(target=_cleanup, daemon=True).start()


COMPREHENSIVE_SUMMARY_PROMPT = (
    "Generate Full Comprehensive Summary without word limits; provide an exhaustive, in-depth academic "
    "study guide and full synthesis grounded strictly in the transcript."
)
_summary_gen_locks: Dict[str, threading.Lock] = {}
_summary_gen_locks_guard = threading.Lock()


def _get_summary_lock(video_id: str, user_email: Optional[str]) -> threading.Lock:
    """Per (lecture, user) lock so two summary generations never run in parallel for the same target."""
    key = f"{video_id}:{(user_email or '').strip().lower()}"
    with _summary_gen_locks_guard:
        return _summary_gen_locks.setdefault(key, threading.Lock())


def generate_and_store_comprehensive_summary(
    video_id: str,
    title: str,
    cues: List[Dict[str, Any]],
    user_email: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Generate the comprehensive study guide from the FULL transcript, derive the plain-text
    submission version, and persist both. Returns the saved summary dict if stored, None otherwise.

    Deliberately bypasses the chat/RAG path: retrieval only sees a handful of top-k chunks, which
    produces summaries that miss parts of the lecture.
    """
    transcript = "\n".join(
        f"[{c.get('time') or '00:00'}] {str(c.get('text')).strip()}"
        for c in cues
        if str(c.get("text") or "").strip()
    )
    if not transcript:
        raise ValueError(f"No transcript text available for video {video_id}.")

    res = pinecone_rag_engine.generate_full_transcript_summary(
        transcript_str=transcript,
        lecture_title=title,
        video_id=video_id,
        user_original_request=COMPREHENSIVE_SUMMARY_PROMPT,
        user_email=user_email,
    )
    markdown_text = (res.get("answer") or "").strip()
    if not markdown_text:
        return None

    submission_text = ""
    try:
        sub_res = pinecone_rag_engine.generate_submission_version(
            original_text=markdown_text,
            video_id=video_id,
            word_count=120,
            query=COMPREHENSIVE_SUMMARY_PROMPT,
        )
        submission_text = sub_res.get("submission_text") or ""
    except Exception as sub_err:
        print(f"⚠️ [Submission Gen Notice]: {sub_err}")
    # Falls back to a cleaned copy of the study guide if the submission LLM chain failed.
    submission_text = pinecone_rag_engine._clean_for_submission(
        submission_text or markdown_text, preserve_paragraphs=True
    )

    saved = db_manager.save_lecture_summary(
        video_id=video_id,
        summary_type="comprehensive",
        markdown_text=markdown_text,
        submission_text=submission_text,
        citations=res.get("citations") or [],
        word_count=len([w for w in submission_text.split() if w]),
        model=res.get("model") or "",
        user_email=user_email,
    )
    if not saved:
        return None

    # Predict upcoming quizzes and dates from cues via LLM during summary ingestion
    try:
        predict_and_store_quizzes(video_id, title, cues)
    except Exception as p_err:
        logger.warning(f"⚠️ [Quiz Predictor Ingestion Notice] {video_id}: {p_err}")

    return db_manager.get_lecture_summary(video_id, "comprehensive", user_email=user_email)


def predict_and_store_quizzes(
    video_id: str,
    title: str,
    cues: List[Dict[str, Any]],
    course_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Predict upcoming quizzes and dates from transcript cues using LLM, and persist."""
    try:
        resolved_course = (course_name or "").strip()
        if not resolved_course:
            saved_vid = db_manager.get_saved_video(video_id)
            if saved_vid and saved_vid.get("course_name"):
                resolved_course = str(saved_vid["course_name"]).strip()
        if not resolved_course:
            resolved_course = extract_course_name(title).strip()
        if resolved_course:
            resolved_course = db_manager.resolve_course_canonical_name(resolved_course)
        course_slug = to_course_slug(resolved_course)
        predictions = predict_quizzes_from_cues(cues, lecture_title=title, video_id=video_id)
        if predictions:
            saved = db_manager.save_predicted_quizzes(video_id, course_slug, resolved_course, predictions)
            try:
                sync_predicted_quizzes_to_calendar(
                    video_id=video_id,
                    course_slug=course_slug,
                    course_name=resolved_course,
                    lecture_title=title,
                    predictions=saved or predictions,
                )
            except Exception as sync_err:
                logger.warning(f"⚠️ [Calendar Sync Notice] {video_id}: {sync_err}")
            print(f"🎯 [Quiz Predictor] Successfully extracted and saved {len(saved)} predicted quizzes for '{video_id}'.")
            return saved
        else:
            print(f"ℹ️ [Quiz Predictor] No upcoming quizzes mentioned in transcript for '{video_id}'.")
    except Exception as e:
        logger.warning(f"⚠️ [Quiz Predictor Error] Failed predicting quizzes for '{video_id}': {e}")
    return []


def _async_post_import_indexing(
    clean_vid: str,
    title: str,
    cues: List[Dict[str, str]],
    user_email: Optional[str] = None,
    course_name: Optional[str] = None,
):
    """
    Background worker for offloading Algolia indexing, Pinecone vector upsert,
    chapter summary generation, and full lecture study notes synthesis so raw
    lecture ingestion finishes in <1 second.
    """
    if not cues:
        return
    try:
        algolia_service.ingest_cues(clean_vid, title, cues)
    except Exception as a_err:
        logger.warning(f"[Background Algolia Notice] {clean_vid}: {a_err}")
    try:
        pinecone_rag_engine.ingest_transcript(clean_vid, title, cues)
    except Exception as p_err:
        logger.warning(f"[Background Pinecone Notice] {clean_vid}: {p_err}")
    try:
        sections = generate_summary_sections(cues, title)
        if sections:
            db_manager.update_summary_sections(clean_vid, sections)
    except Exception as s_err:
        logger.warning(f"[Background Summary Sections Notice] {clean_vid}: {s_err}")
    try:
        predict_and_store_quizzes(clean_vid, title, cues, course_name=course_name)
    except Exception as pq_err:
        logger.warning(f"[Background Quiz Predictor Notice] {clean_vid}: {pq_err}")
    try:
        # Pre-synthesize comprehensive study summary if not already created
        existing_summary = db_manager.get_lecture_summary(clean_vid, "comprehensive", user_email=user_email)
        if not existing_summary or not existing_summary.get("markdownText"):
            lock = _get_summary_lock(clean_vid, user_email)
            # A user-triggered generation may already be running; don't duplicate the LLM work.
            if lock.acquire(blocking=False):
                try:
                    print(f"⚡ [Background Auto-Summary] Synthesizing comprehensive study guide for video '{clean_vid}'...")
                    summary_record = generate_and_store_comprehensive_summary(clean_vid, title, cues, user_email)
                    print(f"✅ [Background Auto-Summary] Successfully stored comprehensive summary for video '{clean_vid}'.")
                    if summary_record:
                        course_title = (course_name or extract_course_name(title)).strip()
                        if summary_record.get("markdownText"):
                            trigger_background_podcast_generation(
                                video_id=clean_vid,
                                title=title,
                                text=summary_record.get("markdownText"),
                                mode="study",
                                course_name=course_title
                            )
                        if summary_record.get("submissionText"):
                            trigger_background_podcast_generation(
                                video_id=clean_vid,
                                title=title,
                                text=summary_record.get("submissionText"),
                                mode="submission",
                                course_name=course_title
                            )
                finally:
                    lock.release()
    except Exception as sum_err:
        logger.warning(f"[Background Auto-Summary Notice] {clean_vid}: {sum_err}")


def process_lecture_import(
    video_id: str,
    email: Optional[str] = None,
    course_name: Optional[str] = None,
    player_config: Optional[Dict[str, Any]] = None,
    video_details: Optional[Dict[str, Any]] = None,
    lms_page_url: Optional[str] = None
) -> Dict[str, Any]:
    clean_vid = extract_video_id(video_id)

    # 1. Check relational DB first for cached video
    saved = db_manager.get_saved_video(clean_vid)
    if saved:
        print(f"[DB Cache Hit] Video '{clean_vid}' found in database. Skipping transcript and summary re-generation.")
        # Shallow copy so per-request fields (signed URLs, upload status) don't leak into the shared L1 cache entry.
        saved = dict(saved)
        saved["cached"] = True
        saved_cues = saved.get("cues") or []
        saved["transcript_available"] = bool(saved_cues)
        saved["transcript_message"] = (
            None if saved_cues else
            "This video was imported, but no transcript or captions are available."
        )
        raw_course = saved.get("course_name") or (course_name and course_name.strip()) or extract_course_name(saved.get("title", ""))
        if not raw_course:
            raise HTTPException(status_code=400, detail="course_name is required.")
        course_title = db_manager.resolve_course_canonical_name(raw_course)
        saved["course_name"] = course_title
        saved["course_slug"] = to_course_slug(course_title)
        clean_email = email.strip() if isinstance(email, str) else None

        def _db_work():
            # Drive URL lookup -> progress lookup -> user library upsert -> targeted Redis course update (order matters).
            d_url = db_manager.get_drive_folder_url(clean_vid, clean_email)
            prog = db_manager.get_lecture_progress(clean_vid, user_email=clean_email)
            if clean_email:
                src_url = saved.get("sourceUrl", f"https://video.lecturescribe.local/{clean_vid}")
                dur_val = saved.get("duration", "Unknown")
                db_manager.record_user_lecture(
                    user_email=clean_email,
                    video_id=clean_vid,
                    title=saved["title"],
                    duration=str(dur_val),
                    source_url=src_url,
                    course_name=course_title,
                    drive_folder_url=d_url
                )
                if redis_cache:
                    redis_cache.update_user_course(
                        clean_email,
                        course_title,
                        lecture_entry={
                            "videoId": clean_vid,
                            "video_id": clean_vid,
                            "title": saved["title"],
                            "video_title": saved["title"],
                            "duration": str(dur_val),
                            "sourceUrl": src_url,
                            "video_url": src_url,
                            "driveFolderUrl": d_url,
                            "drive_folder_url": d_url,
                            "course_name": course_title,
                            "progress": prog
                        }
                    )
            return d_url, prog

        # Postgres and GCS are independent network round-trips: run them concurrently.
        db_future = _lecture_io_executor.submit(_db_work)
        gcs_future = _lecture_io_executor.submit(
            gcs_storage_service.find_lecture_video, video_id=clean_vid, course_name=course_title
        )
        gcs_video = gcs_future.result()
        drive_url, lecture_prog = db_future.result()

        if lecture_prog:
            saved["progress"] = lecture_prog
        if drive_url:
            saved["drive_folder_url"] = drive_url
            saved["driveFolderUrl"] = drive_url
        # Check if self-hosted video is stored in GCS
        if gcs_video:
            saved["gcs_video_url"] = gcs_video["view_url"]
            saved["gcsVideoUrl"] = gcs_video["view_url"]
            saved["video_url"] = gcs_video["view_url"]
            saved["gcs_blob_name"] = gcs_video["blob_name"]
            saved["video_source"] = "gcs"
            saved["is_uploading"] = False
            saved["upload_status"] = "COMPLETED"
        else:
            saved["video_source"] = "gcs"
            is_uploading = _trigger_background_gcs_upload(
                video_id=clean_vid,
                title=saved.get("title", f"Lecture {clean_vid}"),
                course_name=course_title,
                cues=saved.get("cues", []),
                player_config=player_config,
                referer=lms_page_url,
                skip_existing_check=True
            )
            saved["is_uploading"] = is_uploading
            saved["upload_status"] = "UPLOADING" if is_uploading else "IDLE"
        return saved

    # 2. Ingestion of uncached video requires authenticated Google user
    if not email or not str(email).strip():
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Please sign in with Google to ingest lecture videos."
        )

    # Extract video config: use provided player_config or fetch fresh from video provider
    if player_config and isinstance(player_config, dict):
        config = player_config
    else:
        config = fetch_player_config(clean_vid)

    details = video_details or {}
    title = details.get("title") or config.get("video", {}).get("title", f"Video {clean_vid}")
    raw_dur = details.get("duration") or config.get("video", {}).get("duration", 6060)
    if isinstance(raw_dur, int):
        mins = raw_dur // 60
        hrs = mins // 60
        duration = f"{hrs}h {mins % 60}m" if hrs > 0 else f"{mins}m"
    else:
        duration = str(raw_dur)

    tracks = get_text_tracks(config)
    track = next((t for t in tracks if t.get("default")), tracks[0]) if tracks else None
    cues = []
    transcript_message = "This video was imported, but has no caption or subtitle tracks available."
    if track:
        vtt_url = track.get("url") or track.get("src")
        if vtt_url:
            try:
                vtt_content = fetch_vtt(vtt_url)
                raw_segments = parse_vtt(vtt_content)
                cues = [
                    {"time": format_timestamp(s["start"]), "text": s["text"]}
                    for s in raw_segments
                ]
                if not cues:
                    transcript_message = "This video was imported, but its caption track contains no transcript text."
            except Exception as exc:
                print(f"⚠️ [Caption Notice] Could not retrieve captions for video '{clean_vid}': {exc}")
                transcript_message = "This video was imported, but its caption track could not be downloaded."
        else:
            transcript_message = "This video was imported, but did not provide a downloadable caption track."

    transcript_available = bool(cues)
    if transcript_available:
        transcript_message = None
    # Chapters/summaries are generated in the background worker to prevent blocking HTTP ingestion
    summary_sections = []
    source_url = f"https://video.lecturescribe.local/{clean_vid}"
    caption_label = (track.get("label") or "Caption track") if transcript_available and track else "Unavailable"
    raw_course = course_name if isinstance(course_name, str) else None
    candidate_course = ((raw_course and raw_course.strip()) or extract_course_name(title)).strip()
    if not candidate_course:
        raise HTTPException(status_code=400, detail="course_name is required.")
    derived_course = db_manager.resolve_course_canonical_name(candidate_course)

    # 3. Save to Relational DB (PostgreSQL)
    db_manager.save_video_transcript(clean_vid, title, duration, source_url, caption_label, cues, summary_sections, user_email=email, course_name=derived_course)

    # 4-5. Ingest transcript-backed search indexes in background without delaying HTTP response.
    pinecone_chunks = []
    if transcript_available:
        threading.Thread(
            target=_async_post_import_indexing,
            args=(clean_vid, title, cues, email, derived_course),
            daemon=True
        ).start()

    # 6. Record into user LMS library if authenticated
    if email and email.strip():
        clean_user_email = email.strip()
        db_manager.record_user_lecture(
            user_email=clean_user_email,
            video_id=clean_vid,
            title=title,
            duration=duration,
            source_url=source_url,
            course_name=derived_course
        )
        if redis_cache:
            redis_cache.update_user_course(
                clean_user_email,
                derived_course,
                lecture_entry={
                    "videoId": clean_vid,
                    "video_id": clean_vid,
                    "title": title,
                    "video_title": title,
                    "duration": duration,
                    "sourceUrl": source_url,
                    "video_url": source_url,
                    "driveFolderUrl": None,
                    "drive_folder_url": None,
                    "course_name": derived_course,
                    "progress": None
                }
            )

    drive_future = _lecture_io_executor.submit(db_manager.get_drive_folder_url, clean_vid, email)
    gcs_video = gcs_storage_service.find_lecture_video(video_id=clean_vid, course_name=derived_course)
    drive_url = drive_future.result()
    gcs_url = gcs_video["view_url"] if gcs_video else None
    is_uploading = False
    if not gcs_video:
        is_uploading = _trigger_background_gcs_upload(
            video_id=clean_vid,
            title=title,
            course_name=derived_course,
            cues=cues,
            player_config=config,
            referer=lms_page_url,
            skip_existing_check=True
        )

    return {
        "videoId": clean_vid,
        "title": title,
        "duration": duration,
        "sourceUrl": source_url,
        "captionLabel": caption_label,
        "cues": cues,
        "summarySections": summary_sections,
        "transcript_available": transcript_available,
        "transcript_message": transcript_message,
        "course_name": derived_course,
        "course_slug": to_course_slug(derived_course),
        "pineconeIndexedChunks": pinecone_chunks,
        "drive_folder_url": drive_url,
        "driveFolderUrl": drive_url,
        "gcs_video_url": gcs_url,
        "gcsVideoUrl": gcs_url,
        "gcs_blob_name": gcs_video["blob_name"] if gcs_video else None,
        "video_source": "gcs",
        "is_uploading": is_uploading,
        "upload_status": "UPLOADING" if is_uploading else "COMPLETED",
        "cached": False
    }


@app.get("/api/transcript")
def get_transcript(
    url: str = Query(..., description="Video URL or Video ID"),
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library"),
    course_name: Optional[str] = Query(None, description="Optional course name to associate video with")
):
    try:
        video_id = extract_video_id(url)
        return process_lecture_import(video_id=video_id, email=email, course_name=course_name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/extension/import")
def extension_import(req: ExtensionImportRequest):
    try:
        if not req.video_id or not str(req.video_id).strip():
            raise HTTPException(status_code=400, detail="Missing video_id in import request")

        video_id = extract_video_id(str(req.video_id).strip())
        target_email = req.email and str(req.email).strip()
        if not target_email:
            raise HTTPException(
                status_code=401,
                detail="Authentication required: Please sign in with Google to ingest lecture videos."
            )
        return process_lecture_import(
            video_id=video_id,
            email=target_email,
            course_name=req.course_name,
            player_config=req.player_config,
            video_details=req.video_details,
            lms_page_url=req.lms_page_url
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to import lecture: {str(e)}")


# ==============================================================================
# Transcript Manual Cue Editing & Invalidation Endpoints
# ==============================================================================

@app.patch("/api/lecture/{video_id}/cues/{cue_id}")
def update_transcript_cue_endpoint(video_id: str, cue_id: int, req: UpdateCueRequest):
    """
    Manually update a single cue's text, synchronously re-index Algolia and Pinecone,
    flush Redis cache, and mark the lecture summary as outdated.
    """
    vid = str(video_id).strip()
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Cue text cannot be empty.")

    updated_cue = db_manager.update_transcript_cue(vid, cue_id, req.text.strip())
    if not updated_cue:
        raise HTTPException(status_code=404, detail=f"Cue {cue_id} not found for lecture {vid}.")

    # Keep downstream Algolia and Pinecone in sync with canonical updated cues
    saved = db_manager.get_saved_video(vid)
    if saved and saved.get("cues"):
        title = saved.get("title", f"Lecture {vid}")
        try:
            algolia_service.ingest_cues(vid, title, saved["cues"], updated_cue_id=cue_id)
        except Exception as a_err:
            print(f"[Algolia Sync Notice] {a_err}")
        try:
            pinecone_rag_engine.ingest_transcript(vid, title, saved["cues"])
        except Exception as p_err:
            print(f"[Pinecone Sync Notice] {p_err}")

    if redis_cache:
        redis_cache.invalidate_video(vid)

    return {
        "status": "success",
        "video_id": vid,
        "cue": updated_cue,
        "summary_outdated": True
    }


# ==============================================================================
# Interactive Book Reader: Highlights, Margin Notes & Contextual AI
# ==============================================================================

@app.get("/api/lecture/{video_id}/annotations")
def get_transcript_annotations_endpoint(
    video_id: str,
    user_email: Optional[str] = Query(None, description="Optional user email filter")
):
    """Retrieve all highlights, margin notes, and embedded AI responses for a lecture."""
    vid = str(video_id).strip()
    annotations = db_manager.get_annotations(vid, user_email=user_email)
    return {
        "status": "success",
        "video_id": vid,
        "count": len(annotations),
        "annotations": annotations
    }


@app.post("/api/lecture/{video_id}/annotations")
def create_transcript_annotation_endpoint(video_id: str, req: CreateAnnotationRequest):
    """Create a persistent highlight, margin note, or pinned AI response."""
    vid = str(video_id).strip()
    if not req.selected_text or not req.selected_text.strip():
        raise HTTPException(status_code=400, detail="Selected text is required.")

    annotation = db_manager.add_annotation(
        video_id=vid,
        user_email=req.user_email or "anonymous",
        selected_text=req.selected_text.strip(),
        annotation_type=req.annotation_type,
        cue_id=req.cue_id,
        start_seconds=req.start_seconds or 0.0,
        end_seconds=req.end_seconds or 0.0,
        color=req.color,
        note_text=req.note_text,
        ai_prompt=req.ai_prompt,
        ai_response=req.ai_response
    )
    if not annotation:
        raise HTTPException(status_code=500, detail="Failed to save annotation.")

    return {
        "status": "success",
        "video_id": vid,
        "annotation": annotation
    }


@app.delete("/api/lecture/{video_id}/annotations/{annotation_id}")
def delete_transcript_annotation_endpoint(
    video_id: str,
    annotation_id: str,
    user_email: Optional[str] = Query(None)
):
    """Delete a highlight, note, or AI explanation."""
    deleted = db_manager.delete_annotation(annotation_id, user_email=user_email)
    if not deleted:
        raise HTTPException(status_code=404, detail="Annotation not found or could not be deleted.")
    return {"status": "success", "annotation_id": annotation_id}


class UpdateAnnotationRequest(BaseModel):
    note_text: Optional[str] = None
    ai_prompt: Optional[str] = None
    ai_response: Optional[str] = None
    annotation_type: Optional[str] = None
    user_email: Optional[str] = None


@app.patch("/api/lecture/{video_id}/annotations/{annotation_id}")
def update_transcript_annotation_endpoint(
    video_id: str,
    annotation_id: str,
    req: UpdateAnnotationRequest
):
    """Update an existing margin note, AI response, or annotation."""
    has_note = req.note_text is not None and req.note_text.strip() != ""
    has_ai = req.ai_response is not None and req.ai_response.strip() != ""
    if not has_note and not has_ai and not req.annotation_type:
        raise HTTPException(status_code=400, detail="Updated note text or AI response cannot be empty.")
    updated = db_manager.update_annotation(
        annotation_id=annotation_id,
        note_text=req.note_text.strip() if req.note_text is not None else None,
        ai_prompt=req.ai_prompt.strip() if req.ai_prompt is not None else None,
        ai_response=req.ai_response.strip() if req.ai_response is not None else None,
        annotation_type=req.annotation_type.strip() if req.annotation_type is not None else None,
        user_email=req.user_email
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    return {"status": "success", "annotation": updated}


@app.post("/api/lecture/{video_id}/explain-selection")
def explain_selection_endpoint(video_id: str, req: ExplainSelectionRequest):
    """Generate a contextual AI explanation, math breakdown, or analogy for selected transcript text."""
    vid = str(video_id).strip()
    if not req.selected_text or not req.selected_text.strip():
        raise HTTPException(status_code=400, detail="No text selected to explain.")

    saved = db_manager.get_saved_video(vid)
    title = saved.get("title", f"Lecture {vid}") if saved else "Lecture"

    # Grab surrounding context if available
    context_window = ""
    if saved and saved.get("cues") and req.start_seconds is not None:
        target_sec = float(req.start_seconds)
        nearby = [
            c.get("text", "") for c in saved["cues"]
            if abs(float(c.get("seconds", 0)) - target_sec) <= 45
        ]
        context_window = " ".join(nearby)

    explanation = explain_selected_transcript_text(
        selected_text=req.selected_text.strip(),
        prompt_type=req.prompt_type or "explain",
        custom_prompt=req.custom_prompt,
        lecture_title=title,
        context_window=context_window
    )

    return {
        "status": "success",
        "video_id": vid,
        "selected_text": req.selected_text.strip(),
        "prompt_type": req.prompt_type,
        "explanation": explanation
    }


# ==============================================================================
# Predicted Quizzes & Proactive Reminder Engine
# ==============================================================================

@app.get("/api/reminders/upcoming-quizzes")
def get_upcoming_predicted_quizzes_endpoint(
    status: Optional[str] = Query("active", description="Filter status: 'active', 'pending', 'confirmed', or 'all'")
):
    """Retrieve all upcoming predicted quizzes extracted via LLM during summary ingestion."""
    filter_status = None if status == "all" else status
    quizzes = db_manager.get_predicted_quizzes(status=filter_status)
    return {
        "status": "success",
        "count": len(quizzes),
        "quizzes": quizzes
    }


@app.get("/api/lecture/{video_id}/predicted-quizzes")
def get_lecture_predicted_quizzes_endpoint(video_id: str):
    """Retrieve predicted quizzes for a specific lecture."""
    vid = str(video_id).strip()
    quizzes = db_manager.get_predicted_quizzes(video_id=vid)
    return {
        "status": "success",
        "video_id": vid,
        "count": len(quizzes),
        "quizzes": quizzes
    }


@app.patch("/api/reminders/quiz/{quiz_id}")
def update_predicted_quiz_status_endpoint(quiz_id: str, req: UpdateQuizReminderRequest):
    """Update predicted quiz status (e.g. 'dismissed', 'confirmed', 'pending')."""
    qid = str(quiz_id).strip()
    updated = db_manager.update_predicted_quiz_status(qid, req.status.strip().lower())
    if not updated:
        raise HTTPException(status_code=404, detail=f"Predicted quiz {qid} not found.")
    return {
        "status": "success",
        "quiz": updated
    }


@app.post("/api/lecture/{video_id}/predict-quizzes")
def trigger_lecture_quiz_prediction_endpoint(video_id: str):
    """Trigger on-demand LLM prediction of upcoming quizzes from transcript cues."""
    vid = str(video_id).strip()
    saved = db_manager.get_saved_video(vid)
    if not saved or not saved.get("cues"):
        raise HTTPException(status_code=404, detail=f"No cues found for lecture {vid}.")
    quizzes = predict_and_store_quizzes(
        vid,
        saved.get("title", f"Lecture {vid}"),
        saved["cues"],
        course_name=saved.get("course_name"),
    )
    return {
        "status": "success",
        "video_id": vid,
        "count": len(quizzes),
        "quizzes": quizzes
    }


# ==============================================================================
# Audio-Grounded Multimodal AI Review & Candidate Edits
# ==============================================================================

@app.post("/api/lecture/{video_id}/review")
def trigger_transcript_review_endpoint(video_id: str, req: ReviewTranscriptRequest):
    """
    Trigger speech-recognition review and spoken math to LaTeX conversion.
    Returns candidate suggestions without modifying canonical transcript.
    """
    vid = str(video_id).strip()
    saved = db_manager.get_saved_video(vid)
    if not saved or not saved.get("cues"):
        raise HTTPException(status_code=404, detail=f"No cues found for lecture {vid} to review.")

    job_id = db_manager.create_review_job(vid, review_mode=req.review_mode or "audio_grounded")

    audio_path = None
    try:
        audio_path = resolve_lecture_audio_file(vid, course_name=saved.get("course_name"))
        suggestions = review_transcript_cues(
            cues=saved["cues"],
            video_title=saved.get("title", f"Lecture {vid}"),
            audio_path=audio_path,
            review_mode=req.review_mode or "audio_grounded"
        )
        saved_suggs = db_manager.save_review_suggestions(job_id, vid, suggestions)
        db_manager.update_review_job(job_id, "completed")
        return {
            "status": "completed",
            "job_id": job_id,
            "video_id": vid,
            "review_mode": req.review_mode,
            "audio_verified": bool(audio_path is not None),
            "count": len(saved_suggs),
            "suggestions": saved_suggs
        }
    except Exception as e:
        db_manager.update_review_job(job_id, "failed", error_message=str(e))
        raise HTTPException(status_code=500, detail=f"Transcript review failed: {e}")
    finally:
        if audio_path and audio_path.exists():
            try:
                audio_path.unlink()
            except Exception:
                pass


@app.get("/api/lecture/{video_id}/review/status")
def get_transcript_review_status_endpoint(
    video_id: str,
    job_id: Optional[str] = Query(None)
):
    """Fetch status and current candidate suggestions for a transcript review."""
    vid = str(video_id).strip()
    job = db_manager.get_review_job(job_id=job_id, video_id=vid)
    suggestions = db_manager.get_review_suggestions(vid, review_id=job["id"] if job else None)
    return {
        "status": job.get("status") if job else "none",
        "job": job,
        "video_id": vid,
        "count": len(suggestions),
        "suggestions": suggestions
    }


@app.post("/api/lecture/{video_id}/review/suggestions/{suggestion_id}/accept")
def accept_review_suggestion_endpoint(video_id: str, suggestion_id: str):
    """
    Accept an AI review suggestion: updates the canonical cue text in PostgreSQL,
    synchronizes Algolia and Pinecone, flushes Redis, and marks the summary outdated.
    """
    vid = str(video_id).strip()
    suggestions = db_manager.get_review_suggestions(vid)
    matching = next((s for s in suggestions if s["id"] == suggestion_id), None)
    if not matching:
        raise HTTPException(status_code=404, detail="Suggestion not found.")

    cue_id = matching.get("cueId")
    if not cue_id:
        # Fallback by matching seconds if cueId wasn't stored
        saved = db_manager.get_saved_video(vid)
        if saved and saved.get("cues"):
            for c in saved["cues"]:
                if abs(float(c.get("seconds", 0)) - matching["startSeconds"]) <= 2:
                    cue_id = c.get("id")
                    break

    if not cue_id:
        raise HTTPException(status_code=400, detail="Could not resolve matching cue to update.")

    updated_cue = db_manager.update_transcript_cue(vid, cue_id, matching["suggestedText"])
    db_manager.update_suggestion_status(suggestion_id, "accepted")

    # Invalidate downstream services
    saved = db_manager.get_saved_video(vid)
    if saved and saved.get("cues"):
        title = saved.get("title", f"Lecture {vid}")
        try:
            algolia_service.ingest_cues(vid, title, saved["cues"], updated_cue_id=cue_id)
        except Exception:
            pass
        try:
            pinecone_rag_engine.ingest_transcript(vid, title, saved["cues"])
        except Exception:
            pass

    if redis_cache:
        redis_cache.invalidate_video(vid)

    return {
        "status": "success",
        "video_id": vid,
        "suggestion_id": suggestion_id,
        "cue": updated_cue,
        "summary_outdated": True
    }


@app.post("/api/lecture/{video_id}/review/suggestions/{suggestion_id}/reject")
def reject_review_suggestion_endpoint(video_id: str, suggestion_id: str):
    """Dismiss an AI suggestion without modifying canonical transcript."""
    updated = db_manager.update_suggestion_status(suggestion_id, "rejected")
    if not updated:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return {"status": "success", "suggestion_id": suggestion_id, "status": "rejected"}


@app.post("/api/lecture/{video_id}/review/suggestions/{suggestion_id}/undo")
def undo_review_suggestion_endpoint(video_id: str, suggestion_id: str):
    """Undo an accepted suggestion: restores original text and resets status to pending."""
    vid = str(video_id).strip()
    suggestions = db_manager.get_review_suggestions(vid)
    matching = next((s for s in suggestions if s["id"] == suggestion_id), None)
    if not matching:
        raise HTTPException(status_code=404, detail="Suggestion not found.")

    cue_id = matching.get("cueId")
    if cue_id:
        db_manager.update_transcript_cue(vid, cue_id, matching["originalText"])

    db_manager.update_suggestion_status(suggestion_id, "pending")

    # Invalidate downstream services
    saved = db_manager.get_saved_video(vid)
    if saved and saved.get("cues"):
        title = saved.get("title", f"Lecture {vid}")
        try:
            algolia_service.ingest_cues(vid, title, saved["cues"], updated_cue_id=cue_id)
            pinecone_rag_engine.ingest_transcript(vid, title, saved["cues"])
        except Exception:
            pass

    if redis_cache:
        redis_cache.invalidate_video(vid)

    return {"status": "success", "suggestion_id": suggestion_id, "status": "pending"}


@app.post("/api/search")
def algolia_search(req: AlgoliaSearchRequest):
    """Sub-10ms instant keyword search strictly via Algolia Cloud."""
    try:
        hits = algolia_service.search(req.query, video_id=req.video_id, limit=req.limit or 20)
        return {"hits": hits, "results": hits, "count": len(hits), "available": True}
    except Exception as e:
        logger.warning(f"[Algolia Search Unavailable] {e}")
        return {
            "hits": [],
            "results": [],
            "count": 0,
            "available": False,
            "error": f"Algolia transcript search is currently unavailable: {str(e)}"
        }

@app.post("/api/rag/query")
def rag_query(req: RAGQueryRequest):
    """Perform grounded retrieval + multi-model answer synthesis with transparent logging."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query string cannot be empty")

    video_id = str(req.video_id or "").strip()
    video_title = (req.video_title or "").strip()
    if video_id and not video_title:
        saved_vid = db_manager.get_saved_video(video_id)
        if saved_vid and saved_vid.get("title"):
            video_title = saved_vid["title"]

    t_start = time.time()
    print("\n" + "=" * 60)
    print(f"📥 [API /api/rag/query] === Incoming RAG Query ===")
    print(f"   Query: '{req.query}'")
    print(f"   Video ID: '{video_id}' | Title: '{video_title or 'Auto'}'")
    print(f"   Top K: {req.top_k} | Web Search Enabled: {req.enable_web_search} | Bypass Cache: {req.bypass_cache} | Enforce Regenerate: {req.enforce_regenerate}")

    # 1. Check Hosted Redis Cache First
    if not req.bypass_cache and video_id and redis_cache:
        cached_result = redis_cache.get_query(video_id, req.query, "auto")
        if cached_result and (not cached_result.get("video_id") or cached_result.get("video_id") == video_id):
            elapsed = time.time() - t_start
            print(f"⚡ [API /api/rag/query Cache HIT] Returned from Hosted Redis in {elapsed*1000:.2f}ms")
            print("=" * 60 + "\n")
            return cached_result

    # 2. Direct Conversational RAG Query (Router Decoupled)
    print("🔍 [API /api/rag/query] Executing conversational RAG via Hybrid Search + RRF pipeline")
    try:
        result = pinecone_rag_engine.query_rag(
            req.query,
            video_id=video_id,
            video_title=video_title,
            cues=req.cues,
            top_k=req.top_k or 10,
            enable_web_search=req.enable_web_search if req.enable_web_search is not None else True,
            user_email=req.user_email,
            chat_history=req.chat_history,
            enforce_regenerate=req.enforce_regenerate or False
        )
    except Exception as e:
        elapsed = time.time() - t_start
        print(f"\n❌ [API /api/rag/query Error] Failed after {elapsed:.2f}s:")
        traceback.print_exc()
        print("=" * 60 + "\n")
        
        err_type = type(e).__name__
        err_msg = str(e)
        if "Timeout" in err_type or "timed out" in err_msg.lower():
            raise HTTPException(status_code=504, detail=f"LLM upstream gateway timeout: {err_msg}")
        elif "Connection" in err_type or "RequestException" in err_type:
            raise HTTPException(status_code=502, detail=f"LLM upstream network connection error: {err_msg}")
        elif isinstance(e, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid query parameter: {err_msg}")
        elif isinstance(e, RuntimeError):
            raise HTTPException(status_code=502, detail=f"Agent RAG execution error: {err_msg}")
        else:
            raise HTTPException(status_code=500, detail=f"{err_type}: {err_msg}")

    # Auto-generate academic submission version
    sub_res = pinecone_rag_engine.generate_submission_version(
        original_text=result.get("answer", ""),
        video_id=req.video_id,
        word_count=120,
        query=req.query
    )
    result["submission_text"] = sub_res.get("submission_text", "")
    result["submission_word_count"] = sub_res.get("word_count", 0)

    if req.video_id:
        try:
            db_manager.save_chat_log(
                video_id=req.video_id,
                user_prompt=req.query,
                ai_reply=result.get("answer", ""),
                citations=result.get("citations", []),
                user_email=req.user_email,
                submission_text=result.get("submission_text", ""),
                model=result.get("model", ""),
                web_sources=result.get("web_sources", [])
            )
        except Exception as e:
            print(f"⚠️ [Chat Log Notice]: {e}")

    # Store in Hosted Redis Cache
    if req.video_id and redis_cache:
        redis_cache.set_query(req.video_id, req.query, "auto", result)

    elapsed = time.time() - t_start
    print(f"✅ [API /api/rag/query] Completed in {elapsed:.2f}s | Citations: {len(result.get('citations', []))} | Model: {result.get('model')}")
    print("=" * 60 + "\n")
    return result

def process_chat_message(
    user_prompt: str,
    video_id: str = "active",
    video_title: str = "",
    cues: Optional[List[Dict[str, str]]] = None,
    user_email: Optional[str] = None,
    bypass_cache: bool = False,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    save_to_db: bool = True
) -> Dict[str, Any]:
    """Internal core processor for chat queries, RAG retrieval, and full transcript summaries."""
    user_prompt = (user_prompt or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    vid = str(video_id or "active").strip()
    title = (video_title or "").strip()
    if vid and vid != "active" and not title:
        saved_vid = db_manager.get_saved_video(vid)
        if saved_vid and saved_vid.get("title"):
            title = saved_vid["title"]
    title = title or "Lecture"

    t_start = time.time()
    print("\n" + "=" * 60)
    print(f"📥 [Chat Engine] === Processing Query ===")
    print(f"   Message: '{user_prompt}' | Video ID: '{vid}' | Title: '{title}' | Bypass Cache: {bypass_cache}")

    # 1. Check Hosted Redis Cache First
    if not bypass_cache and vid and vid != "active" and redis_cache:
        cached_result = redis_cache.get_query(vid, user_prompt, "auto")
        if cached_result and (not cached_result.get("video_id") or cached_result.get("video_id") == vid):
            elapsed = time.time() - t_start
            print(f"⚡ [Chat Engine Cache HIT] Returned from Hosted Redis in {elapsed*1000:.2f}ms")
            print("=" * 60 + "\n")
            return {
                "reply": cached_result.get("answer", ""),
                "citations": cached_result.get("citations", []),
                "web_sources": cached_result.get("web_sources", []),
                "model": cached_result.get("model", ""),
                "submission_text": cached_result.get("submission_text", ""),
                "submission_word_count": cached_result.get("submission_word_count", 0),
                "cached": True
            }

    # 2. Conversational RAG execution
    # Hydrate the process-local chunk store only. Pinecone vectors and the Algolia index are written
    # at import time (and on cue edits), so re-upserting them per request is redundant network I/O.
    if cues is not None and len(cues) > 0 and len(pinecone_rag_engine.local_chunks) == 0:
        pinecone_rag_engine.ingest_transcript(vid, title, cues, upsert=False)

    try:
        print("🔍 [Chat Engine] Executing conversational RAG pipeline")
        rag_res = pinecone_rag_engine.query_rag(
            user_prompt,
            video_id=vid,
            video_title=title,
            cues=cues,
            top_k=10,
            enable_web_search=True,
            user_email=user_email,
            chat_history=chat_history
        )
    except Exception as e:
        elapsed = time.time() - t_start
        print(f"\n❌ [Chat Engine Error] Failed after {elapsed:.2f}s:")
        traceback.print_exc()
        print("=" * 60 + "\n")
        err_type = type(e).__name__
        err_msg = str(e)
        if "Timeout" in err_type or "timed out" in err_msg.lower():
            raise HTTPException(status_code=504, detail=f"LLM upstream gateway timeout: {err_msg}")
        elif "Connection" in err_type or "RequestException" in err_type:
            raise HTTPException(status_code=502, detail=f"LLM upstream network connection error: {err_msg}")
        elif isinstance(e, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid query parameter: {err_msg}")
        else:
            raise HTTPException(status_code=502, detail=f"Agent RAG execution error: {err_msg}")

    reply = rag_res.get("answer", "")
    citations = rag_res.get("citations", [])

    # Auto-generate academic submission version
    sub_text = ""
    sub_word_count = 0
    if reply and reply.strip():
        try:
            sub_res = pinecone_rag_engine.generate_submission_version(
                original_text=reply,
                video_id=vid,
                word_count=120,
                query=user_prompt
            )
            sub_text = sub_res.get("submission_text", "")
            sub_word_count = sub_res.get("word_count", 0)
        except Exception as e:
            print(f"⚠️ [Submission Gen Notice]: {e}")

    # Save to Chat History DB
    if save_to_db:
        try:
            db_manager.save_chat_log(
                video_id=vid,
                user_prompt=user_prompt,
                ai_reply=reply,
                citations=citations,
                user_email=user_email,
                submission_text=sub_text,
                model=rag_res.get("model", ""),
                web_sources=rag_res.get("web_sources", [])
            )
        except Exception as e:
            print(f"⚠️ [Chat Log Notice]: {e}")

    # Store in Hosted Redis Cache
    if vid and vid != "active" and redis_cache:
        cache_data = {
            "answer": reply,
            "citations": citations,
            "web_sources": rag_res.get("web_sources", []),
            "model": rag_res.get("model", ""),
            "submission_text": sub_text,
            "submission_word_count": sub_word_count,
            "lecture_title": title,
            "video_id": vid
        }
        redis_cache.set_query(vid, user_prompt, "auto", cache_data)

    elapsed = time.time() - t_start
    print(f"✅ [Chat Engine] Completed in {elapsed:.2f}s | Citations: {len(citations)} | Model: {rag_res.get('model')}")
    print("=" * 60 + "\n")

    return {
        "reply": reply,
        "citations": citations,
        "web_sources": rag_res.get("web_sources", []),
        "model": rag_res.get("model", ""),
        "submission_text": sub_text,
        "submission_word_count": sub_word_count
    }


@app.post("/api/chat")
def chat_with_transcript(req: ChatRequest):
    """Route chat queries through RAG engine and save to DB."""
    return process_chat_message(
        user_prompt=req.message,
        video_id=req.video_id,
        video_title=req.video_title,
        cues=req.cues,
        user_email=req.user_email,
        bypass_cache=req.bypass_cache or False,
        chat_history=req.chat_history,
        save_to_db=True
    )


@app.get("/api/chat/history")
def get_chat_history(
    video_id: str = Query(..., description="Video ID"),
    email: Optional[str] = Query(None, description="User email for scoped history"),
    user_email: Optional[str] = Query(None, description="User email alias")
):
    """Retrieve full chronological conversation history for a lecture from PostgreSQL."""
    vid = video_id.strip()
    target_email = (email or user_email or "").strip()
    if not vid:
        raise HTTPException(status_code=400, detail="video_id parameter is required.")

    messages = db_manager.get_chat_history(vid, user_email=target_email)
    return {
        "status": "success",
        "video_id": vid,
        "count": len(messages),
        "messages": messages
    }


@app.delete("/api/chat/history")
def clear_chat_history(
    video_id: str = Query(..., description="Video ID"),
    email: Optional[str] = Query(None, description="User email for scoped history"),
    user_email: Optional[str] = Query(None, description="User email alias")
):
    """Clear conversation history for a video/user session."""
    vid = video_id.strip()
    target_email = (email or user_email or "").strip()
    if not vid:
        raise HTTPException(status_code=400, detail="video_id parameter is required.")

    success = db_manager.clear_chat_history(vid, user_email=target_email)
    if redis_cache:
        redis_cache.invalidate_video(vid)
    return {
        "status": "success" if success else "failed",
        "video_id": vid
    }


@app.delete("/api/chat/message")
def delete_chat_message(
    message_id: str = Query(..., description="Message ID to delete (e.g., msg_user_123 or msg_bot_123)"),
    video_id: Optional[str] = Query(None, description="Optional Video ID"),
    email: Optional[str] = Query(None, description="User email for scoped deletion"),
    user_email: Optional[str] = Query(None, description="User email alias")
):
    """Delete a single message or QA log from PostgreSQL."""
    mid = str(message_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="message_id parameter is required.")

    target_email = (email or user_email or "").strip()
    success = db_manager.delete_chat_message(
        message_id=mid,
        video_id=video_id.strip() if video_id else None,
        user_email=target_email or None
    )
    if video_id and redis_cache:
        redis_cache.invalidate_video(video_id.strip())
    return {
        "status": "success" if success else "failed",
        "message_id": mid
    }


@app.post("/api/rag/query/submission")
@app.post("/api/rag/condense")
@app.post("/api/submission")
def condense_for_submission(req: SubmissionRequest):
    """Condense learning answer into an authentic 100-150 word academic submission."""
    if not req.original_text.strip():
        raise HTTPException(status_code=400, detail="original_text cannot be empty")
    return pinecone_rag_engine.generate_submission_version(
        original_text=req.original_text,
        video_id=req.video_id or "",
        word_count=req.word_count or 120
    )


# ==============================================================================
# Dynamic AI Summary Regeneration Endpoint
# ==============================================================================

@app.post("/api/summary/regenerate")
def regenerate_summary(req: RegenerateSummaryRequest):
    """Regenerate dynamic AI summary from actual transcript cues and persist to DB."""
    video_id = req.video_id.strip()
    saved = db_manager.get_saved_video(video_id)
    if not saved or not saved.get("cues"):
        raise HTTPException(status_code=404, detail=f"No cues found in database for video {video_id}.")

    title = saved.get("title", f"Lecture {video_id}")
    new_summary = generate_summary_sections(saved["cues"], title)

    # Persist updated dynamic summary to PostgreSQL
    db_manager.update_summary_sections(video_id, new_summary)

    # Invalidate Redis cache for this video
    if redis_cache:
        redis_cache.invalidate_video(video_id)

    # Re-trigger background podcast audio & metadata generation for refreshed summary
    summary_text = "\n\n".join([f"## {s.get('heading', '')}\n{s.get('content', '')}" for s in new_summary if isinstance(s, dict)])
    if summary_text:
        trigger_background_podcast_generation(
            video_id=video_id,
            title=title,
            text=summary_text,
            mode="study",
            course_name=saved.get("course_name"),
            force_refresh=True
        )

    return {
        "status": "success",
        "video_id": video_id,
        "title": title,
        "summarySections": new_summary
    }


# ==============================================================================
# Dedicated Lecture Summary & Submission Endpoints
# ==============================================================================

@app.get("/api/summary/lecture")
def get_lecture_summaries_endpoint(
    video_id: str = Query(..., description="Video ID"),
    user_email: Optional[str] = Query(None, description="User email for personalized summaries")
):
    """
    Retrieve all saved lecture summaries for a video, keyed by summary type.
    """
    vid = str(video_id).strip()
    if not vid:
        raise HTTPException(status_code=400, detail="video_id parameter is required.")

    summaries = db_manager.get_lecture_summaries(vid, user_email=user_email)
    return {
        "status": "success",
        "video_id": vid,
        "count": len(summaries),
        "summaries": summaries
    }


@app.post("/api/summary/generate")
def generate_lecture_summary_endpoint(req: GenerateLectureSummaryRequest):
    """
    Generate or regenerate the comprehensive lecture summary from the full transcript and persist it
    to lecturescribe_lecture_summaries without touching chat logs or the chat/RAG pipeline.
    """
    vid = str(req.video_id).strip()
    if not vid or vid == "active":
        raise HTTPException(status_code=400, detail="A valid video_id is required.")

    # Comprehensive is the only supported summary type; any legacy value (e.g. "15_min") maps to it.
    summary_type = "comprehensive"

    # Return existing summary if cached and bypass_cache is False
    if not req.bypass_cache:
        existing = db_manager.get_lecture_summary(vid, summary_type, user_email=req.user_email)
        if existing and existing.get("markdownText"):
            return {
                "status": "success",
                "video_id": vid,
                "summary": existing,
                "cached": True
            }

    saved_vid = db_manager.get_saved_video(vid)
    title = (req.video_title or (saved_vid.get("title") if saved_vid else None) or "Lecture").strip()
    cues = req.cues or (saved_vid.get("cues") if saved_vid else None) or []
    if not cues:
        raise HTTPException(status_code=404, detail=f"No cues found for video {vid} to generate summary.")

    print(f"📥 [Summary API] Received /api/summary/generate for video '{vid}' | Bypass Cache: {req.bypass_cache} | Cues: {len(cues)}")

    lock = _get_summary_lock(vid, req.user_email)
    waited = lock.locked()
    with lock:
        if waited:
            # Another generation (e.g. the import-time background job) for this lecture/user just
            # finished while we waited; reuse its result instead of paying for a second LLM run.
            fresh = db_manager.get_lecture_summary(vid, summary_type, user_email=req.user_email)
            if fresh and fresh.get("markdownText"):
                return {"status": "success", "video_id": vid, "summary": fresh, "cached": True}
        try:
            stored = generate_and_store_comprehensive_summary(vid, title, cues, req.user_email)
        except HTTPException:
            raise
        except Exception as e:
            print(f"❌ [Summary API] Generation failed for '{vid}': {e}")
            raise HTTPException(status_code=502, detail=f"Summary generation failed: {e}")

    if not stored or not isinstance(stored, dict):
        raise HTTPException(status_code=502, detail="Summary generation returned no content.")

    if stored.get("markdownText"):
        course_title = ((saved_vid.get("course_name") if saved_vid else None) or extract_course_name(title)).strip()
        if not course_title:
            raise HTTPException(status_code=400, detail="course_name is required.")
        trigger_background_podcast_generation(
            video_id=vid,
            title=title,
            text=stored.get("markdownText"),
            mode="study",
            course_name=course_title,
            force_refresh=bool(req.bypass_cache)
        )
        if stored.get("submissionText"):
            trigger_background_podcast_generation(
                video_id=vid,
                title=title,
                text=stored.get("submissionText"),
                mode="submission",
                course_name=course_title,
                force_refresh=bool(req.bypass_cache)
            )

    return {
        "status": "success",
        "video_id": vid,
        "summary": stored,
        "cached": False
    }


class SaveCustomSummaryRequest(BaseModel):
    video_id: str
    summary_type: Optional[str] = "comprehensive"
    markdown_text: str
    submission_text: Optional[str] = None
    user_email: Optional[str] = None


@app.post("/api/summary/custom")
def save_custom_summary_endpoint(req: SaveCustomSummaryRequest):
    """
    Save custom or user-edited summary markdown directly into lecturescribe_lecture_summaries.
    Allows students to paste summaries generated from external AI or manually edit study notes.
    """
    clean_vid = str(req.video_id).strip()
    if not clean_vid or clean_vid == "active":
        raise HTTPException(status_code=400, detail="Valid video_id is required.")

    md_text = req.markdown_text.strip()
    if not md_text:
        raise HTTPException(status_code=400, detail="Markdown summary text cannot be empty.")

    submission_text = req.submission_text
    if not submission_text or not submission_text.strip():
        try:
            submission_text = pinecone_rag_engine._clean_for_submission(md_text, target_words=250)
        except Exception:
            submission_text = re.sub(r'#+\s*', '', md_text)[:1500]

    words = len(re.findall(r'\b\w+\b', md_text))

    saved = db_manager.save_lecture_summary(
        video_id=clean_vid,
        summary_type=req.summary_type or "comprehensive",
        markdown_text=md_text,
        submission_text=submission_text,
        word_count=words,
        model="Custom (User Imported)",
        user_email=req.user_email
    )

    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save custom summary to database.")

    try:
        saved_vid = db_manager.get_saved_video(clean_vid) or db_manager.get_video(clean_vid)
        course_name = saved_vid.get("course_name") if saved_vid else None
        title = saved_vid.get("title") if saved_vid else "Lecture Summary"
        trigger_background_podcast_generation(
            video_id=clean_vid,
            title=title,
            text=md_text,
            mode="study",
            course_name=course_name,
            force_refresh=True
        )
        if submission_text:
            trigger_background_podcast_generation(
                video_id=clean_vid,
                title=title,
                text=submission_text,
                mode="submission",
                course_name=course_name,
                force_refresh=True
            )
    except Exception as e:
        logger.warning(f"Could not trigger background podcast for custom summary: {e}")

    return {
        "status": "success",
        "summary": {
            "videoId": clean_vid,
            "summaryType": req.summary_type or "comprehensive",
            "markdownText": md_text,
            "submissionText": submission_text,
            "wordCount": words,
            "model": "Custom (User Imported)"
        }
    }


@app.post("/api/lecture/{video_id}/summary/clear-outdated")
def clear_summary_outdated_endpoint(video_id: str):
    """Clear the outdated flag on summaries for a lecture."""
    vid = str(video_id).strip()
    db_manager.clear_summary_outdated(vid)
    if redis_cache:
        redis_cache.invalidate_video(vid)
    return {
        "status": "success",
        "video_id": vid,
        "is_outdated": False,
        "summary_outdated": False
    }


# ==============================================================================
# Lecture Podcast & Single-Narrator Audio Recap Endpoints
# ==============================================================================

class GeneratePodcastRequest(BaseModel):
    video_id: str
    title: Optional[str] = "Lecture Summary"
    text: Optional[str] = None
    mode: Optional[str] = "study"
    force_refresh: Optional[bool] = False
    user_email: Optional[str] = None


@app.get("/api/lectures/{video_id}/podcast")
def get_lecture_podcast_endpoint(
    video_id: str,
    mode: str = Query("study", description="Mode: 'study' for full summary, 'submission' for assignment prose"),
    course_name: Optional[str] = Query(None, description="Course name for GCS path resolution")
):
    """Retrieve metadata and stream URL for an existing lecture podcast audio recap."""
    clean_vid = str(video_id).strip()
    if not clean_vid or clean_vid == "active":
        raise HTTPException(status_code=400, detail="Valid video_id is required.")

    meta = get_podcast_metadata(clean_vid, mode=mode, course_name=course_name)
    if not meta or not meta.get("exists"):
        if meta and meta.get("status") == "generating":
            return {
                "status": "success",
                "data": meta
            }
        return {
            "status": "success",
            "data": {
                "exists": False,
                "video_id": clean_vid,
                "mode": mode,
                "status": "none"
            }
        }

    return {
        "status": "success",
        "data": meta
    }


@app.post("/api/lectures/{video_id}/podcast/generate")
def generate_lecture_podcast_endpoint(
    video_id: str,
    req: GeneratePodcastRequest
):
    """Generate or retrieve a single-narrator podcast audio recap using Google TTS."""
    clean_vid = str(video_id).strip() or str(req.video_id).strip()
    if not clean_vid or clean_vid == "active":
        raise HTTPException(status_code=400, detail="Valid video_id is required.")

    mode = "submission" if req.mode == "submission" else "study"
    effective_text = req.text

    # If text not supplied in payload, fetch from saved summary in database
    if not effective_text:
        saved_summary = db_manager.get_lecture_summary(clean_vid, "comprehensive", user_email=req.user_email)
        if saved_summary:
            if mode == "submission":
                effective_text = saved_summary.get("submissionText") or saved_summary.get("markdownText")
            else:
                effective_text = saved_summary.get("markdownText")

    # If still not found, check video record for outline / description
    if not effective_text:
        saved_vid = db_manager.get_video(clean_vid, user_email=req.user_email)
        if saved_vid:
            effective_text = saved_vid.get("description") or saved_vid.get("title")

    if not effective_text:
        raise HTTPException(status_code=404, detail="No summary or transcript text available to generate podcast narration.")

    title = req.title or "Lecture Summary"
    try:
        meta = create_or_refresh_podcast(
            video_id=clean_vid,
            title=title,
            text=effective_text,
            mode=mode,
            force_refresh=bool(req.force_refresh)
        )
        return {
            "status": "success",
            "data": meta
        }
    except Exception as e:
        logger.error(f"[Podcast API] Generation error for '{clean_vid}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate podcast audio: {e}")


@app.get("/api/lectures/{video_id}/podcast/stream")
def stream_lecture_podcast_endpoint(
    video_id: str,
    mode: str = Query("study", description="Mode: 'study' or 'submission'"),
    course_name: Optional[str] = Query(None, description="Course name for GCS path resolution")
):
    """Stream the generated MP3 audio file for the lecture podcast directly via GCS signed URL."""
    clean_vid = str(video_id).strip()
    clean_mode = "submission" if mode == "submission" else "study"
    meta = get_podcast_metadata(clean_vid, mode=clean_mode, course_name=course_name)
    if not meta or not meta.get("exists") or not meta.get("gcs_signed_url"):
        raise HTTPException(status_code=404, detail="Podcast audio not found in GCS. Please generate it first.")

    return RedirectResponse(url=meta["gcs_signed_url"], status_code=307)


# ==============================================================================
# Lecture Playback Progress Endpoints
# ==============================================================================

@app.get("/api/progress/lecture")
def get_lecture_progress_endpoint(
    video_id: str = Query(..., description="Lecture video ID"),
    user_email: Optional[str] = Query(None, description="User email")
):
    """Retrieve the saved playback progress for a lecture."""
    vid = str(video_id).strip()
    if not vid:
        raise HTTPException(status_code=400, detail="video_id parameter is required.")
    prog = db_manager.get_lecture_progress(vid, user_email=user_email)
    return {
        "status": "success",
        "video_id": vid,
        "progress": prog
    }


@app.post("/api/progress/lecture")
def save_lecture_progress_endpoint(req: SaveLectureProgressRequest):
    """Save or update the playback progress for a lecture."""
    vid = str(req.video_id).strip()
    if not vid or vid == "active":
        raise HTTPException(status_code=400, detail="A valid video_id is required.")
    item = db_manager.save_lecture_progress(
        video_id=vid,
        last_timestamp=req.last_timestamp,
        last_seconds=req.last_seconds,
        duration_seconds=req.duration_seconds,
        active_cue_idx=req.active_cue_idx,
        user_email=req.user_email
    )
    if redis_cache:
        target_email = req.user_email.strip().lower() if req.user_email and req.user_email.strip() else "anonymous"
        redis_cache.invalidate_user(target_email)
    return {
        "status": "success",
        "video_id": vid,
        "progress": item
    }


@app.get("/api/progress/user")
def get_user_progress_endpoint(
    user_email: Optional[str] = Query(None, description="User email"),
    video_ids: Optional[str] = Query(None, description="Comma-separated video IDs")
):
    """Retrieve progress mapping for all lectures belonging to a user or course."""
    v_list = [v.strip() for v in video_ids.split(",") if v.strip()] if video_ids else None
    progress_map = db_manager.get_user_progress_map(user_email=user_email, video_ids=v_list)
    return {
        "status": "success",
        "count": len(progress_map),
        "progress": progress_map
    }


# ==============================================================================
# LMS User Library Endpoints
# ==============================================================================

class UserLibraryRecordRequest(BaseModel):
    user_email: Optional[str] = None
    email: Optional[str] = None
    video_id: str
    title: Optional[str] = None
    video_title: Optional[str] = None
    duration: Optional[str] = ""
    duration_seconds: Optional[str] = None
    source_url: Optional[str] = ""
    video_url: Optional[str] = None
    drive_folder_url: Optional[str] = None
    course_name: Optional[str] = None


class CoursePinRequest(BaseModel):
    user_email: Optional[str] = None
    email: Optional[str] = None
    course_slug: Optional[str] = None
    course_name: Optional[str] = None


@app.get("/api/user/library")
def get_user_library(email: str = Query(..., description="User Google email")):
    """Fetch user's saved LMS library of lectures."""
    clean_email = (email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="User email is required.")

    if redis_cache:
        cached = redis_cache.get_user_library(clean_email)
        if cached is not None:
            return {"status": "success", "lectures": cached, "library": cached, "count": len(cached), "cached": True}

    lectures = db_manager.get_user_library(clean_email)
    if redis_cache:
        redis_cache.set_user_library(clean_email, lectures, ttl_seconds=300)
    return {"status": "success", "lectures": lectures, "library": lectures, "count": len(lectures)}


@app.get("/api/user/courses")
def get_user_courses(
    email: Optional[str] = Query(None, description="User Google email"),
    user_email: Optional[str] = Query(None, description="User Google email alias")
):
    """Fetch user's saved LMS lectures grouped into Courses."""
    target_email = (email or user_email or "").strip().lower()
    if not target_email:
        raise HTTPException(status_code=400, detail="email query parameter is required.")

    if redis_cache:
        cached = redis_cache.get_user_courses(target_email)
        if cached is not None:
            pinned_courses = db_manager.get_pinned_courses(target_email)
            return {"status": "success", "email": target_email, "count": len(cached), "courses": cached, "pinned_courses": pinned_courses, "cached": True}

    courses = db_manager.get_user_courses(target_email)
    pinned_courses = db_manager.get_pinned_courses(target_email)
    if redis_cache:
        redis_cache.set_user_courses(target_email, courses, ttl_seconds=300)
    return {"status": "success", "email": target_email, "count": len(courses), "courses": courses, "pinned_courses": pinned_courses}


@app.post("/api/user/courses/pin")
def toggle_user_course_pin(req: CoursePinRequest):
    """
    Toggle the pinned state of a course for a user.
    New pins are appended to the existing pinned courses to preserve FIFO ordering.
    """
    target_email = (req.user_email or req.email or "").strip().lower()
    target_slug = (req.course_slug or req.course_name or "").strip()
    if not target_email or not target_slug:
        raise HTTPException(status_code=400, detail="email and course_slug (or course_name) are required.")

    is_pinned_now = db_manager.toggle_course_pin(target_email, target_slug)

    if redis_cache:
        redis_cache.invalidate_user(target_email)

    pinned_courses = db_manager.get_pinned_courses(target_email)
    print(f"📌 [API /api/user/courses/pin] '{target_email}' {'pinned' if is_pinned_now else 'unpinned'} '{target_slug}'. Total pinned: {len(pinned_courses)}")
    return {
        "status": "success",
        "is_pinned": is_pinned_now,
        "course_slug": target_slug,
        "pinned_courses": pinned_courses
    }


@app.get("/api/course/{course_name}")
def get_course_details(
    course_name: str,
    email: Optional[str] = Query(None, description="User Google email")
):
    """Fetch details and aggregated lectures for a specific course by name."""
    clean_name = course_name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")
    course = db_manager.get_course_details(clean_name, user_email=email)
    if not course:
        raise HTTPException(status_code=404, detail=f"Course '{clean_name}' not found.")
    return {"status": "success", "course": course}


@app.delete("/api/course/{course_name}")
def delete_course_endpoint(
    course_name: str,
    email: str = Query(..., description="User Google email")
):
    """Full purge of a course and all its associated lectures, notes, resources, quizzes, readings, and chat logs."""
    clean_name = (course_name or "").strip()
    clean_email = (email or "").strip().lower()
    if not clean_name or not clean_email:
        raise HTTPException(status_code=400, detail="course_name and email are required.")

    if clean_email in db_manager._users_memory_cache:
        require_tutor_role(clean_email, clean_name, action_label="delete courses")

    result = db_manager.delete_course(clean_name, clean_email)

    # Best-effort delete associated GCS blobs (notes, resources, self-hosted videos)
    for blob_name in result.get("deleted_blobs") or []:
        try:
            gcs_storage_service.delete_blob(blob_name)
        except Exception as gcs_err:
            print(f"[GCS Cleanup Notice] Could not delete blob '{blob_name}': {gcs_err}")

    # Invalidate Redis user courses/library, course quiz, and per-video caches
    if redis_cache:
        redis_cache.update_user_course(clean_email, result.get("course_name") or clean_name, lecture_entry=None)
        for vid in result.get("deleted_video_ids") or []:
            redis_cache.invalidate_video(vid)

    return {
        "status": "success",
        "deleted": result.get("deleted", False),
        "course_name": result.get("course_name", clean_name),
        "course_slug": result.get("course_slug", to_course_slug(clean_name)),
        "deleted_video_ids": result.get("deleted_video_ids", []),
    }


@app.get("/api/course/{course_name}/quiz")
@app.post("/api/course/{course_name}/quiz")
def get_or_generate_course_quiz(
    course_name: str,
    regenerate: bool = Query(False, description="Force regenerate without using cache"),
    num_questions: Optional[int] = Query(None, description="Number of quiz questions to generate"),
    email: Optional[str] = Query(None, description="Signed-in user email"),
    body: Optional[QuizGenerateRequest] = None
):
    """Retrieve or generate course-wide practice quiz covering all lectures in the course."""
    clean_course = str(course_name).strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")

    is_regenerate = regenerate or (body.regenerate if body else False)
    req_count = (body.num_questions if body and body.num_questions is not None else None) or num_questions

    # 1. Check Redis Cache
    min_questions = req_count if req_count is not None else 10
    if not is_regenerate and redis_cache:
        cached_quiz = redis_cache.get_course_quiz(course_slug)
        if cached_quiz:
            cached_quiz = sanitize_quiz_payload(cached_quiz)
            if cached_quiz and len(cached_quiz.get("questions") or []) >= min_questions:
                print(f"⚡ [Redis Hit] Returning cached course quiz for '{course_slug}'.")
                if email:
                    attempt = db_manager.get_quiz_attempt("course", course_slug, email)
                    if attempt:
                        cached_quiz = dict(cached_quiz)
                        cached_quiz["user_answers"] = attempt.get("answers", {})
                        cached_quiz["user_score"] = attempt.get("score", 0)
                        cached_quiz["user_completed"] = attempt.get("completed", False)
                        cached_quiz["is_completed"] = attempt.get("completed", False)
                return cached_quiz

    # 2. Check Database Persistence
    if not is_regenerate:
        db_quiz = db_manager.get_saved_course_quiz(clean_course)
        if db_quiz and db_quiz.get("questions"):
            db_quiz = sanitize_quiz_payload(db_quiz)
            if db_quiz and len(db_quiz.get("questions") or []) >= min_questions:
                print(f"💾 [PostgreSQL Hit] Returning persisted course quiz for '{course_slug}'.")
                if redis_cache:
                    redis_cache.set_course_quiz(course_slug, db_quiz, ttl_seconds=86400)
                if email:
                    attempt = db_manager.get_quiz_attempt("course", course_slug, email)
                    if attempt:
                        db_quiz = dict(db_quiz)
                        db_quiz["user_answers"] = attempt.get("answers", {})
                        db_quiz["user_score"] = attempt.get("score", 0)
                        db_quiz["user_completed"] = attempt.get("completed", False)
                        db_quiz["is_completed"] = attempt.get("completed", False)
                return db_quiz

    # 3. Retrieve Course & Lecture list from DB
    course_info = db_manager.get_course_details(clean_course, user_email=email)
    if not course_info or not course_info.get("lectures"):
        raise HTTPException(
            status_code=404,
            detail=f"Course '{clean_course}' not found or has no recorded lectures."
        )

    canonical_title = course_info.get("course_name") or clean_course
    lectures = course_info.get("lectures", [])

    # 4. Fetch saved lecture summaries, existing quiz items, and cues fallback (avoiding token exhaustion)
    lectures_with_materials = []
    for lect in lectures:
        vid = lect.get("video_id") or lect.get("videoId")
        if not vid:
            continue
        saved_vid = db_manager.get_saved_video(vid)
        ltitle = lect.get("title") or lect.get("video_title") or (saved_vid.get("title") if saved_vid else None) or f"Lecture {vid}"

        # Fetch saved lecture summaries
        sums = db_manager.get_lecture_summaries(vid)
        summary_text = ""
        for stype in ("comprehensive", "key_points", "brief", "study_guide"):
            if sums.get(stype) and sums[stype].get("markdownText"):
                summary_text = sums[stype]["markdownText"]
                break
        if not summary_text and sums:
            first_sum = next(iter(sums.values()), None)
            if first_sum and first_sum.get("markdownText"):
                summary_text = first_sum["markdownText"]

        # Fetch existing lecture quiz items
        saved_q = db_manager.get_saved_quiz(vid)
        lecture_qs = (saved_q.get("questions") if isinstance(saved_q, dict) else []) or []

        # Minimal cues only as fallback if no summary is saved
        cues = (saved_vid.get("cues") if saved_vid else None) or []
        lectures_with_materials.append({
            "video_id": vid,
            "title": ltitle,
            "summary": summary_text,
            "existing_questions": lecture_qs,
            "cues": cues[:25] if not summary_text else []
        })

    valid_lectures = lectures_with_materials
    if not valid_lectures:
        raise HTTPException(
            status_code=400,
            detail=f"No lectures in course '{canonical_title}' have materials or summaries available to generate a quiz."
        )

    # 5. Generate Course Quiz (No Fallbacks)
    try:
        quiz_data = pinecone_rag_engine.generate_course_quiz(
            course_name=canonical_title,
            lectures_data=valid_lectures,
            num_questions=req_count
        )
        quiz_id = f"cquiz_{course_slug}_{int(time.time())}"
        quiz_data["quiz_id"] = quiz_id
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate course quiz via AI model: {str(e)}"
        )

    # 6. Persist to Relational Database
    db_manager.save_course_quiz(canonical_title, quiz_data, lecture_count=len(valid_lectures))
    db_manager.save_course_quiz_history(
        course_name=canonical_title,
        quiz_id=quiz_id,
        quiz_data=quiz_data,
        user_email=email or "",
        total_questions=len(quiz_data.get("questions") or [])
    )

    # 7. Cache in Redis (24 hours)
    if redis_cache:
        redis_cache.set_course_quiz(course_slug, quiz_data, ttl_seconds=86400)

    if email:
        attempt = db_manager.get_quiz_attempt("course", course_slug, email)
        if attempt:
            quiz_data = dict(quiz_data)
            # Only restore user answers if this is an active in-progress attempt, NOT a completed attempt
            if not attempt.get("completed"):
                quiz_data["user_answers"] = attempt.get("answers", {})
                quiz_data["user_score"] = attempt.get("score", 0)
                quiz_data["user_completed"] = False
                quiz_data["is_completed"] = False
            else:
                quiz_data["user_answers"] = {}
                quiz_data["user_score"] = attempt.get("score", 0)
                quiz_data["user_completed"] = True
                quiz_data["is_completed"] = True

    return quiz_data


@app.post("/api/course/{course_name}/quiz/answers")
def save_course_quiz_answers(course_name: str, req: QuizAnswersRequest):
    """Persist user course quiz responses directly into PostgreSQL and quiz history."""
    clean_course = str(course_name).strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")
    email = req.user_email or "anonymous"

    target_quiz_id = req.quiz_id
    if not target_quiz_id:
        hist = db_manager.get_course_quiz_history(clean_course, user_email=email)
        if hist and hist[0].get("quiz_id"):
            target_quiz_id = hist[0]["quiz_id"]

    # Protect current active quiz attempt from being clobbered when replaying a historical quiz
    current_quiz = db_manager.get_saved_course_quiz(clean_course)
    current_quiz_id = current_quiz.get("quiz_id") if isinstance(current_quiz, dict) else None
    is_replaying_past_quiz = bool(target_quiz_id and current_quiz_id and target_quiz_id != current_quiz_id)

    if not is_replaying_past_quiz:
        db_manager.save_quiz_attempt("course", course_slug, email, req.answers, req.score or 0, req.completed or False)
    else:
        db_manager.save_quiz_attempt("course_replay", f"{course_slug}:{target_quiz_id}", email, req.answers, req.score or 0, req.completed or False)

    if target_quiz_id:
        existing_item = db_manager.get_course_quiz_history_by_id(target_quiz_id)
        quiz_json = (existing_item.get("quiz_json") if existing_item else None) or current_quiz or {}
        tot_q = len(quiz_json.get("questions") or [])
        db_manager.save_course_quiz_history(
            course_name=clean_course,
            quiz_id=target_quiz_id,
            quiz_data=quiz_json,
            user_email=email,
            answers=req.answers,
            score=req.score or 0,
            total_questions=tot_q,
            completed=req.completed or False
        )
    return {"status": "success", "success": True}


@app.get("/api/course/{course_name}/summary")
@app.post("/api/course/{course_name}/summary")
def get_or_generate_course_summary(
    course_name: str,
    regenerate: bool = Query(False, description="Force regenerate course summary"),
    email: Optional[str] = Query(None, description="User email"),
    body: Optional[CourseSummaryRequest] = None
):
    """Retrieve or generate course-level executive summary across all lectures using saved lecture summaries."""
    clean_course = str(course_name).strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")

    is_regenerate = regenerate or (body.regenerate if body else False)
    user_email = (body.user_email if body and body.user_email else None) or email

    # 1. Check Redis Cache
    if not is_regenerate and redis_cache:
        cached_summary = redis_cache.get_course_summary(course_slug)
        if cached_summary and cached_summary.get("executive_summary"):
            print(f"⚡ [Redis Hit] Returning cached course summary for '{course_slug}'.")
            return {
                **cached_summary,
                "course_slug": cached_summary.get("course_slug") or course_slug,
                "course_name": cached_summary.get("course_name") or clean_course,
                "summary": cached_summary
            }

    # 2. Check Database Persistence
    if not is_regenerate:
        db_summary = db_manager.get_saved_course_summary(clean_course)
        if db_summary and db_summary.get("executive_summary"):
            print(f"💾 [PostgreSQL Hit] Returning persisted course summary for '{course_slug}'.")
            if redis_cache:
                redis_cache.set_course_summary(course_slug, db_summary, ttl_seconds=86400)
            return {
                **db_summary,
                "course_slug": db_summary.get("course_slug") or course_slug,
                "course_name": db_summary.get("course_name") or clean_course,
                "summary": db_summary
            }

    # 3. Retrieve Course & Lecture list from DB
    course_info = db_manager.get_course_details(clean_course, user_email=user_email)
    if not course_info or not course_info.get("lectures"):
        raise HTTPException(
            status_code=404,
            detail=f"Course '{clean_course}' not found or has no recorded lectures."
        )

    canonical_title = course_info.get("course_name") or clean_course
    lectures = course_info.get("lectures", [])

    # 4. Fetch saved summaries for each lecture (token-efficient input)
    lectures_with_summaries = []
    for lect in lectures:
        vid = lect.get("video_id") or lect.get("videoId")
        if not vid:
            continue
        saved_vid = db_manager.get_saved_video(vid)
        ltitle = lect.get("title") or lect.get("video_title") or (saved_vid.get("title") if saved_vid else None) or f"Lecture {vid}"

        sums = db_manager.get_lecture_summaries(vid)
        summary_text = ""
        for stype in ("comprehensive", "key_points", "brief", "study_guide"):
            if sums.get(stype) and sums[stype].get("markdownText"):
                summary_text = sums[stype]["markdownText"]
                break
        if not summary_text and sums:
            first_sum = next(iter(sums.values()), None)
            if first_sum and first_sum.get("markdownText"):
                summary_text = first_sum["markdownText"]

        cues = (saved_vid.get("cues") if saved_vid else None) or []
        lectures_with_summaries.append({
            "video_id": vid,
            "title": ltitle,
            "summary": summary_text,
            "cues": cues[:25] if not summary_text else []
        })

    if not lectures_with_summaries:
        raise HTTPException(
            status_code=400,
            detail=f"No lectures in course '{canonical_title}' are available to generate a course summary."
        )

    # 5. Generate Course Summary
    try:
        summary_data = pinecone_rag_engine.generate_course_summary(
            course_name=canonical_title,
            lectures_data=lectures_with_summaries
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate course summary via AI model: {str(e)}"
        )

    # 6. Persist to Database & Cache
    db_manager.save_course_summary(canonical_title, summary_data)
    canonical_slug = to_course_slug(canonical_title)
    if canonical_slug and canonical_slug != course_slug:
        db_manager.save_course_summary(clean_course, summary_data)

    if redis_cache:
        redis_cache.set_course_summary(course_slug, summary_data, ttl_seconds=86400)
        if canonical_slug and canonical_slug != course_slug:
            redis_cache.set_course_summary(canonical_slug, summary_data, ttl_seconds=86400)

    return {
        **summary_data,
        "course_slug": summary_data.get("course_slug") or course_slug,
        "course_name": summary_data.get("course_name") or canonical_title,
        "summary": summary_data
    }


@app.post("/api/course/{course_name}/summary/regenerate")
def regenerate_course_summary_endpoint(
    course_name: str,
    email: Optional[str] = Query(None, description="User email"),
    body: Optional[CourseSummaryRequest] = None
):
    """Explicit convenience endpoint to force regenerate course-level executive summary."""
    return get_or_generate_course_summary(
        course_name=course_name,
        regenerate=True,
        email=email,
        body=body
    )


@app.delete("/api/course/{course_name}/quiz/answers")
def reset_course_quiz_answers(course_name: str, email: Optional[str] = Query(None)):
    """Reset user course quiz response state in PostgreSQL."""
    clean_course = str(course_name).strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")
    db_manager.delete_quiz_attempt("course", course_slug, email or "anonymous")
    return {"status": "success", "success": True}


@app.post("/api/course/{course_name}/quiz/explanation")
def get_detailed_course_quiz_explanation(course_name: str, req: CourseQuizExplanationRequest):
    """Generate or retrieve detailed explanation for a course quiz question using RAG."""
    clean_course = str(course_name or "").strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")
    q_id = str(req.question_id)

    # 1. Check cache first if not regenerating
    if not req.regenerate:
        cached = db_manager.get_course_quiz_explanation(clean_course, q_id)
        if cached:
            return {
                "detailed_explanation": cached,
                "cached": True,
                "model": "Cached"
            }

    # 2. Find relevant lecture cues
    lecture_title = clean_course
    cues = []
    target_vid = req.lecture_id
    if target_vid:
        saved_vid = db_manager.get_saved_video(target_vid)
        if saved_vid:
            lecture_title = saved_vid.get("title") or f"Lecture {target_vid}"
            cues = saved_vid.get("cues") or []

    # If no specific cues found for that lecture, collect from course lectures
    if not cues:
        course_info = db_manager.get_course_details(clean_course)
        if course_info and course_info.get("lectures"):
            for l in course_info["lectures"]:
                vid = l.get("video_id") or l.get("videoId")
                if vid:
                    v_saved = db_manager.get_saved_video(vid)
                    if v_saved and v_saved.get("cues"):
                        cues.extend(v_saved["cues"][:15])

    # 3. Generate detailed explanation using RAG
    try:
        explanation_data = pinecone_rag_engine.generate_detailed_quiz_explanation(
            video_id=target_vid or course_slug,
            lecture_title=lecture_title,
            question=req.question,
            options=req.options,
            correct_index=req.correct_index,
            explanation=req.explanation or "",
            timestamp=req.timestamp or "00:00",
            cues=cues
        )

        # 4. Save to database
        db_manager.save_course_quiz_explanation(
            clean_course,
            q_id,
            explanation_data["detailed_explanation"]
        )

        return explanation_data
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate detailed course quiz explanation: {str(e)}"
        )


@app.get("/api/course/{course_name}/quiz/history")
def get_course_quiz_history(course_name: str, email: Optional[str] = Query(None)):
    """Retrieve historical quiz runs for a course."""
    clean_course = str(course_name or "").strip()
    history = db_manager.get_course_quiz_history(clean_course, user_email=email)
    return {"history": history, "course_name": clean_course}


@app.get("/api/course/{course_name}/quiz/history/{quiz_id}")
def get_course_quiz_history_run(course_name: str, quiz_id: str):
    """Retrieve a specific historical quiz run by ID."""
    clean_course = str(course_name or "").strip()
    quiz_run = db_manager.get_course_quiz_history_by_id(quiz_id)
    if not quiz_run:
        raise HTTPException(status_code=404, detail=f"Quiz history for '{quiz_id}' not found.")
    return quiz_run


@app.delete("/api/course/{course_name}/quiz/history/{quiz_id}")
def delete_course_quiz_history_run(course_name: str, quiz_id: str, email: Optional[str] = Query(None)):
    """Delete a specific historical quiz run by ID."""
    clean_course = str(course_name or "").strip()
    clean_id = str(quiz_id or "").strip()
    deleted = db_manager.delete_course_quiz_history(clean_id, user_email=email)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Quiz history for '{clean_id}' could not be deleted.")
    return {"status": "success", "success": True, "quiz_id": clean_id}


# ==============================================================================
# Course-Level AI Tutor Endpoints (Exam Preparation & Course Knowledge)
# ==============================================================================

@app.post("/api/course/{course_name}/tutor/chat")
def course_tutor_chat(course_name: str, req: CourseTutorChatRequest):
    """
    Process an open-ended course query through Course-Level RAG.
    Grounded in transcripts and outlines across all course lectures and materials.
    Saves to course chat history in PostgreSQL.
    """
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")

    prompt = req.message.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    try:
        res = pinecone_rag_engine.query_course_rag(
            query=prompt,
            course_name=cname,
            user_email=req.user_email,
            chat_history=req.chat_history
        )
    except Exception as e:
        print(f"❌ [Course Tutor Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Course Tutor query failed: {str(e)}")

    # Save interaction to DB
    try:
        db_manager.save_course_chat_log(
            course_name=cname,
            user_prompt=prompt,
            ai_reply=res.get("reply", ""),
            citations=res.get("citations", []),
            user_email=req.user_email,
            model=res.get("model", "")
        )
    except Exception as e:
        print(f"⚠️ [Course Chat Save Notice]: {e}")

    return res


@app.get("/api/course/{course_name}/tutor/history")
def get_course_tutor_history(course_name: str, user_email: Optional[str] = Query(None)):
    """Retrieve full chronological conversation history for a course AI Tutor."""
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")

    messages = db_manager.get_course_chat_history(cname, user_email=user_email)
    slug = to_course_slug(cname)
    return {
        "status": "success",
        "course_slug": slug,
        "course_name": cname,
        "count": len(messages),
        "messages": messages
    }


@app.delete("/api/course/{course_name}/tutor/history")
def clear_course_tutor_history(course_name: str, user_email: Optional[str] = Query(None)):
    """Clear course tutor conversation history for this course and user."""
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")

    cleared = db_manager.clear_course_chat_history(cname, user_email=user_email)
    return {"status": "success" if cleared else "failed", "cleared": cleared}


@app.delete("/api/course/{course_name}/tutor/message/{message_id}")
def delete_course_tutor_message(course_name: str, message_id: str, user_email: Optional[str] = Query(None)):
    """Delete a single course tutor interaction."""
    cname = course_name.strip()
    deleted = db_manager.delete_course_chat_message(message_id, course_name=cname, user_email=user_email)
    return {"status": "success" if deleted else "failed", "deleted": deleted}


@app.post("/api/user/library/record")
def record_user_lecture(req: UserLibraryRecordRequest):
    """Add or update a lecture in the user's LMS library."""
    target_email = (req.user_email or req.email or "").strip()
    target_title = (req.title or req.video_title or f"Lecture {req.video_id}").strip()
    target_duration = (req.duration or req.duration_seconds or "").strip()
    target_url = (req.source_url or req.video_url or "").strip()

    if not target_email or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="user_email (or email) and video_id are required.")

    raw_course = (req.course_name and req.course_name.strip()) or extract_course_name(target_title)
    if not raw_course:
        raise HTTPException(status_code=400, detail="course_name is required.")
    canonical_course = db_manager.resolve_course_canonical_name(raw_course)

    success = db_manager.record_user_lecture(
        user_email=target_email,
        video_id=req.video_id,
        title=target_title,
        duration=target_duration,
        source_url=target_url,
        drive_folder_url=req.drive_folder_url,
        course_name=canonical_course
    )
    if success and redis_cache:
        redis_cache.update_user_course(
            target_email,
            canonical_course,
            lecture_entry={
                "videoId": req.video_id,
                "video_id": req.video_id,
                "title": target_title,
                "video_title": target_title,
                "duration": target_duration or "Unknown",
                "sourceUrl": target_url or f"https://video.lecturescribe.local/{req.video_id}",
                "video_url": target_url or f"https://video.lecturescribe.local/{req.video_id}",
                "driveFolderUrl": req.drive_folder_url,
                "drive_folder_url": req.drive_folder_url,
                "course_name": canonical_course,
                "progress": None
            }
        )
    return {"status": "success" if success else "failed"}


@app.delete("/api/user/library/{video_id}")
def delete_user_lecture(video_id: str, email: str = Query(..., description="User Google email")):
    """Remove a lecture from the user's LMS library."""
    clean_email = email.strip()
    if not clean_email or not video_id.strip():
        raise HTTPException(status_code=400, detail="email and video_id are required.")
    success = db_manager.remove_user_lecture(clean_email, video_id)
    if success and redis_cache:
        redis_cache.invalidate_user(clean_email)
    return {"status": "success" if success else "failed"}


# ==============================================================================
# Lecture & Course Resources Endpoints (Google Cloud Storage)
# ==============================================================================

class PresignUploadRequest(BaseModel):
    filename: str
    content_type: Optional[str] = "application/octet-stream"
    course_name: str
    video_id: Optional[str] = None
    user_email: str

class ConfirmUploadRequest(BaseModel):
    filename: str
    blob_name: str
    file_type: str
    file_size_bytes: Optional[int] = 0
    course_name: str
    video_id: Optional[str] = None
    title: Optional[str] = None
    user_email: str

class CreateLinkResourceRequest(BaseModel):
    title: str
    url: str
    course_name: str
    video_id: Optional[str] = None
    user_email: str

class CreateCourseNoteRequest(BaseModel):
    user_email: str
    title: Optional[str] = "Untitled Note"
    content: Optional[str] = ""
    note_id: Optional[str] = None

class UpdateCourseNoteRequest(BaseModel):
    user_email: str
    title: Optional[str] = None
    content: Optional[str] = None


@app.post("/api/resources/presign-upload")
def presign_resource_upload(req: PresignUploadRequest):
    """Generate a V4 GCS signed URL for direct browser-to-bucket upload."""
    user_email = (req.user_email or "").strip().lower()
    if not user_email:
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Only signed-in users can upload resources."
        )
    if not req.filename or not req.filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty.")
    clean_course = (req.course_name or "").strip()
    if not clean_course:
        raise HTTPException(status_code=400, detail="course_name is required.")

    blob_name = gcs_storage_service.get_resource_blob_path(
        course_slug=clean_course,
        video_id=req.video_id,
        filename=req.filename.strip()
    )
    upload_info = gcs_storage_service.generate_upload_signed_url(
        blob_name=blob_name,
        content_type=req.content_type or "application/octet-stream"
    )
    return {"status": "success", **upload_info}


@app.post("/api/resources/confirm-upload")
def confirm_resource_upload(req: ConfirmUploadRequest):
    """Record resource metadata in PostgreSQL after successful direct GCS upload."""
    user_email = (req.user_email or "").strip().lower()
    if not user_email:
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Only signed-in users can upload resources."
        )
    if not req.blob_name or not req.filename:
        raise HTTPException(status_code=400, detail="blob_name and filename are required.")
    clean_course = (req.course_name or "").strip()
    if not clean_course:
        raise HTTPException(status_code=400, detail="course_name is required.")

    record = db_manager.create_resource(
        course_name=clean_course,
        user_email=user_email,
        title=req.title or req.filename,
        filename=req.filename,
        blob_name=req.blob_name,
        file_type=req.file_type or "file",
        file_size_bytes=req.file_size_bytes or 0,
        file_url=None,
        video_id=req.video_id
    )
    record["view_url"] = gcs_storage_service.generate_download_signed_url(req.blob_name, disposition="inline")
    record["download_url"] = gcs_storage_service.generate_download_signed_url(req.blob_name, disposition="attachment")
    return {"status": "success", "resource": record}


@app.post("/api/resources/link")
def create_link_resource(req: CreateLinkResourceRequest):
    """Add an external resource link (e.g. Google Docs, Notion, Drive) for a lecture/course."""
    user_email = (req.user_email or "").strip().lower()
    if not user_email:
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Only signed-in users can add resource links."
        )
    url = (req.url or "").strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="A valid HTTP or HTTPS URL is required.")
    clean_course = (req.course_name or "").strip()
    if not clean_course:
        raise HTTPException(status_code=400, detail="course_name is required.")

    ft = "link"
    if "drive.google.com" in url or "docs.google.com" in url:
        ft = "gdrive"

    record = db_manager.create_resource(
        course_name=clean_course,
        user_email=user_email,
        title=req.title.strip() or url,
        filename=url,
        blob_name="",
        file_type=ft,
        file_size_bytes=0,
        file_url=url,
        video_id=req.video_id
    )
    record["download_url"] = url
    return {"status": "success", "resource": record}


@app.get("/api/lecture/{video_id}/resources")
def get_lecture_resources(video_id: str, course_name: Optional[str] = Query(None)):
    """Retrieve all resources attached to a specific lecture and across its course with fresh signed download URLs."""
    vid = video_id.strip()
    if not vid:
        raise HTTPException(status_code=400, detail="video_id is required.")
    items = db_manager.get_lecture_resources(vid, course_name=course_name)
    for r in items:
        if r.get("blob_name"):
            r["view_url"] = gcs_storage_service.generate_download_signed_url(r["blob_name"], disposition="inline")
            r["download_url"] = gcs_storage_service.generate_download_signed_url(r["blob_name"], disposition="attachment")
        elif r.get("file_url"):
            r["view_url"] = r["file_url"]
            r["download_url"] = r["file_url"]
    return {"status": "success", "video_id": vid, "course_name": course_name, "resources": items, "count": len(items)}


@app.get("/api/course/{course_name}/resources")
def get_course_resources(course_name: str):
    """Retrieve all resources attached across a course with fresh signed download URLs."""
    raw_name = course_name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="course_name is required.")
    cname = db_manager.resolve_course_canonical_name(raw_name)
    items = db_manager.get_course_resources(raw_name)
    for r in items:
        if r.get("blob_name"):
            r["view_url"] = gcs_storage_service.generate_download_signed_url(r["blob_name"], disposition="inline")
            r["download_url"] = gcs_storage_service.generate_download_signed_url(r["blob_name"], disposition="attachment")
        elif r.get("file_url"):
            r["view_url"] = r["file_url"]
            r["download_url"] = r["file_url"]
    return {"status": "success", "course_name": cname, "resources": items, "count": len(items)}


@app.delete("/api/resources/{resource_id}")
def delete_resource(resource_id: int, user_email: str = Query(..., description="User Google email")):
    """Delete a resource by ID. Only the uploader is authorized to delete."""
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=401, detail="Authentication required: user_email is required.")
    try:
        deleted = db_manager.delete_resource(resource_id, clean_email)
        if not deleted:
            raise HTTPException(status_code=404, detail="Resource not found.")
        if deleted.get("blob_name"):
            gcs_storage_service.delete_blob(deleted["blob_name"])
        return {"status": "success", "resource_id": resource_id}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))


# ==============================================================================
# Course Notes & Scratchpad Endpoints (Direct GCS + PostgreSQL)
# ==============================================================================

@app.post("/api/course/{course_name}/notes")
def create_course_note(course_name: str, req: CreateCourseNoteRequest):
    """Create a new course scratchpad note stored in GCS and PostgreSQL."""
    clean_email = (req.user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Only signed-in users can create notes."
        )
    raw_course = course_name.strip()
    if not raw_course:
        raise HTTPException(status_code=400, detail="course_name is required.")

    clean_course = db_manager.resolve_course_canonical_name(raw_course)
    course_slug = to_course_slug(clean_course)
    raw_nid = (req.note_id or "").strip()
    if raw_nid and re.match(r"^note_[a-zA-Z0-9_\-]+$", raw_nid):
        note_id = raw_nid
    else:
        note_id = f"note_{uuid.uuid4().hex[:12]}"

    existing = db_manager.get_course_note(note_id, clean_email)
    if existing:
        existing_content = gcs_storage_service.get_blob_text(existing["blob_name"]) or ""
        return {"status": "success", "note": {**existing, "content": existing_content}}

    blob_name = gcs_storage_service.get_course_note_blob_path(course_slug, clean_email, note_id)

    initial_content = req.content or ""
    try:
        gcs_storage_service.upload_blob_text(blob_name, initial_content, content_type="text/plain; charset=utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store note in cloud storage: {e}")

    file_size_bytes = len(initial_content.encode("utf-8"))
    record = db_manager.create_course_note(
        course_name=clean_course,
        user_email=clean_email,
        title=req.title or "Untitled Note",
        blob_name=blob_name,
        file_size_bytes=file_size_bytes,
        note_id=note_id
    )
    record["content"] = initial_content
    return {"status": "success", "note": record}


@app.get("/api/course/{course_name}/notes")
def get_course_notes(course_name: str, user_email: str = Query(..., description="User Google email")):
    """Retrieve all scratchpad notes for a course and user."""
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=401, detail="Authentication required: user_email is required.")
    raw_course = course_name.strip()
    if not raw_course:
        raise HTTPException(status_code=400, detail="course_name is required.")

    clean_course = db_manager.resolve_course_canonical_name(raw_course)
    items = db_manager.get_course_notes(clean_course, clean_email)
    return {"status": "success", "course_name": clean_course, "notes": items, "count": len(items)}


@app.get("/api/course/{course_name}/notes/{note_id}")
def get_course_note(course_name: str, note_id: str, user_email: str = Query(..., description="User Google email")):
    """Fetch note metadata from PG and plain text body from GCS."""
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=401, detail="Authentication required: user_email is required.")
    
    note = db_manager.get_course_note(note_id, clean_email)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    content = gcs_storage_service.get_blob_text(note["blob_name"]) or ""
    return {"status": "success", "note": {**note, "content": content}}


@app.put("/api/course/{course_name}/notes/{note_id}")
def update_course_note(course_name: str, note_id: str, req: UpdateCourseNoteRequest):
    """Save/update note: updates text blob in GCS and metadata in PG. Upserts if not existing."""
    clean_email = (req.user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=401, detail="Authentication required: user_email is required.")

    raw_course = course_name.strip()
    if not raw_course:
        raise HTTPException(status_code=400, detail="course_name is required.")
    clean_course = db_manager.resolve_course_canonical_name(raw_course)
    course_slug = to_course_slug(clean_course)

    # Check if note exists under any user to prevent cross-user overwrite
    existing_any_user = db_manager.get_course_note(note_id)
    if existing_any_user and existing_any_user.get("user_email") != clean_email:
        raise HTTPException(status_code=404, detail="Note not found.")

    note = existing_any_user if (existing_any_user and existing_any_user.get("user_email") == clean_email) else None
    if not note:
        # UPSERT: Note was created optimistically on client or was not yet persisted
        blob_name = gcs_storage_service.get_course_note_blob_path(course_slug, clean_email, note_id)
        content_to_save = req.content or ""
        try:
            gcs_storage_service.upload_blob_text(blob_name, content_to_save, content_type="text/plain; charset=utf-8")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to store note in cloud storage: {e}")

        file_size_bytes = len(content_to_save.encode("utf-8"))
        record = db_manager.create_course_note(
            course_name=clean_course,
            user_email=clean_email,
            title=req.title or "Untitled Note",
            blob_name=blob_name,
            file_size_bytes=file_size_bytes,
            note_id=note_id
        )
        record["content"] = content_to_save
        return {"status": "success", "note": record}

    file_size_bytes = None
    if req.content is not None:
        try:
            gcs_storage_service.upload_blob_text(note["blob_name"], req.content, content_type="text/plain; charset=utf-8")
            file_size_bytes = len(req.content.encode("utf-8"))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to update note in cloud storage: {e}")

    try:
        updated = db_manager.update_course_note(
            note_id=note_id,
            user_email=clean_email,
            title=req.title,
            file_size_bytes=file_size_bytes
        )
        if not updated:
            updated = dict(note)
            if req.title:
                updated["title"] = req.title
            if file_size_bytes is not None:
                updated["file_size_bytes"] = file_size_bytes
        if req.content is not None:
            updated["content"] = req.content
        else:
            updated["content"] = gcs_storage_service.get_blob_text(note["blob_name"]) or ""
        return {"status": "success", "note": updated}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update note metadata: {e}")


@app.delete("/api/course/{course_name}/notes/{note_id}")
def delete_course_note(course_name: str, note_id: str, user_email: str = Query(..., description="User Google email")):
    """Delete note metadata from PG and blob from GCS."""
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=401, detail="Authentication required: user_email is required.")

    try:
        deleted = db_manager.delete_course_note(note_id, clean_email)
        if not deleted:
            raise HTTPException(status_code=404, detail="Note not found.")
        if deleted.get("blob_name"):
            gcs_storage_service.delete_blob(deleted["blob_name"])
        return {"status": "success", "note_id": note_id}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))


# ==============================================================================
# Course Library & Reading Recommendations Endpoints
# ==============================================================================

@app.get("/api/course/{course_name}/readings")
def get_course_readings(course_name: str):
    """Retrieve all extracted textbooks, ebooks, and journals for a course by name or slug."""
    raw_name = course_name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="course_name is required.")
    cname = db_manager.resolve_course_canonical_name(raw_name)
    items = db_manager.get_course_readings(raw_name)
    return {"status": "success", "course_name": cname, "readings": items, "count": len(items)}


@app.post("/api/course/{course_name}/extract-readings")
def extract_course_readings(course_name: str, regenerate: bool = Query(False, description="Wipe existing course readings and re-extract")):
    """
    Manual on-demand extraction of recommended books and journals
    from lecture transcripts and uploaded slide decks (.pptx / .pdf).
    Enriches with Google Books metadata and persists to PostgreSQL.
    Supports course name or URL slug.
    If regenerate=True, wipes existing readings for the course first.
    """
    raw_name = course_name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="course_name is required.")

    logger.info(f"[ExtractReadings] === Initiating reading extraction for course '{raw_name}' (regenerate={regenerate}) ===")
    try:
        cname = db_manager.resolve_course_canonical_name(raw_name)
        slug_norm = to_course_slug(raw_name)
        logger.info(f"[ExtractReadings] Course canonical name: '{cname}' | URL slug: '{slug_norm}'")

        if regenerate:
            logger.info(f"[ExtractReadings] Clearing existing course readings for '{cname}' due to regenerate=True...")
            db_manager.clear_course_readings(cname)

        # 1. Gather all transcripts across lectures in this course
        transcripts_summary_parts: List[str] = []
        course_vids = []
        try:
            if db_manager.postgres_url and db_manager._schema_initialized:
                logger.info(f"[ExtractReadings] Querying database for videos matching course='{cname}', raw='{raw_name}', slug='{slug_norm}'...")
                conn = db_manager._get_connection()
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT v.video_id, v.title
                        FROM lecturescribe_videos v
                        WHERE LOWER(v.course_name) = LOWER(%s)
                           OR LOWER(v.course_name) = LOWER(%s)
                           OR regexp_replace(LOWER(v.course_name), '[^a-z0-9]+', '-', 'g') = %s
                        ORDER BY v.created_at ASC LIMIT 15;
                    """, (cname, raw_name, slug_norm))
                    course_vids = cursor.fetchall() or []
                conn.close()
                logger.info(f"[ExtractReadings] Found {len(course_vids)} video(s) for course '{cname}': {[v['title'] for v in course_vids]}")
            else:
                logger.warning(f"[ExtractReadings] Database not initialized; falling back to in-memory video cache.")
                course_vids = []
        except Exception as e:
            logger.error(f"[ExtractReadings] Error querying course videos from database: {e}\n{traceback.format_exc()}")
            course_vids = []

        total_cues_counted = 0
        for cv in course_vids:
            vid = cv["video_id"]
            title = cv["title"]
            cues = []
            try:
                if db_manager.postgres_url and db_manager._schema_initialized:
                    conn = db_manager._get_connection()
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            SELECT timestamp as time, text 
                            FROM lecturescribe_transcript_cues 
                            WHERE video_id = %s 
                            ORDER BY id ASC;
                        """, (vid,))
                        cues = cursor.fetchall() or []
                    conn.close()
                elif vid in db_manager._memory_cache:
                    cues = db_manager._memory_cache[vid].get("cues") or []
            except Exception as e:
                logger.warning(f"[ExtractReadings] Error fetching transcript cues for video '{vid}' ('{title}'): {e}")
                cues = []

            total_cues_counted += len(cues)
            if cues:
                # Include full transcript cues with timestamps, capped per lecture only if exceptionally long (> 40k chars)
                lecture_blocks = []
                current_len = 0
                max_lecture_chars = 40000
                for c in cues:
                    t_str = f"[{c.get('start_time') or c.get('time') or ''}] {c.get('text', '')}"
                    if current_len + len(t_str) > max_lecture_chars:
                        lecture_blocks.append("... [transcript truncated at 40k chars]")
                        break
                    lecture_blocks.append(t_str)
                    current_len += len(t_str)

                cue_text = " ".join(lecture_blocks)
                logger.info(f"[ExtractReadings] Video '{title}' (ID: {vid}): {len(cues)} total cues loaded -> ingested {len(lecture_blocks)} cues ({len(cue_text)} chars).")
                transcripts_summary_parts.append(f"Lecture '{title}':\n{cue_text}")
            else:
                logger.info(f"[ExtractReadings] Video '{title}' (ID: {vid}): 0 cues found.")

        transcripts_summary = "\n\n".join(transcripts_summary_parts)
        logger.info(f"[ExtractReadings] Summary of transcripts: {len(course_vids)} videos checked, {total_cues_counted} total cues across all lectures, combined text length: {len(transcripts_summary)} chars.")

        # 2. Gather uploaded slide documents for this course
        logger.info(f"[ExtractReadings] Fetching course resources for '{cname}'...")
        resources = db_manager.get_course_resources(cname)
        slides_text_parts: List[str] = []
        logger.info(f"[ExtractReadings] Found {len(resources)} total resource(s) for course '{cname}'.")

        for r in resources:
            ftype = (r.get("file_type") or "").lower()
            fname = (r.get("filename") or "").lower()
            blob_name = r.get("blob_name")
            title_res = r.get("title", fname)
            fsize = r.get("file_size_bytes") or 0
            if ftype in ("ppt", "pptx", "pdf") or fname.endswith((".pptx", ".ppt", ".pdf")):
                logger.info(f"[ExtractReadings] Processing slide resource: title='{title_res}', filename='{fname}', type='{ftype}', size={fsize} bytes, blob='{blob_name}'")
                slide_bytes = None
                if blob_name:
                    try:
                        slide_bytes = gcs_storage_service.get_blob_bytes(blob_name)
                        logger.info(f"[ExtractReadings] Downloaded {len(slide_bytes) if slide_bytes else 0} bytes from GCS for blob '{blob_name}'.")
                    except Exception as e:
                        logger.warning(f"[ExtractReadings] Failed to download blob '{blob_name}' from GCS: {e}")
                if slide_bytes:
                    try:
                        parsed_slides = parse_slide_document(slide_bytes, filename=fname)
                        if parsed_slides:
                            formatted_slides = format_slides_for_llm(parsed_slides, max_chars=12000)
                            slides_text_parts.append(f"Deck '{title_res}':\n{formatted_slides}")
                            logger.info(f"[ExtractReadings] Successfully parsed deck '{title_res}': {len(parsed_slides)} slides/pages extracted, text length: {len(formatted_slides)} chars.")
                        else:
                            logger.info(f"[ExtractReadings] Slide document '{fname}' yielded 0 extractable text/slides.")
                    except Exception as e:
                        logger.error(f"[ExtractReadings] Failed to parse slide document '{fname}': {e}\n{traceback.format_exc()}")
                else:
                    logger.warning(f"[ExtractReadings] No bytes retrieved for slide resource '{fname}'.")
            else:
                logger.info(f"[ExtractReadings] Skipping non-slide resource '{fname}' (type: '{ftype}').")

        slides_text = "\n\n".join(slides_text_parts)
        logger.info(
            f"[ExtractReadings] LLM input prepared: Transcripts excerpt length={len(transcripts_summary)} chars, "
            f"Slides text length={len(slides_text)} chars. Invoking LLM extraction..."
        )

        # 3. Call LLM extractor
        extracted_items = extract_readings_with_llm(cname, transcripts_summary, slides_text)
        logger.info(f"[ExtractReadings] LLM extractor returned {len(extracted_items)} raw reading items.")

        saved_items: List[Dict[str, Any]] = []
        existing = [] if regenerate else db_manager.get_course_readings(cname)
        existing_titles = {re.sub(r'[^a-zA-Z0-9]', '', e.get("title", "").lower()) for e in existing}
        logger.debug(f"[ExtractReadings] Existing readings count for deduplication: {len(existing_titles)}")

        for item in extracted_items:
            norm_t = re.sub(r'[^a-zA-Z0-9]', '', (item.get("title") or "").lower())
            if not norm_t:
                logger.debug(f"[ExtractReadings] Skipping item without normalized title: {item}")
                continue
            if norm_t in existing_titles:
                logger.debug(f"[ExtractReadings] Skipping already existing reading title: '{item.get('title')}'")
                continue

            # 4. Enrich via multi-source digital book resolver (Archive.org, OpenLibrary, OpenAccess PDF, Google Books)
            logger.info(f"[ExtractReadings] Enriching digital book metadata for candidate: '{item.get('title')}' by '{item.get('author')}'...")
            try:
                meta = resolve_digital_book_reader(item.get("title", ""), item.get("author", ""))
                if meta:
                    logger.debug(f"[ExtractReadings] Digital resolver matched '{meta.get('matched_title')}' (reader_type: {meta.get('reader_type')})")
                    if meta.get("cover_url"):
                        item["cover_url"] = meta["cover_url"]
                    if meta.get("preview_url"):
                        item["preview_url"] = meta["preview_url"]
                    if meta.get("embed_url"):
                        item["embed_url"] = meta["embed_url"]
                    if meta.get("reader_type"):
                        item["reader_type"] = meta["reader_type"]
                    if meta.get("isbn"):
                        item["isbn"] = meta["isbn"]
                    if "is_lending" in meta:
                        item["is_lending"] = meta["is_lending"]
            except Exception as e:
                logger.warning(f"[ExtractReadings] Digital reader resolution failed for '{item.get('title')}': {e}")

            try:
                saved = db_manager.save_course_reading(cname, item)
                saved_items.append(saved)
                existing_titles.add(norm_t)
                logger.info(f"[ExtractReadings] Saved new reading: ID={saved.get('id')} '{saved.get('title')}'")
            except Exception as e:
                logger.error(f"[ExtractReadings] Database save failed for reading '{item.get('title')}': {e}\n{traceback.format_exc()}")

        all_readings = db_manager.get_course_readings(cname)
        logger.info(
            f"[ExtractReadings] Extraction complete for '{cname}'. "
            f"Newly extracted: {len(saved_items)}, Total in catalog: {len(all_readings)}"
        )
        return {
            "status": "success",
            "course_name": cname,
            "newly_extracted_count": len(saved_items),
            "readings": all_readings,
            "count": len(all_readings)
        }
    except Exception as e:
        full_err = traceback.format_exc()
        logger.error(f"[ExtractReadings] CRITICAL: extract_course_readings failed for course '{raw_name}': {e}\n{full_err}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract course readings: {str(e)}"
        )


@app.get("/api/course/reading/{reading_id}/reader")
def get_or_resolve_reading_reader(
    reading_id: int,
    refresh: bool = Query(False, description="Force re-resolving reader from external APIs")
):
    """
    Retrieve or dynamically resolve the in-page reader URL for a course reading.
    Enriches with Archive.org, Google Books, or OpenLibrary if not yet cached or if refresh=True.
    """
    reading = None
    if db_manager.postgres_url and db_manager._schema_initialized:
        conn = db_manager._get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, course_name, title, author, edition, reading_type,
                       category, cover_url, preview_url, embed_url, reader_type, isbn, is_lending
                FROM lecturescribe_course_readings
                WHERE id = %s;
            """, (reading_id,))
            row = cur.fetchone()
            if row:
                reading = dict(row)
        conn.close()

    if not reading:
        for r in db_manager._readings_memory_cache:
            if r.get("id") == reading_id:
                reading = dict(r)
                break

    if not reading:
        raise HTTPException(status_code=404, detail="Reading item not found.")

    embed_url = reading.get("embed_url") or ""
    reader_type = reading.get("reader_type") or "embed"
    cover_url = reading.get("cover_url") or ""
    is_lending = reading.get("is_lending", False)

    if embed_url and not refresh and "arxiv-" not in embed_url:
        return {
            "status": "success",
            "reading_id": reading_id,
            "title": reading.get("title"),
            "author": reading.get("author"),
            "embed_url": embed_url,
            "reader_type": reader_type,
            "preview_url": reading.get("preview_url") or embed_url,
            "cover_url": cover_url,
            "is_lending": is_lending
        }

    # Resolve on the fly if embed_url was not previously populated, contained an invalid preprint, or refresh requested
    meta = resolve_digital_book_reader(reading.get("title") or "", reading.get("author") or "")
    if meta and meta.get("embed_url"):
        embed_url = meta["embed_url"]
        reader_type = meta.get("reader_type", "embed")
        cover_url = meta.get("cover_url") or cover_url
        preview_url = meta.get("preview_url") or reading.get("preview_url") or ""
        is_lending = meta.get("is_lending", is_lending)
        db_manager.update_course_reading_embed(
            reading_id=reading_id,
            embed_url=embed_url,
            reader_type=reader_type,
            cover_url=cover_url,
            preview_url=preview_url,
            is_lending=is_lending
        )

    # Google Books preview fallback if preview_url has ID
    if not embed_url and reading.get("preview_url") and "books.google.com" in reading["preview_url"]:
        m = re.search(r'id=([a-zA-Z0-9_\-]+)', reading["preview_url"])
        if m:
            embed_url = f"https://books.google.com/books?id={m.group(1)}&printsec=frontcover&output=embed"
            reader_type = "google_embed"
            db_manager.update_course_reading_embed(reading_id, embed_url, reader_type)

    return {
        "status": "success",
        "reading_id": reading_id,
        "title": reading.get("title"),
        "author": reading.get("author"),
        "embed_url": embed_url,
        "reader_type": reader_type,
        "preview_url": reading.get("preview_url") or embed_url,
        "cover_url": cover_url,
        "is_lending": is_lending
    }


@app.get("/api/course/reading/search-web")
def search_reading_web(
    title: str = Query(..., description="Book or paper title"),
    author: Optional[str] = Query("", description="Author name"),
    course_name: Optional[str] = Query("", description="Course name")
):
    """
    Search DuckDuckGo & academic sources for free PDFs, syllabus links, or library records.
    Provides web scrape results when book is not found in catalog or student wants web links.
    """
    results = search_web_reading_links(title, author or "", course_name or "")
    return {
        "status": "success",
        "title": title,
        "author": author,
        "results": results,
        "count": len(results)
    }


@app.delete("/api/course/reading/{reading_id}")
def delete_course_reading(reading_id: int):
    """Delete a recommended reading item by ID."""
    success = db_manager.delete_course_reading(reading_id)
    return {"status": "success", "reading_id": reading_id, "deleted": success}


class SearchLiteratureRequest(BaseModel):
    query: str
    limit: Optional[int] = 6


class AddCourseReadingRequest(BaseModel):
    title: str
    author: Optional[str] = ""
    edition: Optional[str] = ""
    publication_year: Optional[str] = ""
    reading_type: Optional[str] = "journal"
    category: Optional[str] = "reference"
    publisher: Optional[str] = ""
    journal: Optional[str] = ""
    doi: Optional[str] = ""
    pmcid: Optional[str] = ""
    isbn: Optional[str] = ""
    cover_url: Optional[str] = ""
    preview_url: Optional[str] = ""
    embed_url: Optional[str] = ""
    reader_type: Optional[str] = "web"
    abstract: Optional[str] = ""
    source_type: Optional[str] = "manual_search"
    source_provider: Optional[str] = ""
    source_context: Optional[str] = ""
    is_lending: Optional[bool] = False
    is_open_access: Optional[bool] = False


@app.post("/api/course/{course_name}/search-literature")
async def search_course_literature(course_name: str, payload: SearchLiteratureRequest):
    """
    Search academic literature, research papers, journal articles, and textbooks
    across Crossref, Europe PMC, and Google Books / OpenLibrary.
    """
    raw_name = course_name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="course_name is required.")
    query = (payload.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query is required.")
    cname = db_manager.resolve_course_canonical_name(raw_name)
    results = await search_academic_literature_async(query, limit=payload.limit or 6, course_name=raw_name)
    return {
        "status": "success",
        "course_name": cname,
        "query": query,
        "results": results,
        "count": len(results)
    }


@app.post("/api/course/{course_name}/add-reading")
def add_course_reading(course_name: str, payload: AddCourseReadingRequest):
    """
    Add an academic paper, journal article, or book directly to the course library.
    Enriches with digital reader URL if missing.
    """
    raw_name = course_name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="course_name is required.")
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Reading title is required.")
    cname = db_manager.resolve_course_canonical_name(raw_name)

    reading_dict = payload.model_dump()
    if not reading_dict.get("edition") and reading_dict.get("publication_year"):
        reading_dict["edition"] = reading_dict["publication_year"]
    elif not reading_dict.get("publication_year") and reading_dict.get("edition"):
        reading_dict["publication_year"] = reading_dict["edition"]
    # If embed_url is missing, attempt digital book or literature resolution
    if not reading_dict.get("embed_url"):
        try:
            meta = resolve_digital_book_reader(title, reading_dict.get("author", ""))
            if meta:
                if meta.get("embed_url") and not reading_dict.get("embed_url"):
                    reading_dict["embed_url"] = meta["embed_url"]
                if meta.get("reader_type") and (not reading_dict.get("reader_type") or reading_dict["reader_type"] == "web"):
                    reading_dict["reader_type"] = meta["reader_type"]
                if meta.get("cover_url") and not reading_dict.get("cover_url"):
                    reading_dict["cover_url"] = meta["cover_url"]
                if meta.get("preview_url") and not reading_dict.get("preview_url"):
                    reading_dict["preview_url"] = meta["preview_url"]
        except Exception as e:
            logger.debug(f"[AddReading] Meta resolution failed: {e}")

    saved = db_manager.save_course_reading(cname, reading_dict)
    all_readings = db_manager.get_course_readings(cname)
    return {
        "status": "success",
        "course_name": cname,
        "reading": saved,
        "readings": all_readings,
        "count": len(all_readings)
    }


# ==============================================================================
# Open-Access Academic PDF Proxy Endpoint (SSRF Guarded)
# ==============================================================================

ALLOWED_PDF_DOMAINS = [
    "europepmc.org",
    "arxiv.org",
    "ncbi.nlm.nih.gov",
    "pmc.ncbi.nlm.nih.gov",
    "biorxiv.org",
    "medrxiv.org",
    "openalex.org",
    "archive.org",
    "storage.googleapis.com"
]

RESTRICTED_PUBLISHER_DOMAINS = [
    "jamanetwork.com",
    "sciencedirect.com",
    "elsevier.com",
    "springer.com",
    "nature.com",
    "wiley.com",
    "nejm.org",
    "academic.oup.com",
    "tandfonline.com",
    "bmj.com",
    "thelancet.com",
    "cell.com",
    "ahajournals.org",
    "pnas.org",
    "ieee.org",
    "acm.org",
    "frontiersin.org",
    "doi.org"
]


def validate_proxy_url(target_url: str) -> str:
    """
    Validate target URL against SSRF vulnerabilities and publisher framing restrictions.
    """
    if not target_url or not isinstance(target_url, str):
        raise HTTPException(status_code=400, detail="Target URL is required.")

    parsed = urlparse(target_url)
    if parsed.scheme.lower() != "https":
        raise HTTPException(status_code=400, detail="Only secure HTTPS URLs are permitted.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid hostname in URL.")

    # Check if domain is a commercial publisher that prohibits framing/proxying
    for restricted in RESTRICTED_PUBLISHER_DOMAINS:
        if hostname == restricted or hostname.endswith("." + restricted):
            raise HTTPException(
                status_code=400,
                detail=f"Direct proxying of '{hostname}' is not supported due to publisher security restrictions. Please use the official article link."
            )

    # Check if domain is in allowed list
    is_allowed = any(hostname == d or hostname.endswith("." + d) for d in ALLOWED_PDF_DOMAINS)
    if not is_allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Domain '{hostname}' is not in the allowed list of open-access repositories."
        )

    # SSRF Protection: Resolve hostname and check IP address against private/internal ranges
    try:
        addr_info = socket.getaddrinfo(hostname, 443, proto=socket.IPPROTO_TCP)
        for _, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip_obj = ipaddress.ip_address(ip_str)
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_reserved:
                raise HTTPException(status_code=403, detail="Requests to private or internal network addresses are forbidden.")
    except socket.gaierror:
        raise HTTPException(status_code=400, detail=f"Unable to resolve hostname: {hostname}")

    return target_url


@app.get("/api/literature/pdf-proxy")
async def proxy_literature_pdf(url: str = Query(..., description="HTTPS URL of the open-access PDF to proxy")):
    """
    Secure streaming proxy for verified open-access academic PDFs (Europe PMC, arXiv, etc.).
    Protects against SSRF and strips frame-blocking headers for safe inline preview.
    """
    valid_url = validate_proxy_url(url)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,application/octet-stream,*/*"
    }

    MAX_BYTES = 25 * 1024 * 1024  # 25 MB cap

    async def stream_pdf():
        total_bytes = 0
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            try:
                async with client.stream("GET", valid_url, headers=headers) as resp:
                    if resp.status_code >= 400:
                        yield json.dumps({"error": f"Upstream error {resp.status_code}"}).encode("utf-8")
                        return
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        total_bytes += len(chunk)
                        if total_bytes > MAX_BYTES:
                            break
                        yield chunk
            except Exception as e:
                logger.error(f"[PDFProxy] Streaming error for {valid_url}: {e}")
                return

    return StreamingResponse(
        stream_pdf(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff"
        }
    )



# ==============================================================================
# Video Download & Cloud Export Endpoints
# ==============================================================================

class CloudUploadRequest(BaseModel):
    video_id: str
    url: Optional[str] = None
    title: Optional[str] = "Lecture"
    summary_content: Optional[str] = None
    parent_folder_id: Optional[str] = None
    access_token: Optional[str] = None
    user_email: Optional[str] = None
    job_id: Optional[str] = None


class GCSUploadRequest(BaseModel):
    video_id: str
    url: Optional[str] = None
    title: Optional[str] = None
    bucket_name: Optional[str] = None
    folder_prefix: Optional[str] = "lectures"
    summary_content: Optional[str] = None
    course_name: Optional[str] = None
    h_hash: Optional[str] = None
    referer: Optional[str] = None
    player_config: Optional[Dict[str, Any]] = None
    upload_video: bool = True


@app.get("/api/cloud/gcs/status")
def get_gcs_status(bucket: Optional[str] = None):
    """Check GCS credentials and bucket readiness."""
    target_bucket = bucket or gcs_storage_service.bucket_name
    client = gcs_storage_service._get_client()
    return {
        "status": "online" if client else "emulated",
        "bucket": target_bucket,
        "authenticated": client is not None
    }


@app.post("/api/cloud/gcs/upload-bundle")
def upload_lecture_bundle_to_gcs(req: GCSUploadRequest):
    """
    Directly upload full Lecture Bundle (summary, transcript, captions, metadata, and progressive MP4 video)
    to Google Cloud Storage (GCS).
    Supports client-provided player_config from authenticated browser sessions.
    """
    video_id = req.video_id.strip() if req.video_id else ""
    if req.url and not video_id:
        try:
            video_id = extract_video_id(req.url)
        except Exception:
            pass

    if not video_id:
        raise HTTPException(status_code=400, detail="A valid video_id or video URL is required.")

    target_bucket = req.bucket_name or gcs_storage_service.bucket_name
    print(f"\n==================================================================")
    print(f"📥 [API POST /api/cloud/gcs/upload-bundle Received]")
    print(f"   Video ID:        {video_id}")
    print(f"   Upload Video:    {req.upload_video}")
    print(f"   Bucket Target:   {target_bucket}")
    print(f"   Folder Prefix:   {req.folder_prefix}")
    print(f"   Embed Hash (?h): {req.h_hash or 'None'}")
    print(f"   Referer:         {req.referer or 'None'}")
    print(f"   Client Config:   {'Present' if req.player_config else 'None'}")
    print(f"==================================================================")

    saved = db_manager.get_saved_video(video_id)
    cues: List[Dict[str, str]] = []
    vtt_content = ""
    title = req.title or (saved.get("title") if saved else None) or "Lecture"
    streams_info = None
    config = req.player_config
    config_error = None

    # If player_config was not sent by the browser extension, try fetching it via backend
    if not config:
        print(f"🔍 [GCS Upload] Fetching player config via backend for video {video_id}...")
        try:
            config = fetch_player_config(video_id, h_hash=req.h_hash, referer=req.referer)
        except Exception as e:
            config_error = str(e)
            print(f"⚠️ [Config Notice during GCS upload]: {e}")
    else:
        print(f"✨ [GCS Upload] Using client-authenticated player config from browser extension.")

    # Process config if available
    if config:
        try:
            streams_info = get_video_download_streams(config, video_id)
            if not title or title == "Lecture":
                title = streams_info.get("title", f"Lecture {video_id}")

            prog_count = len(streams_info.get("progressive_streams", []))
            hls_status = "Available" if streams_info.get("hls", {}).get("master_url") else "None"
            print(f"📊 [GCS Streams Extracted] Progressive MP4: {prog_count} formats | HLS: {hls_status}")

            tracks = get_text_tracks(config)
            if tracks:
                track = next((t for t in tracks if t.get("default")), tracks[0])
                vtt_url = track.get("url") or track.get("src")
                if vtt_url:
                    vtt_content = fetch_vtt(vtt_url)
                    raw_segments = parse_vtt(vtt_content)
                    cues = [
                        {"start": s["start"], "time": format_timestamp(s["start"]), "text": s["text"]}
                        for s in raw_segments
                    ]
                    print(f"📝 [GCS Captions Extracted] {len(cues)} cues segments downloaded.")
        except Exception as e:
            print(f"⚠️ [Parsing Notice during GCS upload]: {e}")

    # Fallback to database cache if available
    if not cues and saved and saved.get("cues"):
        cues = saved.get("cues", [])
        if not title or title == "Lecture":
            title = saved.get("title", f"Lecture {video_id}")
        print(f"💾 [GCS Cache Hit] Retrieved {len(cues)} cues from local PostgreSQL database.")

    # Disallow false success: if video config failed and no transcript/cues exist, raise error
    if not cues and not streams_info and not (saved and saved.get("cues")):
        detail_msg = (
            f"Video provider returned 403 Forbidden for video {video_id}. "
            "This video is protected, private, or domain-restricted. "
            "Please play the video in your browser so the LectureScribe extension can capture the session config."
        ) if "403" in str(config_error or "") else (
            f"Could not retrieve lecture content: {config_error or 'No captions or stream tracks found'}"
        )
        raise HTTPException(status_code=403 if "403" in str(config_error or "") else 400, detail=detail_msg)

    summary_md = req.summary_content
    if not summary_md:
        sections = saved.get("summarySections") if saved else None
        if not sections and cues:
            sections = generate_summary_sections(cues, title)

        if sections:
            s_lines = [f"# Executive Summary: {title}", "", "---", ""]
            for sec in sections:
                s_lines.append(f"### {sec.get('title', 'Section')}")
                for pt in sec.get("points", []):
                    s_lines.append(f"- {pt}")
                s_lines.append("")
            summary_md = "\n".join(s_lines)

    # Consolidate prefix into unified course hierarchy: courses/<course-slug>/lectures
    effective_prefix = req.folder_prefix
    if not effective_prefix or effective_prefix == "lectures":
        raw_cname = (saved.get("course_name") if saved else None) or req.course_name or extract_course_name(title)
        cslug = to_gcs_course_slug(raw_cname)
        effective_prefix = f"courses/{cslug}/lectures"

    result = gcs_storage_service.upload_lecture_bundle(
        video_id=video_id,
        title=title,
        vtt_content=vtt_content,
        cues=cues,
        summary_content=summary_md,
        streams_info=streams_info,
        bucket_name=req.bucket_name,
        prefix=effective_prefix,
        upload_video=req.upload_video,
        referer=req.referer
    )
    return result


@app.get("/api/video/download-options")
def get_download_options(url: str = Query(..., description="Video URL or Video ID")):
    """Extract direct progressive MP4 downloads, adaptive HLS streams, and CLI download commands."""
    try:
        video_id = extract_video_id(url)
        config = fetch_player_config(video_id)
        streams_info = get_video_download_streams(config, video_id)
        return {
            "status": "success",
            **streams_info
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract video streams: {str(e)}")


@app.get("/api/cloud/gdrive/status")
def get_google_drive_status():
    """Diagnostic endpoint checking Google Drive configuration & auth readiness."""
    return google_drive_service.get_auth_status()


@app.post("/api/cloud/gdrive/upload-bundle")
def upload_lecture_bundle_to_gdrive(
    req: CloudUploadRequest,
    background_tasks: BackgroundTasks
):
    """
    Export full Lecture Bundle to Google Drive:
    - Dedicated Folder: 'LectureScribe - <Title> (<VideoId>)'
    - summary.md, transcript.md, captions.vtt, metadata.json, download_guide.txt
    Runs asynchronously via background task with live progress reporting.
    """
    video_id = req.video_id.strip()
    if req.url and not video_id:
        try:
            video_id = extract_video_id(req.url)
        except Exception:
            pass

    if not video_id:
        raise HTTPException(status_code=400, detail="A valid video_id or video URL is required.")

    if not req.access_token:
        raise HTTPException(
            status_code=400,
            detail="Please sign in with Google in the export modal to authorize uploading this lecture to your Google Drive."
        )

    saved = db_manager.get_saved_video(video_id)
    cues: List[Dict[str, str]] = []
    vtt_content = ""
    title = req.title or "Lecture"
    streams_info = None

    try:
        config = fetch_player_config(video_id)
        streams_info = get_video_download_streams(config, video_id)
        if not title or title == "Lecture":
            title = streams_info.get("title", f"Lecture {video_id}")

        tracks = get_text_tracks(config)
        if tracks:
            track = next((t for t in tracks if t.get("default")), tracks[0])
            vtt_url = track.get("url") or track.get("src")
            if vtt_url:
                vtt_content = fetch_vtt(vtt_url)
                raw_segments = parse_vtt(vtt_content)
                cues = [
                    {"start": s["start"], "time": format_timestamp(s["start"]), "text": s["text"]}
                    for s in raw_segments
                ]
    except Exception as e:
        print(f"⚠️ [Config Notice during bundle upload]: {e}")

    if not cues and saved and saved.get("cues"):
        cues = saved.get("cues", [])
        if not title or title == "Lecture":
            title = saved.get("title", f"Lecture {video_id}")

    summary_md = req.summary_content
    if not summary_md:
        sections = saved.get("summarySections") if saved else None
        if not sections and cues:
            sections = generate_summary_sections(cues, title)

        if sections:
            s_lines = [f"# Executive Summary: {title}", "", "---", ""]
            for sec in sections:
                s_lines.append(f"### {sec.get('title', 'Section')}")
                for pt in sec.get("points", []):
                    s_lines.append(f"- {pt}")
                s_lines.append("")
            summary_md = "\n".join(s_lines)

    job_id = google_drive_service.create_job(video_id, title, job_id=req.job_id)

    background_tasks.add_task(
        google_drive_service.execute_bundle_upload,
        job_id=job_id,
        video_id=video_id,
        title=title,
        vtt_content=vtt_content,
        cues=cues,
        summary_content=summary_md,
        streams_info=streams_info,
        parent_folder_id=req.parent_folder_id,
        access_token=req.access_token,
        user_email=req.user_email,
    )

    return {
        "status": "queued",
        "job_id": job_id,
        "video_id": video_id,
        "title": title,
        "message": "Full lecture bundle upload scheduled to Google Drive in background."
    }


@app.get("/api/cloud/jobs/{job_id}")
def get_cloud_job_status(job_id: str):
    """Poll progress status of an active or completed Google Drive upload job."""
    job = google_drive_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job



# ==============================================================================
# Moodle Calendar, AI Schedule Extraction & Automated WhatsApp Alert Endpoints
# ==============================================================================

@app.get("/api/calendar/events")
def get_calendar_events(
    refresh: bool = Query(False, description="Bypass cache and fetch fresh feed from Moodle"),
    days: int = Query(7, description="Number of upcoming days to include"),
    course: Optional[str] = Query(None, description="Optional course name or slug filter"),
    user_email: Optional[str] = Query(None, description="Optional user email for personal scope events"),
    source_type: Optional[str] = Query(None, description="Filter by source: 'moodle_ical', 'pdf_ai', 'transcript_ai', 'manual'"),
    category: Optional[str] = Query(None, description="Filter by category: 'exam', 'quiz', 'assignment', 'lab', 'lecture', 'schedule'"),
):
    """Retrieve categorized today, upcoming, and full calendar events from Moodle iCal + AI/DB."""
    try:
        if any(v is not None for v in (course, user_email, source_type, category)):
            agenda = calendar_service.get_dashboard_agenda(
                days=days,
                refresh=refresh,
                course_slug=course,
                user_email=user_email,
                source_type=source_type,
                category=category,
            )
        else:
            agenda = calendar_service.get_dashboard_agenda(days=days, refresh=refresh)
        return agenda
    except Exception as e:
        print(f"❌ [Calendar API Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch calendar agenda: {str(e)}")


@app.post("/api/calendar/events")
def create_or_inject_calendar_events(payload: Dict[str, Any]):
    """
    Create a single manual calendar event or bulk-inject AI-extracted events
    from Exam PDFs or Lecture Transcripts into the LectureScribe calendar.
    """
    try:
        events_in: List[Dict[str, Any]] = []
        if isinstance(payload.get("events"), list):
            events_in = payload["events"]
        elif payload.get("title"):
            events_in = [payload]
        else:
            raise HTTPException(status_code=400, detail="Payload must include 'title' or a list of 'events'.")

        saved = db_manager.save_calendar_events(events_in)
        return {
            "status": "success",
            "count": len(saved),
            "events": saved,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save calendar events: {str(e)}")


@app.patch("/api/calendar/events/{event_id}")
def update_calendar_event_endpoint(event_id: str, payload: Dict[str, Any]):
    """Update an existing calendar event or approve/reject a staged AI event."""
    updated = db_manager.update_calendar_event(event_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Calendar event '{event_id}' not found.")
    return {
        "status": "success",
        "event": updated,
    }


@app.delete("/api/calendar/events/{event_id}")
def delete_calendar_event_endpoint(event_id: str):
    """Delete a calendar event by ID."""
    deleted = db_manager.delete_calendar_event(event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Calendar event '{event_id}' not found.")
    return {
        "status": "success",
        "deleted_id": event_id,
    }


@app.post("/api/calendar/extract-pdf")
async def extract_calendar_from_pdf_endpoint(
    file: UploadFile = File(...),
    course_name: Optional[str] = Form(None),
    event_scope: Optional[str] = Form(None),
    user_email: Optional[str] = Form(None),
    auto_save: bool = Form(False),
):
    """
    Upload a Semester Exam PDF, Academic Calendar PDF, or Course Syllabus PDF.
    Extracts dates, exam times, rooms, and course mappings via LLM + layout parser.
    If auto_save=True, immediately injects extracted events into the calendar;
    otherwise returns candidate events for human-in-the-loop review and 1-click injection.
    """
    filename = file.filename or "Semester_Exam_Schedule.pdf"
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF file is empty.")

    try:
        extracted = extract_calendar_events_from_pdf(
            pdf_bytes=pdf_bytes,
            filename=filename,
            course_name=course_name,
            event_scope=event_scope,
            created_by_email=user_email or "",
            auto_save=auto_save,
            approval_status="approved",
        )
        return {
            "status": "success",
            "filename": filename,
            "auto_saved": auto_save,
            "count": len(extracted),
            "events": extracted,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract dates from PDF: {str(e)}")


@app.post("/api/calendar/extract-transcript")
def extract_calendar_from_transcript_endpoint(payload: Dict[str, Any]):
    """
    Scan a specific lecture transcript (`video_id`) or all lectures in a course (`course_name`)
    for verbal announcements of exams, quizzes, assignment deadlines, or class schedule changes.
    """
    video_id = str(payload.get("video_id") or "").strip()
    course_name = str(payload.get("course_name") or "").strip()
    user_email = str(payload.get("user_email") or "").strip()
    auto_save = bool(payload.get("auto_save", True))
    approval_status = str(payload.get("approval_status") or "approved").strip()

    if not video_id and not course_name:
        raise HTTPException(status_code=400, detail="Provide either 'video_id' or 'course_name' to scan transcripts.")

    videos_to_scan: List[Dict[str, Any]] = []
    if video_id:
        saved = db_manager.get_saved_video(video_id)
        if not saved or not saved.get("cues"):
            raise HTTPException(status_code=404, detail=f"No transcript cues found for lecture '{video_id}'.")
        videos_to_scan.append(saved)
    else:
        # Find lectures belonging to course_name
        course_videos: List[Dict[str, Any]] = []
        if hasattr(db_manager, "get_course_details"):
            details = db_manager.get_course_details(course_name, user_email=user_email or None)
            if details and isinstance(details.get("lectures"), list):
                course_videos = details["lectures"]
        elif hasattr(db_manager, "get_course_videos"):
            course_videos = db_manager.get_course_videos(course_name)

        for cv in course_videos[:10]:
            vid_id = cv.get("video_id") or cv.get("videoId")
            if vid_id:
                full_vid = db_manager.get_saved_video(vid_id)
                if full_vid and full_vid.get("cues"):
                    videos_to_scan.append(full_vid)

    extracted_all: List[Dict[str, Any]] = []
    for vid_obj in videos_to_scan:
        vid_id = str(vid_obj.get("video_id") or vid_obj.get("videoId") or "")
        vid_title = str(vid_obj.get("title") or f"Lecture {vid_id}")
        vid_course = str(vid_obj.get("course_name") or course_name or "")
        cues = vid_obj.get("cues") or []
        evts = extract_calendar_events_from_transcript(
            video_id=vid_id,
            title=vid_title,
            cues=cues,
            course_name=vid_course,
            created_by_email=user_email,
            auto_save=auto_save,
            approval_status=approval_status,
        )
        extracted_all.extend(evts)

    return {
        "status": "success",
        "scanned_lectures": len(videos_to_scan),
        "auto_saved": auto_save,
        "count": len(extracted_all),
        "events": extracted_all,
    }


@app.get("/api/calendar/export.ics")
def export_calendar_ics_endpoint(
    course: Optional[str] = Query(None, description="Optional course slug/name filter"),
    user_email: Optional[str] = Query(None, description="Optional user email"),
):
    """Download or subscribe to the unified LectureScribe + AI calendar as an RFC 5545 .ics file."""
    ics_text = calendar_service.export_ics(course_slug=course, user_email=user_email)
    return Response(
        content=ics_text,
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="lecturescribe-calendar.ics"'},
    )


@app.post("/api/cron/trigger-alert")
def trigger_cron_alert(
    slot: str = Query(..., description="Target alert slot: '8am' or '4pm' (IST)"),
    authorization: Optional[str] = Header(None, description="Bearer token matching CRON_SECRET")
):
    """
    Automated Cloud Scheduler endpoint triggered at 8:00 AM and 4:00 PM IST.
    Both slots send the same full-day reminder (today's events + tomorrow preview).
    Secured with Bearer token authentication matching CRON_SECRET.
    """
    cron_secret = os.getenv("CRON_SECRET", "").strip()
    if cron_secret:
        expected_bearer = f"Bearer {cron_secret}"
        if not authorization or authorization.strip() != expected_bearer:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing Bearer token for cron trigger.")

    clean_slot = slot.strip().lower()
    if clean_slot not in SLOT_LABELS:
        raise HTTPException(status_code=400, detail=f"Invalid slot '{slot}'. Expected '8am' or '4pm'.")

    try:
        matched_events, slot_label, tomorrow_preview = calendar_service.filter_events_for_slot(clean_slot)
        result = whatsapp_service.dispatch_slot_alert(
            slot=clean_slot,
            events=matched_events,
            slot_label=slot_label,
            tomorrow_preview=tomorrow_preview,
            force_send_empty=False
        )
        return {
            "status": "success",
            "slot": clean_slot,
            "events_count": len(matched_events),
            "tomorrow_preview_count": len(tomorrow_preview) if tomorrow_preview else 0,
            "dispatch": result
        }
    except Exception as e:
        print(f"❌ [Cron Trigger Alert Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to execute cron alert: {str(e)}")


@app.get("/api/videos/sync-status")
def get_videos_sync_status():
    """Retrieve current GCS video migration tracking status and summary."""
    tracking_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts", "sync_tracking.json"))
    if os.path.exists(tracking_path):
        try:
            with open(tracking_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read tracking state: {e}")
    return {
        "version": 1,
        "last_updated": None,
        "summary": {
            "total_tracked": 0,
            "success": 0,
            "already_cached": 0,
            "failed": 0,
            "pending": 0,
            "total_size_mb": 0.0
        },
        "videos": {}
    }


@app.get("/api/videos/{video_id}/status")
def get_single_video_status(video_id: str):
    """Fast, lightweight endpoint to query database and GCS sync status for a single video."""
    vid = str(video_id).strip()
    saved = db_manager.get_saved_video(vid)

    # 1. Retrieve in-memory background upload status
    active_upload = None
    with _gcs_upload_lock:
        active_upload = _active_gcs_uploads.get(vid)

    # 2. Check tracking manifest if exists
    tracking_info = {}
    tracking_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts", "sync_tracking.json"))
    if os.path.exists(tracking_path):
        try:
            with open(tracking_path, "r", encoding="utf-8") as f:
                tracking_data = json.load(f)
                tracking_info = tracking_data.get("videos", {}).get(vid, {})
        except Exception as e:
            print(f"⚠️ [Sync Status Tracking Read Notice]: {e}")

    # 3. Determine course name from all available sources
    effective_course = (
        (saved.get("course_name") if saved else None)
        or (active_upload.get("course_name") if active_upload else None)
        or tracking_info.get("course_name")
    )

    # 4. Check GCS storage with resolved course name
    gcs_video = gcs_storage_service.find_lecture_video(video_id=vid, course_name=effective_course)

    is_upload_success = bool(active_upload and active_upload.get("status") == "SUCCESS")
    is_uploading = bool(active_upload and active_upload.get("status") == "UPLOADING")
    is_gcs_synced = bool(
        gcs_video
        or is_upload_success
        or bool(saved and saved.get("gcs_video_blob"))
        or tracking_info.get("status") in ("SUCCESS", "ALREADY_CACHED")
    )

    blob_name = (
        (gcs_video.get("blob_name") if gcs_video else None)
        or (active_upload.get("blob_name") if active_upload else None)
        or (saved.get("gcs_video_blob") if saved else None)
        or tracking_info.get("blob_name")
    )

    view_url = (
        (gcs_video.get("view_url") if gcs_video else None)
        or (active_upload.get("view_url") if active_upload else None)
    )
    if not view_url and blob_name:
        try:
            view_url = gcs_storage_service.generate_download_signed_url(blob_name, expires_minutes=180, disposition="inline")
        except Exception:
            pass

    size_mb = None
    if gcs_video and gcs_video.get("size_bytes"):
        size_mb = round(gcs_video["size_bytes"] / (1024 * 1024), 2)
    elif active_upload and active_upload.get("size_mb"):
        size_mb = active_upload["size_mb"]
    elif tracking_info.get("size_mb"):
        size_mb = tracking_info["size_mb"]

    gcs_uri = (
        (gcs_video.get("gcs_uri") if gcs_video else None)
        or (f"gs://{gcs_storage_service.bucket_name}/{blob_name}" if blob_name else None)
        or tracking_info.get("gcs_uri")
    )
    title = (saved.get("title") if saved else None) or (active_upload.get("title") if active_upload else None) or tracking_info.get("title")
    course_name = effective_course or tracking_info.get("course_name")

    upload_status = active_upload.get("status") if active_upload else ("COMPLETED" if is_gcs_synced else "IDLE")
    upload_stage = active_upload.get("stage") if active_upload else ("Uploaded successfully" if is_gcs_synced else None)

    return {
        "videoId": vid,
        "cached_in_db": bool(saved),
        "synced_to_gcs": is_gcs_synced,
        "is_uploading": is_uploading,
        "upload_status": upload_status,
        "upload_stage": upload_stage,
        "video_source": "gcs",
        "blob_name": blob_name,
        "gcs_uri": gcs_uri,
        "view_url": view_url,
        "size_mb": size_mb,
        "title": title,
        "course_name": course_name,
        "tracking_status": (active_upload.get("status") if is_uploading else None) or tracking_info.get("status") or ("ALREADY_CACHED" if is_gcs_synced else "UNKNOWN")
    }


@app.post("/api/videos/{video_id}/sync-gcs")
def trigger_video_gcs_sync(
    video_id: str,
    referer: Optional[str] = Query(None, description="Optional LMS referer for protected player configs")
):
    """
    Manually trigger or retry video streaming transfer to Google Cloud Storage.
    Returns immediately while upload proceeds asynchronously in the background.
    """
    vid = str(video_id).strip()
    saved = db_manager.get_saved_video(vid)
    if not saved:
        raise HTTPException(status_code=404, detail=f"Video '{vid}' not found in database.")

    title = saved.get("title", f"Lecture {vid}")
    course_title = (saved.get("course_name") or extract_course_name(title)).strip()
    if not course_title:
        raise HTTPException(status_code=400, detail="course_name is required.")
    cues = saved.get("cues", [])

    # Check if already synced in GCS
    existing_gcs = gcs_storage_service.find_lecture_video(video_id=vid, course_name=course_title)
    if existing_gcs and existing_gcs.get("view_url"):
        return {
            "status": "ALREADY_CACHED",
            "message": "Video is already synced to Google Cloud Storage.",
            "video_id": vid,
            "view_url": existing_gcs["view_url"],
            "synced_to_gcs": True,
            "is_uploading": False
        }

    is_started = _trigger_background_gcs_upload(
        video_id=vid,
        title=title,
        course_name=course_title,
        cues=cues,
        player_config=None,
        referer=referer
    )

    with _gcs_upload_lock:
        active_upload = _active_gcs_uploads.get(vid, {})

    return {
        "status": "STARTED" if is_started else "IN_PROGRESS",
        "message": "Cloud Storage video transfer initiated in background." if is_started else "Transfer is already in progress.",
        "video_id": vid,
        "is_uploading": True,
        "upload_stage": active_upload.get("stage", "Initializing Cloud Storage upload..."),
        "synced_to_gcs": False
    }


@app.get("/api/videos/{video_id}/stream")
def stream_video_direct(video_id: str):
    """Directly stream or redirect to the GCS signed URL for a lecture video."""
    from fastapi.responses import RedirectResponse
    vid = str(video_id).strip()
    saved = db_manager.get_saved_video(vid)

    active_upload = None
    with _gcs_upload_lock:
        active_upload = _active_gcs_uploads.get(vid)

    effective_course = (
        (saved.get("course_name") if saved else None)
        or (active_upload.get("course_name") if active_upload else None)
    )

    gcs_video = gcs_storage_service.find_lecture_video(video_id=vid, course_name=effective_course)
    if gcs_video and gcs_video.get("view_url"):
        return RedirectResponse(url=gcs_video["view_url"], status_code=307)
    if active_upload and active_upload.get("view_url"):
        return RedirectResponse(url=active_upload["view_url"], status_code=307)

    blob_name = (saved.get("gcs_video_blob") if saved else None) or (active_upload.get("blob_name") if active_upload else None)
    if blob_name:
        url = gcs_storage_service.generate_download_signed_url(blob_name, expires_minutes=180, disposition="inline")
        if url:
            return RedirectResponse(url=url, status_code=307)

    # If not found immediately, raise 404
    raise HTTPException(status_code=404, detail=f"GCS video stream for '{vid}' not yet available.")


# ==============================================================================
# Course Assignment Planner & Solution Generator Endpoints
# ==============================================================================

@app.post("/api/course/{course_name}/assignments/upload")
async def upload_course_assignment(
    course_name: str,
    file: UploadFile = File(...),
    dataset_file: Optional[UploadFile] = File(None),
    user_email: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Upload assignment PDF, extract problems, enrich with Course RAG, and generate executed notebook & PDF."""
    from backend.assignment_service import process_assignment_pipeline, get_assignment_workspace

    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    course_slug = to_course_slug(clean_course)
    clean_email = (user_email or "").strip().lower() if user_email else None
    if clean_email and clean_email in db_manager._users_memory_cache:
        require_tutor_role(clean_email, clean_course, action_label="upload and solve assignments")

    # Validate filename and PDF extension
    fname = file.filename or "assignment.pdf"
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF assignment documents (.pdf) are supported.")

    pdf_bytes = await file.read()
    if not pdf_bytes or len(pdf_bytes) < 10:
        raise HTTPException(status_code=400, detail="Uploaded PDF file is empty or unreadable.")

    # Generate assignment tracking ID
    assignment_id = f"asgn_{uuid.uuid4().hex[:12]}"
    display_title = (title or "").strip() or fname.rsplit(".", 1)[0].replace("_", " ").title()

    # Upload original assignment PDF to GCS
    source_blob = gcs_storage_service.get_assignment_blob_path(course_slug, assignment_id, fname)
    try:
        gcs_storage_service.upload_blob_bytes(source_blob, pdf_bytes, content_type="application/pdf")
    except Exception as gcs_err:
        logger.warning(f"[Assignment Upload Notice] Could not persist source PDF to GCS: {gcs_err}")

    # Optional dataset file attached during initial upload
    dataset_files_list = []
    if dataset_file and dataset_file.filename:
        ds_name = dataset_file.filename
        try:
            ds_bytes = await dataset_file.read()
            if ds_bytes:
                ws = get_assignment_workspace(assignment_id)
                with open(os.path.join(ws, ds_name), "wb") as f:
                    f.write(ds_bytes)
                ds_blob = gcs_storage_service.get_assignment_blob_path(course_slug, assignment_id, ds_name)
                gcs_storage_service.upload_blob_bytes(ds_blob, ds_bytes, content_type="application/octet-stream")
                dataset_files_list.append(ds_name)
        except Exception as ds_err:
            logger.warning(f"[Assignment Upload Notice] Error saving initial dataset file: {ds_err}")

    # Record in database as pending
    record = db_manager.create_assignment(
        assignment_id=assignment_id,
        course_name=clean_course,
        user_email=clean_email,
        title=display_title,
        source_filename=fname,
        source_blob_name=source_blob,
        status="pending",
        dataset_files=dataset_files_list
    )

    # Launch pipeline in background task so UI receives instant response
    background_tasks.add_task(
        process_assignment_pipeline,
        assignment_id=assignment_id,
        course_name=clean_course,
        user_email=clean_email,
        pdf_bytes=pdf_bytes,
        filename=fname
    )

    return {
        "status": "success",
        "assignment_id": assignment_id,
        "course_name": clean_course,
        "title": display_title,
        "message": "Assignment uploaded. Generation pipeline is running in background.",
        "record": record
    }


@app.post("/api/course/{course_name}/assignments/{assignment_id}/provide-dataset")
async def provide_assignment_dataset(
    course_name: str,
    assignment_id: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Provide a missing dataset file for a paused assignment and resume code execution."""
    from backend.assignment_service import resume_assignment_pipeline, get_assignment_workspace

    clean_id = assignment_id.strip()
    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    course_slug = to_course_slug(clean_course)
    fname = file.filename or "dataset.csv"

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded dataset file is empty.")

    # 1. Save locally in assignment workspace
    ws = get_assignment_workspace(clean_id)
    local_path = os.path.join(ws, fname)
    with open(local_path, "wb") as f:
        f.write(file_bytes)

    # 2. Upload to GCS
    blob_name = gcs_storage_service.get_assignment_blob_path(course_slug, clean_id, fname)
    try:
        gcs_storage_service.upload_blob_bytes(blob_name, file_bytes, content_type="application/octet-stream")
    except Exception as gcs_err:
        logger.warning(f"[Dataset Upload Notice] Could not persist dataset to GCS: {gcs_err}")

    # 3. Update DB record dataset_files (and alias if single missing required filename differs)
    existing_datasets = list(record.get("dataset_files") or [])
    if fname not in existing_datasets:
        existing_datasets.append(fname)

    missing_req = [
        rf for rf in (record.get("required_files") or [])
        if rf not in existing_datasets and not os.path.exists(os.path.join(ws, rf))
    ]
    if len(missing_req) == 1 and fname != missing_req[0]:
        alias_name = missing_req[0]
        try:
            with open(os.path.join(ws, alias_name), "wb") as af:
                af.write(file_bytes)
            alias_blob = gcs_storage_service.get_assignment_blob_path(course_slug, clean_id, alias_name)
            gcs_storage_service.upload_blob_bytes(alias_blob, file_bytes, content_type="application/octet-stream")
            existing_datasets.append(alias_name)
        except Exception as alias_err:
            logger.warning(f"[Dataset Alias Notice] Could not alias '{fname}' to '{alias_name}': {alias_err}")

    db_manager.update_assignment(
        clean_id,
        status="processing",
        dataset_files=existing_datasets,
        error_message=None
    )

    # 4. Resume execution in background
    background_tasks.add_task(
        resume_assignment_pipeline,
        assignment_id=clean_id,
        course_name=clean_course
    )

    return {
        "status": "success",
        "message": f"Dataset '{fname}' uploaded. Resuming assignment code execution.",
        "assignment_id": clean_id,
        "filename": fname
    }


@app.post("/api/course/{course_name}/assignments/{assignment_id}/skip-dataset")
async def skip_assignment_dataset(
    course_name: str,
    assignment_id: str,
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Bypass missing dataset prompt and generate/execute solution using synthetic/in-memory fallback data."""
    from backend.assignment_service import resume_assignment_pipeline

    clean_id = assignment_id.strip()
    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    db_manager.update_assignment(
        clean_id,
        status="processing",
        required_files=[],
        error_message=None
    )

    background_tasks.add_task(
        resume_assignment_pipeline,
        assignment_id=clean_id,
        course_name=clean_course,
        skip_missing=True
    )

    return {
        "status": "success",
        "message": "Proceeding with assignment solution generation without external dataset.",
        "assignment_id": clean_id
    }


@app.get("/api/course/{course_name}/assignments")
def list_course_assignments(
    course_name: str,
    user_email: Optional[str] = Query(None, description="Optional filter by student Google email"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """List all assignment solutions for the specified course."""
    from backend.assignment_service import is_output_or_generated_dataset, resume_assignment_pipeline

    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    clean_email = (user_email or "").strip().lower() if user_email else None

    assignments = db_manager.get_course_assignments(clean_course, clean_email)
    
    # Decorate with download endpoints and auto-recover assignments paused on output/cleaned filenames
    decorated = []
    for asgn in assignments:
        item = dict(asgn)
        aid = item.get("assignment_id")
        if aid:
            item["download_ipynb_url"] = f"/api/course/assignment/{aid}/download/ipynb"
            item["download_pdf_url"] = f"/api/course/assignment/{aid}/download/pdf"
            if item.get("status") == "needs_input":
                req_files = item.get("required_files") or []
                remaining_req = [
                    rf for rf in req_files
                    if not is_output_or_generated_dataset(rf, "", item.get("questions_summary"))
                ]
                if req_files and not remaining_req:
                    item["status"] = "processing"
                    item["required_files"] = []
                    item["error_message"] = None
                    db_manager.update_assignment(aid, status="processing", required_files=[], error_message=None)
                    background_tasks.add_task(
                        resume_assignment_pipeline,
                        assignment_id=aid,
                        course_name=clean_course,
                        skip_missing=True
                    )
        decorated.append(item)

    return {
        "status": "success",
        "course_name": clean_course,
        "count": len(decorated),
        "assignments": decorated
    }


@app.get("/api/course/{course_name}/assignments/{assignment_id}")
def get_course_assignment_status(course_name: str, assignment_id: str):
    """Check the real-time processing status of a specific assignment."""
    clean_id = assignment_id.strip()
    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    res = dict(record)
    res["download_ipynb_url"] = f"/api/course/assignment/{clean_id}/download/ipynb"
    res["download_pdf_url"] = f"/api/course/assignment/{clean_id}/download/pdf"
    return {
        "status": "success",
        "assignment": res
    }


@app.get("/api/course/assignment/{assignment_id}/download/{file_type}")
def download_assignment_file(assignment_id: str, file_type: str):
    """Directly stream the generated .ipynb or .pdf deliverable to the client."""
    clean_id = assignment_id.strip()
    ft = file_type.lower().strip()
    if ft not in ("ipynb", "pdf"):
        raise HTTPException(status_code=400, detail="file_type must be 'ipynb' or 'pdf'.")

    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    if record.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"Assignment solution is still {record.get('status', 'processing')}. Please wait."
        )

    blob_name = record.get("notebook_blob_name") if ft == "ipynb" else record.get("pdf_blob_name")
    if not blob_name:
        raise HTTPException(status_code=404, detail=f"File deliverable for '{ft}' is not available.")

    # Retrieve blob content from GCS (or mock storage)
    if ft == "ipynb":
        text_content = gcs_storage_service.get_blob_text(blob_name)
        if not text_content:
            raw = gcs_storage_service.get_blob_bytes(blob_name)
            text_content = raw.decode("utf-8", errors="replace") if raw else ""
        if not text_content:
            raise HTTPException(status_code=404, detail="Notebook content could not be retrieved.")

        safe_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', record.get('title', 'solution'))
        filename = f"{safe_title}.ipynb"
        return StreamingResponse(
            io.BytesIO(text_content.encode("utf-8")),
            media_type="application/x-ipynb+json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    else:
        pdf_bytes = gcs_storage_service.get_blob_bytes(blob_name)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="PDF deliverable could not be retrieved.")

        safe_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', record.get('title', 'solution'))
        filename = f"{safe_title}_Solution.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )


@app.post("/api/course/{course_name}/assignments/{assignment_id}/regenerate")
async def regenerate_course_assignment_endpoint(
    course_name: str,
    assignment_id: str,
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Re-run generation and code execution for an existing assignment."""
    from backend.assignment_service import process_assignment_pipeline

    clean_id = assignment_id.strip()
    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    source_blob = record.get("source_blob_name")
    if not source_blob:
        raise HTTPException(status_code=400, detail="Original assignment PDF source blob not found.")

    pdf_bytes = gcs_storage_service.get_blob_bytes(source_blob)
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="Could not read original assignment PDF from cloud storage.")

    # Update DB to pending
    db_manager.update_assignment(clean_id, status="pending", error_message=None)

    background_tasks.add_task(
        process_assignment_pipeline,
        assignment_id=clean_id,
        course_name=record.get("course_name") or course_name,
        user_email=record.get("user_email"),
        pdf_bytes=pdf_bytes,
        filename=record.get("source_filename") or "assignment.pdf"
    )

    return {
        "status": "success",
        "message": "Assignment regeneration started in background.",
        "assignment_id": clean_id
    }


@app.delete("/api/course/{course_name}/assignments/{assignment_id}")
def delete_course_assignment_route(
    course_name: str,
    assignment_id: str,
    user_email: Optional[str] = Query(None, description="Optional user email for role verification")
):
    """Delete an assignment and its generated files."""
    if user_email:
        require_tutor_role(user_email, course_name, action_label="delete assignments")
    clean_id = assignment_id.strip()
    record = db_manager.get_assignment_by_id(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Assignment '{clean_id}' not found.")

    # Delete blobs if any
    for b in (record.get("source_blob_name"), record.get("notebook_blob_name"), record.get("pdf_blob_name")):
        if b:
            try:
                gcs_storage_service.delete_blob(b)
            except Exception:
                pass

    db_manager.delete_assignment(clean_id)
    return {"status": "success", "message": f"Assignment '{clean_id}' deleted."}


# ==============================================================================
# LMS Role-Based Access Control (RBAC v1: Tutor & Student Roles)
# ==============================================================================

class AuthSessionRequest(BaseModel):
    email: str
    name: Optional[str] = None
    picture_url: Optional[str] = None
    requested_role: Optional[str] = None


class SwitchRoleRequest(BaseModel):
    email: str
    role: str
    update_system_role: Optional[bool] = False


class AssignCourseMemberRequest(BaseModel):
    user_email: str
    course_role: str = "student"
    enrol_method: Optional[str] = "manual"
    actor_email: Optional[str] = None


def require_tutor_role(
    user_email: Optional[str],
    course_identifier: Optional[str] = None,
    action_label: str = "perform this instructor action"
) -> Dict[str, Any]:
    """Raise 403 Forbidden if a known user_email has effective_role == 'student'."""
    clean_email = (user_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=403, detail=f"Tutor role is required to {action_label}.")
    role_info = db_manager.get_user_role_info(clean_email, course_identifier=course_identifier)
    if not role_info.get("is_tutor"):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: Only Tutors can {action_label}. Current role is '{role_info.get('effective_role', 'student')}'."
        )
    return role_info


@app.post("/api/auth/session")
def sync_auth_session(req: AuthSessionRequest):
    """Sync Google OAuth user profile and resolve Tutor / Student role."""
    clean_email = (req.email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="email is required.")
    session_info = db_manager.upsert_user_session(
        email=clean_email,
        name=req.name,
        picture_url=req.picture_url,
        requested_role=req.requested_role
    )
    return {"status": "success", **session_info}


@app.get("/api/auth/role")
def get_user_role_endpoint(
    email: Optional[str] = Query(None, description="User Google email"),
    course: Optional[str] = Query(None, description="Optional course name or slug")
):
    """Retrieve effective role ('tutor', 'student', or 'guest') for a user."""
    role_info = db_manager.get_user_role_info(email, course_identifier=course)
    return {"status": "success", **role_info}


@app.patch("/api/auth/role")
def switch_user_role_endpoint(req: SwitchRoleRequest):
    """Switch active view role (or system role) between 'tutor' and 'student'."""
    clean_email = (req.email or "").strip().lower()
    target_role = (req.role or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="email is required.")
    if target_role not in ("tutor", "student"):
        raise HTTPException(status_code=400, detail="role must be 'tutor' or 'student'.")
    updated = db_manager.set_user_role(
        email=clean_email,
        role=target_role,
        update_system_role=bool(req.update_system_role)
    )
    return {"status": "success", **updated}


@app.get("/api/course/{course_name}/members")
def list_course_members_endpoint(course_name: str):
    """Return list of Tutors and Students enrolled in a course."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    members = db_manager.get_course_members(clean_course)
    return {
        "status": "success",
        "course_name": clean_course,
        "course_slug": to_course_slug(clean_course),
        "count": len(members),
        "members": members
    }


@app.post("/api/course/{course_name}/members")
def assign_course_member_endpoint(course_name: str, req: AssignCourseMemberRequest):
    """Assign a user as 'tutor' or 'student' in a specific course."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="manage course members")
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    clean_email = (req.user_email or "").strip().lower()
    target_role = (req.course_role or "student").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="user_email is required.")
    if target_role not in ("tutor", "student"):
        raise HTTPException(status_code=400, detail="course_role must be 'tutor' or 'student'.")

    member = db_manager.assign_course_role(
        course_identifier=clean_course,
        user_email=clean_email,
        course_role=target_role,
        enrol_method=req.enrol_method or "manual"
    )
    return {
        "status": "success",
        "course_name": clean_course,
        "member": member
    }


# ==============================================================================
# Option 1: Assignment Publishing, Calendar Deadline Sync, Submissions & SpeedGrader
# ==============================================================================

class PublishAssignmentSettingsRequest(BaseModel):
    due_date: Optional[str] = None
    max_marks: Optional[float] = 100.0
    is_published: Optional[bool] = True
    actor_email: Optional[str] = None


class StudentAssignmentSubmitRequest(BaseModel):
    student_email: str
    student_name: Optional[str] = ""
    submission_text: Optional[str] = ""
    file_name: Optional[str] = ""
    file_content_base64: Optional[str] = ""


class GradeSubmissionRequest(BaseModel):
    score: Optional[float] = None
    instructor_feedback: Optional[str] = ""
    actor_email: Optional[str] = None


@app.patch("/api/course/{course_name}/assignments/{assignment_id}/publish")
def publish_course_assignment_settings_endpoint(
    course_name: str,
    assignment_id: str,
    req: PublishAssignmentSettingsRequest,
):
    """Tutor updates assignment due date, max marks, and publish status (auto-syncing deadline to Calendar)."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="publish assignment settings")
    updated = db_manager.publish_assignment_settings(
        assignment_id=assignment_id,
        due_date=req.due_date,
        max_marks=req.max_marks,
        is_published=req.is_published,
        updated_by_email=req.actor_email,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Assignment '{assignment_id}' not found.")
    return {
        "status": "success",
        "assignment": updated,
        "calendar_event_id": updated.get("calendar_event_id"),
    }


@app.post("/api/course/{course_name}/assignments/{assignment_id}/submit")
def submit_course_assignment_endpoint(
    course_name: str,
    assignment_id: str,
    req: StudentAssignmentSubmitRequest,
):
    """Student submits their solution text and/or attachment for a course assignment."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    clean_email = (req.student_email or "").strip().lower()
    if not clean_email:
        raise HTTPException(status_code=400, detail="student_email is required.")

    asgn = db_manager.get_assignment_by_id(assignment_id.strip())
    if not asgn:
        raise HTTPException(status_code=404, detail=f"Assignment '{assignment_id}' not found.")

    blob_name = ""
    if req.file_name and req.file_content_base64:
        try:
            import base64
            raw_bytes = base64.b64decode(req.file_content_base64)
            safe_fname = re.sub(r"[^a-zA-Z0-9._-]", "_", req.file_name.strip())
            blob_name = f"courses/{to_course_slug(clean_course)}/submissions/{assignment_id.strip()}/{clean_email}_{safe_fname}"
            gcs_storage_service.upload_bytes(raw_bytes, blob_name, content_type="application/octet-stream")
        except Exception as e:
            print(f"[Assignment Submission Upload Notice] {e}")

    sub = db_manager.submit_assignment(
        assignment_id=assignment_id.strip(),
        course_name=clean_course,
        student_email=clean_email,
        student_name=req.student_name or "",
        submission_text=req.submission_text or "",
        file_name=req.file_name or "",
        file_blob_name=blob_name,
        max_marks=float(asgn.get("max_marks") or 100.0),
    )
    return {"status": "success", "submission": sub}


@app.get("/api/course/{course_name}/assignments/{assignment_id}/submissions")
def list_assignment_submissions_endpoint(
    course_name: str,
    assignment_id: str,
    student_email: Optional[str] = Query(None, description="Optional student email filter"),
):
    """List submissions for a specific assignment."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    subs = db_manager.get_assignment_submissions(
        course_name=clean_course,
        assignment_id=assignment_id.strip(),
        student_email=student_email,
    )
    return {
        "status": "success",
        "assignment_id": assignment_id.strip(),
        "count": len(subs),
        "submissions": subs,
    }


@app.get("/api/course/{course_name}/submissions")
def list_course_submissions_endpoint(
    course_name: str,
    student_email: Optional[str] = Query(None, description="Optional student email filter"),
):
    """List all assignment submissions across a course (or for a single student)."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    subs = db_manager.get_assignment_submissions(
        course_name=clean_course,
        student_email=student_email,
    )
    return {
        "status": "success",
        "course_name": clean_course,
        "count": len(subs),
        "submissions": subs,
    }


@app.post("/api/course/{course_name}/assignments/{assignment_id}/submissions/{submission_id}/ai-grade")
def ai_speedgrade_submission_endpoint(
    course_name: str,
    assignment_id: str,
    submission_id: str,
    actor_email: Optional[str] = Query(None),
    apply_grade: bool = Query(False, description="Whether to immediately apply the AI suggested score as final grade"),
):
    """Run AI SpeedGrader on a student submission and store the suggested score & feedback."""
    if actor_email:
        require_tutor_role(actor_email, course_name, action_label="run AI SpeedGrader")

    from backend.assignment_service import evaluate_student_submission_with_ai

    asgn = db_manager.get_assignment_by_id(assignment_id.strip())
    if not asgn:
        raise HTTPException(status_code=404, detail=f"Assignment '{assignment_id}' not found.")

    subs = db_manager.get_assignment_submissions(assignment_id=assignment_id.strip())
    target_sub = next((s for s in subs if s.get("submission_id") == submission_id.strip()), None)
    if not target_sub:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' not found.")

    ai_eval = evaluate_student_submission_with_ai(asgn, target_sub)
    updated = db_manager.grade_assignment_submission(
        submission_id=submission_id.strip(),
        score=ai_eval["ai_suggested_score"] if apply_grade else target_sub.get("score"),
        instructor_feedback=ai_eval["ai_feedback"] if apply_grade and not target_sub.get("instructor_feedback") else target_sub.get("instructor_feedback"),
        ai_suggested_score=ai_eval["ai_suggested_score"],
        ai_feedback=ai_eval["ai_feedback"],
        graded_by_email=actor_email,
        apply_grade=apply_grade,
    )
    return {
        "status": "success",
        "submission": updated,
        "ai_evaluation": ai_eval,
    }


@app.patch("/api/course/{course_name}/assignments/{assignment_id}/submissions/{submission_id}/grade")
def grade_assignment_submission_endpoint(
    course_name: str,
    assignment_id: str,
    submission_id: str,
    req: GradeSubmissionRequest,
):
    """Tutor approves or overrides the final score and feedback for a student submission."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="grade student submissions")

    updated = db_manager.grade_assignment_submission(
        submission_id=submission_id.strip(),
        score=req.score,
        instructor_feedback=req.instructor_feedback,
        graded_by_email=req.actor_email,
        apply_grade=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Submission '{submission_id}' not found.")
    return {"status": "success", "submission": updated}


# ==============================================================================
# Option 2: Centralized Course Gradebook Engine
# ==============================================================================

class GradebookOverrideRequest(BaseModel):
    student_email: str
    item_id: str
    score: float
    max_marks: Optional[float] = 100.0
    item_title: Optional[str] = ""
    item_type: Optional[str] = "manual"
    feedback: Optional[str] = ""
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/gradebook")
def get_course_gradebook_endpoint(
    course_name: str,
    student_email: Optional[str] = Query(None, description="Optional student email to filter personal grade report"),
):
    """Return the centralized Course Gradebook (Student Grade Report or Tutor Class Matrix)."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    gradebook = db_manager.get_course_gradebook(clean_course, student_email=student_email)
    return {"status": "success", **gradebook}


@app.post("/api/course/{course_name}/gradebook/override")
def upsert_course_gradebook_override_endpoint(
    course_name: str,
    req: GradebookOverrideRequest,
):
    """Tutor overrides a student's score on an assessment or adds a manual grade column."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="update gradebook scores")
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    override = db_manager.upsert_gradebook_override(
        course_name=clean_course,
        student_email=req.student_email,
        item_id=req.item_id,
        score=req.score,
        max_marks=float(req.max_marks or 100.0),
        item_title=req.item_title or "",
        item_type=req.item_type or "manual",
        feedback=req.feedback or "",
        updated_by_email=req.actor_email or "",
    )
    return {"status": "success", "override": override}


# ==============================================================================
# Option 3: Course Enrollment, Roster & Self-Enrollment Keys
# ==============================================================================

class GenerateEnrollmentKeyRequest(BaseModel):
    actor_email: Optional[str] = None
    custom_key: Optional[str] = None


class SelfEnrolByKeyRequest(BaseModel):
    enrollment_key: str
    user_email: str
    user_name: Optional[str] = None


@app.get("/api/course/{course_name}/enrollment-key")
def get_course_enrollment_key_endpoint(
    course_name: str,
    actor_email: Optional[str] = Query(None),
):
    """Retrieve the active self-enrollment key for a course (auto-generating one if Tutor requests and none exists)."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    rec = db_manager.get_course_enrollment_key(clean_course)
    if not rec and actor_email:
        role_info = db_manager.get_user_role_info(actor_email, course_identifier=clean_course)
        if role_info.get("is_tutor"):
            rec = db_manager.generate_course_enrollment_key(clean_course, created_by_email=actor_email)
    return {"status": "success", "course_name": clean_course, "key_record": rec}


@app.post("/api/course/{course_name}/enrollment-key")
def generate_course_enrollment_key_endpoint(
    course_name: str,
    req: GenerateEnrollmentKeyRequest,
):
    """Tutor generates or rotates a shareable self-enrollment key for a course."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="generate enrollment keys")
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    rec = db_manager.generate_course_enrollment_key(
        course_name=clean_course,
        created_by_email=req.actor_email or "",
        custom_key=req.custom_key,
    )
    return {"status": "success", "course_name": clean_course, "key_record": rec}


@app.post("/api/course/enrol-by-key")
def enrol_by_key_endpoint(req: SelfEnrolByKeyRequest):
    """Student self-enrols in a course using a shareable enrollment key."""
    enrolled = db_manager.enrol_user_by_key(
        enrollment_key=req.enrollment_key,
        user_email=req.user_email,
        user_name=req.user_name,
    )
    if not enrolled:
        raise HTTPException(status_code=404, detail="Invalid or expired enrollment key.")
    return {"status": "success", "enrollment": enrolled}


@app.delete("/api/course/{course_name}/members/{target_email}")
def remove_course_member_endpoint(
    course_name: str,
    target_email: str,
    actor_email: Optional[str] = Query(None),
):
    """Tutor removes a member from a course roster."""
    if actor_email:
        require_tutor_role(actor_email, course_name, action_label="remove course members")
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    removed = db_manager.remove_course_member(clean_course, target_email)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Member '{target_email}' not found in course.")
    return {"status": "success", "removed": True, "user_email": target_email}


# ==============================================================================
# Option 4: Course Discussions / Q&A Forum with Timestamp Deep-Links & AI Triage
# ==============================================================================

class CreateForumThreadRequest(BaseModel):
    title: str
    body: str
    author_email: str
    author_name: Optional[str] = ""
    author_role: Optional[str] = "student"
    category: Optional[str] = "general"
    video_id: Optional[str] = ""
    lecture_title: Optional[str] = ""
    timestamp_str: Optional[str] = ""
    is_pinned: Optional[bool] = False


class CreateForumReplyRequest(BaseModel):
    author_email: str
    author_name: Optional[str] = ""
    author_role: Optional[str] = "student"
    body: str


class EndorseForumReplyRequest(BaseModel):
    is_endorsed: bool = True
    resolve_thread: bool = True
    actor_email: Optional[str] = None


class UpdateForumThreadFlagsRequest(BaseModel):
    is_pinned: Optional[bool] = None
    is_resolved: Optional[bool] = None
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/forum")
def list_course_forum_threads_endpoint(
    course_name: str,
    category: Optional[str] = Query(None),
):
    """List all discussion threads and nested replies for a course."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    threads = db_manager.get_forum_threads(clean_course, category=category)
    return {
        "status": "success",
        "course_name": clean_course,
        "count": len(threads),
        "threads": threads,
    }


@app.post("/api/course/{course_name}/forum")
def create_course_forum_thread_endpoint(
    course_name: str,
    req: CreateForumThreadRequest,
):
    """Create a new discussion thread (optionally linked to a lecture video & timestamp)."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    role_info = db_manager.get_user_role_info(req.author_email, course_identifier=clean_course)
    effective_role = "tutor" if role_info.get("is_tutor") else (req.author_role or "student")
    thread = db_manager.create_forum_thread(
        course_name=clean_course,
        title=req.title,
        body=req.body,
        author_email=req.author_email,
        author_name=req.author_name or "",
        author_role=effective_role,
        category=req.category or "general",
        video_id=req.video_id or "",
        lecture_title=req.lecture_title or "",
        timestamp_str=req.timestamp_str or "",
        is_pinned=bool(req.is_pinned) if effective_role == "tutor" else False,
    )
    return {"status": "success", "thread": thread}


@app.post("/api/course/{course_name}/forum/{thread_id}/reply")
def add_course_forum_reply_endpoint(
    course_name: str,
    thread_id: str,
    req: CreateForumReplyRequest,
):
    """Post a reply to a course discussion thread."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    role_info = db_manager.get_user_role_info(req.author_email, course_identifier=clean_course)
    effective_role = "tutor" if role_info.get("is_tutor") else (req.author_role or "student")
    reply = db_manager.add_forum_reply(
        thread_id=thread_id.strip(),
        author_email=req.author_email,
        author_name=req.author_name or "",
        author_role=effective_role,
        body=req.body,
        is_ai_generated=False,
    )
    if not reply:
        raise HTTPException(status_code=400, detail="Could not create reply.")
    return {"status": "success", "reply": reply}


@app.post("/api/course/{course_name}/forum/{thread_id}/ai-reply")
def generate_ai_ta_forum_reply_endpoint(
    course_name: str,
    thread_id: str,
):
    """AI TA generates a grounded answer to a student's forum thread using Course RAG and lecture transcripts."""
    clean_course = db_manager.resolve_course_canonical_name(course_name.strip())
    threads = db_manager.get_forum_threads(clean_course)
    target = next((t for t in threads if t.get("thread_id") == thread_id.strip()), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Forum thread '{thread_id}' not found.")

    prompt_text = f"Forum Question Title: {target.get('title')}\nQuestion Details: {target.get('body')}"
    if target.get("lecture_title") or target.get("timestamp_str"):
        prompt_text += f"\nReferenced Lecture: {target.get('lecture_title', '')} at {target.get('timestamp_str', '')}"

    ai_body = ""
    citations: List[Dict[str, Any]] = []
    try:
        from backend.course_rag_service import course_rag_service
        rag_res = course_rag_service.query_course(clean_course, prompt_text)
        if isinstance(rag_res, dict) and rag_res.get("reply"):
            ai_body = str(rag_res["reply"]).strip()
            citations = rag_res.get("citations") or []
    except Exception as e:
        print(f"[Forum AI TA Notice] Course RAG fallback ({e}).")

    if not ai_body or "error" in ai_body.lower()[:25]:
        ref_note = (
            f" (specifically referencing **{target['lecture_title']}** around `[{target['timestamp_str']}]`)"
            if target.get("lecture_title") and target.get("timestamp_str")
            else ""
        )
        ai_body = (
            f"**AI Teaching Assistant Grounded Response:**\n\n"
            f"Regarding **{target.get('title')}**{ref_note}: "
            f"Break the problem down into the core definitions covered in the **{clean_course}** lectures, "
            f"verify the boundary assumptions, and check the corresponding derivation in the course summary notes. "
            f"*(An instructor can endorse or expand on this response below.)*"
        )

    reply = db_manager.add_forum_reply(
        thread_id=thread_id.strip(),
        author_email="ai-ta@lecturescribe.ai",
        author_name="LectureScribe AI TA",
        author_role="ai_ta",
        body=ai_body,
        is_ai_generated=True,
        citations=citations,
    )
    return {"status": "success", "reply": reply}


@app.patch("/api/course/{course_name}/forum/{thread_id}/endorse/{reply_id}")
def endorse_forum_reply_endpoint(
    course_name: str,
    thread_id: str,
    reply_id: str,
    req: EndorseForumReplyRequest,
):
    """Tutor endorses a student or AI TA reply and optionally marks the thread resolved."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="endorse forum replies")
    updated = db_manager.toggle_forum_reply_endorsement(
        thread_id=thread_id.strip(),
        reply_id=reply_id.strip(),
        is_endorsed=req.is_endorsed,
        resolve_thread=req.resolve_thread,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Reply '{reply_id}' not found.")
    return {"status": "success", "reply": updated}


@app.patch("/api/course/{course_name}/forum/{thread_id}/flags")
def update_forum_thread_flags_endpoint(
    course_name: str,
    thread_id: str,
    req: UpdateForumThreadFlagsRequest,
):
    """Update thread pinned or resolved status."""
    if req.actor_email and req.is_pinned is not None:
        require_tutor_role(req.actor_email, course_name, action_label="pin forum threads")
    updated = db_manager.update_forum_thread_flags(
        thread_id=thread_id.strip(),
        is_pinned=req.is_pinned,
        is_resolved=req.is_resolved,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found.")
    return {"status": "success", "thread": updated}


# =========================================================================
# Next-Wave Option 1: Course Completion Tracking & Restrict Access Rules
# =========================================================================


class ToggleModuleCompletionRequest(BaseModel):
    user_email: str
    module_id: str
    module_type: str = "lecture"
    module_title: str = ""
    is_completed: bool = True


class UpsertAccessRuleRequest(BaseModel):
    target_module_id: str
    target_module_type: str = "quiz"
    target_title: str = ""
    required_module_ids: List[str] = []
    min_quiz_score_pct: Optional[float] = None
    unlock_date: Optional[str] = None
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/completion")
def get_course_completion_endpoint(
    course_name: str,
    user_email: Optional[str] = None,
):
    """Get Moodle-style activity completion status and prerequisite lock evaluations for a student."""
    data = db_manager.get_course_completion_status(
        course_name=course_name.strip(),
        user_email=user_email,
    )
    return {"status": "success", **data}


@app.post("/api/course/{course_name}/completion/toggle")
def toggle_module_completion_endpoint(
    course_name: str,
    req: ToggleModuleCompletionRequest,
):
    """Mark a course activity or module as Done / Undone for a student."""
    record = db_manager.toggle_module_completion(
        course_name=course_name.strip(),
        user_email=req.user_email,
        module_id=req.module_id,
        module_type=req.module_type,
        module_title=req.module_title,
        is_completed=req.is_completed,
    )
    return {"status": "success", "completion": record}


@app.get("/api/course/{course_name}/access-rules")
def get_course_access_rules_endpoint(course_name: str):
    """List all Restrict Access prerequisite rules configured for a course."""
    rules = db_manager.get_access_rules(course_name.strip())
    return {"status": "success", "course_name": course_name.strip(), "rules": rules}


@app.post("/api/course/{course_name}/access-rules")
def upsert_course_access_rule_endpoint(
    course_name: str,
    req: UpsertAccessRuleRequest,
):
    """Create or update a Restrict Access prerequisite rule on a course module (Tutor)."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="configure Restrict Access prerequisite rules")
    rule = db_manager.upsert_access_rule(
        course_name=course_name.strip(),
        target_module_id=req.target_module_id,
        target_module_type=req.target_module_type,
        target_title=req.target_title,
        required_module_ids=req.required_module_ids,
        min_quiz_score_pct=req.min_quiz_score_pct,
        unlock_date=req.unlock_date,
        created_by_email=req.actor_email or "",
    )
    return {"status": "success", "rule": rule}


# =========================================================================
# Next-Wave Option 2: Decoupled AI Question Bank & Custom Quiz Builder
# =========================================================================


class SaveQuestionBankRequest(BaseModel):
    items: List[Dict[str, Any]]
    actor_email: Optional[str] = None


class GenerateQuestionBankRequest(BaseModel):
    video_id: Optional[str] = None
    lecture_title: Optional[str] = None
    count: int = 3
    difficulty: str = "medium"
    bloom_level: str = "apply"
    actor_email: Optional[str] = None


class PublishCustomQuizRequest(BaseModel):
    question_ids: Optional[List[str]] = None
    title: Optional[str] = None
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/question-bank")
def get_course_question_bank_endpoint(
    course_name: str,
    difficulty: Optional[str] = None,
    bloom_level: Optional[str] = None,
    question_type: Optional[str] = None,
    video_id: Optional[str] = None,
):
    """Retrieve reusable questions from the Course Question Bank with optional taxonomy filters."""
    items = db_manager.get_question_bank(
        course_name=course_name.strip(),
        difficulty=difficulty,
        bloom_level=bloom_level,
        question_type=question_type,
        video_id=video_id,
    )
    return {
        "status": "success",
        "course_name": course_name.strip(),
        "count": len(items),
        "questions": items,
    }


@app.post("/api/course/{course_name}/question-bank")
def save_course_question_bank_endpoint(
    course_name: str,
    req: SaveQuestionBankRequest,
):
    """Save custom or edited questions into the Course Question Bank."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="manage the Question Bank")
    saved = db_manager.save_question_bank_items(
        course_name=course_name.strip(),
        items=req.items,
        created_by_email=req.actor_email or "",
    )
    return {"status": "success", "saved_count": len(saved), "questions": saved}


@app.post("/api/course/{course_name}/question-bank/ai-generate")
def ai_generate_question_bank_endpoint(
    course_name: str,
    req: GenerateQuestionBankRequest,
):
    """Generate Bloom's Taxonomy-aligned questions for the Question Bank from lecture transcripts."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="generate AI Question Bank items")
    generated = db_manager.generate_questions_for_bank(
        course_name=course_name.strip(),
        video_id=req.video_id,
        lecture_title=req.lecture_title,
        count=max(1, min(req.count, 10)),
        difficulty=req.difficulty,
        bloom_level=req.bloom_level,
        created_by_email=req.actor_email or "",
    )
    return {"status": "success", "generated_count": len(generated), "questions": generated}


@app.post("/api/course/{course_name}/question-bank/publish-quiz")
def publish_custom_quiz_from_bank_endpoint(
    course_name: str,
    req: PublishCustomQuizRequest,
):
    """Assemble selected Question Bank items into the active Course Quiz."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="publish custom course quizzes")
    quiz_payload = db_manager.publish_custom_quiz_from_bank(
        course_name=course_name.strip(),
        question_ids=req.question_ids,
        title=req.title,
    )
    return {"status": "success", "quiz": quiz_payload}


@app.delete("/api/course/{course_name}/question-bank/{question_id}")
def delete_question_bank_item_endpoint(
    course_name: str,
    question_id: str,
    actor_email: Optional[str] = None,
):
    """Delete a question from the Course Question Bank."""
    if actor_email:
        require_tutor_role(actor_email, course_name, action_label="delete Question Bank items")
    deleted = db_manager.delete_question_bank_item(question_id.strip())
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Question '{question_id}' not found.")
    return {"status": "success", "deleted_id": question_id.strip()}


# =========================================================================
# Next-Wave Option 3: Modular Course Syllabus Spine & AI Auto-Organizer
# =========================================================================


class SaveCourseSectionRequest(BaseModel):
    section_id: Optional[str] = None
    section_number: Optional[int] = None
    title: str
    summary: str = ""
    learning_objectives: List[str] = []
    items: List[Dict[str, Any]] = []
    actor_email: Optional[str] = None


class AutoOrganizeSyllabusRequest(BaseModel):
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/syllabus")
def get_course_syllabus_sections_endpoint(course_name: str):
    """Retrieve the weekly/topic curriculum modules for a course."""
    sections = db_manager.get_course_sections(course_name.strip())
    return {
        "status": "success",
        "course_name": course_name.strip(),
        "count": len(sections),
        "sections": sections,
    }


@app.post("/api/course/{course_name}/syllabus/sections")
def save_course_syllabus_section_endpoint(
    course_name: str,
    req: SaveCourseSectionRequest,
):
    """Create or update a weekly/topic module section in the Course Syllabus Spine."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="edit the course syllabus spine")
    section = db_manager.save_course_section(
        course_name=course_name.strip(),
        title=req.title,
        summary=req.summary,
        section_number=req.section_number,
        learning_objectives=req.learning_objectives,
        items=req.items,
        section_id=req.section_id,
    )
    return {"status": "success", "section": section}


@app.post("/api/course/{course_name}/syllabus/ai-organize")
def ai_auto_organize_syllabus_endpoint(
    course_name: str,
    req: Optional[AutoOrganizeSyllabusRequest] = None,
):
    """Auto-organize course lectures, readings, assignments, and exams into weekly curriculum modules."""
    if req and req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="auto-organize the course syllabus")
    sections = db_manager.ai_auto_organize_course_syllabus(course_name.strip())
    return {
        "status": "success",
        "course_name": course_name.strip(),
        "count": len(sections),
        "sections": sections,
    }


@app.delete("/api/course/{course_name}/syllabus/sections/{section_id}")
def delete_course_syllabus_section_endpoint(
    course_name: str,
    section_id: str,
    actor_email: Optional[str] = None,
):
    """Delete a section from the Course Syllabus Spine."""
    if actor_email:
        require_tutor_role(actor_email, course_name, action_label="delete syllabus sections")
    deleted = db_manager.delete_course_section(section_id.strip())
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Section '{section_id}' not found.")
    return {"status": "success", "deleted_id": section_id.strip()}


# =========================================================================
# Next-Wave Option 4: Instructor Learning Analytics & At-Risk AI Dashboard
# =========================================================================


@app.get("/api/course/{course_name}/analytics")
def get_course_learning_analytics_endpoint(course_name: str):
    """Compute per-student engagement telemetry, completion rates, and AI early-warning risk levels."""
    data = db_manager.get_course_learning_analytics(course_name.strip())
    return {"status": "success", **data}


# =========================================================================
# Wave 3 — Option 1: 2D Grading Rubrics & AI Rubric Generator
# =========================================================================


class SaveCourseRubricRequest(BaseModel):
    rubric_id: Optional[str] = None
    assignment_id: str = ""
    title: str
    criteria: List[Dict[str, Any]]
    actor_email: Optional[str] = None


class GenerateRubricRequest(BaseModel):
    assignment_id: str = ""
    title: str = ""
    max_marks: float = 50.0
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/rubrics")
def get_course_rubrics_endpoint(
    course_name: str,
    assignment_id: Optional[str] = None,
):
    """Retrieve 2D Grading Rubrics for a course."""
    rubrics = db_manager.get_course_rubrics(course_name.strip(), assignment_id=assignment_id)
    return {"status": "success", "course_name": course_name.strip(), "rubrics": rubrics}


@app.post("/api/course/{course_name}/rubrics")
def save_course_rubric_endpoint(
    course_name: str,
    req: SaveCourseRubricRequest,
):
    """Create or update a 2D Criterion x Level Grading Rubric."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="manage grading rubrics")
    rubric = db_manager.save_course_rubric(
        course_name=course_name.strip(),
        title=req.title,
        criteria=req.criteria,
        assignment_id=req.assignment_id,
        created_by_email=req.actor_email or "",
        rubric_id=req.rubric_id,
    )
    return {"status": "success", "rubric": rubric}


@app.post("/api/course/{course_name}/rubrics/ai-generate")
def ai_generate_course_rubric_endpoint(
    course_name: str,
    req: GenerateRubricRequest,
):
    """Generate a 2D Criterion x Level Grading Rubric with AI."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="generate AI grading rubrics")
    rubric = db_manager.ai_generate_assignment_rubric(
        course_name=course_name.strip(),
        assignment_id=req.assignment_id,
        title=req.title,
        max_marks=req.max_marks,
        created_by_email=req.actor_email or "",
    )
    return {"status": "success", "rubric": rubric}


# =========================================================================
# Wave 3 — Option 2: Course Competency & Skill Mastery Matrix
# =========================================================================


class SaveCompetencyRequest(BaseModel):
    competency_id: Optional[str] = None
    code: str
    title: str
    description: str = ""
    linked_module_ids: List[str] = []
    actor_email: Optional[str] = None


@app.get("/api/course/{course_name}/competencies")
def get_course_competencies_endpoint(
    course_name: str,
    student_email: Optional[str] = None,
):
    """Retrieve Course Competencies and per-student Mastery Matrix."""
    matrix = db_manager.get_course_competency_matrix(course_name.strip(), student_email=student_email)
    return {"status": "success", **matrix}


@app.post("/api/course/{course_name}/competencies")
def save_course_competency_endpoint(
    course_name: str,
    req: SaveCompetencyRequest,
):
    """Create or update a Course Learning Outcome / Competency."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="manage course competencies")
    comp = db_manager.save_course_competency(
        course_name=course_name.strip(),
        code=req.code,
        title=req.title,
        description=req.description,
        linked_module_ids=req.linked_module_ids,
        competency_id=req.competency_id,
    )
    return {"status": "success", "competency": comp}


@app.post("/api/course/{course_name}/competencies/ai-extract")
def ai_extract_course_competencies_endpoint(
    course_name: str,
    actor_email: Optional[str] = None,
):
    """Auto-extract Course Learning Outcomes / Competencies from syllabus and lectures."""
    if actor_email:
        require_tutor_role(actor_email, course_name, action_label="extract course competencies")
    comps = db_manager.ai_extract_course_competencies(course_name.strip())
    return {"status": "success", "count": len(comps), "competencies": comps}


# =========================================================================
# Wave 3 — Option 3: Peer Review Workshop & AI Calibration Engine
# =========================================================================


class SaveWorkshopRequest(BaseModel):
    workshop_id: Optional[str] = None
    title: str
    instructions: str = ""
    phase: str = "submission"
    submission_weight: float = 80.0
    assessment_weight: float = 20.0
    actor_email: Optional[str] = None


class SubmitWorkshopArtifactRequest(BaseModel):
    student_email: str
    student_name: str = ""
    title: str
    content: str


class SubmitWorkshopReviewRequest(BaseModel):
    submission_id: str
    reviewer_email: str
    reviewer_name: str = ""
    peer_score: float
    feedback: str


@app.get("/api/course/{course_name}/workshops")
def get_course_workshops_endpoint(course_name: str):
    """List Peer Review Workshops with student submissions and AI-calibrated peer reviews."""
    workshops = db_manager.get_course_workshops(course_name.strip())
    return {"status": "success", "course_name": course_name.strip(), "workshops": workshops}


@app.post("/api/course/{course_name}/workshops")
def save_course_workshop_endpoint(
    course_name: str,
    req: SaveWorkshopRequest,
):
    """Create or update a Peer Review Workshop (or advance its phase)."""
    if req.actor_email:
        require_tutor_role(req.actor_email, course_name, action_label="manage peer review workshops")
    ws = db_manager.save_course_workshop(
        course_name=course_name.strip(),
        title=req.title,
        instructions=req.instructions,
        phase=req.phase,
        submission_weight=req.submission_weight,
        assessment_weight=req.assessment_weight,
        created_by_email=req.actor_email or "",
        workshop_id=req.workshop_id,
    )
    return {"status": "success", "workshop": ws}


@app.post("/api/course/{course_name}/workshops/{workshop_id}/submissions")
def submit_workshop_artifact_endpoint(
    course_name: str,
    workshop_id: str,
    req: SubmitWorkshopArtifactRequest,
):
    """Submit a student artifact into a Peer Review Workshop."""
    sub = db_manager.submit_workshop_artifact(
        course_name=course_name.strip(),
        workshop_id=workshop_id.strip(),
        student_email=req.student_email,
        student_name=req.student_name,
        title=req.title,
        content=req.content,
    )
    return {"status": "success", "submission": sub}


@app.post("/api/course/{course_name}/workshops/{workshop_id}/reviews")
def submit_workshop_peer_review_endpoint(
    course_name: str,
    workshop_id: str,
    req: SubmitWorkshopReviewRequest,
):
    """Submit a peer review and compute AI Calibration Quality score."""
    rev = db_manager.submit_workshop_peer_review(
        workshop_id=workshop_id.strip(),
        submission_id=req.submission_id,
        reviewer_email=req.reviewer_email,
        reviewer_name=req.reviewer_name,
        peer_score=req.peer_score,
        feedback=req.feedback,
    )
    return {"status": "success", "review": rev}


# =========================================================================
# Wave 3 — Option 4: Course Announcements Broadcast & Pedagogical Audit Log
# =========================================================================


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    priority: str = "normal"
    author_email: Optional[str] = None
    author_name: Optional[str] = None


@app.get("/api/course/{course_name}/announcements")
def get_course_announcements_endpoint(course_name: str):
    """Retrieve official Course Announcements and Pedagogical Activity Audit Logs."""
    announcements = db_manager.get_course_announcements(course_name.strip())
    audit_logs = db_manager.get_pedagogical_audit_logs(course_name.strip())
    return {
        "status": "success",
        "course_name": course_name.strip(),
        "announcements": announcements,
        "audit_logs": audit_logs,
    }


@app.post("/api/course/{course_name}/announcements")
def create_course_announcement_endpoint(
    course_name: str,
    req: CreateAnnouncementRequest,
):
    """Broadcast an official course announcement (Tutor)."""
    if req.author_email:
        require_tutor_role(req.author_email, course_name, action_label="broadcast course announcements")
    ann = db_manager.create_course_announcement(
        course_name=course_name.strip(),
        title=req.title,
        body=req.body,
        priority=req.priority,
        author_email=req.author_email or "",
        author_name=req.author_name or "",
    )
    return {"status": "success", "announcement": ann}


# -------------------------------------------------------------
# SPA Static File Serving & HTML5 History Catch-All Fallback
# -------------------------------------------------------------
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend build index not found")
