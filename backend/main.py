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
from pathlib import Path
from typing import Dict, Any, List, Optional
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
from fastapi.responses import FileResponse

from contextlib import asynccontextmanager

from backend.calendar_parser import calendar_service
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
from backend.database import db_manager, extract_course_name
from backend.google_drive_service import google_drive_service
from backend.summary_generator import generate_summary_sections
from backend.redis_service import redis_cache
from backend.gcs_storage import gcs_storage_service

# LLM Intent Router Integration
from backend.slm_router import slm_classify_intent, INTENT_SUMMARY, INTENT_CHAT


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
    if not saved or not saved.get("cues"):
        raise HTTPException(
            status_code=404,
            detail=f"Lecture '{clean_vid}' transcript not found in database. Ingest lecture first."
        )

    title = saved.get("title", f"Lecture {clean_vid}")
    cues = saved.get("cues", [])

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
            raw_course = course_name if isinstance(course_name, str) else None
            effective_course = ((raw_course and raw_course.strip()) or saved.get("course_name") or "General Lectures").strip()
            saved["course_name"] = effective_course
            # Ingest into Algolia & Pinecone (safe/idempotent, skips if already active)
            algolia_service.ingest_cues(video_id, saved["title"], saved["cues"])
            pinecone_rag_engine.ingest_transcript(video_id, saved["title"], saved["cues"])
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
        if not tracks:
            raise HTTPException(status_code=404, detail="No caption/subtitle tracks found for this video")

        track = next((t for t in tracks if t.get("default")), tracks[0])
        vtt_url = track.get("url") or track.get("src")
        if not vtt_url:
            raise HTTPException(status_code=404, detail="No caption file URL found")

        vtt_content = fetch_vtt(vtt_url)
        raw_segments = parse_vtt(vtt_content)

        cues = [
            {"time": format_timestamp(s["start"]), "text": s["text"]}
            for s in raw_segments
        ]

        summary_sections = generate_summary_sections(cues, title)
        source_url = f"https://vimeo.com/{video_id}"
        caption_label = track.get("label", "English")
        raw_course = course_name if isinstance(course_name, str) else None
        derived_course = ((raw_course and raw_course.strip()) or extract_course_name(title)).strip()

        # 3. Save to Relational DB (PostgreSQL)
        db_manager.save_video_transcript(video_id, title, duration, source_url, caption_label, cues, summary_sections, user_email=email, course_name=derived_course)

        # 4. Ingest into Algolia Search Engine
        algolia_service.ingest_cues(video_id, title, cues)

        # 5. Ingest into Pinecone Vector Store
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

        drive_url = db_manager.get_drive_folder_url(video_id, email)
        return {
            "videoId": video_id,
            "title": title,
            "duration": duration,
            "sourceUrl": source_url,
            "captionLabel": caption_label,
            "cues": cues,
            "summarySections": summary_sections,
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
    "Generate Summary for 30 mins read",
    "Generate Full Comprehensive Summary",
    "Explain key concepts and definitions"
]

# Per-video locks: prevent concurrent autopopulate runs from duplicating all 4 prompts
_autopopulate_locks: dict = {}
_locks_mutex = threading.Lock()


@app.post("/api/chat/autopopulate")
def autopopulate_chat(req: AutoPopulateRequest):
    """
    Auto-populates the chat box with resultant responses of all 4 standard quick prompts.
    If chat history already exists for this video in PostgreSQL, returns it immediately (<50ms).
    Otherwise, executes the 4 prompts concurrently and persists them sequentially in PostgreSQL.
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
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
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
    if not email or not email.strip():
        raise HTTPException(status_code=400, detail="User email is required.")
    lectures = db_manager.get_user_library(email.strip())
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
    courses = db_manager.get_user_courses(target_email)
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
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to generate course quiz via AI model: {str(e)}"
        )

    # 6. Persist to Relational Database
    db_manager.save_course_quiz(canonical_title, quiz_data, lecture_count=len(valid_lectures))

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
    """Persist user course quiz responses directly into PostgreSQL."""
    clean_course = str(course_name).strip()
    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
    email = req.user_email or "anonymous"
    db_manager.save_quiz_attempt("course", course_slug, email, req.answers, req.score or 0, req.completed or False)
    return {"status": "success", "success": True}


@app.delete("/api/course/{course_name}/quiz/answers")
def reset_course_quiz_answers(course_name: str, email: Optional[str] = Query(None)):
    """Reset user course quiz response state in PostgreSQL."""
    clean_course = str(course_name).strip()
    course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
    db_manager.delete_quiz_attempt("course", course_slug, email or "anonymous")
    return {"status": "success", "success": True}


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
    return {"status": "success" if success else "failed"}


@app.delete("/api/user/library/{video_id}")
def delete_user_lecture(video_id: str, email: str = Query(..., description="User Google email")):
    """Remove a lecture from the user's LMS library."""
    if not email.strip() or not video_id.strip():
        raise HTTPException(status_code=400, detail="email and video_id are required.")
    success = db_manager.remove_user_lecture(email, video_id)
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


@app.post("/api/calendar/test-alert")
def send_test_calendar_alert():
    """Trigger an immediate test WhatsApp alert containing today's agenda."""
    try:
        events = calendar_service.get_events(refresh=False)
        today = datetime.datetime.now(ZoneInfo("Asia/Kolkata")).date()
        today_events = [
            e for e in events 
            if datetime.datetime.fromisoformat(e["start"]).astimezone(ZoneInfo("Asia/Kolkata")).date() == today
        ]
        result = whatsapp_service.dispatch_test_alert(today_events)
        return {
            "status": "success",
            "events_included": len(today_events),
            "dispatch_result": result
        }
    except Exception as e:
        print(f"❌ [Test Alert Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Test alert failed: {str(e)}")


@app.post("/api/cron/trigger-alert")
def trigger_cron_alert(
    slot: str = Query(..., description="Target alert slot: '11am', '3pm', or '6pm'"),
    authorization: Optional[str] = Header(None, description="Bearer token matching CRON_SECRET")
):
    """
    Automated Cloud Scheduler endpoint triggered at 11:00 AM, 3:00 PM, and 6:00 PM IST.
    Secured with Bearer token authentication matching CRON_SECRET.
    """
    cron_secret = os.getenv("CRON_SECRET", "").strip()
    if cron_secret:
        expected_bearer = f"Bearer {cron_secret}"
        if not authorization or authorization.strip() != expected_bearer:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid or missing Bearer token for cron trigger.")

    clean_slot = slot.strip().lower()
    if clean_slot not in ("11am", "3pm", "6pm", "11:00", "15:00", "18:00"):
        raise HTTPException(status_code=400, detail=f"Invalid slot '{slot}'. Expected '11am', '3pm', or '6pm'.")

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
