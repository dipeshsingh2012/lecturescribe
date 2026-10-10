#!/usr/bin/env python3
"""
Database migration script to map raw LMS course codes to canonical human-readable course names.
Applies mappings from extension/content/content.js KNOWN_LMS_CODE_MAPPINGS.
"""
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))

try:
    from dotenv import load_dotenv
    load_dotenv(repo_root / ".env")
except ImportError:
    env_file = repo_root / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))

import psycopg2
from psycopg2.extras import RealDictCursor

# Current mappings defined in extension/content/content.js
KNOWN_LMS_CODE_MAPPINGS = {
    "AMDSAIC04": "1.1 Applied Mathematics for Data Science and AI",
    "MLPC04": "1.2 Machine Learning Paradigms",
    "ISNLPC04": "1.3 Introduction to Speech and Natural Language Processing",
    "ICVC04": "1.4 Introduction to Computer Vision",
    "IGAIC04": "1.5 Introduction to Generative AI",
    "IFAC04": "1.6 Introduction to Financial Analytics",
    "IAIHC04": "1.7 Introduction to AI in Healthcare",
    "IRC04": "1.8 Introduction to Research",
    "DSLC04": "1.9 Data Science Lab",
}

# Also migrate unnumbered or mis-slugged courses to their numbered names
UNNUMBERED_COURSE_MAPPINGS = {
    "Data Science Lab": "1.9 Data Science Lab",
    "Introduction to Research": "1.8 Introduction to Research",
    "Introduction to AI in Healthcare": "1.7 Introduction to AI in Healthcare",
    "Introduction to Financial Analytics": "1.6 Introduction to Financial Analytics",
    "Introduction to Generative AI": "1.5 Introduction to Generative AI",
    "Introduction to Computer Vision": "1.4 Introduction to Computer Vision",
    "Introduction to Speech and Natural Language Processing": "1.3 Introduction to Speech and Natural Language Processing",
    "Introduction To Speech And Natural Language Processing": "1.3 Introduction to Speech and Natural Language Processing",
    "Machine Learning Paradigms": "1.2 Machine Learning Paradigms",
    "machine-learning-paradigms": "1.2 Machine Learning Paradigms",
    "Applied Mathematics for Data Science and AI": "1.1 Applied Mathematics for Data Science and AI",
    "Applied Mathemartics for Data Science and AI": "1.1 Applied Mathematics for Data Science and AI",
}


def run_migration():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("❌ Error: DATABASE_URL environment variable is not set.")
        sys.exit(1)

    print(f"Connecting to database...")
    try:
        conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor, connect_timeout=10)
    except Exception as exc:
        print(f"❌ Connection error: {exc}")
        sys.exit(1)

    try:
        with conn:
            with conn.cursor() as cur:
                print("Checking existing records before migration...")

                # Inspect current matching rows
                cur.execute("""
                    SELECT video_id, title, course_name FROM lecturescribe_videos
                    WHERE course_name IS NOT NULL AND course_name != '';
                """)
                all_videos = cur.fetchall() or []
                print(f"Total videos in database: {len(all_videos)}")

                video_updates = 0
                user_lib_updates = 0

                # 1. Update from LMS Codes
                for code, target_name in KNOWN_LMS_CODE_MAPPINGS.items():
                    alt_code = code.replace("C04", "CO4")
                    cur.execute("""
                        UPDATE lecturescribe_videos
                        SET course_name = %s
                        WHERE UPPER(TRIM(course_name)) IN (UPPER(%s), UPPER(%s))
                           OR course_name ILIKE %s
                           OR course_name ILIKE %s;
                    """, (target_name, code, alt_code, f"%{code}%", f"%{alt_code}%"))
                    c1 = cur.rowcount
                    if c1 > 0:
                        print(f"  [lecturescribe_videos] Updated {c1} rows from code: '{code}' -> '{target_name}'")
                        video_updates += c1

                    cur.execute("""
                        UPDATE lecturescribe_user_library
                        SET course_name = %s
                        WHERE UPPER(TRIM(course_name)) IN (UPPER(%s), UPPER(%s))
                           OR course_name ILIKE %s
                           OR course_name ILIKE %s;
                    """, (target_name, code, alt_code, f"%{code}%", f"%{alt_code}%"))
                    c2 = cur.rowcount
                    if c2 > 0:
                        print(f"  [lecturescribe_user_library] Updated {c2} rows from code: '{code}' -> '{target_name}'")
                        user_lib_updates += c2

                # 2. Update existing unnumbered names to numbered names (case-insensitive)
                for old_name, target_name in UNNUMBERED_COURSE_MAPPINGS.items():
                    cur.execute("""
                        UPDATE lecturescribe_videos
                        SET course_name = %s
                        WHERE LOWER(TRIM(course_name)) = LOWER(%s);
                    """, (target_name, old_name))
                    c1 = cur.rowcount
                    if c1 > 0:
                        print(f"  [lecturescribe_videos] Updated {c1} rows: '{old_name}' -> '{target_name}'")
                        video_updates += c1

                    cur.execute("""
                        UPDATE lecturescribe_user_library
                        SET course_name = %s
                        WHERE LOWER(TRIM(course_name)) = LOWER(%s);
                    """, (target_name, old_name))
                    c2 = cur.rowcount
                    if c2 > 0:
                        print(f"  [lecturescribe_user_library] Updated {c2} rows: '{old_name}' -> '{target_name}'")
                        user_lib_updates += c2

                conn.commit()

                # Invalidate Redis cache keys for user courses and libraries
                try:
                    from backend.redis_service import redis_cache
                    if redis_cache and redis_cache.enabled and redis_cache.client:
                        keys = list(redis_cache.client.keys("ls:user_courses:*")) + list(redis_cache.client.keys("ls:user_library:*"))
                        if keys:
                            redis_cache.client.delete(*keys)
                            print(f"🗑️ [Redis] Purged {len(keys)} cached user courses/library keys.")
                except Exception as r_err:
                    print(f"Redis cache notice: {r_err}")

                print("\nMigration Summary:")
                print(f"  • lecturescribe_videos updated: {video_updates}")
                print(f"  • lecturescribe_user_library updated: {user_lib_updates}")
                print("✅ Migration completed successfully!")

    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()
