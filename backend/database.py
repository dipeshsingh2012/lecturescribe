"""
PostgreSQL Relational Database Manager for LectureScribe
--------------------------------------------------------
Primary relational store for videos, transcript cues, executive summaries,
user LMS libraries, and chat logs. Powered directly by Cloud PostgreSQL.
No SQLite. No fallbacks.
"""
from __future__ import annotations

import os
import re
import json
import uuid
import datetime
import time
from pathlib import Path
from typing import List, Dict, Any, Optional, Mapping
from collections import OrderedDict

def extract_course_name(title: str) -> str:
    """Extract canonical course name from lecture title."""
    if not title:
        return "General Lectures"
    t = title.strip()
    # Remove dates in parentheses/brackets e.g. (18 / 9 / 2026), (18-09-2026), [25/09/2026]
    t = re.sub(r'[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]', '', t)
    # Match session, lecture, module, class, week dividers
    pattern = r'(?i)\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$'
    match = re.search(pattern, t)
    if match:
        course_part = t[:match.start()].strip()
    else:
        course_part = re.sub(r'[\s\-:]+\d+\s*$', '', t).strip()
    course_part = re.sub(r'[\s\-_:\|\/]+$', '', course_part).strip()
    if len(course_part) >= 3:
        return course_part
    return title.strip()

