"""
FastAPI Backend for LectureScribe
--------------------------------
Triad Architecture:
1. Relational DB (PostgreSQL) -> Source of Truth for Videos, Cues, Notes & Chat History.
2. Algolia Search -> Sub-10ms Instant Keyword & Typo-Tolerant Search for Transcript Drawer.
3. Pinecone Vector Store -> 768-dim Dense Vector Embeddings for Semantic RAG Chatbot.
"""
import os
import re
import sys
import time
import threading
import traceback
import concurrent.futures
import requests
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel

from dotenv import load_dotenv

# Ensure .env is explicitly loaded from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)

import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Query, HTTPException, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from contextlib import asynccontextmanager

from backend.calendar_parser import calendar_service, SLOT_LABELS
from backend.whatsapp_service import whatsapp_service

# Import extraction and service modules
from backend.vimeo_client import (
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
from backend.gcs_storage import gcs_storage_service
from backend.transcription_jobs import (
    async_transcription_is_enabled,
    dispatch_transcription_job,
    enqueue_transcription_task,
    transcription_job_status,
    transcription_payload_to_cues,
    verify_cloud_task_identity,
)

# LLM Intent Router Integration
from backend.slm_router import slm_classify_intent, INTENT_SUMMARY, INTENT_CHAT

# Slide & Reading Recommendation Services
from backend.slide_parser import parse_slide_document, format_slides_for_llm
from backend.reading_extractor import (
    fetch_google_books_metadata,
    search_web_reading_links,
    extract_readings_with_llm,
)

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

class AutoPopulateRequest(BaseModel):
    video_id: str
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, str]]] = None
    user_email: Optional[str] = None

class AlgoliaSearchRequest(BaseModel):
    query: str
    video_id: Optional[str] = None
    limit: Optional[int] = 20

class RegenerateSummaryRequest(BaseModel):
    video_id: str


class GenerateLectureSummaryRequest(BaseModel):
    video_id: str
    summary_type: str = "15_min"
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, Any]]] = None
    user_email: Optional[str] = None
    bypass_cache: Optional[bool] = False


class TranscriptionDispatchRequest(BaseModel):
    job_id: str


class CourseTutorChatRequest(BaseModel):
    message: str
    user_email: Optional[str] = None
    chat_history: Optional[List[Dict[str, Any]]] = None


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
    """Dedicated API endpoint for fetching a lecture workspace by Vimeo video ID."""
    return get_transcript(url=video_id, email=email, course_name=course_name)


@app.post("/api/lecture/{video_id}/transcribe")
def transcribe_lecture(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library")
):
    """Generate and persist a transcript for an imported lecture without captions."""
    if not re.fullmatch(r"\d+", video_id):
        raise HTTPException(status_code=400, detail="A valid Vimeo video ID is required.")

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

    source_url = f"https://vimeo.com/{video_id}"
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

    title = saved.get("title") or f"Vimeo Video {video_id}"
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


@app.get("/api/lecture/{video_id}/quiz")
@app.post("/api/lecture/{video_id}/quiz")
def get_or_generate_lecture_quiz(
    video_id: str,
    regenerate: bool = Query(False, description="Force regenerate without using cache"),
    num_questions: Optional[int] = Query(None, description="Number of quiz questions to generate (3-15)"),
    email: Optional[str] = Query(None, description="Signed-in user email"),
    body: Optional[QuizGenerateRequest] = None
):
    """Retrieve or generate interactive practice quiz with LaTeX math formulas."""
    clean_vid = str(video_id).strip()
    is_regenerate = regenerate or (body.regenerate if body else False)
    req_count = (body.num_questions if body and body.num_questions is not None else None) or num_questions

    # 1. Check Redis Cache
    if not is_regenerate and redis_cache:
        cached_quiz = redis_cache.get_quiz(clean_vid)
        if cached_quiz:
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

    # 2. Check Relational Database Persistence
    if not is_regenerate:
        db_quiz = db_manager.get_saved_quiz(clean_vid)
        if db_quiz and db_quiz.get("questions"):
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

    # 3. Retrieve Saved Video & Cues from DB
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
            "quiz_available": False,
            "message": "This video is imported, but no transcript or captions are available. Quiz generation requires transcript text."
        }

    if req_count is not None and req_count > 0:
        target_count = max(3, min(15, int(req_count)))
    else:
        target_count = determine_lecture_quiz_count(cues, saved.get("duration"))

    # 4. Generate with LLM (No Fallbacks)
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

    # 5. Persist to Relational Database
    db_manager.save_quiz(clean_vid, quiz_data)

    # 6. Save to Redis Cache (24 hours)
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


