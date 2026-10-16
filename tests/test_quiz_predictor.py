import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager
from backend.quiz_predictor import predict_quizzes_from_cues

client = TestClient(app)

def test_predict_quizzes_from_cues_with_llm_response():
    sample_cues = [
        {"time": "02:15", "text": "Welcome to week 4 of Algorithms."},
        {"time": "05:30", "text": "Remember that Quiz 2 covering Binary Trees and Heaps will be next Tuesday, October 24th."},
        {"time": "06:00", "text": "Make sure to review the problem sets before then."}
    ]

    mock_llm_json = """[
        {
            "quiz_title": "Quiz 2: Binary Trees and Heaps",
            "predicted_date": "Next Tuesday, October 24th",
            "predicted_date_iso": "2026-10-24",
            "confidence": 0.95,
            "cue_time": "05:30",
            "cue_text": "Remember that Quiz 2 covering Binary Trees and Heaps will be next Tuesday, October 24th."
        }
    ]"""

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": mock_llm_json}]}}]
    }

    with patch("requests.post", return_value=mock_resp), \
         patch.dict("os.environ", {"GEMINI_API_KEY": "fake_gemini_key"}):
        predictions = predict_quizzes_from_cues(sample_cues, lecture_title="Algorithms Lecture 4", video_id="vid_test_123")
        assert len(predictions) == 1
        p = predictions[0]
        assert p["quiz_title"] == "Quiz 2: Binary Trees and Heaps"
        assert p["predicted_date"] == "Next Tuesday, October 24th"
        assert p["predicted_date_iso"] == "2026-10-24"
        assert p["cue_time"] == "05:30"
        assert p["confidence"] == 0.95


def test_predict_quizzes_from_cues_empty_response():
    sample_cues = [
        {"time": "00:00", "text": "Today we discuss asymptotic notation."},
        {"time": "01:00", "text": "Big O, Big Omega, and Big Theta."}
    ]

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "[]"}]}}]
    }

    with patch("requests.post", return_value=mock_resp), \
         patch.dict("os.environ", {"GEMINI_API_KEY": "fake_gemini_key"}):
        predictions = predict_quizzes_from_cues(sample_cues, lecture_title="Algorithms Lecture 1", video_id="vid_test_empty")
        assert predictions == []



def test_db_manager_predicted_quizzes():
    video_id = "test_vid_db_999"
    quizzes = [
        {
            "quiz_title": "Midterm Exam Quiz",
            "predicted_date": "November 10, 2026",
            "predicted_date_iso": "2026-11-10",
            "confidence": 0.9,
            "cue_time": "12:40",
            "cue_text": "Don't forget the midterm exam quiz on November 10th."
        }
    ]

    saved = db_manager.save_predicted_quizzes(
        video_id=video_id,
        course_slug="cs101-algorithms",
        course_name="CS101 Algorithms",
        quizzes=quizzes
    )
    assert len(saved) == 1
    quiz_id = saved[0]["id"]
    assert saved[0]["quiz_title"] == "Midterm Exam Quiz"

    # Query by video
    fetched = db_manager.get_predicted_quizzes(video_id=video_id)
    assert len(fetched) >= 1
    assert any(q["id"] == quiz_id for q in fetched)

    # Update status
    updated = db_manager.update_predicted_quiz_status(quiz_id, "dismissed")
    assert updated is not None
    assert updated["status"] == "dismissed"

    # Active filter should omit dismissed
    active = db_manager.get_predicted_quizzes(video_id=video_id, status="active")
    assert not any(q["id"] == quiz_id for q in active)


def test_predicted_quizzes_api_endpoints():
    video_id = "test_api_vid_888"
    quizzes = [
        {
            "quiz_title": "Pop Quiz 1",
            "predicted_date": "This Friday",
            "predicted_date_iso": "2026-10-23",
            "confidence": 0.85,
            "cue_time": "03:10",
            "cue_text": "We will have our first pop quiz this Friday."
        }
    ]
    saved = db_manager.save_predicted_quizzes(
        video_id=video_id,
        course_slug="data-structures",
        course_name="Data Structures",
        quizzes=quizzes
    )
    quiz_id = saved[0]["id"]

    # 1. GET /api/reminders/upcoming-quizzes
    res = client.get("/api/reminders/upcoming-quizzes")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert any(q["id"] == quiz_id for q in data["quizzes"])

    # 2. GET /api/lecture/{video_id}/predicted-quizzes
    res_lecture = client.get(f"/api/lecture/{video_id}/predicted-quizzes")
    assert res_lecture.status_code == 200
    data_lecture = res_lecture.json()
    assert data_lecture["video_id"] == video_id
    assert len(data_lecture["quizzes"]) >= 1

    # 3. PATCH /api/reminders/quiz/{quiz_id}
    res_patch = client.patch(f"/api/reminders/quiz/{quiz_id}", json={"status": "confirmed"})
    assert res_patch.status_code == 200
    assert res_patch.json()["quiz"]["status"] == "confirmed"
