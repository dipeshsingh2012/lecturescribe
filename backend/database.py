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
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(video_id) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE
                    );
                """)
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_cues_vid ON lecturescribe_transcript_cues(video_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sum_vid ON lecturescribe_summaries(video_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_vid ON lecturescribe_chat_logs(video_id);")
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
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
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

            summary_sections = [
                {
                    "title": "📌 1. Course Structure & Evaluation Framework",
                    "points": [
                        "Core Objective: Bridge theoretical knowledge with applied research methodology leading up to thesis defense, patents, and peer-reviewed publications.",
                        "Total Academic Weightage: 34 credits dedicated to research projects across upcoming semesters.",
                        "Attendance Policy: Mandatory video-on policy during live interactive sessions.",
                        "Class Note Submission: Post-class portal open for 24 hours; requires a concise 100-word reflection summary.",
                        "Evaluation Breakdown: Continuous assignment evaluations, class note submissions, mid-term reviews, and final project report defense.",
                        "Systematic Syllabus Progression: Need for Research ➔ Topic Exploration ➔ Literature Review ➔ Gap Analysis ➔ Experimental Validation ➔ IPR/Patents ➔ Thesis Defense."
                    ]
                },
                {
                    "title": "💡 2. Why Research Matters: Historical & Societal Perspective",
                    "points": [
                        "Human Evolution: Driven from Stone Age survival to Generative AI & 6G connectivity era.",
                        "Transformative Milestones: Medical breakthroughs (uncurable diseases to targeted therapies), supersonic aviation, global telecommunications, and edge computing.",
                        "Research Paradigm Shift: Moving from pure profit-driven industrial mindsets to societal impact + IP creation.",
                        "Monetization & Asset Creation: Academic research creates long-term intellectual assets through patent licensing and royalties.",
                        "Relevance vs. Extinction: Companies failing to invest in continuous R&D become obsolete (e.g. legacy mobile handset makers).",
                        "Innovation as DNA: R&D is the core operational culture required for long-term sustainability."
                    ]
                },
                {
                    "title": "🎯 3. National Thrust Areas & Sovereign Technology",
                    "points": [
                        "Key Thrust Domains: Water & Sanitation, Energy Grids, Food & Agriculture, Healthcare & MedTech, EdTech, Sovereign Tech.",
                        "Sovereign Tech Vision: Developing indigenous semiconductor fabrication (Fab) and microelectronics for Viksit Bharat 2047.",
                        "Scaling Challenge: Translating lab-scale prototypes into mass-deployable solutions for large populations.",
                        "Interdisciplinary Intersections: Data Science + Healthcare (Predictive monitoring), AI + Semiconductor Yield Optimization."
                    ]
                },
                {
                    "title": "🛡️ 4. Case Study: Crisis Management & Research Axiom",
                    "points": [
                        "COVID-19 Response: Rapid scientific research converts public panic into structured understanding.",
                        "Core Axiom: 'Research turns fear into understanding, and understanding into survival.'",
                        "Vaccine Acceleration: Genomic sequencing and mRNA platform research reduced development timelines from decades to months."
                    ]
                },
                {
                    "title": "❓ 5. Student Q&A & Research Exploration Methods",
                    "points": [
                        "Intelligent Systems: Systems that ingest continuous data (e.g. 2 months CGM glucose data), predict states, and execute automated corrective actions.",
                        "Kickstart Problem: Overcoming paralysis in choosing research topics via Top-to-Bottom and Bottom-to-Top exploration methodologies."
                    ]
                },
                {
                    "title": "🔬 6. Methodology: Top-Down vs. Bottom-Up Exploration",
                    "points": [
                        "Top-Down Approach: Macro societal challenge ➔ Sub-domain bottleneck ➔ Technical ML intervention.",
                        "Bottom-Up Approach: Specific ML algorithm (e.g. Graph Neural Nets) ➔ Applied to domain topology (e.g. Drug Discovery)."
                    ]
                }
            ]

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
        summary_sections: List[Dict[str, Any]]
    ):
        """Save video, transcript cues, and AI summaries to SQLite and PostgreSQL (dual persistence)."""
        # 1. Save to SQLite (Always persists locally)
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(video_id) DO UPDATE SET
                        title = excluded.title,
                        duration = excluded.duration,
                        source_url = excluded.source_url,
                        caption_label = excluded.caption_label;
                """, (video_id, title, duration, source_url, caption_label))

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
                                INSERT INTO lecturescribe_videos (video_id, title, duration, source_url, caption_label)
                                VALUES (%s, %s, %s, %s, %s)
                                ON CONFLICT (video_id) 
                                DO UPDATE SET title = EXCLUDED.title, duration = EXCLUDED.duration, 
                                              source_url = EXCLUDED.source_url, caption_label = EXCLUDED.caption_label;
                            """, (video_id, title, duration, source_url, caption_label))

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

        # 3. Update L1 In-Memory Cache
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
                                s_row = cursor.fetchone()
                                summary_sections = s_row["sections_json"] if s_row and "sections_json" in s_row else []

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

    def save_chat_log(self, video_id: str, user_prompt: str, ai_reply: str, citations: List[Dict[str, Any]]):
        """Save chat interaction to SQLite and PostgreSQL."""
        # 1. SQLite
        try:
            with self._get_sqlite_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO lecturescribe_chat_logs (video_id, user_prompt, ai_reply, citations_json)
                    VALUES (?, ?, ?, ?);
                """, (video_id, user_prompt, ai_reply, json.dumps(citations)))
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
                                INSERT INTO lecturescribe_chat_logs (video_id, user_prompt, ai_reply, citations_json)
                                VALUES (%s, %s, %s, %s::jsonb);
                            """, (video_id, user_prompt, ai_reply, json.dumps(citations)))
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


# Export singleton instance
db_manager = RelationalDBManager()
