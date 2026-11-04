"""
Unit Tests for Quick Solver Service & Endpoint
----------------------------------------------
Tests parsing, model selection, prompt formulation, and endpoint behavior.
"""
import base64
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from backend.quick_solver_service import (
    parse_image_data,
    quick_solve_handwritten_image,
    FAST_SYSTEM_PROMPT,
    DETAILED_SYSTEM_PROMPT
)
from backend.main import app


client = TestClient(app)


def test_parse_image_data_url():
    sample_bytes = b"fake-png-bytes-for-test"
    sample_b64 = base64.b64encode(sample_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{sample_b64}"

    mime, raw = parse_image_data(data_url)
    assert mime == "image/png"
    assert raw == sample_bytes


def test_parse_raw_base64():
    sample_bytes = b"fake-jpeg-bytes-for-test"
    sample_b64 = base64.b64encode(sample_bytes).decode("utf-8")

    mime, raw = parse_image_data(sample_b64)
    assert mime == "image/jpeg"
    assert raw == sample_bytes


def test_parse_image_data_empty():
    with pytest.raises(ValueError):
        parse_image_data("")


def test_system_prompt_rules():
    assert "MAXIMUM SPEED" in FAST_SYSTEM_PROMPT
    assert "MCQ" in FAST_SYSTEM_PROMPT
    assert "DO NOT provide step-by-step working" in FAST_SYSTEM_PROMPT
    assert "Transcribed Problem" in DETAILED_SYSTEM_PROMPT


@patch("backend.quick_solver_service.requests.post")
@patch.dict("os.environ", {"GEMINI_API_KEY": "fake_test_key"})
def test_quick_solve_handwritten_image_success(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "**Answer: Option (B)**\n$x = 4$"}]
                }
            }
        ]
    }
    mock_post.return_value = mock_resp

    res = quick_solve_handwritten_image(
        image_bytes=b"sample-image-data",
        mime_type="image/png",
        prompt="Solve for x",
        course_context="Calculus I",
        detailed=False
    )

    assert res["status"] == "success"
    assert "Option (B)" in res["answer"]
    assert res["detailed"] is False
    assert res["course_context"] == "Calculus I"
    assert res["response_time_ms"] >= 0


@patch("backend.quick_solver_service.requests.post")
@patch.dict("os.environ", {"GEMINI_API_KEY": "fake_test_key"})
def test_quick_solve_endpoint_fastapi(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "**Answer: Option (C)**"}]
                }
            }
        ]
    }
    mock_post.return_value = mock_resp

    sample_b64 = base64.b64encode(b"dummy-image").decode("utf-8")
    payload = {
        "image_data": f"data:image/jpeg;base64,{sample_b64}",
        "prompt": "Find correct option",
        "course_context": "Physics 101",
        "detailed": False
    }

    response = client.post("/api/quick-solve", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "Option (C)" in data["answer"]
