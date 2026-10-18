#!/usr/bin/env python3
"""
Assign all courses and lectures without a user_email to dipesh.singh2012@gmail.com,
normalize canonical course names across lecturescribe_videos and lecturescribe_user_library,
and refresh the user's Redis course cache.
"""
import os
import re
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))

from backend.database import db_manager, extract_course_name
from backend.gcs_storage import to_gcs_course_slug
from backend.redis_service import redis_cache

TARGET_EMAIL = "dipesh.singh2012@gmail.com"


def migrate_unassigned_to_user(target_email: str = TARGET_EMAIL):
    clean_email = target_email.strip().lower()
    print(f"Assigning unassigned courses and lectures to: {clean_email}")

    conn = db_manager._get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                # 1. Assign NULL / empty user_email on lecturescribe_videos
                cur.execute("""
                    UPDATE lecturescribe_videos
                    SET user_email = %s
                    WHERE user_email IS NULL OR TRIM(user_email) = '';
                """, (clean_email,))
                print(f"  Updated {cur.rowcount} unassigned videos in lecturescribe_videos -> {clean_email}")

                # Assign NULL / empty user_email on lecturescribe_user_library
                cur.execute("""
                    DELETE FROM lecturescribe_user_library
                    WHERE (user_email IS NULL OR TRIM(user_email) = '')
                      AND video_id IN (
                          SELECT video_id FROM lecturescribe_user_library WHERE user_email = %s
                      );
                """, (clean_email,))
                cur.execute("""
                    UPDATE lecturescribe_user_library
                    SET user_email = %s
                    WHERE user_email IS NULL OR TRIM(user_email) = '';
                """, (clean_email,))
                print(f"  Updated {cur.rowcount} unassigned rows in lecturescribe_user_library -> {clean_email}")

                # Assign NULL / empty user_email on course/lecture chat logs
                for table in ("lecturescribe_chat_logs", "lecturescribe_course_chat_logs"):
                    cur.execute(f"""
                        UPDATE {table}
                        SET user_email = %s
                        WHERE user_email IS NULL OR TRIM(user_email) = '';
                    """, (clean_email,))
                    if cur.rowcount > 0:
                        print(f"  Updated {cur.rowcount} unassigned rows in {table} -> {clean_email}")

                # 2. Build canonical course map from existing numbered course names on the same connection
                cur.execute("""
                    SELECT DISTINCT course_name FROM lecturescribe_videos
                    WHERE course_name IS NOT NULL AND course_name != '';
                """)
                distinct_courses = [r["course_name"] for r in (cur.fetchall() or [])]
                canonical_by_base_slug = {}
                for c in distinct_courses:
                    b_slug = to_gcs_course_slug(c)
                    if re.match(r'^\d+\.\d+\s+', c) or b_slug not in canonical_by_base_slug:
                        canonical_by_base_slug[b_slug] = c

                # Normalize lecturescribe_videos
                cur.execute("SELECT video_id, title, course_name FROM lecturescribe_videos;")
                videos = cur.fetchall() or []
                vid_course_updates = 0
                for v in videos:
                    raw = (v.get("course_name") or "").strip() or extract_course_name(v.get("title", ""))
                    b_slug = to_gcs_course_slug(raw)
                    canonical = canonical_by_base_slug.get(b_slug, raw)
                    if canonical and canonical != v.get("course_name"):
                        cur.execute(
                            "UPDATE lecturescribe_videos SET course_name = %s WHERE video_id = %s;",
                            (canonical, v["video_id"])
                        )
                        vid_course_updates += 1
                print(f"  Canonicalized {vid_course_updates} course names in lecturescribe_videos")

                # Normalize lecturescribe_user_library
                cur.execute("SELECT id, video_id, title, course_name FROM lecturescribe_user_library;")
                lib_rows = cur.fetchall() or []
                lib_course_updates = 0
                for r in lib_rows:
                    raw = (r.get("course_name") or "").strip() or extract_course_name(r.get("title", ""))
                    b_slug = to_gcs_course_slug(raw)
                    canonical = canonical_by_base_slug.get(b_slug, raw)
                    if canonical and canonical != r.get("course_name"):
                        cur.execute(
                            "UPDATE lecturescribe_user_library SET course_name = %s WHERE id = %s;",
                            (canonical, r["id"])
                        )
                        lib_course_updates += 1
                print(f"  Canonicalized {lib_course_updates} course names in lecturescribe_user_library")

                # 3. Ensure every video in lecturescribe_videos is in lecturescribe_user_library for clean_email
                cur.execute("""
                    INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, course_name, last_viewed_at)
                    SELECT %s, video_id, title, duration, source_url, course_name, created_at
                    FROM lecturescribe_videos
                    ON CONFLICT (user_email, video_id) DO UPDATE SET
                        course_name = EXCLUDED.course_name;
                """, (clean_email,))
                print(f"  Synced {cur.rowcount} video entries into lecturescribe_user_library for {clean_email}")

                conn.commit()
    finally:
        conn.close()

    # 4. Refresh Redis cache for target_email
    courses = db_manager.get_user_courses(clean_email)
    library = db_manager.get_user_library(clean_email)
    if redis_cache:
        redis_cache.set_user_courses(clean_email, courses)
        redis_cache.set_user_library(clean_email, library)
        print(f"  Refreshed Redis cache for {clean_email}: {len(courses)} courses, {len(library)} lectures")

    for c in courses:
        print(f"  • {c['course_name']} ({c['course_slug']}): {c['lecture_count']} lectures")


if __name__ == "__main__":
    migrate_unassigned_to_user()

