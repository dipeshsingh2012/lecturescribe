#!/usr/bin/env python3
"""
Fix course "machine-learning-paradigms" and canonicalize numbered courses.
Merges unnumbered/rogue course records into canonical numbered courses across all tables,
removes duplicate course entities from lecturescribe_courses, and flushes Redis cache.
"""
import os
import sys
import re
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))

try:
    from dotenv import load_dotenv
    load_dotenv(repo_root / ".env")
except ImportError:
    pass

import psycopg2
from psycopg2.extras import RealDictCursor

CANONICAL_COURSES = {
    "1.1 Applied Mathematics for Data Science and AI": {
        "slug": "1-1-applied-mathematics-for-data-science-and-ai",
        "aliases": [
            "applied-mathemartics-for-data-science-and-ai",
            "applied-mathematics-for-data-science-and-ai",
            "Applied Mathematics for Data Science and AI",
            "Applied Mathemartics for Data Science and AI",
            "AMDSAIC04",
        ]
    },
    "1.2 Machine Learning Paradigms": {
        "slug": "1-2-machine-learning-paradigms",
        "aliases": [
            "machine-learning-paradigms",
            "Machine Learning Paradigms",
            "MLPC04",
        ]
    },
    "1.3 Introduction to Speech and Natural Language Processing": {
        "slug": "1-3-introduction-to-speech-and-natural-language-processing",
        "aliases": [
            "introduction-to-speech-and-natural-language-processing",
            "Introduction to Speech and Natural Language Processing",
            "Introduction To Speech And Natural Language Processing",
            "ISNLPC04",
        ]
    },
    "1.4 Introduction to Computer Vision": {
        "slug": "1-4-introduction-to-computer-vision",
        "aliases": [
            "introduction-to-computer-vision",
            "Introduction to Computer Vision",
            "ICVC04",
        ]
    },
    "1.5 Introduction to Generative AI": {
        "slug": "1-5-introduction-to-generative-ai",
        "aliases": [
            "introduction-to-generative-ai",
            "Introduction to Generative AI",
            "IGAIC04",
        ]
    },
    "1.6 Introduction to Financial Analytics": {
        "slug": "1-6-introduction-to-financial-analytics",
        "aliases": [
            "introduction-to-financial-analytics",
            "Introduction to Financial Analytics",
            "IFAC04",
            "IFACO4",
        ]
    },
    "1.7 Introduction to AI in Healthcare": {
        "slug": "1-7-introduction-to-ai-in-healthcare",
        "aliases": [
            "introduction-to-ai-in-healthcare",
            "Introduction to AI in Healthcare",
            "IAIHC04",
        ]
    },
    "1.8 Introduction to Research": {
        "slug": "1-8-introduction-to-research",
        "aliases": [
            "introduction-to-research",
            "Introduction to Research",
            "IRC04",
        ]
    },
    "1.9 Data Science Lab": {
        "slug": "1-9-data-science-lab",
        "aliases": [
            "data-science-lab",
            "Data Science Lab",
            "DSLC04",
        ]
    },
}

TABLES_WITH_COURSE_COLS = [
    "lecturescribe_videos",
    "lecturescribe_user_library",
    "lecturescribe_resources",
    "lecturescribe_course_readings",
    "lecturescribe_course_notes",
]


