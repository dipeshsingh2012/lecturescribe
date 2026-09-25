"""
PostgreSQL Relational Database Manager for LectureScribe
--------------------------------------------------------
Primary relational store for videos, transcript cues, executive summaries,
user LMS libraries, and chat logs. Powered directly by Cloud PostgreSQL.
No SQLite. No fallbacks.
"""
from __future__ import annotations

import os
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

POSTGRES_URL = os.getenv("DATABASE_URL")

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


class RelationalDBManager:
    """Dedicated PostgreSQL Database Manager with In-Memory L1 Cache."""

    def __init__(self, postgres_url: Optional[str] = None):
        self._explicit_url = postgres_url
        self._memory_cache: Dict[str, Dict[str, Any]] = {}
        self._schema_initialized: bool = False

        if not HAS_PSYCOPG2:
            print("⚠️ [PostgreSQL Warning] psycopg2 is required for PostgreSQL. Please install psycopg2-binary.")
            return

        if not self.postgres_url:
            print("⚠️ [PostgreSQL Notice] DATABASE_URL environment variable is missing. Database operations will be deferred until configured.")
            return

        # Initialize PostgreSQL schema (deferred if database is unreachable during import)
        try:
            self._init_postgres_schema()
        except Exception as e:
            print(f"[PostgreSQL Notice] Initial connection deferred: {e}")

    @property
    def postgres_url(self) -> Optional[str]:
        return self._explicit_url or os.getenv("DATABASE_URL")

    def _get_connection(self):
        """Create and return a new PostgreSQL connection with RealDictCursor."""
        url = self.postgres_url
        if not url:
            raise ValueError("DATABASE_URL is not set.")
        return psycopg2.connect(url, cursor_factory=RealDictCursor)

    def _init_postgres_schema(self):
        """Initialize PostgreSQL schema for LectureScribe tables."""
        if not self.postgres_url:
            print("⚠️ [PostgreSQL Notice] DATABASE_URL not set yet. Skipping schema initialization.")
            return
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS lecturescribe_videos (
                            video_id VARCHAR(128) PRIMARY KEY,
                            title TEXT NOT NULL,
                            duration VARCHAR(64),
                            source_url TEXT,
                            caption_label VARCHAR(128),
                            user_email VARCHAR(255),
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE IF NOT EXISTS lecturescribe_transcript_cues (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            timestamp VARCHAR(32) NOT NULL,
                            seconds INT NOT NULL,
                            text TEXT NOT NULL
                        );

                        CREATE TABLE IF NOT EXISTS lecturescribe_summaries (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            sections_json JSONB NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE IF NOT EXISTS lecturescribe_chat_logs (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            user_prompt TEXT NOT NULL,
                            ai_reply TEXT NOT NULL,
                            citations_json JSONB,
                            user_email VARCHAR(255),
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE IF NOT EXISTS lecturescribe_user_library (
                            id SERIAL PRIMARY KEY,
                            user_email VARCHAR(255) NOT NULL,
                            video_id VARCHAR(128) NOT NULL,
                            title TEXT NOT NULL,
                            duration VARCHAR(64),
                            source_url TEXT,
                            drive_folder_url TEXT,
                            last_viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            UNIQUE(user_email, video_id)
                        );

                        DO $$ 
                        BEGIN 
                            BEGIN
                                ALTER TABLE lecturescribe_videos ADD COLUMN user_email VARCHAR(255);
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column user_email already exists in lecturescribe_videos.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_chat_logs ADD COLUMN user_email VARCHAR(255);
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column user_email already exists in lecturescribe_chat_logs.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_chat_logs ADD COLUMN submission_text TEXT;
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column submission_text already exists in lecturescribe_chat_logs.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_chat_logs ADD COLUMN model VARCHAR(128);
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column model already exists in lecturescribe_chat_logs.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_chat_logs ADD COLUMN web_sources_json JSONB;
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column web_sources_json already exists in lecturescribe_chat_logs.';
                            END;
                        END $$;

                        CREATE INDEX IF NOT EXISTS idx_pg_cues_vid ON lecturescribe_transcript_cues(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_sum_vid ON lecturescribe_summaries(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_chat_vid ON lecturescribe_chat_logs(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_user_lib_email ON lecturescribe_user_library(user_email);
                    """)
                    conn.commit()
            print("[PostgreSQL] Connection verified and schema initialized successfully.")
        finally:
            conn.close()

    def save_video_transcript(
        self,
        video_id: str,
        title: str,
        duration: str,
        source_url: str,
        caption_label: str,
        cues: List[Dict[str, str]],
        summary_sections: List[Dict[str, Any]],
        user_email: Optional[str] = None
    ):
        """Save video, transcript cues, and AI summaries directly to PostgreSQL."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label, user_email)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (video_id) 
                        DO UPDATE SET title = EXCLUDED.title, duration = EXCLUDED.duration, 
                                      source_url = EXCLUDED.source_url, caption_label = EXCLUDED.caption_label,
                                      user_email = COALESCE(EXCLUDED.user_email, lecturescribe_videos.user_email);
                    """, (video_id, title, duration, source_url, caption_label, clean_email))

                    cursor.execute("DELETE FROM lecturescribe_transcript_cues WHERE video_id = %s;", (video_id,))
                    cue_tuples = [
                        (video_id, c.get("time", "00:00"), self._ts_to_secs(c.get("time", "00:00")), c.get("text", ""))
                        for c in cues
                    ]
                    if cue_tuples:
                        execute_values(
                            cursor,
                            """
                            INSERT INTO lecturescribe_transcript_cues (video_id, timestamp, seconds, text)
                            VALUES %s
                            """,
                            cue_tuples
                        )

                    cursor.execute("DELETE FROM lecturescribe_summaries WHERE video_id = %s;", (video_id,))
                    cursor.execute("""
                        INSERT INTO lecturescribe_summaries (video_id, sections_json)
                        VALUES (%s, %s::jsonb);
                    """, (video_id, json.dumps(summary_sections)))
                    conn.commit()
            print(f"[PostgreSQL] Saved video '{video_id}' with {len(cues)} cues and summary.")
        finally:
            conn.close()

        # If user_email is present, auto-record into their library
        if clean_email:
            self.record_user_lecture(
                user_email=clean_email,
                video_id=video_id,
                title=title,
                duration=duration,
                source_url=source_url
            )

        # Update In-Memory L1 Cache
        self._memory_cache[video_id] = {
            "videoId": video_id,
            "title": title,
            "duration": duration,
            "sourceUrl": source_url,
            "captionLabel": caption_label,
            "cues": cues,
            "summarySections": summary_sections,
            "cached": True
        }

    def update_summary_sections(self, video_id: str, summary_sections: List[Dict[str, Any]]):
        """Update or replace summary sections in PostgreSQL and memory cache."""
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("DELETE FROM lecturescribe_summaries WHERE video_id = %s;", (video_id,))
                    cursor.execute("""
                        INSERT INTO lecturescribe_summaries (video_id, sections_json)
                        VALUES (%s, %s::jsonb);
                    """, (video_id, json.dumps(summary_sections)))
                    conn.commit()
            print(f"[PostgreSQL] Updated summary for video '{video_id}'.")
        finally:
            conn.close()

        if video_id in self._memory_cache:
            self._memory_cache[video_id]["summarySections"] = summary_sections

    def get_saved_video(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Fetch video transcript from In-Memory Cache or PostgreSQL.
        Returns None if not found."""
        if video_id in self._memory_cache:
            return self._memory_cache[video_id]

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT * FROM lecturescribe_videos WHERE video_id = %s;", (video_id,))
                    v_row = cursor.fetchone()
                    if not v_row:
                        return None

                    cursor.execute("""
                        SELECT timestamp as time, text 
                        FROM lecturescribe_transcript_cues 
                        WHERE video_id = %s 
                        ORDER BY id ASC;
                    """, (video_id,))
                    cues = cursor.fetchall() or []

                    cursor.execute("""
                        SELECT sections_json 
                        FROM lecturescribe_summaries 
                        WHERE video_id = %s 
                        ORDER BY id DESC LIMIT 1;
                    """, (video_id,))
                    s_row = cursor.fetchone()
                    summary_sections = []
                    if s_row and s_row.get("sections_json"):
                        raw = s_row["sections_json"]
                        summary_sections = raw if isinstance(raw, list) else json.loads(raw)

                    # Auto-upgrade legacy summaries
                    s_str = json.dumps(summary_sections)
                    if (
                        not summary_sections
                        or "Session Introduction & Core Scope" in s_str
                        or "Course Structure & Evaluation Framework" in s_str
                        or ": Seen [" in s_str
                        or ": Question [" in s_str
                    ):
                        from backend.summary_generator import generate_summary_sections
                        summary_sections = generate_summary_sections([dict(c) for c in cues], v_row["title"])
                        self.update_summary_sections(video_id, summary_sections)

                    record = {
                        "videoId": v_row["video_id"],
                        "title": v_row["title"],
                        "duration": v_row["duration"],
                        "sourceUrl": v_row["source_url"],
                        "captionLabel": v_row["caption_label"],
                        "cues": [dict(c) for c in cues],
                        "summarySections": summary_sections,
                        "cached": True
                    }
                    self._memory_cache[video_id] = record
                    return record
        finally:
            conn.close()

    def save_chat_log(
        self,
        video_id: str,
        user_prompt: str,
        ai_reply: str,
        citations: List[Dict[str, Any]],
        user_email: Optional[str] = None,
        submission_text: Optional[str] = None,
        model: Optional[str] = None,
        web_sources: Optional[List[Dict[str, Any]]] = None
    ):
        """Save chat interaction directly to PostgreSQL."""
        if not video_id or not user_prompt:
            return

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_chat_logs (
                            video_id, user_prompt, ai_reply, citations_json, user_email,
                            submission_text, model, web_sources_json
                        )
                        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb);
                    """, (
                        video_id,
                        user_prompt,
                        ai_reply,
                        json.dumps(citations or []),
                        clean_email,
                        submission_text or "",
                        model or "",
                        json.dumps(web_sources or [])
                    ))
                    conn.commit()
        finally:
            conn.close()

    def get_chat_history(
        self,
        video_id: str,
        user_email: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Fetch chronological chat history for a lecture from PostgreSQL.
        Returns a list of messages formatted for UI rendering.
        """
        if not video_id:
            return []

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    query = """
                        SELECT id, video_id, user_prompt, ai_reply, citations_json, user_email,
                               submission_text, model, web_sources_json, created_at
                        FROM lecturescribe_chat_logs
                        WHERE video_id = %s
                    """
                    params = [video_id]
                    if clean_email:
                        query += " AND (user_email = %s OR user_email IS NULL)"
                        params.append(clean_email)
                    query += " ORDER BY created_at ASC LIMIT %s;"
                    params.append(limit)

                    cursor.execute(query, tuple(params))
                    rows = cursor.fetchall()
                    history = []
                    for r in rows:
                        c_id = str(r["id"])
                        ts_str = r["created_at"].isoformat() if r.get("created_at") else ""
                        # 1. User turn
                        history.append({
                            "id": f"msg_user_{c_id}",
                            "sender": "user",
                            "text": r["user_prompt"],
                            "created_at": ts_str
                        })
                        # 2. Bot turn
                        citations = r["citations_json"] if isinstance(r.get("citations_json"), list) else []
                        web_sources = r["web_sources_json"] if isinstance(r.get("web_sources_json"), list) else []
                        history.append({
                            "id": f"msg_bot_{c_id}",
                            "sender": "bot",
                            "text": r["ai_reply"],
                            "submission_text": r.get("submission_text") or "",
                            "citations": citations,
                            "web_sources": web_sources,
                            "model": r.get("model") or "",
                            "created_at": ts_str
                        })
                    return history
        finally:
            conn.close()

    def clear_chat_history(
        self,
        video_id: str,
        user_email: Optional[str] = None
    ) -> bool:
        """Clear conversation history for a video/user session."""
        if not video_id:
            return False

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            DELETE FROM lecturescribe_chat_logs
                            WHERE video_id = %s AND (user_email = %s OR user_email IS NULL);
                        """, (video_id, clean_email))
                    else:
                        cursor.execute("""
                            DELETE FROM lecturescribe_chat_logs
                            WHERE video_id = %s;
                        """, (video_id,))
                    conn.commit()
            return True
        finally:
            conn.close()

    def record_user_lecture(
        self,
        user_email: str,
        video_id: str,
        title: str,
        duration: str = "",
        source_url: str = "",
        drive_folder_url: Optional[str] = None
    ) -> bool:
        """Upsert a lecture into the user's LMS library in PostgreSQL."""
        if not user_email or not video_id:
            return False

        clean_email = user_email.strip().lower()
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, drive_folder_url, last_viewed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT(user_email, video_id) DO UPDATE SET
                            title = EXCLUDED.title,
                            duration = COALESCE(NULLIF(EXCLUDED.duration, ''), lecturescribe_user_library.duration),
                            source_url = COALESCE(NULLIF(EXCLUDED.source_url, ''), lecturescribe_user_library.source_url),
                            drive_folder_url = COALESCE(EXCLUDED.drive_folder_url, lecturescribe_user_library.drive_folder_url),
                            last_viewed_at = NOW();
                    """, (clean_email, video_id, title, duration, source_url, drive_folder_url))
                    conn.commit()
            return True
        finally:
            conn.close()

    def auto_map_videos_to_user(self, user_email: str):
        """Maps all unassigned or existing database videos to the currently logged in user."""
        if not user_email:
            return
        clean_email = user_email.strip().lower()

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE lecturescribe_videos
                        SET user_email = %s
                        WHERE user_email IS NULL OR user_email = '';
                    """, (clean_email,))
                    cursor.execute("""
                        INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, last_viewed_at)
                        SELECT %s, video_id, title, duration, source_url, created_at
                        FROM lecturescribe_videos
                        ON CONFLICT (user_email, video_id) DO NOTHING;
                    """, (clean_email,))
                    conn.commit()
        finally:
            conn.close()

    def get_user_library(self, user_email: str) -> List[Dict[str, Any]]:
        """Retrieve all lectures saved in the user's LMS library from PostgreSQL."""
        if not user_email:
            return []

        clean_email = user_email.strip().lower()
        self.auto_map_videos_to_user(clean_email)

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at
                        FROM lecturescribe_user_library
                        WHERE user_email = %s
                        ORDER BY last_viewed_at DESC;
                    """, (clean_email,))
                    rows = cursor.fetchall() or []
                    return [
                        {
                            "videoId": r["video_id"],
                            "video_id": r["video_id"],
                            "title": r["title"],
                            "video_title": r["title"],
                            "duration": r["duration"] or "Unknown",
                            "sourceUrl": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "video_url": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "driveFolderUrl": r["drive_folder_url"],
                            "drive_folder_url": r["drive_folder_url"],
                            "lastViewedAt": str(r["last_viewed_at"]) if r["last_viewed_at"] else None,
                            "last_viewed_at": str(r["last_viewed_at"]) if r["last_viewed_at"] else None,
                            "created_at": str(r["last_viewed_at"]) if r["last_viewed_at"] else None,
                        }
                        for r in rows
                    ]
        finally:
            conn.close()

    def get_recent_lectures(self, limit: int = 12) -> List[Dict[str, Any]]:
        """Retrieve recent or sample lectures available across PostgreSQL for library overview and guest explore."""
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT v.video_id, v.title, v.duration, v.source_url, v.created_at,
                               MAX(u.drive_folder_url) as drive_folder_url
                        FROM lecturescribe_videos v
                        LEFT JOIN lecturescribe_user_library u ON v.video_id = u.video_id
                        GROUP BY v.video_id, v.title, v.duration, v.source_url, v.created_at
                        ORDER BY v.created_at DESC
                        LIMIT %s;
                    """, (limit,))
                    rows = cursor.fetchall() or []
                    return [
                        {
                            "videoId": r["video_id"],
                            "video_id": r["video_id"],
                            "title": r["title"],
                            "video_title": r["title"],
                            "duration": r["duration"] or "Unknown",
                            "sourceUrl": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "video_url": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "driveFolderUrl": r["drive_folder_url"],
                            "drive_folder_url": r["drive_folder_url"],
                            "lastViewedAt": str(r["created_at"]) if r["created_at"] else None,
                            "last_viewed_at": str(r["created_at"]) if r["created_at"] else None,
                            "created_at": str(r["created_at"]) if r["created_at"] else None,
                        }
                        for r in rows
                    ]
        finally:
            conn.close()

    def remove_user_lecture(self, user_email: str, video_id: str) -> bool:
        """Remove a lecture from the user's LMS library in PostgreSQL."""
        if not user_email or not video_id:
            return False

        clean_email = user_email.strip().lower()
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        DELETE FROM lecturescribe_user_library
                        WHERE user_email = %s AND video_id = %s;
                    """, (clean_email, video_id))
                    conn.commit()
            return True
        finally:
            conn.close()

    def _ts_to_secs(self, ts: str) -> int:
        """Convert MM:SS or HH:MM:SS to total seconds."""
        parts = ts.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2].split(".")[0])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1].split(".")[0])
        return 0


# Export singleton instance
db_manager = RelationalDBManager()
