#!/usr/bin/env python3
"""
scripts/sync_all_videos_to_gcs.py
---------------------------------
Robust batch synchronizer and tracking engine to sync lectures from PostgreSQL
into Google Cloud Storage (gs://lecturescribe-resources).

Downloads Vimeo HLS video streams & captions using university LMS referer session,
muxes into standard MP4, and uploads to the consolidated GCS course hierarchy:
  courses/<course_slug>/lectures/<video_id>/<safe_title>.mp4

Tracks all successes and failures in real-time in `scripts/sync_tracking.json`.

Usage:
  python scripts/sync_all_videos_to_gcs.py --status
  python scripts/sync_all_videos_to_gcs.py --dry-run
  python scripts/sync_all_videos_to_gcs.py --limit 1
  python scripts/sync_all_videos_to_gcs.py --video-id 1234158181
  python scripts/sync_all_videos_to_gcs.py --course "Introduction to AI in Healthcare"
  python scripts/sync_all_videos_to_gcs.py --retry-failed
  python scripts/sync_all_videos_to_gcs.py --pending-only
"""
from __future__ import annotations

import os
import sys
import re
import json
import argparse
import time
import datetime
import traceback
from typing import List, Dict, Any, Optional

# Ensure repository root is on sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from dotenv import load_dotenv
load_dotenv(os.path.join(REPO_ROOT, ".env"))

from backend.gcs_storage import gcs_storage_service
from backend.vimeo_client import (
    fetch_player_config,
    get_video_download_streams,
    get_text_tracks,
    fetch_vtt,
    parse_vtt,
    format_timestamp,
)

DEFAULT_REFERER = "https://learning.iiitdwd.ac.in/"
DEFAULT_STATE_FILE = os.path.join(REPO_ROOT, "scripts", "sync_tracking.json")


def slugify_course(course_name: Optional[str]) -> str:
    """Normalize course name into GCS directory slug."""
    if not course_name:
        return "general"
    clean = re.sub(r'[^a-zA-Z0-9\- ]', '', course_name.lower())
    clean = re.sub(r'\s+', '-', clean.strip())
    return clean or "general"


