"""Integration tests for the Cloud Run transcription HTTP service."""
from __future__ import annotations

import io
import socket
import sys
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from services.transcription import app as transcription_app
from services.transcription import transcription

client = TestClient(transcription_app.app)


def _make_mock_wav_fixture() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 1600)
    return buffer.getvalue()


MOCK_AUDIO_FIXTURE = _make_mock_wav_fixture()


def _groq_response(status_code: int, text: str = "", *, retry_after: str | None = None):
    headers = {"Retry-After": retry_after} if retry_after else {}
    return SimpleNamespace(
        status_code=status_code,
        headers=headers,
        text=text,
        ok=200 <= status_code < 300,
        json=lambda: {"text": text, "segments": [{"start": 0, "end": 1, "text": text}]},
    )


def _mock_ffmpeg(args: list[str]) -> None:
    source = Path(args[args.index("-i") + 1])
    assert source.is_file()
    target = Path(args[-1])
    if target.name == "audio.mp3":
        target.write_bytes(b"mock-extracted-mp3-that-exceeds-the-test-size-limit")
        return
    for index, content in enumerate((b"chunk-one", b"chunk-two")):
        (target.parent / f"audio-chunk-{index:05d}.mp3").write_bytes(content)


def test_upload_endpoint_extracts_chunks_and_retries_groq(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setattr(transcription, "MAX_GROQ_PAYLOAD_BYTES", 12)
    monkeypatch.setattr(transcription, "_run_ffmpeg", _mock_ffmpeg)
    monkeypatch.setattr(
        transcription,
        "_media_duration",
        lambda path: 30.0 if path.is_file() else 0.0,
    )
    observed_payload_sizes: list[int] = []
    groq_responses = [
        _groq_response(429, "rate limited", retry_after="0"),
        _groq_response(200, "first chunk transcript"),
        _groq_response(200, "second chunk transcript"),
    ]

    def mock_groq_post(url, **kwargs):
        assert url == transcription.GROQ_TRANSCRIPTION_URL
        assert kwargs["data"]["model"] == "whisper-large-v3"
        assert kwargs["data"]["response_format"] == "verbose_json"
        file_tuple = kwargs["files"]["file"]
        observed_payload_sizes.append(len(file_tuple[1].read()))
        return groq_responses.pop(0)

    with patch.object(transcription, "time") as mock_time, patch.object(
        transcription.requests, "post", side_effect=mock_groq_post
    ) as groq_post:
        response = client.post(
            "/transcribe",
            files={"file": ("lecture.wav", io.BytesIO(MOCK_AUDIO_FIXTURE), "audio/wav")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "first chunk transcript\nsecond chunk transcript"
    assert body["model"] == "whisper-large-v3"
    assert body["chunks"] == 2
    assert body["segments"][0]["start"] == 0
    assert body["segments"][1]["start"] == 30
    assert all(size <= 12 for size in observed_payload_sizes)
    assert groq_post.call_count == 3
    mock_time.sleep.assert_called_once_with(0)


def test_remote_url_endpoint_downloads_public_https_media(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setattr(transcription, "_run_ffmpeg", _mock_ffmpeg)
    monkeypatch.setattr(transcription, "MAX_GROQ_PAYLOAD_BYTES", 1000)
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, port, **kwargs: (
            [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
            if host == "media.example" and port == 443 and kwargs.get("type") == socket.SOCK_STREAM
            else []
        ),
    )

    class MockDownload:
        is_redirect = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            del exc_type, exc_value, traceback
            return None

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size: int):
            assert chunk_size == 1024 * 1024
            yield MOCK_AUDIO_FIXTURE

    with patch.object(transcription.requests, "get", return_value=MockDownload()) as download, patch.object(
        transcription.requests,
        "post",
        return_value=_groq_response(200, "remote transcript"),
    ):
        response = client.post("/transcribe/url", json={"url": "https://media.example/lecture.mp4"})

    assert response.status_code == 200
    assert response.json()["text"] == "remote transcript"
    download.assert_called_once_with(
        "https://media.example/lecture.mp4",
        stream=True,
        timeout=(10, 60),
        allow_redirects=False,
    )


def test_remote_url_endpoint_rejects_internal_addresses():
    with patch.object(
        socket,
        "getaddrinfo",
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    ):
        response = client.post("/transcribe/url", json={"url": "https://internal.example/media.mp4"})

    assert response.status_code == 400
    assert "public IP" in response.json()["detail"]


def test_vimeo_url_resolves_and_downloads_media(monkeypatch, tmp_path):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda host, port, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
        ],
    )
    observed = {}

    class MockYoutubeDL:
        def __init__(self, options):
            observed["options"] = options

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            del exc_type, exc_value, traceback
            return None

        def extract_info(self, url, download):
            observed["url"] = url
            observed["download"] = download
            return {"id": "123456789", "ext": "m4a"}

        def prepare_filename(self, info):
            del info
            path = tmp_path / "source.m4a"
            path.write_bytes(MOCK_AUDIO_FIXTURE)
            return str(path)

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=MockYoutubeDL))
    source = transcription.download_media_url(
        "https://vimeo.com/123456789?share=copy",
        tmp_path / "source.media",
    )

    assert source == tmp_path / "source.m4a"
    assert source.read_bytes() == MOCK_AUDIO_FIXTURE
    assert observed["url"] == "https://vimeo.com/123456789?share=copy"
    assert observed["download"] is True
    assert observed["options"]["noplaylist"] is True
    assert observed["options"]["extractor_args"] == {"vimeo": {"client": ["android"]}}


def test_vimeo_url_rejects_non_video_paths(tmp_path):
    try:
        transcription.download_media_url("https://vimeo.com/channels/staffpicks/123", tmp_path / "source.media")
    except ValueError as exc:
        assert "Only Vimeo video page URLs" in str(exc)
    else:
        raise AssertionError("Expected an invalid Vimeo page path to be rejected.")


def test_upload_endpoint_requires_groq_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    with patch.object(transcription, "_run_ffmpeg", _mock_ffmpeg):
        response = client.post(
            "/transcribe",
            files={"file": ("lecture.wav", io.BytesIO(MOCK_AUDIO_FIXTURE), "audio/wav")},
        )

    assert response.status_code == 502
    assert "GROQ_API_KEY" in response.json()["detail"]
