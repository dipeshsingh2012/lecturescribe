import io
import json
import datetime
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager
from backend.calendar_parser import calendar_service, IST
from backend.calendar_ai_service import (
    extract_calendar_events_from_pdf,
    extract_calendar_events_from_transcript,
    sync_predicted_quizzes_to_calendar,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_calendar_memory():
    """Ensure calendar memory cache is clean before and after each test."""
    db_manager._calendar_events_memory = []
    yield
    db_manager._calendar_events_memory = []


def test_db_save_get_update_delete_calendar_events():
    today_iso = datetime.datetime.now(IST).strftime("%Y-%m-%d")
    ev = {
        "id": "cal_test_001",
        "title": "Mid-Semester Exam: Machine Learning",
        "description": "Units 1 to 3",
        "category": "exam",
        "event_scope": "course",
        "course_name": "Machine Learning",
        "start_time": f"{today_iso}T09:30:00+05:30",
        "end_time": f"{today_iso}T12:30:00+05:30",
        "location": "LH-101",
        "source_type": "pdf_ai",
        "ai_confidence": 0.95,
        "source_metadata": {"pdf_filename": "MidSem_Schedule.pdf", "page_number": 1},
    }

    saved = db_manager.save_calendar_events([ev])
    assert len(saved) == 1
    assert saved[0]["id"] == "cal_test_001"
    assert saved[0]["course_slug"] == "machine-learning"
    assert saved[0]["category"] == "exam"

    # Course-filtered retrieval
    ml_events = db_manager.get_calendar_events(course_slug="machine-learning")
    assert any(e["id"] == "cal_test_001" for e in ml_events)

    # Update event
    updated = db_manager.update_calendar_event("cal_test_001", {"location": "Auditorium A"})
    assert updated is not None
    assert updated["location"] == "Auditorium A"

    # Delete event
    deleted = db_manager.delete_calendar_event("cal_test_001")
    assert deleted is True


def test_extract_calendar_events_from_pdf_fallback_and_auto_save():
    tomorrow = (datetime.datetime.now(IST).date() + datetime.timedelta(days=1)).isoformat()
    fake_pdf_text = (
        "--- Page 1 ---\n"
        f"{tomorrow} | 09:30 AM - 12:30 PM | CS301 Machine Learning End-Sem Exam | Room LH-202\n"
        f"{tomorrow} | 02:00 PM - 05:00 PM | CS302 Deep Learning Viva Evaluation | Lab 3\n"
    )

    with patch("backend.calendar_ai_service.extract_text_from_pdf", return_value=fake_pdf_text), \
         patch.dict("os.environ", {"GEMINI_API_KEY": "", "GROQ_API_KEY": ""}, clear=False):
        events = extract_calendar_events_from_pdf(
            pdf_bytes=b"%PDF-1.4 mock exam timetable",
            filename="EndSem_Timetable.pdf",
            course_name="Machine Learning",
            auto_save=True,
        )

    assert len(events) == 2
    assert events[0]["source_type"] == "pdf_ai"
    assert events[0]["category"] == "exam"
    assert events[0]["source_metadata"]["pdf_filename"] == "EndSem_Timetable.pdf"


def test_extract_calendar_events_from_transcript_with_mock_llm():
    tomorrow = (datetime.datetime.now(IST).date() + datetime.timedelta(days=2)).isoformat()
    sample_cues = [
        {"time": "05:10", "text": "Today we will study Support Vector Machines."},
        {"time": "14:22", "text": f"Please remember that Quiz 2 on SVM will be held on {tomorrow} at 10:00 AM."},
    ]

    mock_llm_json = json.dumps([
        {
            "title": "Quiz 2: Support Vector Machines",
            "description": "Announced during SVM lecture",
            "category": "quiz",
            "predicted_date": tomorrow,
            "date_iso": tomorrow,
            "start_time": "10:00",
            "end_time": "11:00",
            "cue_time": "14:22",
            "cue_text": f"Please remember that Quiz 2 on SVM will be held on {tomorrow} at 10:00 AM.",
            "confidence": 0.94,
        }
    ])

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": mock_llm_json}]}}]
    }

    with patch.dict("os.environ", {"GEMINI_API_KEY": "test_key"}, clear=False), \
         patch("backend.calendar_ai_service.requests.post", return_value=mock_resp):
        events = extract_calendar_events_from_transcript(
            video_id="vid_svm_101",
            title="Lecture 12: Support Vector Machines",
            cues=sample_cues,
            course_name="Machine Learning",
            auto_save=True,
        )

    assert len(events) == 1
    ev = events[0]
    assert ev["title"] == "Quiz 2: Support Vector Machines"
    assert ev["source_type"] == "transcript_ai"
    assert ev["source_metadata"]["video_id"] == "vid_svm_101"
    assert ev["source_metadata"]["cue_time"] == "14:22"
    assert ev["source_metadata"]["timestamp_sec"] == 14 * 60 + 22


def test_api_calendar_endpoints_and_whatsapp_slot_integration():
    today_iso = datetime.datetime.now(IST).strftime("%Y-%m-%d")

    # 1. POST /api/calendar/events
    res_post = client.post(
        "/api/calendar/events",
        json={
            "id": "cal_api_exam_1",
            "title": "Operating Systems Final Exam",
            "category": "exam",
            "course_name": "Operating Systems",
            "start_time": f"{today_iso}T14:00:00+05:30",
            "end_time": f"{today_iso}T17:00:00+05:30",
            "location": "Main Auditorium",
            "source_type": "pdf_ai",
        },
    )
    assert res_post.status_code == 200
    assert res_post.json()["count"] == 1

    # 2. GET /api/calendar/events with course filter
    with patch.object(calendar_service, "get_events", return_value=[]):
        res_get = client.get("/api/calendar/events?course=Operating+Systems")
        assert res_get.status_code == 200
        data = res_get.json()
        assert any(e["id"] == "cal_api_exam_1" for e in data["today"]["all"])

        # 3. Verify WhatsApp 8am/4pm slot filter includes AI-injected calendar event
        matched, slot_label, _ = calendar_service.filter_events_for_slot("8am")
        assert "8:00 AM" in slot_label
        assert any(e["id"] == "cal_api_exam_1" for e in matched)

        # 4. GET /api/calendar/export.ics
        res_ics = client.get("/api/calendar/export.ics?course=Operating+Systems")
        assert res_ics.status_code == 200
        assert "BEGIN:VCALENDAR" in res_ics.text
        assert "Operating Systems Final Exam" in res_ics.text

    # 5. DELETE /api/calendar/events/{id}
    res_del = client.delete("/api/calendar/events/cal_api_exam_1")
    assert res_del.status_code == 200

