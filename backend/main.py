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
from pathlib import Path
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from contextlib import asynccontextmanager

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
from backend.database import db_manager
from backend.google_drive_service import google_drive_service
from backend.summary_generator import generate_summary_sections



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager: Automatically creates & verifies all indexes and databases on server start."""
    print("\n" + "=" * 60)
    print("🚀 LectureScribe Triad Server Starting Up...")
    print("=" * 60)

    # 1. Relational Database verification
    print("📦 [1/3] Verifying Relational DB (PostgreSQL)...")
    try:
        db_manager._init_postgres_schema()
        print("✅ [Database Startup] PostgreSQL database ready.")
    except Exception as e:
        print(f"⚠️ [Database Startup Warning]: {e}")

    # 2. Pinecone Index creation & connection
    print("🌲 [2/3] Verifying/Creating Pinecone Vector Index...")
    pinecone_rag_engine.setup_index()

    # 3. Algolia Search Index verification & settings
    print("🔍 [3/3] Verifying/Configuring Algolia Search Index...")
    algolia_service.setup_index()

    # 4. Optional warm-up pre-index if WARMUP_VIDEO_ID environment variable is set
    warmup_vid = os.getenv("WARMUP_VIDEO_ID")
    if warmup_vid:
        try:
            sample = db_manager.get_saved_video(warmup_vid)
            if sample:
                algolia_service.ingest_cues(warmup_vid, sample["title"], sample["cues"])
                pinecone_rag_engine.ingest_transcript(warmup_vid, sample["title"], sample["cues"])
                print(f"⚡ [Warmup] Pre-indexed warmup video '{warmup_vid}' ({len(sample['cues'])} cues).")
        except Exception as e:
            print(f"⚠️ [Warmup Notice]: {e}")

    print("=" * 60)
    print("✨ All Triad Engines & Indexes Ready!")
    print("=" * 60 + "\n")

    yield

    # --- Server Shutdown ---
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
    model_id: Optional[str] = None
    enable_web_search: Optional[bool] = True

class RAGQueryRequest(BaseModel):
    query: str
    video_id: Optional[str] = ""
    video_title: Optional[str] = None
    cues: Optional[List[Dict[str, str]]] = None
    top_k: Optional[int] = 10
    user_email: Optional[str] = None
    model_id: Optional[str] = None
    enable_web_search: Optional[bool] = True

class SubmissionRequest(BaseModel):
    original_text: str
    video_id: Optional[str] = None
    word_count: Optional[int] = 100
    user_email: Optional[str] = None
    model_id: Optional[str] = None

class AlgoliaSearchRequest(BaseModel):
    query: str
    video_id: Optional[str] = None
    limit: Optional[int] = 20

class RegenerateSummaryRequest(BaseModel):
    video_id: str



@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "lecturescribe-triad-api",
        "database": "PostgreSQL Ready",
        "algolia_index": algolia_service.index_name,
        "pinecone_index": pinecone_rag_engine.index_name,
        "pinecone_namespace": pinecone_rag_engine.namespace
    }

@app.get("/api/lecture/{video_id}")
def get_lecture_by_id(
    video_id: str,
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library")
):
    """Dedicated API endpoint for fetching a lecture workspace by Vimeo video ID."""
    return get_transcript(url=video_id, email=email)


@app.get("/api/transcript")
def get_transcript(
    url: str = Query(..., description="Vimeo URL or Video ID"),
    email: Optional[str] = Query(None, description="Signed-in user email for LMS library")
):
    try:
        video_id = extract_video_id(url)
        
        # 1. Check relational DB first for cached video
        saved = db_manager.get_saved_video(video_id)
        if saved:
            print(f"[DB Cache Hit] Video '{video_id}' found in database. Skipping transcript and summary re-generation.")
            saved["cached"] = True
            # Ingest into Algolia & Pinecone (safe/idempotent, skips if already active)
            algolia_service.ingest_cues(video_id, saved["title"], saved["cues"])
            pinecone_rag_engine.ingest_transcript(video_id, saved["title"], saved["cues"])
            if email and email.strip():
                db_manager.record_user_lecture(
                    user_email=email,
                    video_id=video_id,
                    title=saved["title"],
                    duration=saved.get("duration", "Unknown"),
                    source_url=saved.get("sourceUrl", f"https://vimeo.com/{video_id}")
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

        # 3. Save to Relational DB (PostgreSQL)
        db_manager.save_video_transcript(video_id, title, duration, source_url, caption_label, cues, summary_sections, user_email=email)

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
                source_url=source_url
            )

        return {
            "videoId": video_id,
            "title": title,
            "duration": duration,
            "sourceUrl": source_url,
            "captionLabel": caption_label,
            "cues": cues,
            "summarySections": summary_sections,
            "pineconeIndexedChunks": pinecone_chunks,
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
    return {"hits": hits, "count": len(hits)}

@app.get("/api/ai/models")
def get_ai_models():
    """Return available LLM models and their configuration status."""
    return {"models": pinecone_rag_engine.get_supported_models()}

@app.post("/api/rag/query")
def rag_query(req: RAGQueryRequest):
    """Perform grounded retrieval + multi-model answer synthesis."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query string cannot be empty")
    
    result = pinecone_rag_engine.query_rag(
        req.query,
        video_id=req.video_id,
        video_title=req.video_title,
        cues=req.cues,
        top_k=req.top_k or 10,
        model_id=req.model_id,
        enable_web_search=req.enable_web_search if req.enable_web_search is not None else True
    )
    
    # Auto-generate academic submission version (~120 words, human graduate persona)
    try:
        sub_res = pinecone_rag_engine.generate_submission_version(
            original_text=result.get("answer", ""),
            video_id=req.video_id,
            word_count=120,
            model_id=req.model_id
        )
        result["submission_text"] = sub_res.get("submission_text", "")
        result["submission_word_count"] = sub_res.get("word_count", 0)
    except Exception as e:
        print(f"[Submission Gen Notice]: {e}")
        result["submission_text"] = ""
        result["submission_word_count"] = 0

    if req.video_id:
        try:
            db_manager.save_chat_log(
                video_id=req.video_id,
                user_prompt=req.query,
                ai_reply=result.get("answer", ""),
                citations=result.get("citations", []),
                user_email=req.user_email
            )
        except Exception as e:
            print(f"[Chat Log Notice]: {e}")
    return result

