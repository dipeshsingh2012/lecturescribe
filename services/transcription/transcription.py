"""Audio extraction and Groq Whisper transcription pipeline."""
from __future__ import annotations

import ipaddress
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-large-v3"
MAX_GROQ_PAYLOAD_BYTES = 25_000_000
MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SECONDS = 30 * 60
MAX_RETRIES = 4


class TranscriptionError(RuntimeError):
    """Raised when media cannot be extracted or transcribed."""


def validate_public_https_url(url: str) -> str:
    """Accept public HTTPS URLs only; reject hosts resolving to non-public IPs."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Remote media URL must use HTTPS.")
    if parsed.username or parsed.password:
        raise ValueError("Remote media URLs must not include credentials.")
    if parsed.port not in (None, 443):
        raise ValueError("Remote media URL must use the standard HTTPS port.")

    hostname = parsed.hostname.rstrip(".")
    try:
        addresses = {
            ipaddress.ip_address(result[4][0])
            for result in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as exc:
        raise ValueError("Remote media host could not be resolved.") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Remote media URL must resolve only to public IP addresses.")
    return url


def download_remote_media(url: str, destination: Path) -> int:
    """Download a public HTTPS media URL to disk without following redirects."""
    safe_url = validate_public_https_url(url)
    try:
        with requests.get(safe_url, stream=True, timeout=(10, 60), allow_redirects=False) as response:
            if response.is_redirect:
                raise ValueError("Remote media URL redirects are not supported.")
            response.raise_for_status()

            total_bytes = 0
            with destination.open("wb") as output:
                for block in response.iter_content(chunk_size=1024 * 1024):
                    if not block:
                        continue
                    total_bytes += len(block)
                    if total_bytes > MAX_SOURCE_BYTES:
                        raise ValueError("Remote media exceeds the 2 GiB source limit.")
                    output.write(block)
    except requests.RequestException as exc:
        raise TranscriptionError(f"Unable to download remote media: {exc}") from exc

    if total_bytes == 0:
        raise ValueError("Remote media URL returned an empty file.")
    return total_bytes


def download_media_url(url: str, destination: Path) -> Path:
    """Download direct media URLs or resolve Vimeo pages with yt-dlp."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if hostname not in {"vimeo.com", "www.vimeo.com"}:
        download_remote_media(url, destination)
        return destination
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Vimeo URL must use HTTPS without credentials or a custom port.")
    if not re.fullmatch(r"/\d+/?", parsed.path):
        raise ValueError("Only Vimeo video page URLs are supported.")
    validate_public_https_url(url)

    try:
        import yt_dlp
    except ImportError as exc:
        raise TranscriptionError("yt-dlp is not installed in the transcription service.") from exc

    output_template = str(destination.with_suffix(".%(ext)s"))
    options: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": MAX_SOURCE_BYTES,
        "socket_timeout": 30,
        "retries": 3,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            downloaded_path = Path(downloader.prepare_filename(info))
    except Exception as exc:
        raise TranscriptionError(f"Unable to download Vimeo media: {exc}") from exc

    if not downloaded_path.is_file():
        raise TranscriptionError("yt-dlp completed without producing a media file.")
    if downloaded_path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Vimeo media exceeds the 2 GiB source limit.")
    if downloaded_path.stat().st_size == 0:
        raise ValueError("Vimeo returned an empty media file.")
    return downloaded_path


def _run_ffmpeg(args: list[str]) -> None:
    try:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True,
            text=True,
            timeout=60 * 60,
            check=False,
        )
    except FileNotFoundError as exc:
        raise TranscriptionError("ffmpeg is not installed in the transcription service.") from exc
    except subprocess.TimeoutExpired as exc:
        raise TranscriptionError("ffmpeg timed out while processing the media.") from exc
    if result.returncode != 0:
        details = (result.stderr or "Unknown ffmpeg error").strip()[-1000:]
        raise TranscriptionError(f"ffmpeg could not extract audio: {details}")


