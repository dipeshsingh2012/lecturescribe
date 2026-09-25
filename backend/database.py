"""
Unified Relational Database Manager for LectureScribe (PostgreSQL + SQLite)
--------------------------------------------------------------------------
Dual-Layer Architecture:
1. SQLite (Local First): Built-in zero-dependency persistence via 'lecturescribe.db'.
   Always active, instantaneous, survives network outages, and serves as primary/fallback cache.
2. PostgreSQL (Remote Cloud): Neon DB connection when configured via DATABASE_URL and psycopg2 is installed.
3. In-Memory L1 Cache: 0ms lookups for active video transcripts and summaries.

Guarantees: If a video has been transcribed and summarized once, it will NEVER be
re-generated from Vimeo on repeated requests.
"""
from __future__ import annotations

import os
import json
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional

# Safe environment loading without crashing if python-dotenv is missing
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
SQLITE_DB_PATH = Path(__file__).parent.parent / "lecturescribe.db"

# Optional psycopg2 import
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


class RelationalDBManager:
    """Unified Database Manager handling SQLite (local) + PostgreSQL (cloud) with In-Memory Cache."""

    def __init__(self, postgres_url: Optional[str] = None, sqlite_path: Optional[Path] = None):
        self.postgres_url = postgres_url or POSTGRES_URL
        self.sqlite_path = sqlite_path or SQLITE_DB_PATH
        self.use_postgres = False
        self._memory_cache: Dict[str, Dict[str, Any]] = {}

        # 1. Initialize SQLite (Always available and zero-dependency)
        self._init_sqlite_schema()

        # 2. Attempt remote Cloud PostgreSQL if credentials exist
        if HAS_PSYCOPG2 and self.postgres_url:
            self._init_postgres_schema()

        # 3. Seed default sample data if DB is empty
        self._seed_sample_data_if_needed()

    def _get_sqlite_connection(self):
        conn = sqlite3.connect(str(self.sqlite_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _get_postgres_connection(self):
        if not HAS_PSYCOPG2 or not self.postgres_url:
            return None
        return psycopg2.connect(self.postgres_url, cursor_factory=RealDictCursor)

    def _init_sqlite_schema(self):
        """Initialize local SQLite schema in lecturescribe.db."""
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lecturescribe_videos (
                        video_id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        duration TEXT,
                        source_url TEXT,
                        caption_label TEXT,
                        user_email TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lecturescribe_transcript_cues (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        video_id TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        seconds INTEGER NOT NULL,
                        text TEXT NOT NULL,
                        FOREIGN KEY(video_id) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE
                    );
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lecturescribe_summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        video_id TEXT NOT NULL,
                        sections_json TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(video_id) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE
                    );
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lecturescribe_chat_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        video_id TEXT NOT NULL,
                        user_prompt TEXT NOT NULL,
                        ai_reply TEXT NOT NULL,
                        citations_json TEXT,
                        user_email TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(video_id) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE
                    );
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lecturescribe_user_library (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_email TEXT NOT NULL,
                        video_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        duration TEXT,
                        source_url TEXT,
                        drive_folder_url TEXT,
                        last_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_email, video_id)
                    );
                """)

                # Migrations: Ensure user_email column exists on existing installations
                try:
                    cursor.execute("ALTER TABLE lecturescribe_videos ADD COLUMN user_email TEXT;")
                except Exception:
                    pass
                try:
                    cursor.execute("ALTER TABLE lecturescribe_chat_logs ADD COLUMN user_email TEXT;")
                except Exception:
                    pass

                cursor.execute("CREATE INDEX IF NOT EXISTS idx_cues_vid ON lecturescribe_transcript_cues(video_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sum_vid ON lecturescribe_summaries(video_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_vid ON lecturescribe_chat_logs(video_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_lib_email ON lecturescribe_user_library(user_email);")
                conn.commit()
                print(f"[SQLite DB] Initialized local schema at '{self.sqlite_path}'.")
        except Exception as e:
            print(f"[SQLite DB Error] Failed to initialize schema: {e}")

    def _init_postgres_schema(self):
        """Initialize remote Cloud PostgreSQL schema if reachable."""
        try:
            conn = self._get_postgres_connection()
            if not conn:
                return
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
                        END $$;

                        CREATE INDEX IF NOT EXISTS idx_pg_user_lib_email ON lecturescribe_user_library(user_email);
                    """)
                    conn.commit()
            conn.close()
            self.use_postgres = True
            print("[Cloud PostgreSQL] Connection verified and schema initialized on Cloud DB.")
        except Exception as e:
            self.use_postgres = False
            print(f"[Cloud PostgreSQL Notice] Postgres unavailable ({e}). Using local SQLite as database.")

    def _seed_sample_data_if_needed(self):
        """If video 1229247139 is not yet in the DB, populate it from sample files."""
        sample_video_id = "1229247139"
        if self.get_saved_video(sample_video_id):
            return

        sample_transcript_file = Path(__file__).parent.parent / "sample_transcript.md"
        if not sample_transcript_file.exists():
            return

        try:
            import re
            content = sample_transcript_file.read_text(encoding="utf-8")
            cues = []
            for line in content.splitlines():
                m = re.match(r"\*\*\[(.*?)\]\*\*\s*(.*)", line.strip())
                if m:
                    cues.append({"time": m.group(1), "text": m.group(2)})

            if not cues:
                return

            title = "Introduction to Research Live session -1 (22 / 9 / 2026)"
            duration = "1h 41m"
            source_url = f"https://vimeo.com/{sample_video_id}"
            caption_label = "English (auto-generated)"

            from backend.summary_generator import generate_summary_sections
            summary_sections = generate_summary_sections(cues, title)


            self.save_video_transcript(
                video_id=sample_video_id,
                title=title,
                duration=duration,
                source_url=source_url,
                caption_label=caption_label,
                cues=cues,
                summary_sections=summary_sections
            )
            print(f"[Seed] Successfully seeded video '{sample_video_id}' with {len(cues)} cues into database.")
        except Exception as e:
            print(f"[Seed Notice] Could not seed sample video data: {e}")

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
        """Save video, transcript cues, and AI summaries to SQLite and PostgreSQL (dual persistence)."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        # 1. Save to SQLite (Always persists locally)
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label, user_email)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(video_id) DO UPDATE SET
                        title = excluded.title,
                        duration = excluded.duration,
                        source_url = excluded.source_url,
                        caption_label = excluded.caption_label,
                        user_email = COALESCE(excluded.user_email, lecturescribe_videos.user_email);
                """, (video_id, title, duration, source_url, caption_label, clean_email))

                cursor.execute("DELETE FROM lecturescribe_transcript_cues WHERE video_id = ?;", (video_id,))
                cue_rows = [
                    (video_id, c.get("time", "00:00"), self._ts_to_secs(c.get("time", "00:00")), c.get("text", ""))
                    for c in cues
                ]
                if cue_rows:
                    cursor.executemany("""
                        INSERT INTO lecturescribe_transcript_cues (video_id, timestamp, seconds, text)
                        VALUES (?, ?, ?, ?)
                    """, cue_rows)

                cursor.execute("DELETE FROM lecturescribe_summaries WHERE video_id = ?;", (video_id,))
                cursor.execute("""
                    INSERT INTO lecturescribe_summaries (video_id, sections_json)
                    VALUES (?, ?);
                """, (video_id, json.dumps(summary_sections)))

                conn.commit()
                print(f"[SQLite DB] Cached video '{video_id}' with {len(cues)} cues and summary.")
        except Exception as e:
            print(f"[SQLite DB Error] Failed saving video: {e}")

        # 2. Save to Cloud PostgreSQL if enabled
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
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
                    conn.close()
                    print(f"[Cloud PostgreSQL] Saved video '{video_id}' to Cloud DB.")
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed saving video: {e}")

        # 3. If user_email is present, auto-record into their library
        if clean_email:
            self.record_user_lecture(
                user_email=clean_email,
                video_id=video_id,
                title=title,
                duration=duration,
                source_url=source_url
            )

        # 4. Update L1 In-Memory Cache
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
        """Update or replace summary sections in SQLite, PostgreSQL, and memory cache."""
        # 1. SQLite
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM lecturescribe_summaries WHERE video_id = ?;", (video_id,))
                cursor.execute("""
                    INSERT INTO lecturescribe_summaries (video_id, sections_json)
                    VALUES (?, ?);
                """, (video_id, json.dumps(summary_sections)))
                conn.commit()
                print(f"[SQLite DB] Updated dynamic summary for video '{video_id}'.")
        except Exception as e:
            print(f"[SQLite DB Error] Failed updating summary: {e}")

        # 2. PostgreSQL
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("DELETE FROM lecturescribe_summaries WHERE video_id = %s;", (video_id,))
                            cursor.execute("""
                                INSERT INTO lecturescribe_summaries (video_id, sections_json)
                                VALUES (%s, %s::jsonb);
                            """, (video_id, json.dumps(summary_sections)))
                            conn.commit()
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Notice] Could not update summary in Postgres: {e}")

        # 3. Memory cache
        if video_id in self._memory_cache:
            self._memory_cache[video_id]["summarySections"] = summary_sections

    def get_saved_video(self, video_id: str) -> Optional[Dict[str, Any]]:

        """Fetch video transcript from In-Memory Cache, SQLite, or PostgreSQL.
        Returns None only if never processed before."""
        # 1. Check L1 In-Memory Cache
        if video_id in self._memory_cache:
            return self._memory_cache[video_id]

        # 2. Check local SQLite DB
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM lecturescribe_videos WHERE video_id = ?;", (video_id,))
                v_row = cursor.fetchone()
                if v_row:
                    cursor.execute("""
                        SELECT timestamp as time, text 
                        FROM lecturescribe_transcript_cues 
                        WHERE video_id = ? 
                        ORDER BY id ASC;
                    """, (video_id,))
                    cues = [dict(r) for r in cursor.fetchall()]

                    cursor.execute("""
                        SELECT sections_json 
                        FROM lecturescribe_summaries 
                        WHERE video_id = ? 
                        ORDER BY id DESC LIMIT 1;
                    """, (video_id,))
                    s_row = cursor.fetchone()
                    summary_sections = []
                    if s_row and s_row["sections_json"]:
                        try:
                            summary_sections = json.loads(s_row["sections_json"])
                        except Exception:
                            summary_sections = []

                    # Auto-upgrade legacy hardcoded summaries to authentic dynamic summaries
                    s_str = json.dumps(summary_sections)
                    if (
                        not summary_sections
                        or "Session Introduction & Core Scope" in s_str
                        or "Course Structure & Evaluation Framework" in s_str
                        or ": Seen [" in s_str
                        or ": Question [" in s_str
                    ):
                        from backend.summary_generator import generate_summary_sections
                        summary_sections = generate_summary_sections(cues, v_row["title"])
                        self.update_summary_sections(video_id, summary_sections)

                    record = {
                        "videoId": v_row["video_id"],
                        "title": v_row["title"],
                        "duration": v_row["duration"],
                        "sourceUrl": v_row["source_url"],
                        "captionLabel": v_row["caption_label"],
                        "cues": cues,
                        "summarySections": summary_sections,
                        "cached": True
                    }
                    self._memory_cache[video_id] = record
                    return record
        except Exception as e:
            print(f"[SQLite DB Error] Failed fetching video: {e}")

        # 3. Check Cloud PostgreSQL if enabled
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("SELECT * FROM lecturescribe_videos WHERE video_id = %s;", (video_id,))
                            v_row = cursor.fetchone()
                            if v_row:
                                cursor.execute("""
                                    SELECT timestamp as time, text 
                                    FROM lecturescribe_transcript_cues 
                                    WHERE video_id = %s 
                                    ORDER BY id ASC;
                                """, (video_id,))
                                cues = cursor.fetchall()

                                cursor.execute("""
                                    SELECT sections_json 
                                    FROM lecturescribe_summaries 
                                    WHERE video_id = %s 
                                    ORDER BY id DESC LIMIT 1;
                                """, (video_id,))
                                summary_sections = s_row["sections_json"] if s_row and "sections_json" in s_row else []
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
                                # Backfill into local SQLite for offline speed
                                self.save_video_transcript(
                                    video_id, v_row["title"], v_row["duration"],
                                    v_row["sourceUrl"], v_row["caption_label"],
                                    record["cues"], summary_sections
                                )
                                self._memory_cache[video_id] = record
                                return record
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed fetching video: {e}")

        return None

    def save_chat_log(
        self,
        video_id: str,
        user_prompt: str,
        ai_reply: str,
        citations: List[Dict[str, Any]],
        user_email: Optional[str] = None
    ):
        """Save chat interaction to SQLite and PostgreSQL."""
        clean_email = user_email.strip().lower() if user_email and user_email.strip() else None

        # 1. SQLite
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO lecturescribe_chat_logs (video_id, user_prompt, ai_reply, citations_json, user_email)
                    VALUES (?, ?, ?, ?, ?);
                """, (video_id, user_prompt, ai_reply, json.dumps(citations), clean_email))
                conn.commit()
        except Exception as e:
            print(f"[SQLite DB Error] Failed saving chat log: {e}")

        # 2. PostgreSQL
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("""
                                INSERT INTO lecturescribe_chat_logs (video_id, user_prompt, ai_reply, citations_json, user_email)
                                VALUES (%s, %s, %s, %s::jsonb, %s);
                            """, (video_id, user_prompt, ai_reply, json.dumps(citations), clean_email))
                            conn.commit()
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed saving chat log: {e}")

    def _ts_to_secs(self, ts: str) -> int:
        parts = ts.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2].split(".")[0])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1].split(".")[0])
        return 0

    def record_user_lecture(
        self,
        user_email: str,
        video_id: str,
        title: str,
        duration: str = "",
        source_url: str = "",
        drive_folder_url: Optional[str] = None
    ) -> bool:
        """Upsert a lecture into the user's LMS library in SQLite and PostgreSQL."""
        if not user_email or not video_id:
            return False

        clean_email = user_email.strip().lower()

        # 1. SQLite
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, drive_folder_url, last_viewed_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_email, video_id) DO UPDATE SET
                        title = excluded.title,
                        duration = COALESCE(NULLIF(excluded.duration, ''), lecturescribe_user_library.duration),
                        source_url = COALESCE(NULLIF(excluded.source_url, ''), lecturescribe_user_library.source_url),
                        drive_folder_url = COALESCE(excluded.drive_folder_url, lecturescribe_user_library.drive_folder_url),
                        last_viewed_at = CURRENT_TIMESTAMP;
                """, (clean_email, video_id, title, duration, source_url, drive_folder_url))
                conn.commit()
        except Exception as e:
            print(f"[SQLite DB Error] Failed recording user lecture: {e}")

        # 2. PostgreSQL
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
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
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed recording user lecture: {e}")

        return True

    def auto_map_videos_to_user(self, user_email: str):
        """Maps all unassigned or existing database videos to the currently logged in user."""
        if not user_email:
            return
        clean_email = user_email.strip().lower()
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE lecturescribe_videos
                    SET user_email = ?
                    WHERE user_email IS NULL OR user_email = '';
                """, (clean_email,))
                cursor.execute("""
                    INSERT OR IGNORE INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, last_viewed_at)
                    SELECT ?, video_id, title, duration, source_url, created_at
                    FROM lecturescribe_videos;
                """, (clean_email,))
                conn.commit()
        except Exception as e:
            print(f"[Auto-Map SQLite Notice] {e}")

        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
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
                    conn.close()
            except Exception as e:
                print(f"[Auto-Map PostgreSQL Notice] {e}")

    def get_user_library(self, user_email: str) -> List[Dict[str, Any]]:
        """Retrieve all lectures saved in the user's LMS library."""
        if not user_email:
            return []

        clean_email = user_email.strip().lower()

        # Dynamically ensure existing database videos are mapped to the active user
        self.auto_map_videos_to_user(clean_email)

        # Try SQLite first
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at
                    FROM lecturescribe_user_library
                    WHERE user_email = ?
                    ORDER BY last_viewed_at DESC;
                """, (clean_email,))
                rows = cursor.fetchall()
                if rows:
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
        except Exception as e:
            print(f"[SQLite DB Error] Failed fetching user library: {e}")

        # Fallback to PostgreSQL
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("""
                                SELECT video_id, title, duration, source_url, drive_folder_url, last_viewed_at
                                FROM lecturescribe_user_library
                                WHERE user_email = %s
                                ORDER BY last_viewed_at DESC;
                            """, (clean_email,))
                            rows = cursor.fetchall()
                            if rows:
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
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed fetching user library: {e}")

        return []

    def get_recent_lectures(self, limit: int = 12) -> List[Dict[str, Any]]:
        """Retrieve recent or sample lectures available across the system for library overview and guest explore."""
        # Try SQLite
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT v.video_id, v.title, v.duration, v.source_url, v.created_at,
                           u.drive_folder_url
                    FROM lecturescribe_videos v
                    LEFT JOIN lecturescribe_user_library u ON v.video_id = u.video_id
                    GROUP BY v.video_id
                    ORDER BY v.created_at DESC
                    LIMIT ?;
                """, (limit,))
                rows = cursor.fetchall()
                if rows:
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
        except Exception as e:
            print(f"[SQLite DB Error] Failed fetching recent lectures: {e}")

        # Fallback to PostgreSQL
        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
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
                            rows = cursor.fetchall()
                            if rows:
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
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed fetching recent lectures: {e}")

        return []

    def remove_user_lecture(self, user_email: str, video_id: str) -> bool:
        """Remove a lecture from the user's LMS library."""
        if not user_email or not video_id:
            return False

        clean_email = user_email.strip().lower()
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    DELETE FROM lecturescribe_user_library
                    WHERE user_email = ? AND video_id = ?;
                """, (clean_email, video_id))
                conn.commit()
        except Exception as e:
            print(f"[SQLite DB Error] Failed removing user lecture: {e}")

        if self.use_postgres:
            try:
                conn = self._get_postgres_connection()
                if conn:
                    with conn:
                        with conn.cursor() as cursor:
                            cursor.execute("""
                                DELETE FROM lecturescribe_user_library
                                WHERE user_email = %s AND video_id = %s;
                            """, (clean_email, video_id))
                            conn.commit()
                    conn.close()
            except Exception as e:
                print(f"[Cloud PostgreSQL Error] Failed removing user lecture: {e}")

        return True


# Export singleton instance
db_manager = RelationalDBManager()
