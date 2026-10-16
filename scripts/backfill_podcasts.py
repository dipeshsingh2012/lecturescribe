#!/usr/bin/env python3
"""
scripts/backfill_podcasts.py
----------------------------
Batch generates single-narrator podcast audio for lectures that already have summaries,
using the pure 2-layer SLM pipeline (Writer SLM -> Voice Director SLM -> Google Cloud TTS).

Usage:
  # Dry-run: list lectures and check audio cache status without calling models or TTS
  python scripts/backfill_podcasts.py --dry-run

  # Backfill missing study notes podcast audio for all lectures
  python scripts/backfill_podcasts.py

  # Process only 1 lecture
  python scripts/backfill_podcasts.py --limit 1

  # Process a specific video ID
  python scripts/backfill_podcasts.py --video-id 12345678

  # Force regenerate audio even if already cached
  python scripts/backfill_podcasts.py --force

  # Backfill both study notes and assignment submission prose
  python scripts/backfill_podcasts.py --mode all
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env", override=True)

from backend.database import db_manager
from backend.podcast_service import (
    create_or_refresh_podcast,
    get_podcast_metadata,
)


def fetch_lectures_with_summaries(target_video_id: str | None = None) -> List[Dict[str, Any]]:
    """Query all lectures in PostgreSQL that have completed summaries and an assigned course."""
    conn = db_manager._get_connection()
    results: List[Dict[str, Any]] = []

    with conn:
        with conn.cursor() as cursor:
            if target_video_id:
                cursor.execute("""
                    SELECT s.video_id, s.summary_type, s.markdown_text, s.submission_text,
                           COALESCE(v.title, 'Lecture ' || s.video_id) AS title,
                           v.course_name
                    FROM lecturescribe_lecture_summaries s
                    LEFT JOIN lecturescribe_videos v ON s.video_id = v.video_id
                    WHERE s.video_id = %s
                      AND v.course_name IS NOT NULL
                      AND ((s.markdown_text IS NOT NULL AND LENGTH(s.markdown_text) > 40)
                       OR (s.submission_text IS NOT NULL AND LENGTH(s.submission_text) > 40))
                    ORDER BY s.updated_at DESC;
                """, (target_video_id,))
            else:
                cursor.execute("""
                    SELECT s.video_id, s.summary_type, s.markdown_text, s.submission_text,
                           COALESCE(v.title, 'Lecture ' || s.video_id) AS title,
                           v.course_name
                    FROM lecturescribe_lecture_summaries s
                    LEFT JOIN lecturescribe_videos v ON s.video_id = v.video_id
                    WHERE v.course_name IS NOT NULL
                      AND ((s.markdown_text IS NOT NULL AND LENGTH(s.markdown_text) > 40)
                       OR (s.submission_text IS NOT NULL AND LENGTH(s.submission_text) > 40))
                    ORDER BY s.updated_at DESC;
                """)
            rows = cursor.fetchall() or []
            seen_vids = set()
            for r in rows:
                vid = str(r["video_id"]).strip()
                if vid not in seen_vids:
                    seen_vids.add(vid)
                    results.append({
                        "video_id": vid,
                        "title": r["title"] or f"Lecture {vid}",
                        "course_name": r["course_name"],
                        "markdown_text": r.get("markdown_text") or "",
                        "submission_text": r.get("submission_text") or "",
                    })

    return results


def main():
    parser = argparse.ArgumentParser(description="Backfill podcast audio for lectures with summaries.")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and report status without generating audio")
    parser.add_argument("--video-id", type=str, default=None, help="Process a single video ID")
    parser.add_argument("--mode", choices=["study", "submission", "all"], default="study", help="Summary mode to generate audio for")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of lectures to process")
    parser.add_argument("--force", action="store_true", help="Force regenerate audio even if cached")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay in seconds between generations to avoid rate limits")

    args = parser.parse_args()

    print("=" * 70)
    print("🎙️  LectureScribe Single-Narrator Podcast Backfill Engine")
    print(f"    Mode: {args.mode.upper()} | Dry Run: {args.dry_run} | Force: {args.force}")
    print("=" * 70)

    lectures = fetch_lectures_with_summaries(args.video_id)
    if not lectures:
        print("❌ No lectures with completed summaries found in the database.")
        return

    if args.limit and args.limit > 0:
        lectures = lectures[:args.limit]

    print(f"📋 Found {len(lectures)} lecture(s) with completed summaries.\n")

    modes_to_process = ["study", "submission"] if args.mode == "all" else [args.mode]

    total_tasks = 0
    already_cached = 0
    synthesized = 0
    failed = 0

    for idx, lec in enumerate(lectures, start=1):
        vid = lec["video_id"]
        title = lec["title"]
        course = lec["course_name"]

        print(f"[{idx}/{len(lectures)}] Lecture: \"{title}\" (ID: {vid}) [{course}]")

        for m in modes_to_process:
            total_tasks += 1
            text = lec["submission_text"] if m == "submission" else lec["markdown_text"]
            if not text:
                text = lec["markdown_text"] or lec["submission_text"]

            if not text:
                print(f"    ⚠️  [{m.upper()}] No text available to generate audio. Skipping.")
                continue

            existing = get_podcast_metadata(vid, mode=m, course_name=course)
            has_audio = existing and existing.get("exists")

            if args.dry_run:
                status_label = "✅ CACHED" if has_audio else "⏳ NEEDS AUDIO"
                file_size = f"({existing.get('file_size', 0)} bytes)" if has_audio else ""
                gcs_info = f" -> {existing.get('gcs_uri')}" if (existing and existing.get("gcs_uri")) else ""
                print(f"    • [{m.upper()}] Status: {status_label} {file_size}{gcs_info}")
                if has_audio:
                    already_cached += 1
                continue

            if has_audio and not args.force:
                gcs_info = f" ({existing.get('gcs_uri')})" if (existing and existing.get("gcs_uri")) else ""
                print(f"    • [{m.upper()}] ⏩ Audio already cached in GCS{gcs_info}. Skipping.")
                already_cached += 1
                continue

            print(f"    • [{m.upper()}] ⚡ Synthesizing 2-layer SLM monologue & Google TTS audio...")
            start_time = time.time()
            try:
                meta = create_or_refresh_podcast(
                    video_id=vid,
                    title=title,
                    text=text,
                    mode=m,
                    course_name=course,
                    force_refresh=args.force
                )
                elapsed = time.time() - start_time
                gcs_loc = meta.get("gcs_uri") or "local storage"
                print(f"    • [{m.upper()}] ✅ Success in {elapsed:.1f}s | Audio size: {meta.get('file_size', 0)} bytes | Uploaded: {gcs_loc}")
                synthesized += 1
                if args.delay > 0:
                    time.sleep(args.delay)
            except Exception as err:
                print(f"    • [{m.upper()}] ❌ Failed: {err}")
                failed += 1

        print("-" * 50)

    print("\n" + "=" * 70)
    print("📊 Backfill Summary:")
    print(f"    Total Checked / Scheduled: {total_tasks}")
    if args.dry_run:
        print(f"    Already Cached:            {already_cached}")
        print(f"    Needing Audio Generation:  {total_tasks - already_cached}")
    else:
        print(f"    Newly Synthesized:         {synthesized}")
        print(f"    Already Cached (Skipped):  {already_cached}")
        print(f"    Failed:                    {failed}")
    print("=" * 70)


if __name__ == "__main__":
    main()