def extract_audio(source: Path, workspace: Path) -> list[Path]:
    """Convert media to 16 kHz mono MP3, splitting oversized audio into chunks."""
    extracted = workspace / "audio.mp3"
    _run_ffmpeg([
        "-i", str(source),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-codec:a", "libmp3lame",
        "-b:a", "64k",
        str(extracted),
    ])
    if not extracted.is_file() or extracted.stat().st_size == 0:
        raise TranscriptionError("ffmpeg produced no audio for this media.")

    if extracted.stat().st_size <= MAX_GROQ_PAYLOAD_BYTES:
        return [extracted]

    pattern = workspace / "audio-chunk-%05d.mp3"
    _run_ffmpeg([
        "-i", str(source),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-codec:a", "libmp3lame",
        "-b:a", "64k",
        "-f", "segment",
        "-segment_time", str(CHUNK_SECONDS),
        "-reset_timestamps", "1",
        str(pattern),
    ])
    chunks = sorted(workspace.glob("audio-chunk-*.mp3"))
    if len(chunks) < 2:
        raise TranscriptionError("Oversized audio could not be split into smaller chunks.")
    if any(chunk.stat().st_size > MAX_GROQ_PAYLOAD_BYTES for chunk in chunks):
        raise TranscriptionError("An extracted audio chunk exceeds Groq's 25 MB request limit.")
    return chunks


def _media_duration(path: Path) -> float:
    """Read an audio chunk's duration using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode == 0:
            return max(0.0, float(result.stdout.strip()))
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
        pass
    return 0.0


def _transcribe_chunk(path: Path, api_key: str) -> dict[str, Any]:
    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with path.open("rb") as audio:
                response = requests.post(
                    GROQ_TRANSCRIPTION_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    data={"model": WHISPER_MODEL, "response_format": "verbose_json"},
                    files={"file": (path.name, audio, "audio/mpeg")},
                    timeout=(10, 300),
                )
        except requests.RequestException as exc:
            last_error = str(exc)
            if attempt + 1 == MAX_RETRIES:
                break
            time.sleep(min(2 ** attempt, 16))
            continue

        if response.status_code == 429 or response.status_code >= 500:
            last_error = f"Groq returned HTTP {response.status_code}: {response.text[:500]}"
            if attempt + 1 == MAX_RETRIES:
                break
            retry_after = response.headers.get("Retry-After")
            try:
                delay = min(max(float(retry_after), 0), 30) if retry_after else min(2 ** attempt, 16)
            except ValueError:
                delay = min(2 ** attempt, 16)
            time.sleep(delay)
            continue

        if not response.ok:
            raise TranscriptionError(
                f"Groq transcription failed (HTTP {response.status_code}): {response.text[:1000]}"
            )
        try:
            result = response.json()
        except ValueError as exc:
            raise TranscriptionError("Groq returned invalid JSON for the transcription.") from exc
        if not isinstance(result, dict) or not isinstance(result.get("text"), str):
            raise TranscriptionError("Groq response did not contain transcript text.")
        return result

    raise TranscriptionError(f"Groq transcription failed after retries: {last_error}")


def transcribe_media_file(source: Path) -> dict[str, Any]:
    """Extract audio and transcribe each chunk with Groq Whisper."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise TranscriptionError("GROQ_API_KEY is not configured.")

    with tempfile.TemporaryDirectory(prefix="lecturescribe-transcription-") as temp_dir:
        workspace = Path(temp_dir)
        chunks = extract_audio(source, workspace)
        text_parts: list[str] = []
        segments: list[dict[str, Any]] = []
        offset = 0.0

        for chunk_index, chunk in enumerate(chunks):
            if chunk.stat().st_size > MAX_GROQ_PAYLOAD_BYTES:
                raise TranscriptionError("Audio payload exceeds Groq's 25 MiB request limit.")
            result = _transcribe_chunk(chunk, api_key)
            chunk_text = result["text"].strip()
            if chunk_text:
                text_parts.append(chunk_text)

            for segment in result.get("segments", []):
                if isinstance(segment, dict):
                    adjusted = dict(segment)
                    for field in ("start", "end"):
                        value = adjusted.get(field)
                        if isinstance(value, (int, float)):
                            adjusted[field] = value + offset
                    adjusted["chunk_index"] = chunk_index
                    segments.append(adjusted)
            offset += _media_duration(chunk)

        return {
            "text": "\n".join(text_parts),
            "segments": segments,
            "model": WHISPER_MODEL,
            "chunks": len(chunks),
        }
