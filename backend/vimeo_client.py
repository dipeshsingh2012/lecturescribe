"""
Vimeo Metadata & Caption Track Client for LectureScribe Backend
--------------------------------------------------------------
Extracts Vimeo player config, text track metadata, downloads VTT captions,
and parses timestamps into structured cue segments for backend ingestion.
"""
from __future__ import annotations

import re
import json
import urllib.request
from typing import Dict, Any, List, Optional


def extract_video_id(url: str) -> str:
    """Extract Vimeo video ID from URL or raw ID string."""
    if not url:
        raise ValueError("URL cannot be empty")
    url_str = str(url).strip()
    if url_str.isdigit():
        return url_str
    match = re.search(r"vimeo\.com/(?:video/)?(\d+)", url_str)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract Vimeo video ID from: {url}")


def fetch_player_config(video_id: str) -> Dict[str, Any]:
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
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_error = e

    raise RuntimeError(
        f"Failed to fetch player config for video {video_id}: {last_error}"
    )


def get_text_tracks(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract text tracks (captions/subtitles) from player config."""
    tracks = config.get("request", {}).get("text_tracks", [])
    if not tracks:
        for key in ("text_tracks", "captions", "subtitles"):
            if key in config:
                tracks = config[key]
                break
    return tracks or []


def fetch_vtt(url: str) -> str:
    """Download a VTT caption file from Vimeo CDN."""
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def parse_vtt(vtt_content: str) -> List[Dict[str, str]]:
    """Parse raw VTT content into list of {start, end, text} segments."""
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


def format_duration(seconds: int | float | None) -> str:
    """Format total seconds into human-readable duration (e.g. '1h 42m 01s' or '45m 30s')."""
    if not seconds:
        return "Unknown"
    sec = int(seconds)
    hours = sec // 3600
    minutes = (sec % 3600) // 60
    remaining_secs = sec % 60
    if hours > 0:
        return f"{hours}h {minutes:02d}m {remaining_secs:02d}s"
    return f"{minutes}m {remaining_secs:02d}s"


def get_video_download_streams(config: Dict[str, Any], video_id: str = "") -> Dict[str, Any]:
    """Extract direct progressive MP4 downloads, HLS streams, and download commands from Vimeo player config."""
    req = config.get("request", {})
    files = req.get("files", {})
    video_meta = config.get("video", {})

    title = video_meta.get("title") or f"Lecture_{video_id}"
    duration = video_meta.get("duration")
    duration_str = format_duration(duration)
    owner = video_meta.get("owner", {}).get("name", "Unknown")

    # 1. Progressive MP4 streams (direct downloadable files)
    progressive_streams: List[Dict[str, Any]] = []
    raw_prog = files.get("progressive") or []
    if isinstance(raw_prog, list):
        for item in raw_prog:
            if isinstance(item, dict) and item.get("url"):
                progressive_streams.append({
                    "quality": item.get("quality", "standard"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                    "fps": item.get("fps"),
                    "mime": item.get("mime", "video/mp4"),
                    "url": item.get("url"),
                })
        # Sort highest resolution first
        progressive_streams.sort(key=lambda x: (x.get("height") or 0), reverse=True)

    # 2. HLS Adaptive Streaming (.m3u8)
    hls_data = files.get("hls", {})
    hls_master_url: Optional[str] = None
    hls_cdn: Optional[str] = None
    hls_qualities: List[str] = []

    if isinstance(hls_data, dict):
        cdns = hls_data.get("cdns", {})
        default_cdn = hls_data.get("default_cdn")
        if default_cdn and default_cdn in cdns:
            hls_cdn = default_cdn
            hls_master_url = cdns[default_cdn].get("url")
        elif cdns:
            first_key = list(cdns.keys())[0]
            hls_cdn = first_key
            hls_master_url = cdns[first_key].get("url")
        elif hls_data.get("url"):
            hls_master_url = hls_data.get("url")

        raw_streams = hls_data.get("streams", [])
        if isinstance(raw_streams, list):
            for s in raw_streams:
                if isinstance(s, dict) and s.get("quality"):
                    q = s.get("quality")
                    if q not in hls_qualities:
                        hls_qualities.append(q)

    # 3. Helper download commands for HLS (VLC, ffmpeg, yt-dlp)
    safe_filename = re.sub(r'[^a-zA-Z0-9_\- ]', '_', title).strip().replace(' ', '_')
    if not safe_filename:
        safe_filename = f"lecture_{video_id}"

    commands: Dict[str, str] = {}
    if hls_master_url:
        commands = {
            "ffmpeg": f'ffmpeg -i "{hls_master_url}" -c copy "{safe_filename}.mp4"',
            "yt_dlp": f'yt-dlp "{hls_master_url}" -o "{safe_filename}.mp4"',
            "vlc": f'vlc "{hls_master_url}"',
        }

    return {
        "video_id": video_id,
        "title": title,
        "duration": duration,
        "duration_formatted": duration_str,
        "owner": owner,
        "has_progressive": len(progressive_streams) > 0,
        "progressive_streams": progressive_streams,
        "has_hls": bool(hls_master_url),
        "hls": {
            "master_url": hls_master_url,
            "cdn": hls_cdn,
            "qualities": hls_qualities,
        },
        "commands": commands,
        "filename": f"{safe_filename}.mp4",
    }

