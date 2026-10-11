#!/usr/bin/env python3
"""
scripts/reindex_algolia_chunks.py
---------------------------------
Migration script to compress existing fine-grained Algolia transcript records
into consolidated ~30-second windowed chunks.

Reduces the total Algolia record footprint by 80-90% by:
1. Deleting legacy per-cue records (`vimeo-{video_id}-{cue_idx}`) via `delete_by(filters='video_id:<id>')`.
2. Building ~30s aggregated chunk records (`vimeo-{video_id}-chunk-{chunk_idx}`).
3. Ingesting the new chunk records into the Algolia Cloud index.

Usage:
  # Dry-run analysis (no Algolia mutations)
  python scripts/reindex_algolia_chunks.py --dry-run

  # Migrate a single lecture
  python scripts/reindex_algolia_chunks.py --video-id 1234158181

  # Migrate all existing lectures across PostgreSQL
  python scripts/reindex_algolia_chunks.py

  # Custom window size (e.g. 45 seconds)
  python scripts/reindex_algolia_chunks.py --window-seconds 45
"""
from __future__ import annotations

import os
import sys
import argparse
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

from backend.algolia_service import algolia_service
from backend.database import db_manager


def fetch_videos_with_cues(
    target_video_id: Optional[str] = None,
    limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Retrieve video metadata and cues from PostgreSQL database."""
    conn = None
    results = []
    try:
        conn = db_manager._get_connection()
        with conn:
            with conn.cursor() as cursor:
                if target_video_id:
                    cursor.execute(
                        "SELECT video_id, title FROM lecturescribe_videos WHERE video_id = %s;",
                        (str(target_video_id).strip(),)
                    )
                else:
                    cursor.execute("SELECT video_id, title FROM lecturescribe_videos ORDER BY created_at DESC;")

                v_rows = cursor.fetchall() or []
                if limit and limit > 0:
                    v_rows = v_rows[:limit]

                for v in v_rows:
                    vid = str(v["video_id"]).strip()
                    title = v.get("title") or f"Lecture {vid}"

                    cursor.execute("""
                        SELECT id, timestamp as time, seconds, text 
                        FROM lecturescribe_transcript_cues 
                        WHERE video_id = %s 
                        ORDER BY id ASC;
                    """, (vid,))
                    cues = cursor.fetchall() or []

                    if cues:
                        results.append({
                            "video_id": vid,
                            "title": title,
                            "cues": [dict(c) for c in cues]
                        })
    except Exception as e:
        print(f"❌ [Database Error] Could not query videos from PostgreSQL: {e}")
    finally:
        if conn:
            conn.close()

    return results


def run_reindex(
    target_video_id: Optional[str] = None,
    window_seconds: int = 30,
    dry_run: bool = False,
    limit: Optional[int] = None
):
    print("=" * 70)
    print("🚀 Algolia Footprint Migration: Consolidate Legacy Cues into Windowed Chunks")
    print(f"   Target Video:    {target_video_id or 'ALL'}")
    print(f"   Window Size:     {window_seconds} seconds")
    print(f"   Mode:            {'DRY-RUN (Simulated)' if dry_run else 'LIVE MIGRATION'}")
    print(f"   Algolia Index:   {algolia_service.index_name}")
    print("=" * 70)

    if not dry_run and not algolia_service.client:
        print("⚠️ [Algolia Notice] Algolia client credentials are not configured in environment.")
        print("   Running in dry-run simulation mode.\n")
        dry_run = True

    videos = fetch_videos_with_cues(target_video_id=target_video_id, limit=limit)
    if not videos:
        print("ℹ️ No videos with transcript cues found in database.")
        return

    print(f"Found {len(videos)} lecture(s) with transcript cues to process.\n")

    total_cues_before = 0
    total_chunks_after = 0
    successful_videos = 0
    failed_videos = 0

    for idx, v in enumerate(videos, start=1):
        vid = v["video_id"]
        title = v["title"]
        cues = v["cues"]
        cue_count = len(cues)
        total_cues_before += cue_count

        # Build chunks to assess footprint reduction
        chunks = algolia_service.build_transcript_chunks(
            video_id=vid,
            video_title=title,
            cues=cues,
            window_seconds=window_seconds
        )
        chunk_count = len(chunks)
        total_chunks_after += chunk_count
        reduction_pct = ((cue_count - chunk_count) / cue_count * 100) if cue_count > 0 else 0

        print(f"[{idx}/{len(videos)}] Video '{vid}' ('{title[:40]}...'):")
        print(f"    Raw Cues: {cue_count}  ➔  Consolidated Chunks: {chunk_count}  (-{reduction_pct:.1f}% records)")

        if not dry_run:
            try:
                # 1. Purge legacy records for this video
                algolia_service.delete_video_records(vid)
                # 2. Upload consolidated windowed chunks
                pushed = algolia_service.ingest_cues(
                    video_id=vid,
                    video_title=title,
                    cues=cues,
                    window_seconds=window_seconds
                )
                print(f"    ✅ Ingested {pushed} chunks into Algolia.")
                successful_videos += 1
            except Exception as err:
                print(f"    ❌ Migration failed for '{vid}': {err}")
                failed_videos += 1
        else:
            successful_videos += 1

    print("\n" + "=" * 70)
    print("📊 Migration Summary Report")
    print("=" * 70)
    print(f"Total Lectures Processed:    {len(videos)}")
    print(f"Total Legacy Cue Records:    {total_cues_before}")
    print(f"Total New Chunk Records:     {total_chunks_after}")
    overall_savings = (
        ((total_cues_before - total_chunks_after) / total_cues_before * 100)
        if total_cues_before > 0 else 0
    )
    saved_records = total_cues_before - total_chunks_after
    print(f"Records Eliminated:          {saved_records} records (-{overall_savings:.1f}%)")
    print(f"Successful:                  {successful_videos}")
    if failed_videos > 0:
        print(f"Failed:                      {failed_videos}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Re-index legacy Algolia transcript records into ~30s chunks.")
    parser.add_argument("--video-id", type=str, default=None, help="Target a specific video ID.")
    parser.add_argument("--window-seconds", type=int, default=30, help="Window size for cue chunking (default: 30s).")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without modifying Algolia records.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of videos to process.")
    args = parser.parse_args()

    run_reindex(
        target_video_id=args.video_id,
        window_seconds=args.window_seconds,
        dry_run=args.dry_run,
        limit=args.limit
    )


if __name__ == "__main__":
    main()