@app.post("/api/chat")
def chat_with_transcript(req: ChatRequest):
    """Route chat queries through RAG engine and save to DB."""
    user_prompt = req.message.strip()
    cues = req.cues
    title = req.video_title or "Lecture"
    video_id = req.video_id or "active"

    if req.cues is not None and len(req.cues) > 0 and len(pinecone_rag_engine.local_chunks) == 0:
        pinecone_rag_engine.ingest_transcript(video_id, title, req.cues)
        algolia_service.ingest_cues(video_id, title, req.cues)

    rag_res = pinecone_rag_engine.query_rag(
        user_prompt,
        video_id=video_id,
        video_title=title,
        cues=cues,
        top_k=10,
        model_id=req.model_id,
        enable_web_search=req.enable_web_search if req.enable_web_search is not None else True
    )
    reply = rag_res.get("answer", "")
    citations = rag_res.get("citations", [])

    # Auto-generate academic submission version
    sub_text = ""
    sub_word_count = 0
    try:
        sub_res = pinecone_rag_engine.generate_submission_version(
            original_text=reply,
            video_id=video_id,
            word_count=120,
            model_id=req.model_id
        )
        sub_text = sub_res.get("submission_text", "")
        sub_word_count = sub_res.get("word_count", 0)
    except Exception as e:
        print(f"[Submission Gen Notice]: {e}")

    # Save to Chat History DB
    db_manager.save_chat_log(video_id, user_prompt, reply, citations, user_email=req.user_email)

    return {
        "reply": reply,
        "citations": citations,
        "web_sources": rag_res.get("web_sources", []),
        "model": rag_res.get("model", ""),
        "submission_text": sub_text,
        "submission_word_count": sub_word_count
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
        word_count=req.word_count or 120,
        model_id=req.model_id
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


@app.get("/api/user/library")
def get_user_library(email: str = Query(..., description="User Google email")):
    """Fetch user's saved LMS library of lectures."""
    if not email or not email.strip():
        raise HTTPException(status_code=400, detail="User email is required.")
    lectures = db_manager.get_user_library(email.strip())
    return {"status": "success", "lectures": lectures, "library": lectures, "count": len(lectures)}


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
        drive_folder_url=req.drive_folder_url
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

    # Check configuration
    if not req.access_token:
        raise HTTPException(
            status_code=400,
            detail="Please sign in with Google in the export modal to authorize uploading this lecture to your Google Drive."
        )

    # 1. Fetch or load video cues, VTT, and title
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

    # Fallback to saved DB cues if live fetch was skipped or failed
    if not cues and saved and saved.get("cues"):
        cues = saved.get("cues", [])
        if not title or title == "Lecture":
            title = saved.get("title", f"Lecture {video_id}")

    # Build summary markdown dynamically if not explicitly provided
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

    # Create background job
    job_id = google_drive_service.create_job(video_id, title)

    # Schedule background execution
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
        # Do not catch unhandled API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend build index not found")


