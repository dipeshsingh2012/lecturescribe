"""HTTP API for Cloud Run media transcription."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from services.transcription.transcription import (
    MAX_SOURCE_BYTES,
    TranscriptionError,
    download_media_url,
    transcribe_media_file,
)

app = FastAPI(title="LectureScribe Transcription API")


class RemoteTranscriptionRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


def _transcribe_or_http_error(source: Path) -> dict[str, Any]:
    try:
        return transcribe_media_file(source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TranscriptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "lecturescribe-transcription"}


@app.post("/transcribe")
def transcribe_upload(file: Annotated[UploadFile, File(...)]) -> dict[str, Any]:
    """Accept a video or audio upload and return its transcript."""
    try:
        with tempfile.TemporaryDirectory(prefix="lecturescribe-upload-") as temp_dir:
            source = Path(temp_dir) / "source.media"
            total_bytes = 0
            with source.open("wb") as destination:
                while block := file.file.read(1024 * 1024):
                    total_bytes += len(block)
                    if total_bytes > MAX_SOURCE_BYTES:
                        raise HTTPException(status_code=413, detail="Uploaded media exceeds the 2 GiB source limit.")
                    destination.write(block)
            if total_bytes == 0:
                raise HTTPException(status_code=400, detail="Uploaded media file is empty.")
            return _transcribe_or_http_error(source)
    finally:
        file.file.close()


@app.post("/transcribe/url")
def transcribe_url(request: RemoteTranscriptionRequest) -> dict[str, Any]:
    """Download public HTTPS media and return its transcript."""
    try:
        with tempfile.TemporaryDirectory(prefix="lecturescribe-remote-") as temp_dir:
            source = download_media_url(request.url, Path(temp_dir) / "source.media")
            return _transcribe_or_http_error(source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TranscriptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
