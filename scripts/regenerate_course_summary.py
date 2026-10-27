#!/usr/bin/env python3
"""
scripts/regenerate_course_summary.py
------------------------------------
CLI utility to synthesize or force-regenerate course-level executive summaries across all lectures
using saved lecture summaries and the RAG course synthesis pipeline.

Usage:
  # Dry-run analysis for a specific course (no LLM generation or DB writes)
  python scripts/regenerate_course_summary.py --course "Linear Algebra" --dry-run

  # Regenerate course summary for a specific course
  python scripts/regenerate_course_summary.py --course "Linear Algebra"

  # Regenerate by course slug
  python scripts/regenerate_course_summary.py --course linear-algebra

  # Regenerate summaries for all courses in the catalog
  python scripts/regenerate_course_summary.py --all

  # Limit number of courses processed when using --all
  python scripts/regenerate_course_summary.py --all --limit 5

  # Dry-run across all courses
  python scripts/regenerate_course_summary.py --all --dry-run
"""
from __future__ import annotations

import os
import sys
import argparse
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env", override=True)
except ImportError:
    pass

from backend.database import db_manager, to_course_slug
from backend.redis_service import redis_cache
from backend.rag_engine import pinecone_rag_engine


def get_all_distinct_courses() -> List[str]:
    """Retrieve all distinct canonical course names from PostgreSQL."""
    courses = []
    conn = None
    try:
        conn = db_manager._get_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT course_name 
                    FROM lecturescribe_videos 
                    WHERE course_name IS NOT NULL AND TRIM(course_name) != ''
                    ORDER BY course_name ASC;
                """)
                rows = cur.fetchall() or []
                for r in rows:
                    cname = (r.get("course_name") if isinstance(r, dict) else r[0]) or ""
                    cname = cname.strip()
                    if cname and cname not in courses:
                        courses.append(cname)
    except Exception as e:
        print(f"⚠️ [Database Warning] Failed to query distinct courses from PostgreSQL: {e}")
    finally:
        if conn:
            conn.close()

    return courses


def regenerate_course_summary(
    course_name: str,
    dry_run: bool = False,
    user_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Load lecture summaries for a course, invoke course synthesis, and persist to DB/cache.
    """
    clean_course = str(course_name or "").strip()
    course_slug = to_course_slug(clean_course)
    if not clean_course or not course_slug:
        raise ValueError("Valid course_name is required.")

    print(f"\n=======================================================")
    print(f"📚 Course: {clean_course} (slug: {course_slug})")
    print(f"=======================================================")

    # 1. Fetch course details and lectures
    course_info = db_manager.get_course_details(clean_course, user_email=user_email)
    if not course_info or not course_info.get("lectures"):
        raise RuntimeError(f"Course '{clean_course}' not found or has no recorded lectures in DB.")

    canonical_title = course_info.get("course_name") or clean_course
    lectures = course_info.get("lectures", [])
    print(f"Found {len(lectures)} total lecture(s) for '{canonical_title}'.")

    # 2. Extract lecture summaries
    lectures_with_summaries = []
    for lect in lectures:
        vid = lect.get("video_id") or lect.get("videoId")
        if not vid:
            continue
        saved_vid = db_manager.get_saved_video(vid)
        ltitle = (
            lect.get("title")
            or lect.get("video_title")
            or (saved_vid.get("title") if saved_vid else None)
            or f"Lecture {vid}"
        )

        sums = db_manager.get_lecture_summaries(vid)
        summary_text = ""
        for stype in ("comprehensive", "key_points", "brief", "study_guide"):
            if sums.get(stype) and sums[stype].get("markdownText"):
                summary_text = sums[stype]["markdownText"]
                break
        if not summary_text and sums:
            first_sum = next(iter(sums.values()), None)
            if first_sum and first_sum.get("markdownText"):
                summary_text = first_sum["markdownText"]

        cues = (saved_vid.get("cues") if saved_vid else None) or []
        lectures_with_summaries.append({
            "video_id": vid,
            "title": ltitle,
            "summary": summary_text,
            "cues": cues[:25] if not summary_text else []
        })

    if not lectures_with_summaries:
        raise RuntimeError(f"No usable lecture records found for course '{canonical_title}'.")

    summarized_count = sum(1 for l in lectures_with_summaries if l.get("summary"))
    print(f"Lectures with generated summaries: {summarized_count}/{len(lectures_with_summaries)}")

    if dry_run:
        print(f"🔍 [DRY RUN] Would synthesize course summary across {len(lectures_with_summaries)} lectures:")
        for idx, l in enumerate(lectures_with_summaries, 1):
            has_sum = "✅ summary" if l.get("summary") else "⚠️ raw cues fallback"
            print(f"   {idx}. [{l['video_id']}] {l['title']} ({has_sum})")
        return {"dry_run": True, "lectures_count": len(lectures_with_summaries)}

    # 3. Call AI synthesis
    print(f"🧠 Synthesizing executive course summary via RAG engine...")
    t0 = time.time()
    summary_data = pinecone_rag_engine.generate_course_summary(
        course_name=canonical_title,
        lectures_data=lectures_with_summaries
    )
    elapsed = round(time.time() - t0, 2)
    print(f"✅ Generated summary in {elapsed}s.")

    # 4. Persist to PostgreSQL & Redis
    db_manager.save_course_summary(canonical_title, summary_data)
    canonical_slug = to_course_slug(canonical_title)
    if canonical_slug and canonical_slug != course_slug:
        db_manager.save_course_summary(clean_course, summary_data)

    if redis_cache:
        redis_cache.set_course_summary(course_slug, summary_data, ttl_seconds=86400)
        if canonical_slug and canonical_slug != course_slug:
            redis_cache.set_course_summary(canonical_slug, summary_data, ttl_seconds=86400)
        print(f"⚡ Invalided & cached summary in Redis for '{course_slug}'.")

    modules = summary_data.get("thematic_modules", [])
    formulas = summary_data.get("core_formulas_and_definitions", [])
    checklist = summary_data.get("master_exam_checklist", [])

    print(f"📊 Summary Stats:")
    print(f"   - Thematic Modules: {len(modules)}")
    print(f"   - Core Formulas/Definitions: {len(formulas)}")
    print(f"   - Master Exam Checklist Items: {len(checklist)}")
    print(f"   - Executive Summary Length: {len(summary_data.get('executive_summary', ''))} chars")

    return summary_data