def run_fix():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL is not set.")
        sys.exit(1)

    print("Connecting to PostgreSQL...")
    conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
    try:
        with conn:
            with conn.cursor() as cur:
                # 1. Ensure canonical courses exist in lecturescribe_courses and fetch their IDs
                canonical_info = {}
                for c_name, meta in CANONICAL_COURSES.items():
                    c_slug = meta["slug"]
                    cur.execute("""
                        SELECT id::text, slug, name FROM lecturescribe_courses
                        WHERE slug = %s OR name = %s
                        ORDER BY CASE WHEN slug = %s THEN 0 ELSE 1 END
                        LIMIT 1;
                    """, (c_slug, c_name, c_slug))
                    row = cur.fetchone()
                    if row:
                        cid = row["id"]
                        cur.execute("""
                            UPDATE lecturescribe_courses
                            SET name = %s, slug = %s
                            WHERE id = %s::uuid;
                        """, (c_name, c_slug, cid))
                    else:
                        cur.execute("""
                            INSERT INTO lecturescribe_courses (slug, name)
                            VALUES (%s, %s)
                            RETURNING id::text;
                        """, (c_slug, c_name))
                        cid = cur.fetchone()["id"]
                    canonical_info[c_name] = {
                        "id": cid,
                        "slug": c_slug,
                        "aliases": meta["aliases"]
                    }
                    print(f"✅ Canonical course ready: '{c_name}' (ID: {cid}, slug: {c_slug})")

                total_updated = 0

                # 2. Update multi-row tables (videos, user_library, resources, readings, notes)
                for c_name, info in canonical_info.items():
                    cid = info["id"]
                    c_slug = info["slug"]
                    aliases = info["aliases"]

                    for tbl in TABLES_WITH_COURSE_COLS:
                        for alias in aliases:
                            cur.execute(f"""
                                UPDATE {tbl}
                                SET course_name = %s, course_slug = %s, course_id = %s::uuid
                                WHERE (course_name = %s OR course_slug = %s)
                                  AND (course_name != %s OR course_slug != %s OR course_id != %s::uuid OR course_id IS NULL);
                            """, (c_name, c_slug, cid, alias, alias, c_name, c_slug, cid))
                            if cur.rowcount > 0:
                                print(f"  [{tbl}] Updated {cur.rowcount} rows: alias '{alias}' -> '{c_name}'")
                                total_updated += cur.rowcount

                # 3. Handle unique-per-course tables (quizzes and summaries)
                for c_name, info in canonical_info.items():
                    cid = info["id"]
                    c_slug = info["slug"]
                    aliases = info["aliases"]

                    for tbl in ["lecturescribe_course_quizzes", "lecturescribe_course_summaries"]:
                        # Check if a canonical row exists
                        cur.execute(f"""
                            SELECT id FROM {tbl}
                            WHERE course_slug = %s OR course_name = %s;
                        """, (c_slug, c_name))
                        canon_row = cur.fetchone()

                        for alias in aliases:
                            if canon_row:
                                # Canonical exists, delete the alias row to avoid unique violation
                                cur.execute(f"""
                                    DELETE FROM {tbl}
                                    WHERE (course_slug = %s OR course_name = %s)
                                      AND id != %s;
                                """, (alias, alias, canon_row["id"]))
                                if cur.rowcount > 0:
                                    print(f"  [{tbl}] Removed {cur.rowcount} duplicate alias row '{alias}' (canonical id {canon_row['id']} kept)")
                            else:
                                # Update alias row to canonical
                                cur.execute(f"""
                                    UPDATE {tbl}
                                    SET course_name = %s, course_slug = %s, course_id = %s::uuid
                                    WHERE course_slug = %s OR course_name = %s;
                                """, (c_name, c_slug, cid, alias, alias))
                                if cur.rowcount > 0:
                                    print(f"  [{tbl}] Promoted alias row '{alias}' to canonical '{c_name}'")
                                    # Set canon_row so subsequent aliases don't collide
                                    cur.execute(f"SELECT id FROM {tbl} WHERE course_slug = %s;", (c_slug,))
                                    canon_row = cur.fetchone()

                # 4. Handle history / chat logs / explanations
                for c_name, info in canonical_info.items():
                    cid = info["id"]
                    c_slug = info["slug"]
                    aliases = info["aliases"]

                    for tbl in ["lecturescribe_course_quiz_history", "lecturescribe_course_chat_logs", "lecturescribe_course_quiz_explanations"]:
                        cur.execute("""
                            SELECT column_name FROM information_schema.columns
                            WHERE table_name = %s;
                        """, (tbl,))
                        cols = {r["column_name"] for r in (cur.fetchall() or [])}
                        has_slug = "course_slug" in cols
                        has_id = "course_id" in cols
                        has_name = "course_name" in cols

                        for alias in aliases:
                            set_clauses = []
                            params = []
                            if has_name:
                                set_clauses.append("course_name = %s")
                                params.append(c_name)
                            if has_slug:
                                set_clauses.append("course_slug = %s")
                                params.append(c_slug)
                            if has_id:
                                set_clauses.append("course_id = %s::uuid")
                                params.append(cid)

                            where_conds = []
                            if has_name:
                                where_conds.append("course_name = %s")
                                params.append(alias)
                            if has_slug:
                                where_conds.append("course_slug = %s")
                                params.append(alias)

                            if set_clauses and where_conds:
                                cur.execute(f"""
                                    UPDATE {tbl}
                                    SET {', '.join(set_clauses)}
                                    WHERE ({' OR '.join(where_conds)});
                                """, tuple(params))
                                if cur.rowcount > 0:
                                    print(f"  [{tbl}] Updated {cur.rowcount} rows: alias '{alias}' -> '{c_name}'")

                # 5. Clean up rogue/duplicate unnumbered courses from lecturescribe_courses
                deleted_entities = 0
                for c_name, info in canonical_info.items():
                    cid = info["id"]
                    c_slug = info["slug"]
                    for alias in info["aliases"]:
                        cur.execute("""
                            DELETE FROM lecturescribe_courses
                            WHERE id != %s::uuid
                              AND (slug = %s OR LOWER(name) = LOWER(%s));
                        """, (cid, alias, alias))
                        if cur.rowcount > 0:
                            print(f"  [lecturescribe_courses] Deleted {cur.rowcount} rogue course entity for alias '{alias}'")
                            deleted_entities += cur.rowcount

                conn.commit()
                print(f"\nDatabase updates completed successfully! {deleted_entities} duplicate course entities removed.")

                # Invalidate Redis
                try:
                    from backend.redis_service import redis_cache
                    if redis_cache and redis_cache.enabled and redis_cache.client:
                        keys = (
                            list(redis_cache.client.keys("ls:user_courses:*")) +
                            list(redis_cache.client.keys("ls:user_library:*")) +
                            list(redis_cache.client.keys("ls:course_summary:*")) +
                            list(redis_cache.client.keys("ls:course_quiz:*")) +
                            list(redis_cache.client.keys("ls:course:*"))
                        )
                        if keys:
                            redis_cache.client.delete(*keys)
                            print(f"🗑️ [Redis] Purged {len(keys)} cached keys.")
                except Exception as r_err:
                    print(f"Redis cache notice: {r_err}")

    finally:
        conn.close()


if __name__ == "__main__":
    run_fix()