def load_tracking_state(state_file: str = DEFAULT_STATE_FILE) -> Dict[str, Any]:
    """Load the persistent tracking state JSON file."""
    if os.path.exists(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "videos" in data:
                    return data
        except Exception as e:
            print(f"⚠️ [Tracking Warning] Could not parse existing state file ({e}). Starting fresh.")

    return {
        "version": 1,
        "last_updated": None,
        "summary": {
            "total_tracked": 0,
            "success": 0,
            "already_cached": 0,
            "failed": 0,
            "pending": 0,
            "total_size_mb": 0.0
        },
        "videos": {}
    }


def save_tracking_state(state: Dict[str, Any], state_file: str = DEFAULT_STATE_FILE) -> None:
    """Atomically save the tracking state JSON file."""
    videos = state.get("videos", {})
    success_count = sum(1 for v in videos.values() if v.get("status") == "SUCCESS")
    cached_count = sum(1 for v in videos.values() if v.get("status") == "ALREADY_CACHED")
    failed_count = sum(1 for v in videos.values() if v.get("status") == "FAILED")
    pending_count = sum(1 for v in videos.values() if v.get("status") in ("PENDING", "IN_PROGRESS", "DRY_RUN_READY"))
    total_mb = sum(float(v.get("size_mb") or 0.0) for v in videos.values() if v.get("status") in ("SUCCESS", "ALREADY_CACHED"))

    state["summary"] = {
        "total_tracked": len(videos),
        "success": success_count,
        "already_cached": cached_count,
        "failed": failed_count,
        "pending": pending_count,
        "total_size_mb": round(total_mb, 2)
    }
    state["last_updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    temp_file = state_file + ".tmp"
    os.makedirs(os.path.dirname(os.path.abspath(state_file)), exist_ok=True)
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(temp_file, state_file)


def print_status_report(state: Dict[str, Any], verbose: bool = False) -> None:
    """Print an executive summary and failure breakdown from tracking state."""
    summary = state.get("summary", {})
    videos = state.get("videos", {})

    print("\n==================================================================")
    print("📊 LECTURESCRIBE GCS SYNC TRACKING REPORT")
    print(f"   Last Updated:    {state.get('last_updated') or 'Never'}")
    print(f"   Target Bucket:   gs://{gcs_storage_service.bucket_name}")
    print("------------------------------------------------------------------")
    print(f"   Total Tracked:   {summary.get('total_tracked', len(videos))}")
    print(f"   ✅ Succeeded:     {summary.get('success', 0)}")
    print(f"   ⏩ Already In GCS:{summary.get('already_cached', 0)}")
    print(f"   ✕  Failed:        {summary.get('failed', 0)}")
    print(f"   ⏳ Pending:       {summary.get('pending', 0)}")
    print(f"   💾 Synced Volume: {summary.get('total_size_mb', 0):.2f} MB")
    print("==================================================================")

    failed_videos = [v for v in videos.values() if v.get("status") == "FAILED"]
    if failed_videos:
        print("\n🚨 FAILED VIDEOS BREAKDOWN:")
        for idx, f in enumerate(failed_videos, start=1):
            vid = f.get("video_id")
            title = f.get("title", "Unknown")[:45]
            cat = f.get("error_category", "UNKNOWN")
            err = f.get("error", "No details")
            attempts = f.get("attempts", 1)
            print(f"  {idx:2d}. [{vid}] ({cat}) {title} - Attempts: {attempts}")
            print(f"      Error: {err}")
        print("------------------------------------------------------------------")
        print("💡 To retry all failed videos, run:")
        print("   python scripts/sync_all_videos_to_gcs.py --retry-failed\n")

    if verbose:
        succeeded = [v for v in videos.values() if v.get("status") in ("SUCCESS", "ALREADY_CACHED")]
        if succeeded:
            print("\n✅ COMPLETED VIDEOS:")
            for s in succeeded:
                print(f"  - [{s.get('video_id')}] ({s.get('status')} | {s.get('size_mb', 0)} MB) {s.get('title')[:50]}")


def get_all_videos_from_db(
    filter_video_id: Optional[str] = None,
    filter_course: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retrieve videos from PostgreSQL."""
    query = """
        SELECT video_id, title, duration, course_name, source_url, created_at
        FROM lecturescribe_videos
        WHERE video_id IS NOT NULL
    """
    params = []
    if filter_video_id:
        query += " AND video_id = %s"
        params.append(filter_video_id)
    if filter_course:
        query += " AND LOWER(course_name) LIKE %s"
        params.append(f"%{filter_course.lower()}%")
    query += " ORDER BY video_id ASC;"

    from backend.database import db_manager
    with db_manager._get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, tuple(params) if params else None)
            return [dict(r) for r in cur.fetchall()]


def check_gcs_status(video_id: str, course_slug: str) -> Dict[str, Any]:
    """Check if the video and assets are already stored in GCS."""
    bucket = gcs_storage_service._get_bucket()
    if not bucket:
        return {"exists": False, "has_video": False, "blobs": [], "size_mb": 0.0}

    # Primary consolidated path
    primary_prefix = f"courses/{course_slug}/lectures/{video_id}/"
    blobs = list(bucket.list_blobs(prefix=primary_prefix))

    # Also check legacy path
    if not blobs:
        blobs = list(bucket.list_blobs(prefix=f"lectures/{video_id}/"))

    video_blobs = [b for b in blobs if b.name.endswith((".mp4", ".mkv", ".webm"))]
    total_bytes = sum(b.size for b in blobs if b.size)
    video_size_mb = (video_blobs[0].size / (1024 * 1024)) if video_blobs and video_blobs[0].size else (total_bytes / (1024 * 1024))

    return {
        "exists": len(blobs) > 0,
        "has_video": len(video_blobs) > 0,
        "video_blob_name": video_blobs[0].name if video_blobs else None,
        "blob_count": len(blobs),
        "size_mb": round(video_size_mb, 2),
        "blobs": [b.name for b in blobs]
    }


def sync_single_video(
    video: Dict[str, Any],
    state: Dict[str, Any],
    state_file: str = DEFAULT_STATE_FILE,
    dry_run: bool = False,
    force: bool = False,
    referer: str = DEFAULT_REFERER,
    max_height: int = 720
) -> Dict[str, Any]:
    """Sync a single video into GCS and record tracking state."""
    vid = str(video["video_id"]).strip()
    raw_course = video.get("course_name") or "General Lectures"
    course_slug = slugify_course(raw_course)
    title = video.get("title") or f"Lecture {vid}"

    record = state.setdefault("videos", {}).get(vid, {
        "video_id": vid,
        "title": title,
        "course_name": raw_course,
        "course_slug": course_slug,
        "status": "PENDING",
        "attempts": 0
    })
    record["title"] = title
    record["course_name"] = raw_course
    record["course_slug"] = course_slug
    record["attempts"] = record.get("attempts", 0) + 1
    record["status"] = "IN_PROGRESS"
    record["last_attempt_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    state["videos"][vid] = record
    save_tracking_state(state, state_file)

    print(f"\n==================================================================")
    print(f"🎬 Processing Video: {vid}")
    print(f"   Title:    {title}")
    print(f"   Course:   {raw_course} (slug: {course_slug})")
    print(f"   Attempts: {record['attempts']}")
    print(f"==================================================================")

    # 1. Check GCS Cache
    if not force:
        status = check_gcs_status(vid, course_slug)
        if status.get("has_video"):
            print(f"⏩ [GCS Cache Hit] Video is ALREADY stored in GCS ({status['blob_count']} files, {status['size_mb']} MB). Skipping.")
            record.update({
                "status": "ALREADY_CACHED",
                "blob_name": status.get("video_blob_name"),
                "gcs_uri": f"gs://{gcs_storage_service.bucket_name}/courses/{course_slug}/lectures/{vid}/",
                "size_mb": status.get("size_mb", 0.0),
                "error": None,
                "error_category": None,
            })
            save_tracking_state(state, state_file)
            return {"status": "skipped", "video_id": vid, "reason": "already_cached", "size_mb": status.get("size_mb")}

    # 2. Probe Vimeo player config
    try:
        print(f"🔍 Probing Vimeo player config via referer: {referer}...")
        cfg = fetch_player_config(vid, referer=referer)
        streams = get_video_download_streams(cfg, vid)
        hls_master = streams.get("hls", {}).get("master_url")
        prog_streams = streams.get("progressive_streams", [])
        tracks = get_text_tracks(cfg)

        print(f"   Vimeo Title:      {cfg.get('video', {}).get('title')}")
        print(f"   Progressive MP4s: {len(prog_streams)} streams")
        print(f"   HLS Master URL:   {'Found' if hls_master else 'None'}")
        print(f"   Caption Tracks:   {len(tracks)} found")

        if not hls_master and not prog_streams:
            err_msg = f"No progressive or HLS streams found for video {vid}"
            print(f"✕ [Stream Error] {err_msg}")
            record.update({
                "status": "FAILED",
                "error": err_msg,
                "error_category": "NO_STREAM_AVAILABLE"
            })
            save_tracking_state(state, state_file)
            return {"status": "error", "video_id": vid, "error": err_msg}

        if dry_run:
            print(f"✨ [Dry-Run] Video {vid} is valid and READY to upload to gs://{gcs_storage_service.bucket_name}/courses/{course_slug}/lectures/{vid}/")
            record.update({
                "status": "DRY_RUN_READY",
                "error": None,
                "error_category": None
            })
            save_tracking_state(state, state_file)
            return {"status": "dry_run_ready", "video_id": vid, "course_slug": course_slug}

        # 3. Extract captions
        cues = []
        vtt_content = ""
        if tracks:
            track = next((t for t in tracks if t.get("default")), tracks[0])
            vtt_url = track.get("url") or track.get("src")
            if vtt_url:
                try:
                    vtt_content = fetch_vtt(vtt_url)
                    raw_segments = parse_vtt(vtt_content)
                    cues = [
                        {"start": s["start"], "time": format_timestamp(s["start"]), "text": s["text"]}
                        for s in raw_segments
                    ]
                    print(f"   Captions cues:    {len(cues)} segments downloaded")
                except Exception as ce:
                    print(f"   Captions notice:  {ce}")

        summary_md = f"# {title}\nAuto-uploaded lecture archive."
        folder_prefix = f"courses/{course_slug}/lectures"

        # 4. Upload bundle and video to GCS
        print(f"\n☁️ Uploading bundle & video stream to GCS: gs://{gcs_storage_service.bucket_name}/{folder_prefix}/{vid}/...")
        start_time = time.time()
        result = gcs_storage_service.upload_lecture_bundle(
            video_id=vid,
            title=title,
            vtt_content=vtt_content,
            cues=cues,
            summary_content=summary_md,
            streams_info=streams,
            bucket_name=gcs_storage_service.bucket_name,
            prefix=folder_prefix,
            upload_video=True,
            referer=referer
        )
        duration = time.time() - start_time
        video_uploaded = result.get("video_uploaded")
        video_details = result.get("video_details") or {}

        if video_uploaded:
            size_mb = video_details.get("size_mb") or 0.0
            blob_name = video_details.get("blob_name") or f"{folder_prefix}/{vid}/lecture_{vid}.mp4"
            print(f"🎉 [Upload Complete] Successfully synced {vid} ({size_mb} MB) in {duration:.1f}s.")
            record.update({
                "status": "SUCCESS",
                "blob_name": blob_name,
                "gcs_uri": f"gs://{gcs_storage_service.bucket_name}/{folder_prefix}/{vid}/",
                "size_mb": size_mb,
                "duration_seconds": round(duration, 1),
                "has_video": True,
                "has_captions": len(cues) > 0,
                "cues_count": len(cues),
                "error": None,
                "error_category": None
            })
            save_tracking_state(state, state_file)
            return {"status": "success", "video_id": vid, "size_mb": size_mb, "duration": duration}
        else:
            err_detail = video_details.get("error") or "Video upload step did not complete successfully"
            print(f"✕ [Upload Warning] Video stream failed for {vid}: {err_detail}")
            record.update({
                "status": "FAILED",
                "error": err_detail,
                "error_category": "VIDEO_UPLOAD_FAILED"
            })
            save_tracking_state(state, state_file)
            return {"status": "error", "video_id": vid, "error": err_detail}

    except Exception as e:
        err_str = str(e)
        cat = "UNKNOWN_ERROR"
        if "403" in err_str or "forbidden" in err_str.lower() or "restricted" in err_str.lower():
            cat = "AUTH_FORBIDDEN"
        elif "yt-dlp" in err_str.lower() or "ffmpeg" in err_str.lower() or "hls" in err_str.lower():
            cat = "DOWNLOAD_MUX_FAILED"
        elif "gcs" in err_str.lower() or "google" in err_str.lower() or "storage" in err_str.lower():
            cat = "GCS_ERROR"

        print(f"✕ [Failed] Video {vid} ({cat}): {err_str}")
        record.update({
            "status": "FAILED",
            "error": err_str,
            "error_category": cat
        })
        save_tracking_state(state, state_file)
        return {"status": "error", "video_id": vid, "error": err_str, "category": cat}


def main():
    parser = argparse.ArgumentParser(description="Sync PostgreSQL lecture videos to Google Cloud Storage with real-time tracking")
    parser.add_argument("--status", action="store_true", help="Print current sync tracking report and exit")
    parser.add_argument("--verbose", action="store_true", help="Include list of completed videos in status report")
    parser.add_argument("--dry-run", action="store_true", help="Probe configs and check status without downloading/uploading")
    parser.add_argument("--retry-failed", action="store_true", help="Only process videos whose status is FAILED")
    parser.add_argument("--pending-only", action="store_true", help="Only process videos that have not succeeded or been cached")
    parser.add_argument("--force", action="store_true", help="Force re-upload even if marked ALREADY_CACHED or SUCCESS")
    parser.add_argument("--video-id", type=str, default=None, help="Process a specific video ID only")
    parser.add_argument("--course", type=str, default=None, help="Process videos for a specific course only")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of videos to process in this run")
    parser.add_argument("--referer", type=str, default=DEFAULT_REFERER, help="HTTP Referer for Vimeo authentication")
    parser.add_argument("--max-height", type=int, default=720, help="Max resolution for video download (e.g. 720, 1080)")
    parser.add_argument("--state-file", type=str, default=DEFAULT_STATE_FILE, help="Path to JSON tracking file")

    args = parser.parse_args()

    state = load_tracking_state(args.state_file)

    if args.status:
        print_status_report(state, verbose=args.verbose)
        return

    print("==================================================================")
    print("🚀 LectureScribe GCS Video Batch Synchronizer & Tracker")
    print(f"   Target Bucket: gs://{gcs_storage_service.bucket_name}")
    print(f"   State File:    {args.state_file}")
    print(f"   Mode:          {'DRY-RUN (verification only)' if args.dry_run else 'LIVE SYNC'}")
    print(f"   Referer:       {args.referer}")
    if args.retry_failed:
        print("   Filter:        RETRY FAILED ONLY")
    elif args.pending_only:
        print("   Filter:        PENDING ONLY")
    print("==================================================================")

    all_videos = get_all_videos_from_db(filter_video_id=args.video_id, filter_course=args.course)
    print(f"\n📊 Found {len(all_videos)} videos in PostgreSQL matching criteria.")

    if not all_videos:
        print("No videos found to process.")
        return

    # Populate initial state for untracked videos
    for v in all_videos:
        vid = str(v["video_id"]).strip()
        if vid not in state.setdefault("videos", {}):
            state["videos"][vid] = {
                "video_id": vid,
                "title": v.get("title") or f"Lecture {vid}",
                "course_name": v.get("course_name") or "General Lectures",
                "course_slug": slugify_course(v.get("course_name")),
                "status": "PENDING",
                "attempts": 0
            }
    save_tracking_state(state, args.state_file)

    # Filtering according to CLI flags
    to_process = []
    for v in all_videos:
        vid = str(v["video_id"]).strip()
        v_status = state["videos"].get(vid, {}).get("status", "PENDING")

        if args.retry_failed:
            if v_status == "FAILED":
                to_process.append(v)
        elif args.pending_only:
            if v_status not in ("SUCCESS", "ALREADY_CACHED"):
                to_process.append(v)
        else:
            to_process.append(v)

    if args.limit:
        to_process = to_process[:args.limit]

    print(f"🎯 Will process {len(to_process)} video(s).\n")
    if not to_process:
        print("No matching videos need processing based on filters.")
        print_status_report(state)
        return

    run_summary = {"success": 0, "skipped": 0, "failed": 0, "dry_run_ready": 0}

    for idx, vid in enumerate(to_process, start=1):
        print(f"\n[{idx}/{len(to_process)}] Processing video {vid.get('video_id')}...")
        res = sync_single_video(
            video=vid,
            state=state,
            state_file=args.state_file,
            dry_run=args.dry_run,
            force=args.force,
            referer=args.referer,
            max_height=args.max_height
        )

        st = res.get("status")
        if st in ("success", "emulated"):
            run_summary["success"] += 1
        elif st == "skipped":
            run_summary["skipped"] += 1
        elif st == "dry_run_ready":
            run_summary["dry_run_ready"] += 1
        else:
            run_summary["failed"] += 1

    print("\n==================================================================")
    print("🏁 CURRENT RUN COMPLETED")
    print(f"   Processed:     {len(to_process)}")
    print(f"   Uploaded/Done: {run_summary['success']}")
    print(f"   Skipped/Cached:{run_summary['skipped']}")
    print(f"   Dry-Run Ready: {run_summary['dry_run_ready']}")
    print(f"   Failed:        {run_summary['failed']}")
    print("==================================================================")

    # Print overall persistent status report
    print_status_report(state)


if __name__ == "__main__":
    main()