def main():
    parser = argparse.ArgumentParser(
        description="Regenerate course-level executive summary across all lectures in LectureScribe."
    )
    parser.add_argument(
        "-c", "--course",
        type=str,
        help="Course name or slug to regenerate (e.g. 'Linear Algebra' or 'linear-algebra')."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Regenerate summaries for all courses found in the database."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of courses processed when using --all."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect course lectures without invoking LLMs or writing to database."
    )
    parser.add_argument(
        "--email",
        type=str,
        default=None,
        help="Optional user email for scoped library lookups."
    )

    args = parser.parse_args()

    if not args.course and not args.all:
        parser.print_help()
        print("\n❌ Error: Please specify either --course <name> or --all.")
        sys.exit(1)

    target_courses = []
    if args.course:
        target_courses.append(args.course.strip())
    elif args.all:
        all_courses = get_all_distinct_courses()
        if args.limit:
            all_courses = all_courses[:args.limit]
        target_courses.extend(all_courses)

    if not target_courses:
        print("❌ No courses found to process.")
        sys.exit(1)

    print(f"Starting course summary regeneration for {len(target_courses)} course(s)...")
    successes = 0
    failures = 0

    for c in target_courses:
        try:
            regenerate_course_summary(
                course_name=c,
                dry_run=args.dry_run,
                user_email=args.email
            )
            successes += 1
        except Exception as e:
            print(f"❌ Failed to regenerate course summary for '{c}': {e}")
            failures += 1

    print("\n=======================================================")
    print(f"🎉 Complete! Successes: {successes} | Failures: {failures}")
    print("=======================================================")


if __name__ == "__main__":
    main()

