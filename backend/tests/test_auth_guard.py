import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager


client = TestClient(app)


def test_transcript_endpoint_requires_auth_for_new_video_ingestion():
    # Attempting to ingest an uncached video without email
    resp = client.get("/api/transcript?url=https://video.lecturescribe.local/999888777")
    assert resp.status_code == 401
    assert "Authentication required" in resp.json()["detail"]


def test_transcribe_lecture_endpoint_requires_auth():
    # Attempting to transcribe without email
    resp = client.post("/api/lecture/999888777/transcribe")
    assert resp.status_code == 401
    assert "Authentication required" in resp.json()["detail"]


def test_extension_import_requires_auth():
    # Attempting extension import without email
    resp = client.post("/api/extension/import", json={"video_id": "999888777"})
    assert resp.status_code == 401
    assert "Authentication required" in resp.json()["detail"]