def to_course_slug(course_name: str) -> str:
    """Normalize a course name into a URL-safe, lowercase hyphenated slug."""
    clean = (course_name or "").strip()
    return re.sub(r'[^a-z0-9]+', '-', clean.lower()).strip('-') or "general"

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
        self._resources_memory_cache: List[Dict[str, Any]] = []
        self._quiz_memory_cache: Dict[str, Dict[str, Any]] = {}
        self._course_quiz_memory_cache: Dict[str, Dict[str, Any]] = {}
        self._quiz_attempts_memory_cache: Dict[str, Dict[str, Any]] = {}
        self._quiz_explanations_memory_cache: Dict[str, Dict[int, str]] = {}
        self._course_quiz_history_memory: List[Dict[str, Any]] = []
        self._course_quiz_explanations_memory: Dict[str, Dict[str, str]] = {}
        self._readings_memory_cache: List[Dict[str, Any]] = []
        self._progress_memory_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self._annotations_memory_cache: List[Dict[str, Any]] = []
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
        if self._explicit_url is not None:
            return self._explicit_url
        return os.getenv("DATABASE_URL")

    def _get_connection(self):
        """Create and return a new PostgreSQL connection with RealDictCursor."""
        url = self.postgres_url
        if not url:
            raise ValueError("DATABASE_URL is not set.")
        return psycopg2.connect(url, cursor_factory=RealDictCursor, connect_timeout=5)

    def _init_postgres_schema(self, _first_init: bool = True):
        """Initialize PostgreSQL schema for LectureScribe tables.

        Idempotent: when ``_first_init`` is False (e.g. re-invoked from the
        FastAPI lifespan block), the heavy connection + CREATE TABLE work and
        the verbose "[PostgreSQL] Connection verified…" print are skipped IF
        ``self._schema_initialized`` is already True. The lifespan block is
        expected to print its own short one-line confirmation banner.
        """
        if not _first_init and self._schema_initialized:
            # Already verified and initialized at module-import time.
            # No-op here so we don't duplicate the "[PostgreSQL] Connection verified…" banner.
            return
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

                        CREATE TABLE IF NOT EXISTS lecturescribe_transcription_jobs (
                            job_id UUID PRIMARY KEY,
                            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            requested_by VARCHAR(255),
                            status VARCHAR(32) NOT NULL,
                            stage VARCHAR(32) NOT NULL,
                            error_message TEXT,
                            task_name TEXT,
                            run_execution_name TEXT,
                            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                            started_at TIMESTAMP WITH TIME ZONE,
                            completed_at TIMESTAMP WITH TIME ZONE,
                            CONSTRAINT chk_transcription_job_status
                                CHECK (status IN ('queued', 'starting', 'processing', 'completed', 'failed'))
                        );

                        CREATE UNIQUE INDEX IF NOT EXISTS uq_transcription_active_job_video
                            ON lecturescribe_transcription_jobs (video_id)
                            WHERE status IN ('queued', 'starting', 'processing');
                        CREATE INDEX IF NOT EXISTS idx_transcription_jobs_video_created
                            ON lecturescribe_transcription_jobs (video_id, created_at DESC);

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
                            BEGIN
                                ALTER TABLE lecturescribe_user_library ADD COLUMN course_name VARCHAR(255);
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column course_name already exists in lecturescribe_user_library.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_videos ADD COLUMN course_name VARCHAR(255);
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column course_name already exists in lecturescribe_videos.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_summaries ADD COLUMN is_outdated BOOLEAN NOT NULL DEFAULT FALSE;
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column is_outdated already exists in lecturescribe_summaries.';
                            END;
                            BEGIN
                                ALTER TABLE lecturescribe_lecture_summaries ADD COLUMN is_outdated BOOLEAN NOT NULL DEFAULT FALSE;
                            EXCEPTION
                                WHEN duplicate_column THEN RAISE NOTICE 'column is_outdated already exists in lecturescribe_lecture_summaries.';
                            END;
                        END $$;

                        CREATE INDEX IF NOT EXISTS idx_pg_cues_vid ON lecturescribe_transcript_cues(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_sum_vid ON lecturescribe_summaries(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_chat_vid ON lecturescribe_chat_logs(video_id);
                        CREATE INDEX IF NOT EXISTS idx_pg_user_lib_email ON lecturescribe_user_library(user_email);
                        CREATE INDEX IF NOT EXISTS idx_pg_user_lib_course ON lecturescribe_user_library(user_email, course_name);

                        CREATE TABLE IF NOT EXISTS lecturescribe_resources (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(64),
                            course_name VARCHAR(255) NOT NULL,
                            user_email VARCHAR(255) NOT NULL,
                            title VARCHAR(255) NOT NULL,
                            filename VARCHAR(255) NOT NULL,
                            blob_name VARCHAR(512),
                            file_type VARCHAR(32) NOT NULL,
                            file_size_bytes BIGINT DEFAULT 0,
                            file_url TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );

                        CREATE INDEX IF NOT EXISTS idx_res_vid ON lecturescribe_resources(video_id);
                        CREATE INDEX IF NOT EXISTS idx_res_course ON lecturescribe_resources(course_name);
                        CREATE INDEX IF NOT EXISTS idx_res_email ON lecturescribe_resources(user_email);

                        CREATE TABLE IF NOT EXISTS lecturescribe_quizzes (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            quiz_json JSONB NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_lecturescribe_quizzes_video_id UNIQUE (video_id)
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_quiz_vid ON lecturescribe_quizzes(video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_course_quizzes (
                            id SERIAL PRIMARY KEY,
                            course_slug VARCHAR(255) NOT NULL,
                            course_name VARCHAR(255) NOT NULL,
                            quiz_json JSONB NOT NULL,
                            lecture_count INT DEFAULT 0,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_course_quizzes_course_slug UNIQUE (course_slug)
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_course_quiz_slug ON lecturescribe_course_quizzes(course_slug);

                        CREATE TABLE IF NOT EXISTS lecturescribe_quiz_attempts (
                            id SERIAL PRIMARY KEY,
                            quiz_type VARCHAR(32) NOT NULL,
                            target_id VARCHAR(255) NOT NULL,
                            user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous',
                            answers JSONB NOT NULL DEFAULT '{}'::jsonb,
                            score INT DEFAULT 0,
                            completed BOOLEAN DEFAULT FALSE,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_quiz_attempt UNIQUE (quiz_type, target_id, user_email)
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_quiz_attempt ON lecturescribe_quiz_attempts(quiz_type, target_id, user_email);

                        CREATE TABLE IF NOT EXISTS lecturescribe_quiz_explanations (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            question_id INTEGER NOT NULL,
                            detailed_explanation TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_quiz_explanation UNIQUE (video_id, question_id)
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_quiz_explanation_vid ON lecturescribe_quiz_explanations(video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_course_quiz_history (
                            id SERIAL PRIMARY KEY,
                            quiz_id VARCHAR(64) UNIQUE NOT NULL,
                            course_slug VARCHAR(255) NOT NULL,
                            course_name VARCHAR(255) NOT NULL,
                            user_email VARCHAR(255) NOT NULL DEFAULT '',
                            quiz_json JSONB NOT NULL,
                            answers JSONB NOT NULL DEFAULT '{}'::jsonb,
                            score INT DEFAULT 0,
                            total_questions INT DEFAULT 0,
                            completed BOOLEAN DEFAULT FALSE,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_course_quiz_hist_slug ON lecturescribe_course_quiz_history(course_slug);
                        CREATE INDEX IF NOT EXISTS idx_pg_course_quiz_hist_email ON lecturescribe_course_quiz_history(user_email);
                        CREATE INDEX IF NOT EXISTS idx_pg_course_quiz_hist_quiz_id ON lecturescribe_course_quiz_history(quiz_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_course_quiz_explanations (
                            id SERIAL PRIMARY KEY,
                            course_slug VARCHAR(255) NOT NULL,
                            question_id VARCHAR(64) NOT NULL,
                            detailed_explanation TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT uq_course_quiz_explanation UNIQUE (course_slug, question_id)
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_course_quiz_exp ON lecturescribe_course_quiz_explanations(course_slug, question_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_course_readings (
                            id SERIAL PRIMARY KEY,
                            course_name VARCHAR(255) NOT NULL,
                            title VARCHAR(255) NOT NULL,
                            author VARCHAR(255),
                            edition VARCHAR(100),
                            reading_type VARCHAR(32) DEFAULT 'book',
                            category VARCHAR(64) DEFAULT 'recommended',
                            cover_url TEXT,
                            preview_url TEXT,
                            isbn VARCHAR(32),
                            source_type VARCHAR(32),
                            source_context TEXT,
                            web_links JSONB DEFAULT '[]'::jsonb,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_readings_course ON lecturescribe_course_readings(course_name);
                        ALTER TABLE lecturescribe_course_readings ADD COLUMN IF NOT EXISTS embed_url TEXT;
                        ALTER TABLE lecturescribe_course_readings ADD COLUMN IF NOT EXISTS reader_type VARCHAR(64) DEFAULT 'embed';
                        ALTER TABLE lecturescribe_course_readings ADD COLUMN IF NOT EXISTS is_lending BOOLEAN DEFAULT FALSE;

                        CREATE TABLE IF NOT EXISTS lecturescribe_course_chat_logs (
                            id SERIAL PRIMARY KEY,
                            course_slug VARCHAR(255) NOT NULL,
                            course_name VARCHAR(255) NOT NULL,
                            user_prompt TEXT NOT NULL,
                            ai_reply TEXT NOT NULL,
                            citations_json JSONB,
                            user_email VARCHAR(255),
                            model VARCHAR(128),
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE INDEX IF NOT EXISTS idx_pg_course_chat_slug ON lecturescribe_course_chat_logs(course_slug);
                        CREATE INDEX IF NOT EXISTS idx_pg_course_chat_user ON lecturescribe_course_chat_logs(user_email);

                        CREATE TABLE IF NOT EXISTS lecturescribe_lecture_summaries (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            user_email VARCHAR(255),
                            summary_type VARCHAR(64) NOT NULL,
                            markdown_text TEXT NOT NULL,
                            submission_text TEXT DEFAULT '',
                            citations_json JSONB DEFAULT '[]'::jsonb,
                            word_count INT DEFAULT 0,
                            model VARCHAR(128) DEFAULT '',
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );

                        CREATE UNIQUE INDEX IF NOT EXISTS uq_lecture_summaries_key 
                            ON lecturescribe_lecture_summaries (video_id, COALESCE(user_email, ''), summary_type);
                        CREATE INDEX IF NOT EXISTS idx_lecture_summaries_vid 
                            ON lecturescribe_lecture_summaries (video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_lecture_progress (
                            id SERIAL PRIMARY KEY,
                            video_id VARCHAR(128) NOT NULL,
                            user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous',
                            last_timestamp VARCHAR(32) NOT NULL DEFAULT '00:00',
                            last_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                            duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                            progress_percent DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                            active_cue_idx INTEGER NOT NULL DEFAULT 0,
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            CONSTRAINT uq_lecture_progress_user_video UNIQUE (user_email, video_id)
                        );

                        CREATE INDEX IF NOT EXISTS idx_lecture_progress_user_email 
                            ON lecturescribe_lecture_progress (user_email);
                        CREATE INDEX IF NOT EXISTS idx_lecture_progress_video_id 
                            ON lecturescribe_lecture_progress (video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_fleet_runs (
                            request_id VARCHAR(128) PRIMARY KEY,
                            tenant_id VARCHAR(128) NOT NULL,
                            initiative_id VARCHAR(128) NOT NULL,
                            event_type VARCHAR(64) NOT NULL,
                            title VARCHAR(500) NOT NULL,
                            client_payload JSONB NOT NULL,
                            status VARCHAR(32) NOT NULL,
                            github_run_id VARCHAR(32),
                            github_run_attempt VARCHAR(16),
                            run_url TEXT,
                            conclusion VARCHAR(100),
                            error_summary TEXT,
                            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_lecturescribe_fleet_runs_initiative
                            ON lecturescribe_fleet_runs (tenant_id, initiative_id, created_at DESC);

                        CREATE TABLE IF NOT EXISTS lecturescribe_transcript_reviews (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            review_mode VARCHAR(32) NOT NULL DEFAULT 'audio_grounded',
                            status VARCHAR(32) NOT NULL DEFAULT 'queued',
                            error_message TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_transcription_reviews_vid ON lecturescribe_transcript_reviews(video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_transcript_suggestions (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            review_id UUID NOT NULL REFERENCES lecturescribe_transcript_reviews(id) ON DELETE CASCADE,
                            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            cue_id INT REFERENCES lecturescribe_transcript_cues(id) ON DELETE SET NULL,
                            start_seconds NUMERIC(10, 2) NOT NULL,
                            end_seconds NUMERIC(10, 2) NOT NULL,
                            original_text TEXT NOT NULL,
                            suggested_text TEXT NOT NULL,
                            suggestion_type VARCHAR(32) NOT NULL DEFAULT 'correction',
                            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
                            reason TEXT,
                            status VARCHAR(32) NOT NULL DEFAULT 'pending',
                            applied_at TIMESTAMP WITH TIME ZONE,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_transcription_sugg_rev ON lecturescribe_transcript_suggestions(review_id);
                        CREATE INDEX IF NOT EXISTS idx_transcription_sugg_vid ON lecturescribe_transcript_suggestions(video_id);

                        CREATE TABLE IF NOT EXISTS lecturescribe_transcript_annotations (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
                            user_email VARCHAR(255) NOT NULL,
                            cue_id INT REFERENCES lecturescribe_transcript_cues(id) ON DELETE SET NULL,
                            start_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
                            end_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
                            selected_text TEXT NOT NULL,
                            annotation_type VARCHAR(32) NOT NULL,
                            color VARCHAR(16),
                            note_text TEXT,
                            ai_prompt TEXT,
                            ai_response TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_annotations_user_vid ON lecturescribe_transcript_annotations(user_email, video_id);
                    """)
                    conn.commit()
            self._schema_initialized = True
            print("[PostgreSQL] Connection verified and schema initialized successfully.")
            try:
                self.backfill_missing_course_names()
            except Exception as b_err:
                print(f"[PostgreSQL Notice] Initial backfill deferred ({b_err}).")
        finally:
            conn.close()

    @staticmethod
    def _serialize_fleet_run(row: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(row, Mapping):
            return None
        result = dict(row)
        for key in ("created_at", "updated_at"):
            value = result.get(key)
            if value is not None and hasattr(value, "isoformat"):
                result[key] = value.isoformat()
        result.pop("client_payload", None)
        return result

    def create_fleet_run(
        self,
        request_id: str,
        tenant_id: str,
        initiative_id: str,
        event_type: str,
        title: str,
        client_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create a durable dispatch record, returning an existing idempotent request if present."""
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO lecturescribe_fleet_runs
                            (request_id, tenant_id, initiative_id, event_type, title, client_payload, status)
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb, 'dispatching')
                        ON CONFLICT (request_id) DO NOTHING
                        RETURNING request_id;
                        """,
                        (request_id, tenant_id, initiative_id, event_type, title, json.dumps(client_payload)),
                    )
                    created = cursor.fetchone() is not None
                    cursor.execute(
                        "SELECT * FROM lecturescribe_fleet_runs WHERE request_id = %s;",
                        (request_id,),
                    )
                    row = self._serialize_fleet_run(cursor.fetchone())
            return {"created": created, "run": row}
        finally:
            conn.close()

    def get_fleet_run(self, request_id: str) -> Optional[Dict[str, Any]]:
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM lecturescribe_fleet_runs WHERE request_id = %s;",
                        (request_id,),
                    )
                    return self._serialize_fleet_run(cursor.fetchone())
        finally:
            conn.close()

    def update_fleet_run(
        self,
        request_id: str,
        status: str,
        github_run_id: Optional[str] = None,
        github_run_attempt: Optional[str] = None,
        run_url: Optional[str] = None,
        conclusion: Optional[str] = None,
        error_summary: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Apply an idempotent status update while preventing backward/invalid transitions."""
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        ranks = {
            "dispatching": 0,
            "dispatch_unknown": 1,
            "queued": 1,
            "running": 2,
            "succeeded": 3,
            "failed": 3,
            "cancelled": 3,
        }
        if status not in ranks:
            raise ValueError("Unsupported fleet run status.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM lecturescribe_fleet_runs WHERE request_id = %s FOR UPDATE;",
                        (request_id,),
                    )
                    current_row = cursor.fetchone()
                    if not isinstance(current_row, Mapping):
                        return None
                    current = current_row["status"]
                    terminal = {"succeeded", "failed", "cancelled"}
                    if current in terminal and status != current and ranks[status] < ranks[current]:
                        return self._serialize_fleet_run(current_row)
                    if current in terminal and status != current:
                        raise ValueError(f"Cannot change terminal fleet status '{current}' to '{status}'.")
                    if current not in terminal and ranks[status] < ranks[current]:
                        return self._serialize_fleet_run(current_row)
                    cursor.execute(
                        """
                        UPDATE lecturescribe_fleet_runs
                        SET status = %s,
                            github_run_id = COALESCE(%s, github_run_id),
                            github_run_attempt = COALESCE(%s, github_run_attempt),
                            run_url = COALESCE(%s, run_url),
                            conclusion = COALESCE(%s, conclusion),
                            error_summary = COALESCE(%s, error_summary),
                            updated_at = NOW()
                        WHERE request_id = %s
                        RETURNING *;
                        """,
                        (
                            status,
                            github_run_id,
                            github_run_attempt,
                            run_url,
                            conclusion,
                            error_summary,
                            request_id,
                        ),
                    )
                    return self._serialize_fleet_run(cursor.fetchone())
        finally:
            conn.close()

    @staticmethod
    def _serialize_transcription_job(row: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(row, Mapping):
            return None
        result = dict(row)
        for key in ("created_at", "updated_at", "started_at", "completed_at"):
            value = result.get(key)
            if value is not None and hasattr(value, "isoformat"):
                result[key] = value.isoformat()
        return result

    def create_transcription_job(
        self,
        job_id: str,
        video_id: str,
        requested_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a durable job or return the currently active job for this lecture."""
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        clean_email = requested_by.strip().lower() if requested_by and requested_by.strip() else None
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO lecturescribe_transcription_jobs
                            (job_id, video_id, requested_by, status, stage)
                        VALUES (%s, %s, %s, 'queued', 'queued')
                        ON CONFLICT (video_id)
                            WHERE status IN ('queued', 'starting', 'processing')
                        DO NOTHING
                        RETURNING *;
                        """,
                        (job_id, video_id, clean_email),
                    )
                    row = cursor.fetchone()
                    created = row is not None
                    if not created:
                        cursor.execute(
                            """
                            SELECT * FROM lecturescribe_transcription_jobs
                            WHERE video_id = %s
                              AND status IN ('queued', 'starting', 'processing')
                            ORDER BY created_at DESC
                            LIMIT 1;
                            """,
                            (video_id,),
                        )
                        row = cursor.fetchone()
                    serialized = self._serialize_transcription_job(row)
                    if serialized is None:
                        raise RuntimeError("Unable to create or retrieve the transcription job.")
                    serialized["created"] = created
                    return serialized
        finally:
            conn.close()

    def get_transcription_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM lecturescribe_transcription_jobs WHERE job_id = %s;",
                        (job_id,),
                    )
                    return self._serialize_transcription_job(cursor.fetchone())
        finally:
            conn.close()

    def update_transcription_job(
        self,
        job_id: str,
        status: str,
        stage: str,
        error_message: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        if status not in {"queued", "starting", "processing", "completed", "failed"}:
            raise ValueError("Unsupported transcription job status.")
        allowed_transitions = {
            "queued": {"queued", "starting", "failed"},
            "starting": {"starting", "processing", "failed"},
            "processing": {"processing", "completed", "failed"},
            "completed": {"completed"},
            "failed": {"failed"},
        }
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT status FROM lecturescribe_transcription_jobs WHERE job_id = %s FOR UPDATE;",
                        (job_id,),
                    )
                    current_row = cursor.fetchone()
                    if not isinstance(current_row, Mapping):
                        return None
                    current_status = current_row["status"]
                    if status not in allowed_transitions[current_status]:
                        raise ValueError(
                            f"Cannot change transcription job status from '{current_status}' to '{status}'."
                        )
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET status = %s,
                            stage = %s,
                            error_message = %s,
                            started_at = CASE
                                WHEN %s = 'processing' THEN COALESCE(started_at, NOW())
                                ELSE started_at
                            END,
                            completed_at = CASE
                                WHEN %s IN ('completed', 'failed') THEN NOW()
                                ELSE completed_at
                            END,
                            updated_at = NOW()
                        WHERE job_id = %s
                        RETURNING *;
                        """,
                        (
                            status,
                            stage,
                            error_message,
                            status,
                            status,
                            job_id,
                        ),
                    )
                    return self._serialize_transcription_job(cursor.fetchone())
        finally:
            conn.close()

    def record_transcription_task(self, job_id: str, task_name: str) -> None:
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET task_name = %s, updated_at = NOW()
                        WHERE job_id = %s;
                        """,
                        (task_name, job_id),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError("Unable to record the transcription task.")
        finally:
            conn.close()

    def record_transcription_execution(self, job_id: str, execution_name: str) -> None:
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET run_execution_name = %s, updated_at = NOW()
                        WHERE job_id = %s;
                        """,
                        (execution_name, job_id),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError("Unable to record the Cloud Run execution.")
        finally:
            conn.close()

    def claim_transcription_job(self, job_id: str) -> bool:
        """Atomically claim a queued/starting job; duplicate worker starts do no work."""
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET status = 'processing', stage = 'transcribing',
                            started_at = COALESCE(started_at, NOW()), updated_at = NOW()
                        WHERE job_id = %s AND status IN ('queued', 'starting')
                        RETURNING job_id;
                        """,
                        (job_id,),
                    )
                    return cursor.fetchone() is not None
        finally:
            conn.close()

    def claim_transcription_dispatch(self, job_id: str) -> bool:
        """Claim a queued dispatch, allowing recovery of a stale launch attempt."""
        if not self.postgres_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET status = 'starting', stage = 'starting', updated_at = NOW()
                        WHERE job_id = %s
                          AND (
                            status = 'queued'
                            OR (
                                status = 'starting'
                                AND run_execution_name IS NULL
                                AND updated_at < NOW() - INTERVAL '2 minutes'
                            )
                          )
                        RETURNING job_id;
                        """,
                        (job_id,),
                    )
                    return cursor.fetchone() is not None
        finally:
            conn.close()

    def reset_transcription_dispatch(self, job_id: str) -> bool:
        """Reset a starting dispatch back to queued if Cloud Run Job launch failed."""
        if not self.postgres_url:
            return True
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE lecturescribe_transcription_jobs
                        SET status = 'queued', stage = 'queued', updated_at = NOW()
                        WHERE job_id = %s AND status = 'starting' AND run_execution_name IS NULL;
                        """,
                        (job_id,),
                    )
                    return cursor.rowcount > 0
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
        user_email: Optional[str] = None,
        course_name: Optional[str] = None
    ):
        """Save video, transcript cues, and AI summaries directly to PostgreSQL."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        derived_course = (course_name or extract_course_name(title)).strip()

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label, user_email, course_name)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (video_id) 
                        DO UPDATE SET title = EXCLUDED.title, duration = EXCLUDED.duration, 
                                      source_url = EXCLUDED.source_url, caption_label = EXCLUDED.caption_label,
                                      user_email = COALESCE(EXCLUDED.user_email, lecturescribe_videos.user_email),
                                      course_name = COALESCE(NULLIF(EXCLUDED.course_name, ''), lecturescribe_videos.course_name);
                    """, (video_id, title, duration, source_url, caption_label, clean_email, derived_course))

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
                source_url=source_url,
                course_name=derived_course
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
            "course_name": derived_course,
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

    def save_lecture_summary(
        self,
        video_id: str,
        summary_type: str,
        markdown_text: str,
        submission_text: str = "",
        citations: Optional[List[Dict[str, Any]]] = None,
        word_count: Optional[int] = None,
        model: str = "",
        user_email: Optional[str] = None
    ) -> bool:
        """Save or update a lecture summary in lecturescribe_lecture_summaries."""
        if not video_id or not summary_type or not markdown_text:
            return False

        clean_type = summary_type.strip().lower()
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        calculated_word_count = word_count
        if calculated_word_count is None:
            text_to_count = submission_text.strip() if submission_text and submission_text.strip() else markdown_text.strip()
            calculated_word_count = len([w for w in text_to_count.split() if w])

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_lecture_summaries (
                            video_id, user_email, summary_type, markdown_text,
                            submission_text, citations_json, word_count, model,
                            is_outdated, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, FALSE, NOW(), NOW())
                        ON CONFLICT (video_id, COALESCE(user_email, ''), summary_type) DO UPDATE
                        SET markdown_text = EXCLUDED.markdown_text,
                            submission_text = EXCLUDED.submission_text,
                            citations_json = EXCLUDED.citations_json,
                            word_count = EXCLUDED.word_count,
                            model = EXCLUDED.model,
                            is_outdated = FALSE,
                            updated_at = NOW();
                    """, (
                        video_id,
                        clean_email,
                        clean_type,
                        markdown_text,
                        submission_text or "",
                        json.dumps(citations or []),
                        calculated_word_count,
                        model or ""
                    ))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Notice] save_lecture_summary error: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def get_lecture_summaries(
        self,
        video_id: str,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch all saved lecture summaries (15_min, comprehensive, etc.) for a video.
        Returns a dictionary keyed by summary_type.
        """
        if not video_id:
            return {}

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = None
        summaries: Dict[str, Any] = {}
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            SELECT id, video_id, user_email, summary_type, markdown_text,
                                   submission_text, citations_json, word_count, model,
                                   COALESCE(is_outdated, FALSE) as is_outdated,
                                   created_at, updated_at
                            FROM lecturescribe_lecture_summaries
                            WHERE video_id = %s AND (user_email = %s OR user_email IS NULL)
                            ORDER BY (user_email = %s) DESC, updated_at DESC;
                        """, (video_id, clean_email, clean_email))
                    else:
                        cursor.execute("""
                            SELECT id, video_id, user_email, summary_type, markdown_text,
                                   submission_text, citations_json, word_count, model,
                                   COALESCE(is_outdated, FALSE) as is_outdated,
                                   created_at, updated_at
                            FROM lecturescribe_lecture_summaries
                            WHERE video_id = %s
                            ORDER BY updated_at DESC;
                        """, (video_id,))

                    rows = cursor.fetchall() or []
                    for row in rows:
                        stype = row["summary_type"]
                        if stype not in summaries:
                            raw_cit = row.get("citations_json")
                            citations = raw_cit if isinstance(raw_cit, list) else (json.loads(raw_cit) if raw_cit else [])
                            summaries[stype] = {
                                "id": row["id"],
                                "videoId": row["video_id"],
                                "userEmail": row.get("user_email"),
                                "summaryType": stype,
                                "markdownText": row.get("markdown_text") or "",
                                "submissionText": row.get("submission_text") or "",
                                "citations": citations,
                                "wordCount": row.get("word_count") or 0,
                                "model": row.get("model") or "",
                                "isOutdated": bool(row.get("is_outdated", False)),
                                "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
                                "updatedAt": row.get("updated_at").isoformat() if row.get("updated_at") else None
                            }
            return summaries
        except Exception as e:
            print(f"[PostgreSQL Notice] get_lecture_summaries error: {e}")
            return {}
        finally:
            if conn:
                conn.close()

    def get_lecture_summary(
        self,
        video_id: str,
        summary_type: str,
        user_email: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Fetch a single summary for a video and summary_type."""
        all_sums = self.get_lecture_summaries(video_id, user_email)
        return all_sums.get(summary_type.strip().lower())

    def save_lecture_progress(
        self,
        video_id: str,
        last_timestamp: str,
        last_seconds: float,
        duration_seconds: float = 0.0,
        active_cue_idx: int = 0,
        user_email: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Save or update lecture playback progress in PostgreSQL and In-Memory cache."""
        if not video_id:
            return None

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else "anonymous"
        clean_ts = (last_timestamp or "00:00").strip()
        safe_secs = max(0.0, float(last_seconds or 0.0))
        safe_dur = max(0.0, float(duration_seconds or 0.0))
        safe_idx = max(0, int(active_cue_idx or 0))

        # Check existing cached item to preserve duration if client passed 0
        existing_item = self._progress_memory_cache.get((clean_email, video_id))
        if safe_dur <= 0.0 and existing_item and existing_item.get("duration_seconds", 0) > 0:
            safe_dur = float(existing_item["duration_seconds"])

        if safe_dur > 0:
            progress_pct = min(100.0, max(0.0, round((safe_secs / safe_dur) * 100.0, 1)))
        else:
            progress_pct = 0.0

        item = {
            "video_id": video_id,
            "user_email": clean_email,
            "last_timestamp": clean_ts,
            "last_seconds": safe_secs,
            "duration_seconds": safe_dur,
            "progress_percent": progress_pct,
            "active_cue_idx": safe_idx,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            INSERT INTO lecturescribe_lecture_progress (
                                video_id, user_email, last_timestamp, last_seconds, duration_seconds, progress_percent, active_cue_idx, updated_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (user_email, video_id) DO UPDATE SET
                                last_timestamp = EXCLUDED.last_timestamp,
                                last_seconds = EXCLUDED.last_seconds,
                                duration_seconds = CASE WHEN EXCLUDED.duration_seconds > 0 THEN EXCLUDED.duration_seconds ELSE lecturescribe_lecture_progress.duration_seconds END,
                                progress_percent = CASE
                                    WHEN EXCLUDED.duration_seconds > 0 THEN EXCLUDED.progress_percent
                                    WHEN lecturescribe_lecture_progress.duration_seconds > 0 THEN LEAST(100.0, GREATEST(0.0, ROUND(((EXCLUDED.last_seconds / lecturescribe_lecture_progress.duration_seconds) * 100.0)::numeric, 1)))
                                    ELSE EXCLUDED.progress_percent
                                END,
                                active_cue_idx = EXCLUDED.active_cue_idx,
                                updated_at = NOW()
                            RETURNING id, video_id, user_email, last_timestamp, last_seconds, duration_seconds, progress_percent, active_cue_idx, updated_at;
                        """, (video_id, clean_email, clean_ts, safe_secs, safe_dur, progress_pct, safe_idx))
                        row = cursor.fetchone()
                        if row:
                            item["id"] = row["id"]
                            item["video_id"] = row["video_id"]
                            item["user_email"] = row["user_email"]
                            item["last_timestamp"] = row["last_timestamp"]
                            item["last_seconds"] = float(row["last_seconds"])
                            item["duration_seconds"] = float(row["duration_seconds"])
                            item["progress_percent"] = float(row["progress_percent"])
                            item["active_cue_idx"] = int(row["active_cue_idx"])
                            if isinstance(row["updated_at"], (datetime.date, datetime.datetime)):
                                item["updated_at"] = row["updated_at"].isoformat()
                        conn.commit()
                        self._progress_memory_cache[(clean_email, video_id)] = item
                        return item
            except Exception as e:
                print(f"[PostgreSQL Notice] save_lecture_progress fallback: {e}")
            finally:
                if conn:
                    conn.close()

        self._progress_memory_cache[(clean_email, video_id)] = item
        return item

    def get_lecture_progress(
        self,
        video_id: str,
        user_email: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Retrieve the last playback progress for a lecture."""
        if not video_id:
            return None

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        if clean_email and clean_email != "anonymous":
                            cursor.execute("""
                                SELECT id, video_id, user_email, last_timestamp, last_seconds, duration_seconds, progress_percent, active_cue_idx, updated_at
                                FROM lecturescribe_lecture_progress
                                WHERE video_id = %s AND user_email IN (%s, 'anonymous')
                                ORDER BY CASE WHEN user_email = %s THEN 0 ELSE 1 END, updated_at DESC
                                LIMIT 1;
                            """, (video_id, clean_email, clean_email))
                        else:
                            cursor.execute("""
                                SELECT id, video_id, user_email, last_timestamp, last_seconds, duration_seconds, progress_percent, active_cue_idx, updated_at
                                FROM lecturescribe_lecture_progress
                                WHERE video_id = %s
                                ORDER BY updated_at DESC
                                LIMIT 1;
                            """, (video_id,))
                        row = cursor.fetchone()
                        if row:
                            return {
                                "id": row["id"],
                                "video_id": row["video_id"],
                                "user_email": row["user_email"],
                                "last_timestamp": row["last_timestamp"],
                                "last_seconds": float(row["last_seconds"]),
                                "duration_seconds": float(row["duration_seconds"]),
                                "progress_percent": float(row["progress_percent"]),
                                "active_cue_idx": int(row["active_cue_idx"]),
                                "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None
                            }
            except Exception as e:
                print(f"[PostgreSQL Notice] get_lecture_progress fallback: {e}")
            finally:
                if conn:
                    conn.close()

        # In-memory fallback
        if clean_email and (clean_email, video_id) in self._progress_memory_cache:
            return self._progress_memory_cache[(clean_email, video_id)]
        if ("anonymous", video_id) in self._progress_memory_cache:
            return self._progress_memory_cache[("anonymous", video_id)]
        for (em, vid), data in self._progress_memory_cache.items():
            if vid == video_id:
                return data
        return None

    def get_user_progress_map(
        self,
        user_email: Optional[str] = None,
        video_ids: Optional[List[str]] = None
    ) -> Dict[str, Dict[str, Any]]:
        """Return a mapping of video_id -> progress for all lectures of a user or list of videos."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        res_map: Dict[str, Dict[str, Any]] = {}

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        query = """
                            SELECT DISTINCT ON (video_id)
                                video_id, user_email, last_timestamp, last_seconds, duration_seconds, progress_percent, active_cue_idx, updated_at
                            FROM lecturescribe_lecture_progress
                            WHERE 1=1
                        """
                        params = []
                        if clean_email and clean_email != "anonymous":
                            query += " AND user_email IN (%s, 'anonymous')"
                            params.append(clean_email)
                        if video_ids:
                            query += " AND video_id = ANY(%s)"
                            params.append(video_ids)
                        query += " ORDER BY video_id, CASE WHEN user_email = %s THEN 0 ELSE 1 END, updated_at DESC;"
                        params.append(clean_email or "anonymous")

                        cursor.execute(query, tuple(params))
                        rows = cursor.fetchall() or []
                        for row in rows:
                            res_map[row["video_id"]] = {
                                "video_id": row["video_id"],
                                "user_email": row["user_email"],
                                "last_timestamp": row["last_timestamp"],
                                "last_seconds": float(row["last_seconds"]),
                                "duration_seconds": float(row["duration_seconds"]),
                                "progress_percent": float(row["progress_percent"]),
                                "active_cue_idx": int(row["active_cue_idx"]),
                                "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None
                            }
                        return res_map
            except Exception as e:
                print(f"[PostgreSQL Notice] get_user_progress_map fallback: {e}")
            finally:
                if conn:
                    conn.close()

        # In-memory fallback
        for (em, vid), data in self._progress_memory_cache.items():
            if not video_ids or vid in video_ids:
                if not clean_email or em in (clean_email, "anonymous"):
                    if vid not in res_map or (clean_email and em == clean_email):
                        res_map[vid] = data
        return res_map

    def save_quiz(self, video_id: str, quiz_data: Dict[str, Any]) -> bool:
        """Persist generated quiz questions and metadata to PostgreSQL and In-Memory cache."""
        if not video_id or not quiz_data:
            return False

        clean_vid = str(video_id).strip()
        self._quiz_memory_cache[clean_vid] = quiz_data

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    quiz_json_str = json.dumps(quiz_data)
                    cursor.execute("""
                        INSERT INTO lecturescribe_quizzes (video_id, quiz_json, updated_at)
                        VALUES (%s, %s::jsonb, CURRENT_TIMESTAMP)
                        ON CONFLICT (video_id)
                        DO UPDATE SET
                            quiz_json = EXCLUDED.quiz_json,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (clean_vid, quiz_json_str))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_quiz error for video '{clean_vid}': {e}")
            return False
        finally:
            if conn:
                conn.close()

    def get_saved_quiz(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve persisted quiz from In-Memory cache or PostgreSQL."""
        if not video_id:
            return None

        clean_vid = str(video_id).strip()
        if clean_vid in self._quiz_memory_cache:
            data = self._quiz_memory_cache[clean_vid]
            if isinstance(data, dict):
                data["persisted"] = True
            return data

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT quiz_json 
                        FROM lecturescribe_quizzes 
                        WHERE video_id = %s 
                        LIMIT 1;
                    """, (clean_vid,))
                    row = cursor.fetchone()
                    if row and row.get("quiz_json"):
                        raw = row["quiz_json"]
                        data = raw if isinstance(raw, dict) else json.loads(raw)
                        data["persisted"] = True
                        self._quiz_memory_cache[clean_vid] = data
                        return data
        except Exception as e:
            print(f"[PostgreSQL Warning] get_saved_quiz error for video '{clean_vid}': {e}")
            return None
        finally:
            if conn:
                conn.close()
        return None

    def save_course_quiz(self, course_name: str, quiz_data: Dict[str, Any], lecture_count: int = 0) -> bool:
        """Persist generated course-wide quiz into PostgreSQL and L1 In-Memory Cache."""
        if not course_name:
            return False

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        self._course_quiz_memory_cache[course_slug] = quiz_data

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    quiz_json_str = json.dumps(quiz_data)
                    cursor.execute("""
                        INSERT INTO lecturescribe_course_quizzes (course_slug, course_name, quiz_json, lecture_count, updated_at)
                        VALUES (%s, %s, %s::jsonb, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (course_slug)
                        DO UPDATE SET
                            course_name = EXCLUDED.course_name,
                            quiz_json = EXCLUDED.quiz_json,
                            lecture_count = EXCLUDED.lecture_count,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (course_slug, clean_name, quiz_json_str, lecture_count))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_course_quiz error for '{course_slug}': {e}")
            return False
        finally:
            if conn:
                conn.close()

    def get_saved_course_quiz(self, course_name: str) -> Optional[Dict[str, Any]]:
        """Retrieve persisted course-wide quiz from In-Memory cache or PostgreSQL."""
        if not course_name:
            return None

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        if course_slug in self._course_quiz_memory_cache:
            data = self._course_quiz_memory_cache[course_slug]
            if isinstance(data, dict):
                data["persisted"] = True
            return data

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT quiz_json 
                        FROM lecturescribe_course_quizzes 
                        WHERE course_slug = %s 
                        LIMIT 1;
                    """, (course_slug,))
                    row = cursor.fetchone()
                    if row and row.get("quiz_json"):
                        raw = row["quiz_json"]
                        data = raw if isinstance(raw, dict) else json.loads(raw)
                        data["persisted"] = True
                        self._course_quiz_memory_cache[course_slug] = data
                        return data
        except Exception as e:
            print(f"[PostgreSQL Warning] get_saved_course_quiz error for '{course_slug}': {e}")
            return None
        finally:
            if conn:
                conn.close()

    def save_course_quiz_history(
        self,
        course_name: str,
        quiz_id: str,
        quiz_data: Dict[str, Any],
        user_email: str = "",
        answers: Optional[Dict[str, Any]] = None,
        score: int = 0,
        total_questions: int = 0,
        completed: bool = False
    ) -> bool:
        """Persist a course quiz run/attempt into history."""
        if not course_name or not quiz_id or not quiz_data:
            return False

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        clean_email = str(user_email or "").strip().lower()
        answers_dict = answers or {}
        tot_q = total_questions or len(quiz_data.get("questions") or [])

        # Update in-memory history cache
        found_mem = False
        for item in self._course_quiz_history_memory:
            if item.get("quiz_id") == quiz_id:
                item["answers"] = answers_dict
                item["score"] = score
                item["total_questions"] = tot_q
                item["completed"] = completed
                item["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                found_mem = True
                break
        if not found_mem:
            self._course_quiz_history_memory.append({
                "quiz_id": quiz_id,
                "course_slug": course_slug,
                "course_name": clean_name,
                "user_email": clean_email,
                "quiz_json": quiz_data,
                "answers": answers_dict,
                "score": score,
                "total_questions": tot_q,
                "completed": completed,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            })

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_course_quiz_history 
                            (quiz_id, course_slug, course_name, user_email, quiz_json, answers, score, total_questions, completed, updated_at)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (quiz_id)
                        DO UPDATE SET
                            answers = EXCLUDED.answers,
                            score = EXCLUDED.score,
                            total_questions = EXCLUDED.total_questions,
                            completed = EXCLUDED.completed,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (
                        quiz_id,
                        course_slug,
                        clean_name,
                        clean_email,
                        json.dumps(quiz_data),
                        json.dumps(answers_dict),
                        score,
                        tot_q,
                        completed
                    ))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_course_quiz_history error for '{quiz_id}': {e}")
            return True
        finally:
            if conn:
                conn.close()

    def get_course_quiz_history(
        self,
        course_name: str,
        user_email: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve list of historical quiz runs for a course."""
        if not course_name:
            return []

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        clean_email = str(user_email or "").strip().lower()

        if not self.postgres_url:
            matched = [
                {
                    "quiz_id": item["quiz_id"],
                    "course_name": item["course_name"],
                    "course_slug": item["course_slug"],
                    "score": item["score"],
                    "total_questions": item["total_questions"],
                    "completed": item["completed"],
                    "created_at": item["created_at"],
                    "updated_at": item.get("updated_at", item["created_at"])
                }
                for item in reversed(self._course_quiz_history_memory)
                if item.get("course_slug") == course_slug and (not clean_email or item.get("user_email") == clean_email or not item.get("user_email"))
            ]
            return matched

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            SELECT quiz_id, course_slug, course_name, score, total_questions, completed, created_at, updated_at
                            FROM lecturescribe_course_quiz_history
                            WHERE course_slug = %s AND (user_email = %s OR user_email = '')
                            ORDER BY created_at DESC
                            LIMIT 50;
                        """, (course_slug, clean_email))
                    else:
                        cursor.execute("""
                            SELECT quiz_id, course_slug, course_name, score, total_questions, completed, created_at, updated_at
                            FROM lecturescribe_course_quiz_history
                            WHERE course_slug = %s
                            ORDER BY created_at DESC
                            LIMIT 50;
                        """, (course_slug,))
                    rows = cursor.fetchall() or []
                    results = []
                    for r in rows:
                        results.append({
                            "quiz_id": r["quiz_id"],
                            "course_slug": r["course_slug"],
                            "course_name": r["course_name"],
                            "score": r["score"],
                            "total_questions": r["total_questions"],
                            "completed": bool(r["completed"]),
                            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
                            "updated_at": r["updated_at"].isoformat() if hasattr(r["updated_at"], "isoformat") else str(r["updated_at"])
                        })
                    return results
        except Exception as e:
            print(f"[PostgreSQL Warning] get_course_quiz_history error for '{course_slug}': {e}")
            return [
                {
                    "quiz_id": item["quiz_id"],
                    "course_name": item["course_name"],
                    "course_slug": item["course_slug"],
                    "score": item["score"],
                    "total_questions": item["total_questions"],
                    "completed": item["completed"],
                    "created_at": item["created_at"]
                }
                for item in reversed(self._course_quiz_history_memory)
                if item.get("course_slug") == course_slug
            ]
        finally:
            if conn:
                conn.close()

    def get_course_quiz_history_by_id(self, quiz_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full historical quiz details, saved answers, and score by quiz_id."""
        if not quiz_id:
            return None

        clean_id = str(quiz_id).strip()
        for item in self._course_quiz_history_memory:
            if item.get("quiz_id") == clean_id:
                return item

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT quiz_id, course_slug, course_name, user_email, quiz_json, answers, score, total_questions, completed, created_at, updated_at
                        FROM lecturescribe_course_quiz_history
                        WHERE quiz_id = %s
                        LIMIT 1;
                    """, (clean_id,))
                    row = cursor.fetchone()
                    if row:
                        quiz_json = row["quiz_json"] if isinstance(row["quiz_json"], dict) else json.loads(row["quiz_json"])
                        answers = row["answers"] if isinstance(row["answers"], dict) else json.loads(row["answers"])
                        return {
                            "quiz_id": row["quiz_id"],
                            "course_slug": row["course_slug"],
                            "course_name": row["course_name"],
                            "user_email": row["user_email"],
                            "quiz_json": quiz_json,
                            "answers": answers,
                            "score": row["score"],
                            "total_questions": row["total_questions"],
                            "completed": bool(row["completed"]),
                            "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
                            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"])
                        }
                    return None
        except Exception as e:
            print(f"[PostgreSQL Warning] get_course_quiz_history_by_id error for '{clean_id}': {e}")
            return None
        finally:
            if conn:
                conn.close()

    def save_course_quiz_explanation(self, course_name: str, question_id: Union[int, str], detailed_explanation: str) -> bool:
        """Persist detailed course quiz explanation to PostgreSQL and In-Memory cache."""
        if not course_name or not detailed_explanation:
            return False

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        q_id = str(question_id or "").strip()

        if course_slug not in self._course_quiz_explanations_memory:
            self._course_quiz_explanations_memory[course_slug] = {}
        self._course_quiz_explanations_memory[course_slug][q_id] = detailed_explanation

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_course_quiz_explanations (course_slug, question_id, detailed_explanation, updated_at)
                        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (course_slug, question_id)
                        DO UPDATE SET
                            detailed_explanation = EXCLUDED.detailed_explanation,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (course_slug, q_id, detailed_explanation))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_course_quiz_explanation error for course '{course_slug}' question {q_id}: {e}")
            return True
        finally:
            if conn:
                conn.close()

    def get_course_quiz_explanation(self, course_name: str, question_id: Union[int, str]) -> Optional[str]:
        """Retrieve detailed course quiz explanation from In-Memory cache or PostgreSQL."""
        if not course_name:
            return None

        clean_name = str(course_name).strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_name.lower()).strip('-') or "general"
        q_id = str(question_id or "").strip()

        if course_slug in self._course_quiz_explanations_memory:
            if q_id in self._course_quiz_explanations_memory[course_slug]:
                return self._course_quiz_explanations_memory[course_slug][q_id]

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT detailed_explanation
                        FROM lecturescribe_course_quiz_explanations
                        WHERE course_slug = %s AND question_id = %s
                        LIMIT 1;
                    """, (course_slug, q_id))
                    row = cursor.fetchone()
                    if row and row.get("detailed_explanation"):
                        exp = row["detailed_explanation"]
                        if course_slug not in self._course_quiz_explanations_memory:
                            self._course_quiz_explanations_memory[course_slug] = {}
                        self._course_quiz_explanations_memory[course_slug][q_id] = exp
                        return exp
            return None
        except Exception as e:
            print(f"[PostgreSQL Warning] get_course_quiz_explanation error for '{course_slug}' question {q_id}: {e}")
            return None
        finally:
            if conn:
                conn.close()

        return None

    def save_quiz_attempt(
        self,
        quiz_type: str,
        target_id: str,
        user_email: str,
        answers: Dict[str, int],
        score: int = 0,
        completed: bool = False
    ) -> bool:
        """Persist user quiz responses and score into PostgreSQL and Memory Cache."""
        q_type = str(quiz_type or "course").strip().lower()
        t_id = str(target_id or "").strip().lower()
        email = str(user_email or "anonymous").strip().lower()
        key = f"{q_type}:{t_id}:{email}"

        attempt_data = {
            "quiz_type": q_type,
            "target_id": t_id,
            "user_email": email,
            "answers": answers or {},
            "score": int(score or 0),
            "completed": bool(completed),
            "is_completed": bool(completed),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        self._quiz_attempts_memory_cache[key] = attempt_data

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    answers_json = json.dumps(answers or {})
                    cursor.execute("""
                        INSERT INTO lecturescribe_quiz_attempts (quiz_type, target_id, user_email, answers, score, completed, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (quiz_type, target_id, user_email)
                        DO UPDATE SET
                            answers = EXCLUDED.answers,
                            score = EXCLUDED.score,
                            completed = EXCLUDED.completed,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (q_type, t_id, email, answers_json, score, completed))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_quiz_attempt error for '{key}': {e}")
            return False
        finally:
            if conn:
                conn.close()

    def get_quiz_attempt(self, quiz_type: str, target_id: str, user_email: str) -> Optional[Dict[str, Any]]:
        """Retrieve persisted user quiz attempt from Memory cache or PostgreSQL."""
        q_type = str(quiz_type or "course").strip().lower()
        t_id = str(target_id or "").strip().lower()
        email = str(user_email or "anonymous").strip().lower()
        key = f"{q_type}:{t_id}:{email}"

        if key in self._quiz_attempts_memory_cache:
            return self._quiz_attempts_memory_cache[key]

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT answers, score, completed, updated_at
                        FROM lecturescribe_quiz_attempts
                        WHERE quiz_type = %s AND target_id = %s AND user_email = %s
                        LIMIT 1;
                    """, (q_type, t_id, email))
                    row = cursor.fetchone()
                    if row:
                        raw_answers = row.get("answers")
                        answers_dict = raw_answers if isinstance(raw_answers, dict) else json.loads(raw_answers or "{}")
                        data = {
                            "quiz_type": q_type,
                            "target_id": t_id,
                            "user_email": email,
                            "answers": answers_dict,
                            "score": row.get("score", 0),
                            "completed": row.get("completed", False),
                            "is_completed": row.get("completed", False),
                            "updated_at": str(row.get("updated_at") or "")
                        }
                        self._quiz_attempts_memory_cache[key] = data
                        return data
        except Exception as e:
            print(f"[PostgreSQL Warning] get_quiz_attempt error for '{key}': {e}")
            return None
        finally:
            if conn:
                conn.close()
        return None

    def delete_quiz_attempt(self, quiz_type: str, target_id: str, user_email: str) -> bool:
        """Reset user quiz attempt in PostgreSQL and Memory cache."""
        q_type = str(quiz_type or "course").strip().lower()
        t_id = str(target_id or "").strip().lower()
        email = str(user_email or "anonymous").strip().lower()
        key = f"{q_type}:{t_id}:{email}"
        self._quiz_attempts_memory_cache.pop(key, None)

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        DELETE FROM lecturescribe_quiz_attempts
                        WHERE quiz_type = %s AND target_id = %s AND user_email = %s;
                    """, (q_type, t_id, email))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] delete_quiz_attempt error for '{key}': {e}")
            return False
        finally:
            if conn:
                conn.close()

    def save_quiz_explanation(self, video_id: str, question_id: int, detailed_explanation: str) -> bool:
        """Persist detailed quiz explanation to PostgreSQL and In-Memory cache."""
        if not video_id or not detailed_explanation:
            return False

        clean_vid = str(video_id).strip()
        q_id = int(question_id or 0)

        if clean_vid not in self._quiz_explanations_memory_cache:
            self._quiz_explanations_memory_cache[clean_vid] = {}
        self._quiz_explanations_memory_cache[clean_vid][q_id] = detailed_explanation

        if not self.postgres_url:
            return True

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_quiz_explanations (video_id, question_id, detailed_explanation, updated_at)
                        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (video_id, question_id)
                        DO UPDATE SET
                            detailed_explanation = EXCLUDED.detailed_explanation,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (clean_vid, q_id, detailed_explanation))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Warning] save_quiz_explanation error for video '{clean_vid}' question {q_id}: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def get_quiz_explanation(self, video_id: str, question_id: int) -> Optional[str]:
        """Retrieve detailed quiz explanation from In-Memory cache or PostgreSQL."""
        if not video_id:
            return None

        clean_vid = str(video_id).strip()
        q_id = int(question_id or 0)

        if clean_vid in self._quiz_explanations_memory_cache:
            if q_id in self._quiz_explanations_memory_cache[clean_vid]:
                return self._quiz_explanations_memory_cache[clean_vid][q_id]

        if not self.postgres_url:
            return None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT detailed_explanation
                        FROM lecturescribe_quiz_explanations
                        WHERE video_id = %s AND question_id = %s
                        LIMIT 1;
                    """, (clean_vid, q_id))
                    row = cursor.fetchone()
                    if row and row.get("detailed_explanation"):
                        explanation = row["detailed_explanation"]
                        if clean_vid not in self._quiz_explanations_memory_cache:
                            self._quiz_explanations_memory_cache[clean_vid] = {}
                        self._quiz_explanations_memory_cache[clean_vid][q_id] = explanation
                        return explanation
        except Exception as e:
            print(f"[PostgreSQL Warning] get_quiz_explanation error for video '{clean_vid}' question {q_id}: {e}")
            return None
        finally:
            if conn:
                conn.close()
        return None

    def get_saved_video(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Fetch video transcript from In-Memory Cache or PostgreSQL.
        Returns None if not found."""
        if video_id in self._memory_cache:
            return self._memory_cache[video_id]

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT * FROM lecturescribe_videos WHERE video_id = %s;", (video_id,))
                    v_row = cursor.fetchone()
                    if not v_row:
                        return None

                    cursor.execute("""
                        SELECT id, timestamp as time, seconds, text 
                        FROM lecturescribe_transcript_cues 
                        WHERE video_id = %s 
                        ORDER BY id ASC;
                    """, (video_id,))
                    cues = cursor.fetchall() or []

                    cursor.execute("""
                        SELECT sections_json, COALESCE(is_outdated, FALSE) as is_outdated 
                        FROM lecturescribe_summaries 
                        WHERE video_id = %s 
                        ORDER BY id DESC LIMIT 1;
                    """, (video_id,))
                    s_row = cursor.fetchone()
                    summary_sections = []
                    legacy_is_outdated = False
                    if s_row:
                        legacy_is_outdated = bool(s_row.get("is_outdated", False))
                        if s_row.get("sections_json"):
                            raw = s_row["sections_json"]
                            summary_sections = raw if isinstance(raw, list) else json.loads(raw)

                    cursor.execute("""
                        SELECT COALESCE(BOOL_OR(is_outdated), FALSE) as is_outdated
                        FROM lecturescribe_lecture_summaries
                        WHERE video_id = %s;
                    """, (video_id,))
                    ls_row = cursor.fetchone()
                    summary_is_outdated = bool(legacy_is_outdated or (ls_row and ls_row.get("is_outdated", False)))

                    if not summary_sections and cues:
                        from backend.summary_generator import generate_summary_sections
                        summary_sections = generate_summary_sections([dict(c) for c in cues], v_row["title"])
                        if summary_sections:
                            self.update_summary_sections(video_id, summary_sections)

                    course_name = v_row.get("course_name") or extract_course_name(v_row.get("title", ""))
                    record = {
                        "videoId": v_row["video_id"],
                        "title": v_row["title"],
                        "duration": v_row["duration"],
                        "sourceUrl": v_row["source_url"],
                        "captionLabel": v_row["caption_label"],
                        "cues": [dict(c) for c in cues],
                        "summarySections": summary_sections,
                        "course_name": course_name,
                        "course_slug": to_course_slug(course_name),
                        "summary_outdated": summary_is_outdated,
                        "is_outdated": summary_is_outdated,
                        "cached": True
                    }
                    self._memory_cache[video_id] = record
                    return record
        except Exception as e:
            print(f"[PostgreSQL Notice] get_saved_video fallback ({e}).")
            return self._memory_cache.get(video_id)
        finally:
            if conn:
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

        conn = None
        try:
            conn = self._get_connection()
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
        except Exception as e:
            print(f"[PostgreSQL Notice] save_chat_log fallback ({e}).")
        finally:
            if conn:
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
        conn = None
        try:
            conn = self._get_connection()
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
        except Exception as e:
            print(f"[PostgreSQL Notice] get_chat_history fallback ({e}). Returning empty list.")
            return []
        finally:
            if conn:
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
        conn = None
        try:
            conn = self._get_connection()
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
        except Exception as e:
            print(f"[PostgreSQL Notice] clear_chat_history fallback ({e}).")
            return False
        finally:
            if conn:
                conn.close()

    def delete_chat_message(
        self,
        message_id: str,
        video_id: Optional[str] = None,
        user_email: Optional[str] = None
    ) -> bool:
        """
        Delete a chat interaction log from PostgreSQL.
        Accepts formats: 'msg_user_<id>', 'msg_bot_<id>', or raw integer string '<id>'.
        """
        if not message_id:
            return False

        clean_id_str = str(message_id).strip()
        if clean_id_str.startswith("msg_user_"):
            clean_id_str = clean_id_str[len("msg_user_"):]
        elif clean_id_str.startswith("msg_bot_"):
            clean_id_str = clean_id_str[len("msg_bot_"):]

        try:
            row_id = int(clean_id_str)
        except ValueError:
            print(f"[PostgreSQL Notice] Invalid message_id for deletion: '{message_id}'")
            return False

        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    query = "DELETE FROM lecturescribe_chat_logs WHERE id = %s"
                    params = [row_id]
                    if video_id:
                        query += " AND video_id = %s"
                        params.append(video_id)
                    if clean_email:
                        query += " AND (user_email = %s OR user_email IS NULL)"
                        params.append(clean_email)
                    query += ";"
                    cursor.execute(query, tuple(params))
                    deleted_count = cursor.rowcount
                    conn.commit()
                    return deleted_count > 0
        except Exception as e:
            print(f"[PostgreSQL Notice] delete_chat_message fallback ({e}).")
            return False
        finally:
            if conn:
                conn.close()

    def save_course_chat_log(
        self,
        course_name: str,
        user_prompt: str,
        ai_reply: str,
        citations: Optional[List[Dict[str, Any]]] = None,
        user_email: Optional[str] = None,
        model: Optional[str] = None
    ):
        """Save course-level chat interaction directly to PostgreSQL."""
        if not course_name or not user_prompt:
            return

        clean_name = course_name.strip()
        course_slug = to_course_slug(clean_name)
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_course_chat_logs (
                            course_slug, course_name, user_prompt, ai_reply,
                            citations_json, user_email, model
                        )
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s);
                    """, (
                        course_slug,
                        clean_name,
                        user_prompt,
                        ai_reply,
                        json.dumps(citations or []),
                        clean_email,
                        model or ""
                    ))
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Notice] save_course_chat_log error ({e}).")
        finally:
            if conn:
                conn.close()

    def get_course_chat_history(
        self,
        course_name: str,
        user_email: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Fetch chronological course-level chat history directly from PostgreSQL."""
        if not course_name:
            return []

        course_slug = to_course_slug(course_name)
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    query = """
                        SELECT id, course_slug, course_name, user_prompt, ai_reply,
                               citations_json, user_email, model, created_at
                        FROM lecturescribe_course_chat_logs
                        WHERE course_slug = %s
                    """
                    params = [course_slug]
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
                        citations = r["citations_json"] if isinstance(r.get("citations_json"), list) else []
                        history.append({
                            "id": f"msg_user_{c_id}",
                            "sender": "user",
                            "text": r["user_prompt"],
                            "created_at": ts_str
                        })
                        history.append({
                            "id": f"msg_bot_{c_id}",
                            "sender": "bot",
                            "text": r["ai_reply"],
                            "citations": citations,
                            "model": r.get("model") or "",
                            "created_at": ts_str
                        })
                    return history
        except Exception as e:
            print(f"[PostgreSQL Notice] get_course_chat_history error ({e}).")
            return []
        finally:
            if conn:
                conn.close()

    def clear_course_chat_history(
        self,
        course_name: str,
        user_email: Optional[str] = None
    ) -> bool:
        """Clear course-level chat history for a course and user session directly in PostgreSQL."""
        if not course_name:
            return False

        course_slug = to_course_slug(course_name)
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            DELETE FROM lecturescribe_course_chat_logs
                            WHERE course_slug = %s AND (user_email = %s OR user_email IS NULL);
                        """, (course_slug, clean_email))
                    else:
                        cursor.execute("""
                            DELETE FROM lecturescribe_course_chat_logs
                            WHERE course_slug = %s;
                        """, (course_slug,))
                    conn.commit()
            return True
        except Exception as e:
            print(f"[PostgreSQL Notice] clear_course_chat_history error ({e}).")
            return False
        finally:
            if conn:
                conn.close()

    def delete_course_chat_message(
        self,
        message_id: str,
        course_name: Optional[str] = None,
        user_email: Optional[str] = None
    ) -> bool:
        """Delete an interaction from course chat logs directly in PostgreSQL."""
        if not message_id:
            return False

        clean_id_str = str(message_id).strip()
        course_slug = to_course_slug(course_name) if course_name else None
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        if clean_id_str.startswith("msg_user_"):
            clean_id_str = clean_id_str.replace("msg_user_", "")
        elif clean_id_str.startswith("msg_bot_"):
            clean_id_str = clean_id_str.replace("msg_bot_", "")

        try:
            int_id = int(clean_id_str)
        except ValueError:
            return False

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    query = "DELETE FROM lecturescribe_course_chat_logs WHERE id = %s"
                    params = [int_id]
                    if course_slug:
                        query += " AND course_slug = %s"
                        params.append(course_slug)
                    if clean_email:
                        query += " AND (user_email = %s OR user_email IS NULL)"
                        params.append(clean_email)
                    query += ";"
                    cursor.execute(query, tuple(params))
                    deleted = cursor.rowcount > 0
                    conn.commit()
                    return deleted
        except Exception as e:
            print(f"[PostgreSQL Notice] delete_course_chat_message error ({e}).")
            return False
        finally:
            if conn:
                conn.close()

    def record_user_lecture(
        self,
        user_email: str,
        video_id: str,
        title: str,
        duration: str = "",
        source_url: str = "",
        drive_folder_url: Optional[str] = None,
        course_name: Optional[str] = None
    ) -> bool:
        """Upsert a lecture into the user's LMS library in PostgreSQL with course grouping."""
        if not user_email or not video_id:
            return False

        clean_email = user_email.strip().lower()
        # Resolve slug to canonical course name if caller passed a slug
        derived_course = (course_name or "").strip()
        is_slug = bool(re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', derived_course))
        if not derived_course or is_slug:
            extracted = extract_course_name(title)
            if extracted and not re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', extracted):
                derived_course = extracted
            elif derived_course:
                derived_course = derived_course.replace("-", " ").title()
            else:
                derived_course = "General Lectures"

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, drive_folder_url, course_name, last_viewed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT(user_email, video_id) DO UPDATE SET
                            title = EXCLUDED.title,
                            duration = COALESCE(NULLIF(EXCLUDED.duration, ''), lecturescribe_user_library.duration),
                            source_url = COALESCE(NULLIF(EXCLUDED.source_url, ''), lecturescribe_user_library.source_url),
                            drive_folder_url = COALESCE(EXCLUDED.drive_folder_url, lecturescribe_user_library.drive_folder_url),
                            course_name = COALESCE(NULLIF(EXCLUDED.course_name, ''), lecturescribe_user_library.course_name),
                            last_viewed_at = NOW();
                    """, (clean_email, video_id, title, duration, source_url, drive_folder_url, derived_course))
                    conn.commit()
            try:
                self.auto_map_videos_to_user(clean_email)
            except Exception as map_err:
                print(f"[PostgreSQL Notice] Auto-map during write skipped ({map_err}).")
            return True
        finally:
            conn.close()

    def get_drive_folder_url(self, video_id: str, user_email: Optional[str] = None) -> Optional[str]:
        """Fetch saved Google Drive folder URL for a given video_id."""
        if not video_id:
            return None
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if user_email and user_email.strip():
                        cursor.execute("""
                            SELECT drive_folder_url FROM lecturescribe_user_library 
                            WHERE video_id = %s AND user_email = %s AND drive_folder_url IS NOT NULL AND drive_folder_url != ''
                            ORDER BY id DESC LIMIT 1;
                        """, (str(video_id), user_email.strip().lower()))
                        row = cursor.fetchone()
                        if row and row.get("drive_folder_url"):
                            return row["drive_folder_url"]

                    cursor.execute("""
                        SELECT drive_folder_url FROM lecturescribe_user_library 
                        WHERE video_id = %s AND drive_folder_url IS NOT NULL AND drive_folder_url != ''
                        ORDER BY id DESC LIMIT 1;
                    """, (str(video_id),))
                    row = cursor.fetchone()
                    if row and row.get("drive_folder_url"):
                        return row["drive_folder_url"]
        except Exception as e:
            print(f"[DB Error fetching drive_folder_url]: {e}")
        finally:
            if conn:
                conn.close()
        return None

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
                        INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, course_name, last_viewed_at)
                        SELECT %s, video_id, title, duration, source_url, course_name, created_at
                        FROM lecturescribe_videos
                        ON CONFLICT (user_email, video_id) DO NOTHING;
                    """, (clean_email,))
                    conn.commit()
        finally:
            conn.close()

    def backfill_missing_course_names(self, force: bool = False):
        """Backfill and repair course_name for library records or videos (including repairing slug names)."""
        if not force and getattr(self, '_backfill_done', False):
            return
        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, title FROM lecturescribe_user_library WHERE course_name IS NULL OR course_name = '';
                    """)
                    lib_rows = cursor.fetchall() or []
                    for r in lib_rows:
                        c_name = extract_course_name(r["title"])
                        cursor.execute("UPDATE lecturescribe_user_library SET course_name = %s WHERE id = %s;", (c_name, r["id"]))

                    cursor.execute("""
                        SELECT video_id, title FROM lecturescribe_videos WHERE course_name IS NULL OR course_name = '';
                    """)
                    vid_rows = cursor.fetchall() or []
                    for r in vid_rows:
                        c_name = extract_course_name(r["title"])
                        cursor.execute("UPDATE lecturescribe_videos SET course_name = %s WHERE video_id = %s;", (c_name, r["video_id"]))

                    # Repair any slug-formatted course_names in lecturescribe_user_library
                    cursor.execute("""
                        SELECT id, video_id, title, course_name FROM lecturescribe_user_library
                        WHERE course_name ~ '^[a-z0-9]+(-[a-z0-9]+)+$';
                    """)
                    slug_rows = cursor.fetchall() or []
                    for sr in slug_rows:
                        canonical = extract_course_name(sr.get("title", ""))
                        if not canonical or re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', canonical):
                            canonical = sr["course_name"].replace("-", " ").title()
                        cursor.execute("""
                            UPDATE lecturescribe_user_library SET course_name = %s WHERE id = %s;
                        """, (canonical, sr["id"]))

                    conn.commit()
                    self._backfill_done = True
        finally:
            conn.close()

    def get_user_courses(self, user_email: str) -> List[Dict[str, Any]]:
        """
        Group user library lectures by course_name, canonicalizing slugs to avoid duplicates.
        Returns a list of course objects, each containing its aggregated lecture list.
        """
        if not user_email:
            return []

        clean_email = user_email.strip().lower()

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at, course_name
                        FROM lecturescribe_user_library
                        WHERE user_email = %s
                        ORDER BY last_viewed_at DESC;
                    """, (clean_email,))
                    rows = cursor.fetchall() or []

                    try:
                        v_ids = [r["video_id"] for r in rows if r.get("video_id")]
                        prog_map = self.get_user_progress_map(user_email=clean_email, video_ids=v_ids)
                    except Exception:
                        prog_map = {}

                    courses_map = OrderedDict()
                    for r in rows:
                        c_name = (r.get("course_name") or extract_course_name(r.get("title", ""))).strip()
                        if not c_name:
                            c_name = "General Lectures"

                        # Canonical key grouped by hyphenated slug
                        c_slug = re.sub(r'[^a-z0-9]+', '-', c_name.lower()).strip('-') or "general"
                        is_slug = bool(re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', c_name))

                        if c_slug not in courses_map:
                            display_title = c_name
                            if is_slug:
                                extracted = extract_course_name(r.get("title", ""))
                                if extracted and not re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', extracted):
                                    display_title = extracted
                                else:
                                    display_title = c_name.replace("-", " ").title()

                            courses_map[c_slug] = {
                                "course_name": display_title,
                                "course_slug": c_slug,
                                "lecture_count": 0,
                                "latest_viewed_at": str(r["last_viewed_at"]) if r.get("last_viewed_at") else None,
                                "thumbnail_video_id": r["video_id"],
                                "lectures": []
                            }
                        else:
                            # Upgrade slug display name to proper capitalized course title if available
                            if bool(re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', courses_map[c_slug]["course_name"])) and not is_slug:
                                courses_map[c_slug]["course_name"] = c_name

                        canonical_course_title = courses_map[c_slug]["course_name"]
                        courses_map[c_slug]["lecture_count"] += 1
                        courses_map[c_slug]["lectures"].append({
                            "videoId": r["video_id"],
                            "video_id": r["video_id"],
                            "title": r["title"],
                            "video_title": r["title"],
                            "duration": r["duration"] or "Unknown",
                            "sourceUrl": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "video_url": r["source_url"] or f"https://vimeo.com/{r['video_id']}",
                            "driveFolderUrl": r["drive_folder_url"],
                            "drive_folder_url": r["drive_folder_url"],
                            "lastViewedAt": str(r["last_viewed_at"]) if r.get("last_viewed_at") else None,
                            "last_viewed_at": str(r["last_viewed_at"]) if r.get("last_viewed_at") else None,
                            "created_at": str(r["last_viewed_at"]) if r.get("last_viewed_at") else None,
                            "course_name": canonical_course_title,
                            "progress": prog_map.get(r["video_id"])
                        })

                    return list(courses_map.values())
        finally:
            conn.close()

    def resolve_course_canonical_name(self, course_identifier: str) -> str:
        """
        Resolve a course slug (e.g. 'machine-learning-paradigms') or raw name
        (e.g. 'Machine Learning Paradigms') to the canonical course name stored in DB.
        If no match is found, returns clean input or formatted title as fallback.
        Never returns a raw hyphenated slug.
        """
        if not course_identifier or not course_identifier.strip():
            return "General Lectures"

        clean = course_identifier.strip()
        slug_norm = to_course_slug(clean)

        conn = None
        try:
            if HAS_PSYCOPG2 and self.postgres_url:
                conn = self._get_connection()
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT course_name FROM lecturescribe_videos
                        WHERE course_name IS NOT NULL AND course_name != ''
                          AND (LOWER(course_name) = LOWER(%s) OR regexp_replace(LOWER(course_name), '[^a-z0-9]+', '-', 'g') = %s)
                        LIMIT 1;
                    """, (clean, slug_norm))
                    row = cursor.fetchone()
                    if row and row.get("course_name"):
                        return row["course_name"]
        except Exception:
            pass
        finally:
            if conn:
                conn.close()

        for v in self._memory_cache.values():
            if isinstance(v, dict):
                c = (v.get("course_name") or "").strip()
                if c and (to_course_slug(c) == slug_norm or c.lower() == clean.lower()):
                    return c

        return clean

    def get_course_details(self, course_name: str, user_email: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Fetch aggregated course info and its lecture list.
        Queries all course lectures from PostgreSQL (merging general videos and user library),
        falling back to in-memory cache if the database is unavailable.
        """
        if not course_name or not course_name.strip():
            return None

        clean_name = course_name.strip()
        clean_lower = clean_name.lower()
        slug_as_space = clean_name.replace("-", " ")
        slug_as_wildcard = clean_name.replace("-", "%")

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    # 1. Fetch all general lectures for this course from lecturescribe_videos
                    cursor.execute("""
                        SELECT video_id, title, duration, source_url, course_name, created_at
                        FROM lecturescribe_videos
                        WHERE course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s OR title ILIKE %s OR title ILIKE %s
                        ORDER BY created_at DESC;
                    """, (clean_name, f"%{clean_name}%", slug_as_space, f"%{slug_as_wildcard}%", f"%{slug_as_space}%", f"%{slug_as_wildcard}%"))
                    vid_rows = cursor.fetchall() or []

                    # 2. Fetch user library lectures if email provided (to enrich with drive_folder_url, last_viewed_at)
                    user_lib_rows = []
                    if user_email and user_email.strip():
                        cursor.execute("""
                            SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at, course_name
                            FROM lecturescribe_user_library
                            WHERE user_email = %s AND (
                                course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s
                                OR title ILIKE %s OR title ILIKE %s
                            )
                            ORDER BY last_viewed_at DESC;
                        """, (user_email.strip().lower(), clean_name, f"%{clean_name}%", slug_as_space, f"%{slug_as_wildcard}%", f"%{slug_as_space}%", f"%{slug_as_wildcard}%"))
                        user_lib_rows = cursor.fetchall() or []

                    first_row = vid_rows[0] if vid_rows else (user_lib_rows[0] if user_lib_rows else {})
                    canonical_name = (
                        first_row.get("course_name") or
                        extract_course_name(first_row.get("title", "")) or
                        clean_name
                    )

                    user_map = {r["video_id"]: r for r in user_lib_rows}
                    seen_vids = set()
                    lectures = []

                    # General lectures first, enriched by user library if present
                    for r in vid_rows:
                        vid = r["video_id"]
                        if vid in seen_vids:
                            continue
                        seen_vids.add(vid)
                        u_data = user_map.get(vid)
                        lectures.append({
                            "videoId": vid,
                            "video_id": vid,
                            "title": r["title"],
                            "video_title": r["title"],
                            "duration": r.get("duration") or "Unknown",
                            "sourceUrl": r.get("source_url") or f"https://vimeo.com/{vid}",
                            "video_url": r.get("source_url") or f"https://vimeo.com/{vid}",
                            "driveFolderUrl": u_data.get("drive_folder_url") if u_data else None,
                            "drive_folder_url": u_data.get("drive_folder_url") if u_data else None,
                            "lastViewedAt": str(u_data["last_viewed_at"]) if u_data and u_data.get("last_viewed_at") else str(r["created_at"]) if r.get("created_at") else None,
                            "last_viewed_at": str(u_data["last_viewed_at"]) if u_data and u_data.get("last_viewed_at") else str(r["created_at"]) if r.get("created_at") else None,
                            "created_at": str(r["created_at"]) if r.get("created_at") else None,
                            "course_name": r.get("course_name") or canonical_name
                        })

                    # Any user library lectures not in lecturescribe_videos
                    for u in user_lib_rows:
                        vid = u["video_id"]
                        if vid in seen_vids:
                            continue
                        seen_vids.add(vid)
                        lectures.append({
                            "videoId": vid,
                            "video_id": vid,
                            "title": u["title"],
                            "video_title": u["title"],
                            "duration": u.get("duration") or "Unknown",
                            "sourceUrl": u.get("source_url") or f"https://vimeo.com/{vid}",
                            "video_url": u.get("source_url") or f"https://vimeo.com/{vid}",
                            "driveFolderUrl": u.get("drive_folder_url"),
                            "drive_folder_url": u.get("drive_folder_url"),
                            "lastViewedAt": str(u["last_viewed_at"]) if u.get("last_viewed_at") else None,
                            "last_viewed_at": str(u["last_viewed_at"]) if u.get("last_viewed_at") else None,
                            "created_at": str(u["last_viewed_at"]) if u.get("last_viewed_at") else None,
                            "course_name": u.get("course_name") or canonical_name
                        })

                    try:
                        v_ids = [l["video_id"] for l in lectures if l.get("video_id")]
                        prog_map = self.get_user_progress_map(user_email=user_email, video_ids=v_ids)
                        for l in lectures:
                            l["progress"] = prog_map.get(l.get("video_id"))
                    except Exception:
                        pass

                    return {
                        "course_name": canonical_name,
                        "course_slug": to_course_slug(canonical_name),
                        "lecture_count": len(lectures),
                        "latest_viewed_at": lectures[0]["last_viewed_at"] if lectures else None,
                        "thumbnail_video_id": lectures[0]["video_id"] if lectures else None,
                        "lectures": lectures
                    }
        except Exception:
            pass
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

        # In-memory cache fallback (used when DB is down or in mock test mode)
        mem_lectures = []
        for vid_id, v in self._memory_cache.items():
            c_name = v.get("course_name") or extract_course_name(v.get("title", ""))
            c_slug = re.sub(r'[^a-z0-9]+', '-', c_name.lower()).strip('-')
            if (clean_lower in (c_name.lower(), c_slug)
                or slug_as_space.lower() == c_name.lower()
                or clean_lower in c_name.lower()
                or slug_as_space.lower() in c_name.lower()
                or clean_lower in v.get("title", "").lower()):
                mem_lectures.append({
                    "videoId": vid_id,
                    "video_id": vid_id,
                    "title": v.get("title", f"Video {vid_id}"),
                    "video_title": v.get("title", f"Video {vid_id}"),
                    "duration": v.get("duration", "Unknown"),
                    "sourceUrl": v.get("sourceUrl", f"https://vimeo.com/{vid_id}"),
                    "video_url": v.get("sourceUrl", f"https://vimeo.com/{vid_id}"),
                    "driveFolderUrl": None,
                    "drive_folder_url": None,
                    "lastViewedAt": None,
                    "last_viewed_at": None,
                    "created_at": None,
                    "course_name": c_name
                })
        if mem_lectures:
            c_title = self.resolve_course_canonical_name(mem_lectures[0].get("course_name") or clean_name)
            for m in mem_lectures:
                m["course_name"] = c_title
                m["course_slug"] = to_course_slug(c_title)
            return {
                "course_name": c_title,
                "course_slug": to_course_slug(c_title),
                "lecture_count": len(mem_lectures),
                "latest_viewed_at": None,
                "thumbnail_video_id": mem_lectures[0]["video_id"],
                "lectures": mem_lectures
            }
        return None

    def get_user_library(self, user_email: str) -> List[Dict[str, Any]]:
        """Retrieve all lectures saved in the user's LMS library from PostgreSQL."""
        if not user_email:
            return []

        clean_email = user_email.strip().lower()

        conn = self._get_connection()
        try:
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at, course_name
                        FROM lecturescribe_user_library
                        WHERE user_email = %s
                        ORDER BY last_viewed_at DESC;
                    """, (clean_email,))
                    rows = cursor.fetchall() or []
                    items = [
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
                            "course_name": r.get("course_name") or extract_course_name(r.get("title", "")),
                            "course_slug": to_course_slug(r.get("course_name") or extract_course_name(r.get("title", ""))),
                        }
                        for r in rows
                    ]
                    try:
                        v_ids = [it["video_id"] for it in items]
                        prog_map = self.get_user_progress_map(user_email=clean_email, video_ids=v_ids)
                        for it in items:
                            it["progress"] = prog_map.get(it["video_id"])
                    except Exception:
                        pass
                    return items
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

    def create_resource(
        self,
        course_name: str,
        user_email: str,
        title: str,
        filename: str,
        blob_name: str,
        file_type: str,
        file_size_bytes: int = 0,
        file_url: Optional[str] = None,
        video_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Insert a resource record into PostgreSQL and memory cache."""
        clean_email = (user_email or "").strip().lower()
        clean_course = (course_name or "General Lectures").strip()
        vid = str(video_id).strip() if video_id and str(video_id).strip() else None

        record = {
            "video_id": vid,
            "course_name": clean_course,
            "user_email": clean_email,
            "title": title.strip(),
            "filename": filename.strip(),
            "blob_name": blob_name,
            "file_type": file_type.lower(),
            "file_size_bytes": file_size_bytes,
            "file_url": file_url,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_resources 
                        (video_id, course_name, user_email, title, filename, blob_name, file_type, file_size_bytes, file_url)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id, created_at;
                    """, (vid, clean_course, clean_email, record["title"], record["filename"], blob_name, record["file_type"], file_size_bytes, file_url))
                    row = cursor.fetchone()
                    if row:
                        record["id"] = row["id"]
                        record["created_at"] = str(row["created_at"])
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Resources Warning] Could not save resource to DB: {e}")
            if "id" not in record:
                record["id"] = len(self._resources_memory_cache) + 1
        finally:
            if conn:
                conn.close()

        self._resources_memory_cache.append(record)
        return record

    def get_lecture_resources(self, video_id: str, course_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch all resources attached to a specific lecture and its course (e.g. PDFs, docs, syllabus)."""
        if not video_id:
            return []
        vid = str(video_id).strip()
        cname = (course_name or "").strip()
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if not cname:
                        # Auto-resolve course_name if not explicitly passed
                        try:
                            cursor.execute("""
                                SELECT course_name FROM lecturescribe_user_library 
                                WHERE video_id = %s AND course_name IS NOT NULL AND course_name != '' AND course_name != 'General Lectures'
                                LIMIT 1;
                            """, (vid,))
                            r_course = cursor.fetchone()
                            if r_course and r_course.get("course_name"):
                                cname = r_course["course_name"].strip()
                        except Exception:
                            pass
                    if not cname:
                        try:
                            cursor.execute("""
                                SELECT course_name FROM lecturescribe_resources 
                                WHERE video_id = %s AND course_name IS NOT NULL AND course_name != '' AND course_name != 'General Lectures'
                                LIMIT 1;
                            """, (vid,))
                            r_res = cursor.fetchone()
                            if r_res and r_res.get("course_name"):
                                cname = r_res["course_name"].strip()
                        except Exception:
                            pass

                    if cname and cname.lower() != "general lectures":
                        slug_as_space = cname.replace("-", " ")
                        slug_as_wildcard = cname.replace("-", "%")
                        cursor.execute("""
                            SELECT id, video_id, course_name, user_email, title, filename, blob_name, file_type, file_size_bytes, file_url, created_at
                            FROM lecturescribe_resources
                            WHERE video_id = %s 
                               OR (
                                   (course_name ILIKE %s 
                                    OR course_name ILIKE %s 
                                    OR course_name ILIKE %s 
                                    OR course_name ILIKE %s)
                                   AND (video_id IS NULL OR video_id = '' OR video_id = 'general' OR video_id = 'null')
                               )
                            ORDER BY created_at ASC;
                        """, (vid, cname, f"%{cname}%", slug_as_space, f"%{slug_as_wildcard}%"))
                    else:
                        cursor.execute("""
                            SELECT id, video_id, course_name, user_email, title, filename, blob_name, file_type, file_size_bytes, file_url, created_at
                            FROM lecturescribe_resources
                            WHERE video_id = %s
                            ORDER BY created_at ASC;
                        """, (vid,))

                    rows = cursor.fetchall() or []
                    results = []
                    seen_ids = set()
                    for r in rows:
                        if r["id"] in seen_ids:
                            continue
                        seen_ids.add(r["id"])
                        results.append({
                            "id": r["id"],
                            "video_id": r["video_id"],
                            "course_name": r["course_name"],
                            "user_email": r["user_email"],
                            "title": r["title"],
                            "filename": r["filename"],
                            "blob_name": r["blob_name"],
                            "file_type": r["file_type"],
                            "file_size_bytes": r["file_size_bytes"],
                            "file_url": r["file_url"],
                            "created_at": str(r["created_at"]) if r.get("created_at") else None
                        })
                    return results
        except Exception as e:
            print(f"[PostgreSQL Resources Warning] Could not fetch lecture resources: {e}")
            seen = set()
            res = []
            clean_l = cname.lower() if cname else ""
            if not clean_l:
                for r in self._resources_memory_cache:
                    if r.get("video_id") == vid and r.get("course_name") and r.get("course_name").lower() != "general lectures":
                        clean_l = r.get("course_name").lower()
                        break
            for r in self._resources_memory_cache:
                is_match = False
                if r.get("video_id") == vid:
                    is_match = True
                elif clean_l and clean_l != "general lectures":
                    rc = r.get("course_name", "").lower()
                    r_vid = str(r.get("video_id") or "").strip().lower()
                    is_course_level = (not r_vid) or r_vid in ("none", "null", "general")
                    if is_course_level and (clean_l in rc or rc.replace("-", " ") == clean_l.replace("-", " ")):
                        is_match = True
                if is_match and r.get("id") not in seen:
                    seen.add(r.get("id"))
                    res.append(r)
            return res
        finally:
            if conn:
                conn.close()

    def get_course_resources(self, course_name: str) -> List[Dict[str, Any]]:
        """Fetch all resources attached to a course (across all lectures + general)."""
        if not course_name:
            return []
        clean = course_name.strip()
        slug_as_space = clean.replace("-", " ")
        slug_as_wildcard = clean.replace("-", "%")
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, video_id, course_name, user_email, title, filename, blob_name, file_type, file_size_bytes, file_url, created_at
                        FROM lecturescribe_resources
                        WHERE course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s OR course_name ILIKE %s
                        ORDER BY created_at ASC;
                    """, (clean, f"%{clean}%", slug_as_space, f"%{slug_as_wildcard}%"))
                    rows = cursor.fetchall() or []
                    results = []
                    for r in rows:
                        results.append({
                            "id": r["id"],
                            "video_id": r["video_id"],
                            "course_name": r["course_name"],
                            "user_email": r["user_email"],
                            "title": r["title"],
                            "filename": r["filename"],
                            "blob_name": r["blob_name"],
                            "file_type": r["file_type"],
                            "file_size_bytes": r["file_size_bytes"],
                            "file_url": r["file_url"],
                            "created_at": str(r["created_at"]) if r.get("created_at") else None
                        })
                    return results
        except Exception as e:
            print(f"[PostgreSQL Resources Warning] Could not fetch course resources: {e}")
            clean_l = clean.lower()
            return [
                r for r in self._resources_memory_cache
                if clean_l in r.get("course_name", "").lower() or r.get("course_name", "").lower().replace("-", " ") == slug_as_space.lower()
            ]
        finally:
            if conn:
                conn.close()

    def delete_resource(self, resource_id: int, user_email: str) -> Optional[Dict[str, Any]]:
        """Delete a resource by ID if owned by user_email."""
        clean_email = (user_email or "").strip().lower()
        conn = None
        target = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, blob_name, user_email FROM lecturescribe_resources
                        WHERE id = %s;
                    """, (resource_id,))
                    row = cursor.fetchone()
                    if not row:
                        return None
                    if clean_email and row["user_email"].strip().lower() != clean_email:
                        raise PermissionError("You can only delete resources you uploaded.")
                    
                    target = dict(row)
                    cursor.execute("DELETE FROM lecturescribe_resources WHERE id = %s;", (resource_id,))
                    conn.commit()
        except PermissionError:
            raise
        except Exception as e:
            print(f"[PostgreSQL Resources Warning] Could not delete resource from DB: {e}")
            for idx, r in enumerate(self._resources_memory_cache):
                if r.get("id") == resource_id:
                    if clean_email and r.get("user_email", "").lower() != clean_email:
                        raise PermissionError("You can only delete resources you uploaded.")
                    target = r
                    self._resources_memory_cache.pop(idx)
                    break
        finally:
            if conn:
                conn.close()

        if target:
            self._resources_memory_cache = [r for r in self._resources_memory_cache if r.get("id") != resource_id]
        return target

    def get_course_readings(self, course_name: str) -> List[Dict[str, Any]]:
        """Retrieve all extracted and curated readings for a course by name or slug."""
        clean_course = (course_name or "General Lectures").strip()
        slug_norm = to_course_slug(clean_course)
        slug_as_space = clean_course.replace("-", " ")

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, course_name, title, author, edition, reading_type,
                               category, cover_url, preview_url, embed_url, reader_type, isbn, source_type,
                               source_context, web_links, is_lending, created_at
                        FROM lecturescribe_course_readings
                        WHERE LOWER(course_name) = LOWER(%s)
                           OR LOWER(course_name) = LOWER(%s)
                           OR regexp_replace(LOWER(course_name), '[^a-z0-9]+', '-', 'g') = %s
                        ORDER BY id ASC;
                    """, (clean_course, slug_as_space, slug_norm))
                    rows = cursor.fetchall()
                    results = []
                    for r in rows:
                        item = dict(r)
                        if isinstance(item.get("created_at"), (datetime.date, datetime.datetime)):
                            item["created_at"] = item["created_at"].isoformat()
                        results.append(item)
                    return results
            except Exception as e:
                print(f"[PostgreSQL Notice] get_course_readings fallback: {e}")
            finally:
                if conn:
                    conn.close()

        # Memory fallback
        return [
            r for r in self._readings_memory_cache
            if r.get("course_name", "").lower() == clean_course.lower()
            or r.get("course_name", "").lower() == slug_as_space.lower()
            or to_course_slug(r.get("course_name", "")) == slug_norm
        ]

    def save_course_reading(self, course_name: str, reading: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a course reading item."""
        clean_course = (course_name or "General Lectures").strip()
        title = (reading.get("title") or "").strip()
        author = (reading.get("author") or "").strip()
        edition = (reading.get("edition") or "").strip()
        reading_type = (reading.get("reading_type") or "book").strip()
        category = (reading.get("category") or "recommended").strip()
        cover_url = (reading.get("cover_url") or "").strip()
        preview_url = (reading.get("preview_url") or "").strip()
        embed_url = (reading.get("embed_url") or "").strip()
        reader_type = (reading.get("reader_type") or "embed").strip()
        isbn = (reading.get("isbn") or "").strip()
        source_type = (reading.get("source_type") or "manual").strip()
        source_context = (reading.get("source_context") or "").strip()
        web_links = reading.get("web_links") or []
        is_lending = bool(reading.get("is_lending", False))

        item = {
            "course_name": clean_course,
            "title": title,
            "author": author,
            "edition": edition,
            "reading_type": reading_type,
            "category": category,
            "cover_url": cover_url,
            "preview_url": preview_url,
            "embed_url": embed_url,
            "reader_type": reader_type,
            "isbn": isbn,
            "source_type": source_type,
            "source_context": source_context,
            "web_links": web_links,
            "is_lending": is_lending,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            INSERT INTO lecturescribe_course_readings (
                                course_name, title, author, edition, reading_type,
                                category, cover_url, preview_url, embed_url, reader_type, isbn, source_type,
                                source_context, web_links, is_lending
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                            RETURNING id, created_at;
                        """, (
                            clean_course, title, author, edition, reading_type,
                            category, cover_url, preview_url, embed_url, reader_type, isbn, source_type,
                            source_context, json.dumps(web_links), is_lending
                        ))
                        row = cursor.fetchone()
                        if row:
                            item["id"] = row["id"]
                            if isinstance(row["created_at"], (datetime.date, datetime.datetime)):
                                item["created_at"] = row["created_at"].isoformat()
                        conn.commit()
                        return item
            except Exception as e:
                print(f"[PostgreSQL Notice] save_course_reading fallback: {e}")
            finally:
                if conn:
                    conn.close()

        # Memory fallback
        item["id"] = int(time.time() * 1000) % 10000000
        self._readings_memory_cache.append(item)
        return item

    def update_course_reading_embed(
        self,
        reading_id: int,
        embed_url: str,
        reader_type: str = "embed",
        cover_url: str = "",
        preview_url: str = "",
        is_lending: Optional[bool] = None
    ) -> bool:
        """Update reader embed URL, cover, and lending status for an existing reading item."""
        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        updates = ["embed_url = %s", "reader_type = %s"]
                        params = [embed_url, reader_type]
                        if cover_url:
                            updates.append("cover_url = %s")
                            params.append(cover_url)
                        if preview_url:
                            updates.append("preview_url = %s")
                            params.append(preview_url)
                        if is_lending is not None:
                            updates.append("is_lending = %s")
                            params.append(is_lending)
                        params.append(reading_id)
                        cursor.execute(f"""
                            UPDATE lecturescribe_course_readings
                            SET {', '.join(updates)}
                            WHERE id = %s;
                        """, tuple(params))
                        conn.commit()
                return True
            except Exception as e:
                print(f"[PostgreSQL Notice] update_course_reading_embed error: {e}")
            finally:
                if conn:
                    conn.close()
        for r in self._readings_memory_cache:
            if r.get("id") == reading_id:
                r["embed_url"] = embed_url
                r["reader_type"] = reader_type
                if cover_url:
                    r["cover_url"] = cover_url
                if preview_url:
                    r["preview_url"] = preview_url
                if is_lending is not None:
                    r["is_lending"] = is_lending
                return True
        return False

    def delete_course_reading(self, reading_id: int) -> bool:
        """Delete a reading item by ID."""
        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            DELETE FROM lecturescribe_course_readings
                            WHERE id = %s;
                        """, (reading_id,))
                        conn.commit()
                return True
            except Exception as e:
                print(f"[PostgreSQL Notice] delete_course_reading fallback: {e}")
            finally:
                if conn:
                    conn.close()

        self._readings_memory_cache = [r for r in self._readings_memory_cache if r.get("id") != reading_id]
        return True

    def clear_course_readings(self, course_name: str) -> bool:
        """Clear all readings for a course by name or slug."""
        clean_course = (course_name or "General Lectures").strip()
        slug_norm = to_course_slug(clean_course)
        slug_as_space = clean_course.replace("-", " ")

        conn = None
        if HAS_PSYCOPG2 and self.postgres_url:
            try:
                conn = self._get_connection()
                with conn:
                    with conn.cursor() as cursor:
                        cursor.execute("""
                            DELETE FROM lecturescribe_course_readings
                            WHERE LOWER(course_name) = LOWER(%s)
                               OR LOWER(course_name) = LOWER(%s)
                               OR regexp_replace(LOWER(course_name), '[^a-z0-9]+', '-', 'g') = %s;
                        """, (clean_course, slug_as_space, slug_norm))
                        conn.commit()
                return True
            except Exception as e:
                print(f"[PostgreSQL Notice] clear_course_readings fallback: {e}")
            finally:
                if conn:
                    conn.close()

        self._readings_memory_cache = [
            r for r in self._readings_memory_cache
            if r.get("course_name", "").lower() != clean_course.lower()
            and r.get("course_name", "").lower() != slug_as_space.lower()
            and to_course_slug(r.get("course_name", "")) != slug_norm
        ]
    def update_transcript_cue(self, video_id: str, cue_id: int, new_text: str) -> Optional[Dict[str, Any]]:
        """Update a single transcript cue, mark summaries outdated, and evict memory cache."""
        cleaned_text = (new_text or "").strip()
        conn = None
        updated_cue = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE lecturescribe_transcript_cues
                        SET text = %s
                        WHERE id = %s AND video_id = %s
                        RETURNING id, timestamp, seconds, text;
                    """, (cleaned_text, cue_id, video_id))
                    row = cursor.fetchone()
                    if row:
                        updated_cue = {
                            "id": row["id"],
                            "time": row["timestamp"],
                            "seconds": row["seconds"],
                            "text": row["text"]
                        }
                        # Mark all summaries for this video as outdated
                        cursor.execute("""
                            UPDATE lecturescribe_summaries
                            SET is_outdated = TRUE
                            WHERE video_id = %s;
                        """, (video_id,))
                        cursor.execute("""
                            UPDATE lecturescribe_lecture_summaries
                            SET is_outdated = TRUE
                            WHERE video_id = %s;
                        """, (video_id,))
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Notice] update_transcript_cue error: {e}")
        finally:
            if conn:
                conn.close()

        # Invalidate memory cache
        if video_id in self._memory_cache:
            self._memory_cache.pop(video_id, None)

        return updated_cue

    def mark_summary_outdated(self, video_id: str) -> None:
        """Mark all summaries for a video as outdated."""
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE lecturescribe_summaries SET is_outdated = TRUE WHERE video_id = %s;", (video_id,))
                    cursor.execute("UPDATE lecturescribe_lecture_summaries SET is_outdated = TRUE WHERE video_id = %s;", (video_id,))
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Notice] mark_summary_outdated error: {e}")
        finally:
            if conn:
                conn.close()

    def _format_annotation_dict(
        self,
        ann_id: str,
        video_id: str,
        user_email: str,
        cue_id: Optional[int],
        start_seconds: float,
        end_seconds: float,
        selected_text: str,
        annotation_type: str,
        color: Optional[str] = None,
        note_text: Optional[str] = None,
        ai_prompt: Optional[str] = None,
        ai_response: Optional[str] = None,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None
    ) -> Dict[str, Any]:
        """Produce consistent annotation dictionary with both camelCase and snake_case properties."""
        return {
            "id": str(ann_id),
            "videoId": video_id,
            "userEmail": user_email,
            "cueId": cue_id,
            "startSeconds": float(start_seconds),
            "endSeconds": float(end_seconds),
            "selectedText": selected_text,
            "annotationType": annotation_type,
            "color": color,
            "noteText": note_text,
            "aiPrompt": ai_prompt,
            "aiResponse": ai_response,
            "createdAt": created_at,
            "updatedAt": updated_at,
            # snake_case properties for full API parity
            "video_id": video_id,
            "user_email": user_email,
            "cue_id": cue_id,
            "start_seconds": float(start_seconds),
            "end_seconds": float(end_seconds),
            "selected_text": selected_text,
            "annotation_type": annotation_type,
            "note_text": note_text,
            "ai_prompt": ai_prompt,
            "ai_response": ai_response,
            "created_at": created_at,
            "updated_at": updated_at
        }

    def add_annotation(
        self,
        video_id: str,
        user_email: str,
        selected_text: str,
        annotation_type: str,
        cue_id: Optional[Union[int, str]] = None,
        start_seconds: float = 0.0,
        end_seconds: float = 0.0,
        color: Optional[str] = None,
        note_text: Optional[str] = None,
        ai_prompt: Optional[str] = None,
        ai_response: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Save a new highlight, margin note, or embedded AI explanation."""
        clean_email = (user_email or "anonymous").strip().lower()
        clean_type = annotation_type.strip().lower() if annotation_type else "highlight"
        clean_cue_id = None
        if cue_id is not None:
            try:
                clean_cue_id = int(cue_id)
            except (ValueError, TypeError):
                clean_cue_id = None

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    # Ensure video exists in lecturescribe_videos to satisfy foreign key
                    cursor.execute("SELECT video_id FROM lecturescribe_videos WHERE video_id = %s;", (video_id,))
                    if not cursor.fetchone():
                        cursor.execute("""
                            INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (video_id) DO NOTHING;
                        """, (video_id, f"Lecture {video_id}", "", f"https://vimeo.com/{video_id}", "Caption track"))

                    # Ensure cue_id exists in lecturescribe_transcript_cues to satisfy foreign key
                    if clean_cue_id is not None:
                        cursor.execute("SELECT id FROM lecturescribe_transcript_cues WHERE id = %s;", (clean_cue_id,))
                        if not cursor.fetchone():
                            if clean_cue_id >= 0:
                                cursor.execute("SELECT id FROM lecturescribe_transcript_cues WHERE video_id = %s ORDER BY id ASC OFFSET %s LIMIT 1;", (video_id, clean_cue_id))
                                row = cursor.fetchone()
                                if row:
                                    clean_cue_id = row["id"]
                                else:
                                    clean_cue_id = None
                            else:
                                clean_cue_id = None

                    cursor.execute("""
                        INSERT INTO lecturescribe_transcript_annotations (
                            video_id, user_email, cue_id, start_seconds, end_seconds,
                            selected_text, annotation_type, color, note_text,
                            ai_prompt, ai_response, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        RETURNING id, video_id, user_email, cue_id, start_seconds, end_seconds,
                                  selected_text, annotation_type, color, note_text,
                                  ai_prompt, ai_response, created_at, updated_at;
                    """, (
                        video_id, clean_email, clean_cue_id, float(start_seconds), float(end_seconds),
                        selected_text, clean_type, color, note_text,
                        ai_prompt, ai_response
                    ))
                    row = cursor.fetchone()
                    conn.commit()
                    if row:
                        return self._format_annotation_dict(
                            ann_id=str(row["id"]),
                            video_id=row["video_id"],
                            user_email=row["user_email"],
                            cue_id=row["cue_id"],
                            start_seconds=row["start_seconds"],
                            end_seconds=row["end_seconds"],
                            selected_text=row["selected_text"],
                            annotation_type=row["annotation_type"],
                            color=row.get("color"),
                            note_text=row.get("note_text"),
                            ai_prompt=row.get("ai_prompt"),
                            ai_response=row.get("ai_response"),
                            created_at=row["created_at"].isoformat() if row.get("created_at") else now_iso,
                            updated_at=row["updated_at"].isoformat() if row.get("updated_at") else now_iso
                        )
        except Exception as e:
            print(f"[PostgreSQL Notice] add_annotation error: {e}")
        finally:
            if conn:
                conn.close()

        # In-memory fallback
        fallback_ann = self._format_annotation_dict(
            ann_id=str(uuid.uuid4()),
            video_id=video_id,
            user_email=clean_email,
            cue_id=clean_cue_id,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            selected_text=selected_text,
            annotation_type=clean_type,
            color=color,
            note_text=note_text,
            ai_prompt=ai_prompt,
            ai_response=ai_response,
            created_at=now_iso,
            updated_at=now_iso
        )
        self._annotations_memory_cache.append(fallback_ann)
        return fallback_ann

    def get_annotations(self, video_id: str, user_email: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve user annotations for a video."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = None
        annotations = []
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            SELECT id, video_id, user_email, cue_id, start_seconds, end_seconds,
                                   selected_text, annotation_type, color, note_text,
                                   ai_prompt, ai_response, created_at, updated_at
                            FROM lecturescribe_transcript_annotations
                            WHERE video_id = %s AND user_email = %s
                            ORDER BY start_seconds ASC, created_at ASC;
                        """, (video_id, clean_email))
                    else:
                        cursor.execute("""
                            SELECT id, video_id, user_email, cue_id, start_seconds, end_seconds,
                                   selected_text, annotation_type, color, note_text,
                                   ai_prompt, ai_response, created_at, updated_at
                            FROM lecturescribe_transcript_annotations
                            WHERE video_id = %s
                            ORDER BY start_seconds ASC, created_at ASC;
                        """, (video_id,))
                    rows = cursor.fetchall() or []
                    for row in rows:
                        annotations.append(self._format_annotation_dict(
                            ann_id=str(row["id"]),
                            video_id=row["video_id"],
                            user_email=row["user_email"],
                            cue_id=row["cue_id"],
                            start_seconds=row["start_seconds"],
                            end_seconds=row["end_seconds"],
                            selected_text=row["selected_text"],
                            annotation_type=row["annotation_type"],
                            color=row.get("color"),
                            note_text=row.get("note_text"),
                            ai_prompt=row.get("ai_prompt"),
                            ai_response=row.get("ai_response"),
                            created_at=row["created_at"].isoformat() if row.get("created_at") else None,
                            updated_at=row["updated_at"].isoformat() if row.get("updated_at") else None
                        ))
                    return annotations
        except Exception as e:
            print(f"[PostgreSQL Notice] get_annotations error: {e}")
        finally:
            if conn:
                conn.close()

        # Fallback to memory cache
        filtered = [
            a for a in self._annotations_memory_cache
            if a.get("videoId") == video_id or a.get("video_id") == video_id
        ]
        if clean_email:
            filtered = [
                a for a in filtered
                if (a.get("userEmail") or a.get("user_email") or "").lower() == clean_email
            ]
        return filtered

    def delete_annotation(self, annotation_id: str, user_email: Optional[str] = None) -> bool:
        """Delete an annotation by ID."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None
        conn = None
        db_deleted = False
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if clean_email:
                        cursor.execute("""
                            DELETE FROM lecturescribe_transcript_annotations
                            WHERE id = %s AND user_email = %s;
                        """, (annotation_id, clean_email))
                    else:
                        cursor.execute("""
                            DELETE FROM lecturescribe_transcript_annotations
                            WHERE id = %s;
                        """, (annotation_id,))
                    conn.commit()
                    db_deleted = cursor.rowcount > 0
        except Exception as e:
            print(f"[PostgreSQL Notice] delete_annotation error: {e}")
        finally:
            if conn:
                conn.close()

        mem_before = len(self._annotations_memory_cache)
        self._annotations_memory_cache = [
            a for a in self._annotations_memory_cache
            if str(a.get("id")) != str(annotation_id)
        ]
        mem_deleted = len(self._annotations_memory_cache) < mem_before
        return db_deleted or mem_deleted

    def create_review_job(self, video_id: str, review_mode: str = "audio_grounded") -> str:
        """Create a new transcript review job and return its UUID."""
        job_id = str(uuid.uuid4())
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lecturescribe_transcript_reviews (id, video_id, review_mode, status, created_at, updated_at)
                        VALUES (%s, %s, %s, 'processing', NOW(), NOW());
                    """, (job_id, video_id, review_mode))
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Notice] create_review_job error: {e}")
        finally:
            if conn:
                conn.close()
        return job_id

    def get_review_job(self, job_id: Optional[str] = None, video_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get review job details."""
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if job_id:
                        cursor.execute("""
                            SELECT id, video_id, review_mode, status, error_message, created_at, updated_at
                            FROM lecturescribe_transcript_reviews
                            WHERE id = %s;
                        """, (job_id,))
                    elif video_id:
                        cursor.execute("""
                            SELECT id, video_id, review_mode, status, error_message, created_at, updated_at
                            FROM lecturescribe_transcript_reviews
                            WHERE video_id = %s
                            ORDER BY created_at DESC LIMIT 1;
                        """, (video_id,))
                    else:
                        return None
                    row = cursor.fetchone()
                    if row:
                        return {
                            "id": str(row["id"]),
                            "videoId": row["video_id"],
                            "reviewMode": row["review_mode"],
                            "status": row["status"],
                            "errorMessage": row.get("error_message"),
                            "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
                            "updatedAt": row["updated_at"].isoformat() if row.get("updated_at") else None
                        }
        except Exception as e:
            print(f"[PostgreSQL Notice] get_review_job error: {e}")
        finally:
            if conn:
                conn.close()
        return None

    def update_review_job(self, job_id: str, status: str, error_message: Optional[str] = None) -> bool:
        """Update review job status."""
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE lecturescribe_transcript_reviews
                        SET status = %s, error_message = %s, updated_at = NOW()
                        WHERE id = %s;
                    """, (status, error_message, job_id))
                    conn.commit()
                    return cursor.rowcount > 0
        except Exception as e:
            print(f"[PostgreSQL Notice] update_review_job error: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def save_review_suggestions(self, review_id: str, video_id: str, suggestions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Batch save review suggestion candidates."""
        conn = None
        saved = []
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    for s in suggestions:
                        s_id = str(uuid.uuid4())
                        cue_id = s.get("cue_id")
                        cursor.execute("""
                            INSERT INTO lecturescribe_transcript_suggestions (
                                id, review_id, video_id, cue_id, start_seconds, end_seconds,
                                original_text, suggested_text, suggestion_type, confidence,
                                reason, status, created_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', NOW())
                            RETURNING id, review_id, video_id, cue_id, start_seconds, end_seconds,
                                      original_text, suggested_text, suggestion_type, confidence,
                                      reason, status, created_at;
                        """, (
                            s_id, review_id, video_id, cue_id,
                            float(s.get("start_seconds", 0.0)), float(s.get("end_seconds", 0.0)),
                            s.get("original_text", ""), s.get("suggested_text", ""),
                            s.get("suggestion_type", "correction"), s.get("confidence", "medium"),
                            s.get("reason", "")
                        ))
                        row = cursor.fetchone()
                        if row:
                            saved.append({
                                "id": str(row["id"]),
                                "reviewId": str(row["review_id"]),
                                "videoId": row["video_id"],
                                "cueId": row["cue_id"],
                                "startSeconds": float(row["start_seconds"]),
                                "endSeconds": float(row["end_seconds"]),
                                "originalText": row["original_text"],
                                "suggestedText": row["suggested_text"],
                                "suggestionType": row["suggestion_type"],
                                "confidence": row["confidence"],
                                "reason": row.get("reason"),
                                "status": row["status"],
                                "createdAt": row["created_at"].isoformat() if row.get("created_at") else None
                            })
                    conn.commit()
        except Exception as e:
            print(f"[PostgreSQL Notice] save_review_suggestions error: {e}")
        finally:
            if conn:
                conn.close()
        return saved

    def get_review_suggestions(self, video_id: str, review_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve candidate review suggestions."""
        conn = None
        results = []
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    if review_id:
                        cursor.execute("""
                            SELECT id, review_id, video_id, cue_id, start_seconds, end_seconds,
                                   original_text, suggested_text, suggestion_type, confidence,
                                   reason, status, applied_at, created_at
                            FROM lecturescribe_transcript_suggestions
                            WHERE video_id = %s AND review_id = %s
                            ORDER BY start_seconds ASC, created_at ASC;
                        """, (video_id, review_id))
                    else:
                        cursor.execute("""
                            SELECT id, review_id, video_id, cue_id, start_seconds, end_seconds,
                                   original_text, suggested_text, suggestion_type, confidence,
                                   reason, status, applied_at, created_at
                            FROM lecturescribe_transcript_suggestions
                            WHERE video_id = %s
                            ORDER BY start_seconds ASC, created_at ASC;
                        """, (video_id,))
                    rows = cursor.fetchall() or []
                    for row in rows:
                        results.append({
                            "id": str(row["id"]),
                            "reviewId": str(row["review_id"]),
                            "videoId": row["video_id"],
                            "cueId": row["cue_id"],
                            "startSeconds": float(row["start_seconds"]),
                            "endSeconds": float(row["end_seconds"]),
                            "originalText": row["original_text"],
                            "suggestedText": row["suggested_text"],
                            "suggestionType": row["suggestion_type"],
                            "confidence": row["confidence"],
                            "reason": row.get("reason"),
                            "status": row["status"],
                            "appliedAt": row["applied_at"].isoformat() if row.get("applied_at") else None,
                            "createdAt": row["created_at"].isoformat() if row.get("created_at") else None
                        })
        except Exception as e:
            print(f"[PostgreSQL Notice] get_review_suggestions error: {e}")
        finally:
            if conn:
                conn.close()
        return results

    def update_suggestion_status(self, suggestion_id: str, status: str) -> Optional[Dict[str, Any]]:
        """Update suggestion status ('accepted', 'rejected', 'pending')."""
        conn = None
        try:
            conn = self._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    applied_clause = "NOW()" if status == "accepted" else "NULL"
                    cursor.execute(f"""
                        UPDATE lecturescribe_transcript_suggestions
                        SET status = %s, applied_at = {applied_clause}
                        WHERE id = %s
                        RETURNING id, review_id, video_id, cue_id, start_seconds, end_seconds,
                                  original_text, suggested_text, suggestion_type, confidence,
                                  reason, status, applied_at;
                    """, (status, suggestion_id))
                    row = cursor.fetchone()
                    conn.commit()
                    if row:
                        return {
                            "id": str(row["id"]),
                            "reviewId": str(row["review_id"]),
                            "videoId": row["video_id"],
                            "cueId": row["cue_id"],
                            "startSeconds": float(row["start_seconds"]),
                            "endSeconds": float(row["end_seconds"]),
                            "originalText": row["original_text"],
                            "suggestedText": row["suggested_text"],
                            "suggestionType": row["suggestion_type"],
                            "confidence": row["confidence"],
                            "reason": row.get("reason"),
                            "status": row["status"],
                            "appliedAt": row["applied_at"].isoformat() if row.get("applied_at") else None
                        }
        except Exception as e:
            print(f"[PostgreSQL Notice] update_suggestion_status error: {e}")
        finally:
            if conn:
                conn.close()
        return None

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