@app.get("/api/transcript")
def get_transcript(
    url: str = Query(..., description="Vimeo URL or Video ID"),
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library"),
    course_name: Optional[str] = Query(None, description="Optional course name to associate video with")
):
    try:
        video_id = extract_video_id(url)
        
        # 1. Check relational DB first for cached video
        saved = db_manager.get_saved_video(video_id)
        if saved:
            print(f"[DB Cache Hit] Video '{video_id}' found in database. Skipping transcript and summary re-generation.")
            saved["cached"] = True
            saved_cues = saved.get("cues") or []
            saved["transcript_available"] = bool(saved_cues)
            saved["transcript_message"] = (
                None if saved_cues else
                "This video was imported, but no transcript or captions are available."
            )
            raw_course = course_name if isinstance(course_name, str) else None
            effective_course = ((raw_course and raw_course.strip()) or saved.get("course_name") or "General Lectures").strip()
            saved["course_name"] = effective_course
            if raw_course and raw_course.strip():
                try:
                    conn = db_manager._get_connection()
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("UPDATE lecturescribe_videos SET course_name = %s WHERE video_id = %s;", (effective_course, video_id))
                            conn.commit()
                except Exception as ce:
                    print(f"⚠️ [Course Update Notice]: {ce}")
            # Only transcript-backed services can be populated when cues exist.
            if saved_cues:
                algolia_service.ingest_cues(video_id, saved["title"], saved_cues)
                pinecone_rag_engine.ingest_transcript(video_id, saved["title"], saved_cues)
            drive_url = db_manager.get_drive_folder_url(video_id, email)
            if drive_url:
                saved["drive_folder_url"] = drive_url
                saved["driveFolderUrl"] = drive_url
            if email and email.strip():
                db_manager.record_user_lecture(
                    user_email=email,
                    video_id=video_id,
                    title=saved["title"],
                    duration=saved.get("duration", "Unknown"),
                    source_url=saved.get("sourceUrl", f"https://vimeo.com/{video_id}"),
                    course_name=effective_course,
                    drive_folder_url=drive_url
                )
                if redis_cache:
                    redis_cache.invalidate_user(email.strip())
            return saved

        # 2. Extract fresh video config from Vimeo
        config = fetch_player_config(video_id)
        title = config.get("video", {}).get("title", f"Vimeo Video {video_id}")
        raw_dur = config.get("video", {}).get("duration", 6060)
        if isinstance(raw_dur, int):
            mins = raw_dur // 60
            hrs = mins // 60
            duration = f"{hrs}h {mins % 60}m" if hrs > 0 else f"{mins}m"
        else:
            duration = str(raw_dur)

        tracks = get_text_tracks(config)
        track = next((t for t in tracks if t.get("default")), tracks[0]) if tracks else None
        cues = []
        transcript_message = "This video was imported, but Vimeo has no caption or subtitle tracks available."
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
                    print(f"⚠️ [Vimeo Caption Notice] Could not retrieve captions for video '{video_id}': {exc}")
                    transcript_message = "This video was imported, but its caption track could not be downloaded."
            else:
                transcript_message = "This video was imported, but Vimeo did not provide a downloadable caption track."

        transcript_available = bool(cues)
        if transcript_available:
            transcript_message = None
        summary_sections = generate_summary_sections(cues, title) if transcript_available else []
        source_url = f"https://vimeo.com/{video_id}"
        caption_label = (track.get("label") or "Caption track") if transcript_available and track else "Unavailable"
        raw_course = course_name if isinstance(course_name, str) else None
        derived_course = ((raw_course and raw_course.strip()) or extract_course_name(title)).strip()

        # 3. Save to Relational DB (PostgreSQL)
        db_manager.save_video_transcript(video_id, title, duration, source_url, caption_label, cues, summary_sections, user_email=email, course_name=derived_course)

        # 4-5. Ingest transcript-backed search indexes only when captions exist.
        pinecone_chunks = []
        if transcript_available:
            algolia_service.ingest_cues(video_id, title, cues)
            pinecone_chunks = pinecone_rag_engine.ingest_transcript(video_id, title, cues)

        # 6. Record into user LMS library if authenticated
        if email and email.strip():
            db_manager.record_user_lecture(
                user_email=email,
                video_id=video_id,
                title=title,
                duration=duration,
                source_url=source_url,
                course_name=derived_course
            )
            if redis_cache:
                redis_cache.invalidate_user(email.strip())

        drive_url = db_manager.get_drive_folder_url(video_id, email)
        return {
            "videoId": video_id,
            "title": title,
            "duration": duration,
            "sourceUrl": source_url,
            "captionLabel": caption_label,
            "cues": cues,
            "summarySections": summary_sections,
            "transcript_available": transcript_available,
            "transcript_message": transcript_message,
            "course_name": derived_course,
            "pineconeIndexedChunks": pinecone_chunks,
            "drive_folder_url": drive_url,
            "driveFolderUrl": drive_url,
            "cached": False
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/search")
def algolia_search(req: AlgoliaSearchRequest):
    """Sub-10ms instant keyword search with typo tolerance via Algolia."""
    hits = algolia_service.search(req.query, video_id=req.video_id, limit=req.limit or 20)
    return {"hits": hits, "results": hits, "count": len(hits)}

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

    # 2. Structured LLM Intent Router: classify SUMMARY vs CHAT
    intent = slm_classify_intent(
        query=req.query,
        chat_history=req.chat_history,
        video_title=video_title,
    )
    print(f"🧭 [Intent Router /api/rag/query] Intent classified as: {intent}")

    try:
        if intent == INTENT_SUMMARY:
            print("🚀 ROUTING EXECUTION: SUMMARY INTENT — Streaming uncut chronological context straight to Cloud LLM")
            if not video_id:
                raise ValueError("SUMMARY intent requires a valid video_id to fetch the full transcript.")
            saved = db_manager.get_saved_video(video_id)
            cues = (saved.get("cues") if saved else None) or req.cues
            if not cues:
                raise ValueError(f"No transcript cues found in database or request for video {video_id}. SUMMARY requires the full transcript.")
            lecture_title = (saved.get("title") if saved else None) or video_title or "Lecture"
            full_transcript_with_timestamps = "\n".join(
                f"[{cue['time']}] {cue['text']}"
                for cue in cues
                if cue.get("text", "").strip()
            )
            result = pinecone_rag_engine.generate_full_transcript_summary(
                transcript_str=full_transcript_with_timestamps,
                lecture_title=lecture_title,
                video_id=video_id,
                user_original_request=req.query,
                user_email=req.user_email,
            )
        elif intent == INTENT_CHAT:
            print("🔍 ROUTING EXECUTION: CHAT INTENT — Directing to Hybrid Search + RRF pipeline")
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
        else:
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

    # 2. Structured LLM Intent Router: classify SUMMARY vs CHAT
    intent = slm_classify_intent(
        query=user_prompt,
        chat_history=chat_history,
        video_title=title,
    )
    print(f"🧭 [Intent Router] Intent classified as: {intent}")

    if cues is not None and len(cues) > 0 and len(pinecone_rag_engine.local_chunks) == 0:
        pinecone_rag_engine.ingest_transcript(vid, title, cues)
        algolia_service.ingest_cues(vid, title, cues)

    try:
        if intent == INTENT_SUMMARY:
            print("🚀 ROUTING EXECUTION: SUMMARY INTENT — Streaming uncut chronological context straight to Cloud LLM")
            if not vid or vid == "active":
                raise ValueError("SUMMARY intent requires a valid video_id to fetch the full transcript.")
            saved = db_manager.get_saved_video(vid)
            cues_list = (saved.get("cues") if saved else None) or cues
            if not cues_list:
                raise ValueError(f"No transcript cues found in database or request for video {vid}. SUMMARY requires the full transcript.")
            lecture_title = (saved.get("title") if saved else None) or title or "Lecture"
            full_transcript_with_timestamps = "\n".join(
                f"[{cue['time']}] {cue['text']}"
                for cue in cues_list
                if cue.get("text", "").strip()
            )
            rag_res = pinecone_rag_engine.generate_full_transcript_summary(
                transcript_str=full_transcript_with_timestamps,
                lecture_title=lecture_title,
                video_id=vid,
                user_original_request=user_prompt,
                user_email=user_email,
            )
        elif intent == INTENT_CHAT:
            print("🔍 ROUTING EXECUTION: CHAT INTENT — Directing to Hybrid Search + RRF pipeline")
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
        else:
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
    sub_res = pinecone_rag_engine.generate_submission_version(
        original_text=reply,
        video_id=vid,
        word_count=120,
        query=user_prompt
    )
    sub_text = sub_res.get("submission_text", "")
    sub_word_count = sub_res.get("word_count", 0)

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


AUTOPOPULATE_PROMPTS = [
    "Create a summary for a 15 min read",
    "Generate Full Comprehensive Summary"
]

# Per-video locks: prevent concurrent autopopulate runs from duplicating prompts
_autopopulate_locks: dict = {}
_locks_mutex = threading.Lock()


@app.post("/api/chat/autopopulate")
def autopopulate_chat(req: AutoPopulateRequest):
    """
    Auto-populates the chat box with resultant responses of the 2 standard summary prompts (15-min and full summary).
    If chat history already exists for this video in PostgreSQL, returns it immediately (<50ms).
    Otherwise, executes the prompts concurrently and persists them sequentially in PostgreSQL.
    """
    vid = str(req.video_id or "").strip()
    if not vid or vid == "active":
        raise HTTPException(status_code=400, detail="A valid video_id is required.")

    lock_key = f"{vid}:{req.user_email or 'all'}"
    with _locks_mutex:
        if lock_key not in _autopopulate_locks:
            _autopopulate_locks[lock_key] = threading.Lock()
        video_lock = _autopopulate_locks[lock_key]

    with video_lock:
        # 1. Return immediately if chat logs already exist in PostgreSQL
        existing = db_manager.get_chat_history(vid, user_email=req.user_email)
        if existing and len(existing) > 0:
            return {
                "status": "success",
                "video_id": vid,
                "count": len(existing),
                "messages": existing
            }

        # 2. Retrieve video details and cues from DB or request
        saved_vid = db_manager.get_saved_video(vid)
        title = (req.video_title or (saved_vid.get("title") if saved_vid else None) or "Lecture").strip()
        cues = req.cues or (saved_vid.get("cues") if saved_vid else None) or []
        if not cues:
            return {
                "status": "no_cues",
                "video_id": vid,
                "count": 0,
                "messages": []
            }

        # Ingest cues up front to prime local chunks & Algolia search once
        if cues and len(pinecone_rag_engine.local_chunks) == 0:
            pinecone_rag_engine.ingest_transcript(vid, title, cues)
            algolia_service.ingest_cues(vid, title, cues)

        # 3. Concurrently execute the 4 standard prompts
        def _execute_prompt(prompt_text: str):
            try:
                return process_chat_message(
                    user_prompt=prompt_text,
                    video_id=vid,
                    video_title=title,
                    cues=cues,
                    user_email=req.user_email,
                    bypass_cache=False,
                    chat_history=[],
                    save_to_db=False  # Saved sequentially below to guarantee chronological ordering
                )
            except Exception as err:
                print(f"⚠️ [Autopopulate Worker Error for '{prompt_text}']: {err}")
                return None

        results = [None] * len(AUTOPOPULATE_PROMPTS)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_to_idx = {
                executor.submit(_execute_prompt, prompt): idx 
                for idx, prompt in enumerate(AUTOPOPULATE_PROMPTS)
            }
            for future in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[future]
                results[idx] = future.result()

        # 4. Sequentially persist to PostgreSQL in exact prompt order
        for idx, prompt in enumerate(AUTOPOPULATE_PROMPTS):
            res = results[idx]
            if not res or not res.get("reply"):
                continue
            try:
                db_manager.save_chat_log(
                    video_id=vid,
                    user_prompt=prompt,
                    ai_reply=res["reply"],
                    citations=res.get("citations", []),
                    user_email=req.user_email,
                    submission_text=res.get("submission_text", ""),
                    model=res.get("model", ""),
                    web_sources=res.get("web_sources", [])
                )
                # Also persist to dedicated lecture summaries table
                stype = "15_min" if "15" in prompt else "comprehensive"
                sub_text = res.get("submission_text", "")
                wc = len([w for w in sub_text.split() if w]) if sub_text else 0
                db_manager.save_lecture_summary(
                    video_id=vid,
                    summary_type=stype,
                    markdown_text=res["reply"],
                    submission_text=sub_text,
                    citations=res.get("citations", []),
                    word_count=wc,
                    model=res.get("model", ""),
                    user_email=req.user_email
                )
                time.sleep(0.01)  # 10ms monotonic timestamp spacing
            except Exception as save_err:
                print(f"⚠️ [Autopopulate Save Error for prompt {idx}]: {save_err}")

        # 5. Fetch persisted messages from PostgreSQL
        persisted_messages = db_manager.get_chat_history(vid, user_email=req.user_email)
        return {
            "status": "success",
            "video_id": vid,
            "count": len(persisted_messages),
            "messages": persisted_messages
        }


@app.get("/api/chat/history")
def get_chat_history(
    video_id: str = Query(..., description="Vimeo Video ID"),
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
    video_id: str = Query(..., description="Vimeo Video ID"),
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
    video_id: Optional[str] = Query(None, description="Optional Vimeo Video ID"),
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
    video_id: str = Query(..., description="Vimeo video ID"),
    user_email: Optional[str] = Query(None, description="User email for personalized summaries")
):
    """
    Retrieve all saved lecture summaries (15_min, comprehensive) for a video.
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
    Generate or regenerate a dedicated lecture summary (15_min or comprehensive)
    and persist it to lecturescribe_lecture_summaries without polluting chat logs.
    """
    vid = str(req.video_id).strip()
    if not vid or vid == "active":
        raise HTTPException(status_code=400, detail="A valid video_id is required.")

    summary_type = req.summary_type.strip().lower()
    if summary_type not in ["15_min", "comprehensive"]:
        summary_type = "15_min" if "15" in summary_type else "comprehensive"

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

    # Prime RAG engine transcript chunks if needed
    if len(pinecone_rag_engine.local_chunks) == 0:
        pinecone_rag_engine.ingest_transcript(vid, title, cues)

    prompt = "Create a summary for a 15 min read" if summary_type == "15_min" else "Generate Full Comprehensive Summary"

    res = process_chat_message(
        user_prompt=prompt,
        video_id=vid,
        video_title=title,
        cues=cues,
        user_email=req.user_email,
        bypass_cache=req.bypass_cache or False,
        chat_history=[],
        save_to_db=False  # Do not pollute chat logs!
    )

    markdown_text = res.get("reply") or ""
    submission_text = res.get("submission_text") or pinecone_rag_engine._clean_for_submission(
        markdown_text,
        target_words=120 if summary_type == "15_min" else 350
    )
    word_count = len([w for w in submission_text.split() if w])
    citations = res.get("citations") or []
    model = res.get("model") or ""

    db_manager.save_lecture_summary(
        video_id=vid,
        summary_type=summary_type,
        markdown_text=markdown_text,
        submission_text=submission_text,
        citations=citations,
        word_count=word_count,
        model=model,
        user_email=req.user_email
    )

    saved_record = db_manager.get_lecture_summary(vid, summary_type, user_email=req.user_email)
    return {
        "status": "success",
        "video_id": vid,
        "summary": saved_record,
        "cached": False
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
            return {"status": "success", "email": target_email, "count": len(cached), "courses": cached, "cached": True}

    courses = db_manager.get_user_courses(target_email)
    if redis_cache:
        redis_cache.set_user_courses(target_email, courses, ttl_seconds=300)
    return {"status": "success", "email": target_email, "count": len(courses), "courses": courses}


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
    if not clean_course:
        raise HTTPException(status_code=400, detail="course_name parameter is required.")

    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
    is_regenerate = regenerate or (body.regenerate if body else False)
    req_count = (body.num_questions if body and body.num_questions is not None else None) or num_questions

    # 1. Check Redis Cache
    if not is_regenerate and redis_cache:
        cached_quiz = redis_cache.get_course_quiz(course_slug)
        if cached_quiz:
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

    # 4. Fetch transcript cues for each lecture in the course
    lectures_with_cues = []
    for lect in lectures:
        vid = lect.get("video_id") or lect.get("videoId")
        if not vid:
            continue
        saved_vid = db_manager.get_saved_video(vid)
        cues = (saved_vid.get("cues") if saved_vid else None) or []
        lectures_with_cues.append({
            "video_id": vid,
            "title": lect.get("title") or lect.get("video_title") or (saved_vid.get("title") if saved_vid else None) or f"Lecture {vid}",
            "cues": cues
        })

    valid_lectures = [l for l in lectures_with_cues if l.get("cues")]
    if not valid_lectures:
        valid_lectures = lectures_with_cues
    if not valid_lectures:
        raise HTTPException(
            status_code=400,
            detail=f"No lectures in course '{canonical_title}' have transcripts available to generate a quiz."
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
            quiz_data["user_answers"] = attempt.get("answers", {})
            quiz_data["user_score"] = attempt.get("score", 0)
            quiz_data["user_completed"] = attempt.get("completed", False)
            quiz_data["is_completed"] = attempt.get("completed", False)

    return quiz_data


@app.post("/api/course/{course_name}/quiz/answers")
def save_course_quiz_answers(course_name: str, req: QuizAnswersRequest):
    """Persist user course quiz responses directly into PostgreSQL and quiz history."""
    clean_course = str(course_name).strip()
    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
    email = req.user_email or "anonymous"
    db_manager.save_quiz_attempt("course", course_slug, email, req.answers, req.score or 0, req.completed or False)

    target_quiz_id = req.quiz_id
    if not target_quiz_id:
        hist = db_manager.get_course_quiz_history(clean_course, user_email=email)
        if hist and hist[0].get("quiz_id"):
            target_quiz_id = hist[0]["quiz_id"]

    if target_quiz_id:
        existing_item = db_manager.get_course_quiz_history_by_id(target_quiz_id)
        quiz_json = (existing_item.get("quiz_json") if existing_item else None) or db_manager.get_saved_course_quiz(clean_course) or {}
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


@app.delete("/api/course/{course_name}/quiz/answers")
def reset_course_quiz_answers(course_name: str, email: Optional[str] = Query(None)):
    """Reset user course quiz response state in PostgreSQL."""
    clean_course = str(course_name).strip()
    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
    db_manager.delete_quiz_attempt("course", course_slug, email or "anonymous")
    return {"status": "success", "success": True}


@app.post("/api/course/{course_name}/quiz/explanation")
def get_detailed_course_quiz_explanation(course_name: str, req: CourseQuizExplanationRequest):
    """Generate or retrieve detailed explanation for a course quiz question using RAG."""
    clean_course = str(course_name or "").strip()
    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
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

    success = db_manager.record_user_lecture(
        user_email=target_email,
        video_id=req.video_id,
        title=target_title,
        duration=target_duration,
        source_url=target_url,
        drive_folder_url=req.drive_folder_url,
        course_name=req.course_name
    )
    if success and redis_cache:
        redis_cache.invalidate_user(target_email)
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
    course_name: Optional[str] = "General Lectures"
    video_id: Optional[str] = None
    user_email: str

class ConfirmUploadRequest(BaseModel):
    filename: str
    blob_name: str
    file_type: str
    file_size_bytes: Optional[int] = 0
    course_name: Optional[str] = "General Lectures"
    video_id: Optional[str] = None
    title: Optional[str] = None
    user_email: str

class CreateLinkResourceRequest(BaseModel):
    title: str
    url: str
    course_name: Optional[str] = "General Lectures"
    video_id: Optional[str] = None
    user_email: str


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

    clean_course = (req.course_name or "general").strip().lower().replace(" ", "-")
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

    record = db_manager.create_resource(
        course_name=req.course_name or "General Lectures",
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

    ft = "link"
    if "drive.google.com" in url or "docs.google.com" in url:
        ft = "gdrive"

    record = db_manager.create_resource(
        course_name=req.course_name or "General Lectures",
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
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")
    items = db_manager.get_course_resources(cname)
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
# Course Library & Reading Recommendations Endpoints
# ==============================================================================

@app.get("/api/course/{course_name}/readings")
def get_course_readings(course_name: str):
    """Retrieve all extracted textbooks, ebooks, and journals for a course."""
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")
    items = db_manager.get_course_readings(cname)
    return {"status": "success", "course_name": cname, "readings": items, "count": len(items)}


@app.post("/api/course/{course_name}/extract-readings")
def extract_course_readings(course_name: str):
    """
    Manual on-demand extraction of recommended books and journals
    from lecture transcripts and uploaded slide decks (.pptx / .pdf).
    Enriches with Google Books metadata and persists to PostgreSQL.
    """
    cname = course_name.strip()
    if not cname:
        raise HTTPException(status_code=400, detail="course_name is required.")

    # 1. Gather all transcripts across lectures in this course
    transcripts_summary_parts: List[str] = []
    try:
        if db_manager.postgres_url and db_manager._schema_initialized:
            conn = db_manager._get_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT v.video_id, v.title
                    FROM lecturescribe_videos v
                    WHERE LOWER(v.course_name) = LOWER(%s)
                    ORDER BY v.created_at ASC LIMIT 15;
                """, (cname,))
                course_vids = cursor.fetchall()
            conn.close()
        else:
            course_vids = []
    except Exception:
        course_vids = []

    for cv in course_vids:
        vid = cv["video_id"]
        title = cv["title"]
        cues = db_manager.get_transcript_cues(vid)
        if cues:
            head_cues = cues[:40]
            tail_cues = cues[40:][-20:] if len(cues) > 40 else []
            combined_cues = head_cues + tail_cues
            cue_text = " ".join([f"[{c.get('start_time', '')}] {c.get('text', '')}" for c in combined_cues])
            transcripts_summary_parts.append(f"Lecture '{title}':\n{cue_text}")

    # 2. Gather uploaded slide documents for this course
    resources = db_manager.get_course_resources(cname)
    slides_text_parts: List[str] = []
    for r in resources:
        ftype = (r.get("file_type") or "").lower()
        fname = (r.get("filename") or "").lower()
        blob_name = r.get("blob_name")
        if ftype in ("ppt", "pptx", "pdf") or fname.endswith((".pptx", ".ppt", ".pdf")):
            slide_bytes = None
            if blob_name:
                slide_bytes = gcs_storage_service.get_blob_bytes(blob_name)
            if slide_bytes:
                parsed_slides = parse_slide_document(slide_bytes, filename=fname)
                if parsed_slides:
                    formatted_slides = format_slides_for_llm(parsed_slides, max_chars=12000)
                    slides_text_parts.append(f"Deck '{r.get('title', fname)}':\n{formatted_slides}")

    transcripts_summary = "\n\n".join(transcripts_summary_parts)
    slides_text = "\n\n".join(slides_text_parts)

    # 3. Call LLM extractor
    extracted_items = extract_readings_with_llm(cname, transcripts_summary, slides_text)

    saved_items: List[Dict[str, Any]] = []
    existing = db_manager.get_course_readings(cname)
    existing_titles = {re.sub(r'[^a-zA-Z0-9]', '', e.get("title", "").lower()) for e in existing}

    for item in extracted_items:
        norm_t = re.sub(r'[^a-zA-Z0-9]', '', (item.get("title") or "").lower())
        if not norm_t or norm_t in existing_titles:
            continue
        # 4. Enrich via Google Books API
        gb_meta = fetch_google_books_metadata(item.get("title", ""), item.get("author", ""))
        if gb_meta:
            if gb_meta.get("cover_url"):
                item["cover_url"] = gb_meta["cover_url"]
            if gb_meta.get("preview_url"):
                item["preview_url"] = gb_meta["preview_url"]
            if gb_meta.get("isbn"):
                item["isbn"] = gb_meta["isbn"]

        saved = db_manager.save_course_reading(cname, item)
        saved_items.append(saved)
        existing_titles.add(norm_t)

    all_readings = db_manager.get_course_readings(cname)
    return {
        "status": "success",
        "course_name": cname,
        "newly_extracted_count": len(saved_items),
        "readings": all_readings,
        "count": len(all_readings)
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


@app.get("/api/video/download-options")
def get_download_options(url: str = Query(..., description="Vimeo URL or Video ID")):
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
        raise HTTPException(status_code=400, detail="A valid video_id or Vimeo URL is required.")

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
        print(f"⚠️ [Vimeo Config Notice during bundle upload]: {e}")

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
# Moodle Calendar & Automated WhatsApp Alert Endpoints
# ==============================================================================

@app.get("/api/calendar/events")
def get_calendar_events(
    refresh: bool = Query(False, description="Bypass cache and fetch fresh feed from Moodle"),
    days: int = Query(7, description="Number of upcoming days to include")
):
    """Retrieve categorized today and upcoming events from Moodle iCal feed."""
    try:
        agenda = calendar_service.get_dashboard_agenda(days=days, refresh=refresh)
        return agenda
    except Exception as e:
        print(f"❌ [Calendar API Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch calendar agenda: {str(e)}")


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
