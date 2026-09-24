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
