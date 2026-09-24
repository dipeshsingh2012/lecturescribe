#!/usr/bin/env python3
"""
LectureScribe - Vimeo & Video Lecture Transcript Extractor
---------------------------------------------------------
Extracts auto-generated or manual captions from Vimeo video URLs and formats them into timestamped Markdown.

Usage:
    python3 lecturescribe.py <VIMEO_URL_OR_ID> [--output FILE] [--clean-only]

Examples:
    python3 lecturescribe.py https://vimeo.com/1229247139
    python3 lecturescribe.py 1229247139 --output lecture1_transcript.md
"""

import json
import re
import sys
import urllib.request
from pathlib import Path


def extract_video_id(url: str) -> str:
    """Extract Vimeo video ID from URL or raw ID string."""
    if url.isdigit():
        return url
    match = re.search(r"vimeo\.com/(?:video/)?(\d+)", url)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract Vimeo video ID from: {url}")


def fetch_player_config(video_id: str) -> dict:
    """Fetch Vimeo player config JSON to get video metadata and text tracks."""
    urls_to_try = [
        f"https://player.vimeo.com/video/{video_id}/config",
        f"https://player.vimeo.com/video/{video_id}/config?byline=0&portrait=0",
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://vimeo.com/",
        "Accept": "application/json",
    }

    last_error = None
    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=15)
            return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_error = e

    raise RuntimeError(
        f"Failed to fetch player config for video {video_id}: {last_error}"
    )


def get_text_tracks(config: dict) -> list:
    """Extract text tracks (captions/subtitles) from player config."""
    tracks = config.get("request", {}).get("text_tracks", [])
    if not tracks:
        for key in ("text_tracks", "captions", "subtitles"):
            if key in config:
                tracks = config[key]
                break
    return tracks


def fetch_vtt(url: str) -> str:
    """Download a VTT caption file."""
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    req = urllib.request.Request(url, headers=headers)
    resp = urllib.request.urlopen(req, timeout=30)
    return resp.read().decode("utf-8")


def parse_vtt(vtt_content: str) -> list:
    """Parse VTT content into list of {start, end, text} dicts."""
    segments = []
    lines = vtt_content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if "-->" in line:
            parts = line.split("-->")
            start = parts[0].strip().split()[0]
            end = parts[1].strip().split()[0]

            text_lines = []
            i += 1
            while i < len(lines) and lines[i].strip():
                text_lines.append(lines[i].strip())
                i += 1

            text = " ".join(text_lines)
            text = re.sub(r"<[^>]+>", "", text)  # strip VTT tags

            if text.strip():
                segments.append({"start": start, "end": end, "text": text.strip()})
        else:
            i += 1

    return segments


def format_timestamp(ts: str) -> str:
    """Convert HH:MM:SS.mmm to compact MM:SS or H:MM:SS."""
    parts = ts.split(":")
    if len(parts) == 3:
        h, m, s = parts
        s = s.split(".")[0]
        if int(h) > 0:
            return f"{int(h)}:{m}:{s}"
        return f"{m}:{s}"
    return ts.split(".")[0]


def generate_transcript(video_url: str, output_path: str = None, force: bool = False) -> str:
    """Main entry point: extract transcript from a Vimeo URL with local caching."""
    video_id = extract_video_id(video_url)
    print(f"[1/4] Extracting video ID: {video_id}")

    # Check local SQLite cache first to avoid re-generating transcripts
    db_file = Path(__file__).parent / "lecturescribe.db"
    if db_file.exists() and not force:
        try:
            import sqlite3
            with sqlite3.connect(str(db_file)) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT * FROM lecturescribe_videos WHERE video_id = ?", (video_id,))
                v_row = cur.fetchone()
                if v_row:
                    cur.execute("SELECT timestamp, text FROM lecturescribe_transcript_cues WHERE video_id = ? ORDER BY id ASC", (video_id,))
                    cues = cur.fetchall()
                    if cues:
                        title = v_row["title"]
                        safe_title = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "_")[:60]
                        target_path = output_path or f"{safe_title}_transcript.md"
                        if Path(target_path).exists():
                            print(f"\n⚡ [Cache Hit] Transcript already generated at: {target_path}")
                            print(f"   Skipping re-generation. ({len(cues)} segments retrieved from database cache)")
                            print("   (Pass --force to re-generate from Vimeo)")
                            return target_path
        except Exception:
            pass

    if output_path and Path(output_path).exists() and not force:
        print(f"\n⚡ [Cache Hit] Output file '{output_path}' already exists.")
        print("   Skipping transcript re-generation. (Pass --force to overwrite)")
        return output_path

    print("[2/4] Fetching player configuration & captions metadata...")
    config = fetch_player_config(video_id)

    title = config.get("video", {}).get("title", f"Vimeo Video {video_id}")
    print(f"       Title: {title}")

    tracks = get_text_tracks(config)
    if not tracks:
        print("[ERROR] No captions/subtitles found for this video.")
        sys.exit(1)

    print(f"[3/4] Found {len(tracks)} caption track(s):")
    for t in tracks:
        print(f"       - {t.get('label', 'Unknown')} ({t.get('lang', '?')})")

    track = next((t for t in tracks if t.get("default")), tracks[0])
    vtt_url = track.get("url") or track.get("src")
    if not vtt_url:
        print("[ERROR] No URL found for caption track.")
        sys.exit(1)

    print(f"       Using track: {track.get('label', 'Unknown')}")
    vtt_content = fetch_vtt(vtt_url)
    segments = parse_vtt(vtt_content)
    print(f"[4/4] Successfully parsed {len(segments)} caption segments.")

    md_lines = [
        f"# {title}\n",
        f"**Source:** https://vimeo.com/{video_id}",
        f"**Captions:** {track.get('label', 'Unknown')}",
        f"**Segments:** {len(segments)}\n",
        "---\n",
    ]

    for seg in segments:
        ts = format_timestamp(seg["start"])
        md_lines.append(f"**[{ts}]** {seg['text']}\n")

    transcript = "\n".join(md_lines)

    if not output_path:
        safe_title = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "_")[:60]
        output_path = f"{safe_title}_transcript.md"

    Path(output_path).write_text(transcript, encoding="utf-8")
    print(f"\n✅ Transcript saved to: {output_path}")
    print(f"   {len(segments)} segments, {len(transcript)} characters")

    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    url = sys.argv[1]
    output = None
    force_flag = "--force" in sys.argv

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output = sys.argv[idx + 1]

    generate_transcript(url, output, force=force_flag)

