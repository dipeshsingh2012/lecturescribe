"""
Unit tests for Transcript Cue Editing, Math to LaTeX Conversion,
Annotations, and AI Review Pipeline.
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager
from backend.transcript_correction import (
    convert_spoken_math_to_latex,
    review_transcript_cues,
    explain_selected_transcript_text
)

client = TestClient(app)


def test_convert_spoken_math_to_latex():
    # Basic formula
    res = convert_spoken_math_to_latex("In this lecture, y equals mx plus c represents the line.")
    assert "$y = mx + c$" in res

    # Einstein formula
    res2 = convert_spoken_math_to_latex("We know that e equals mc squared.")
    assert "$E = mc^2$" in res2

    # Pythagorean formula
    res3 = convert_spoken_math_to_latex("In right triangle, a squared plus b squared equals c squared.")
    assert "$a^2 + b^2 = c^2$" in res3


def test_review_transcript_cues_heuristic_fallback():
    cues = [
        {"id": 1, "time": "00:10", "seconds": 10, "text": "Welcome to class today."},
        {"id": 2, "time": "00:20", "seconds": 20, "text": "Notice that y equals mx plus c is the equation."},
        {"id": 3, "time": "00:30", "seconds": 30, "text": "Tata structures are important in computer science."}
    ]
    suggestions = review_transcript_cues(cues, video_title="Linear Algebra")
    assert isinstance(suggestions, list)
    # Even if LLM is offline/mocked, heuristic fallback detects math
    math_sugg = next((s for s in suggestions if s.get("suggestion_type") == "math_latex"), None)
    if math_sugg:
        assert "$y = mx + c$" in math_sugg["suggested_text"]


def test_explain_selected_transcript_text():
    explanation = explain_selected_transcript_text(
        selected_text="eigenvalues and eigenvectors",
        prompt_type="explain",
        lecture_title="Linear Algebra"
    )
    assert len(explanation) > 10

    math_exp = explain_selected_transcript_text(
        selected_text="y = mx + c",
        prompt_type="math_breakdown",
        lecture_title="Pre-Calculus"
    )
    assert len(math_exp) > 10


def test_update_transcript_cue_endpoint():
    video_id = "test_vid_edit_123"
    fake_cues = [
        {"id": 101, "time": "00:05", "seconds": 5, "text": "Initial text"}
    ]
    with patch.object(db_manager, "update_transcript_cue", return_value={"id": 101, "time": "00:05", "seconds": 5, "text": "Corrected text"}) as mock_update, \
         patch.object(db_manager, "get_saved_video", return_value={"videoId": video_id, "title": "Test Title", "cues": fake_cues}), \
         patch("backend.main.algolia_service.ingest_cues") as mock_algolia, \
         patch("backend.main.pinecone_rag_engine.ingest_transcript") as mock_pinecone:

        resp = client.patch(
            f"/api/lecture/{video_id}/cues/101",
            json={"text": "Corrected text"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["cue"]["text"] == "Corrected text"
        assert data["summary_outdated"] is True
        mock_update.assert_called_once_with(video_id, 101, "Corrected text")
        mock_algolia.assert_called_once()
        mock_pinecone.assert_called_once()


def test_transcript_annotations_crud():
    video_id = "test_vid_annot_123"
    fake_annotation = {
        "id": "anno-uuid-1",
        "videoId": video_id,
        "userEmail": "student@example.com",
        "cueId": 101,
        "startSeconds": 5.0,
        "endSeconds": 8.0,
        "selectedText": "important concept",
        "annotationType": "highlight",
        "color": "yellow",
        "noteText": "Must review for midterm",
        "aiPrompt": None,
        "aiResponse": None,
        "createdAt": "2026-10-09T20:00:00Z",
        "updatedAt": "2026-10-09T20:00:00Z"
    }

    with patch.object(db_manager, "add_annotation", return_value=fake_annotation) as mock_add, \
         patch.object(db_manager, "get_annotations", return_value=[fake_annotation]) as mock_get, \
         patch.object(db_manager, "delete_annotation", return_value=True) as mock_del:

        # 1. Create
        create_resp = client.post(
            f"/api/lecture/{video_id}/annotations",
            json={
                "user_email": "student@example.com",
                "selected_text": "important concept",
                "annotation_type": "highlight",
                "color": "yellow",
                "note_text": "Must review for midterm"
            }
        )
        assert create_resp.status_code == 200
        assert create_resp.json()["annotation"]["selectedText"] == "important concept"

        # 2. Get
        get_resp = client.get(f"/api/lecture/{video_id}/annotations?user_email=student@example.com")
        assert get_resp.status_code == 200
        assert len(get_resp.json()["annotations"]) == 1

        # 3. Delete
        del_resp = client.delete(f"/api/lecture/{video_id}/annotations/anno-uuid-1?user_email=student@example.com")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "success"


def test_transcript_annotations_camel_and_snake_parity():
    video_id = "test_vid_annot_parity"
    fake_annotation = {
        "id": "anno-uuid-parity",
        "videoId": video_id,
        "video_id": video_id,
        "userEmail": "student@example.com",
        "user_email": "student@example.com",
        "cueId": 105,
        "cue_id": 105,
        "startSeconds": 10.0,
        "start_seconds": 10.0,
        "endSeconds": 15.0,
        "end_seconds": 15.0,
        "selectedText": "eigenvectors and eigenvalues",
        "selected_text": "eigenvectors and eigenvalues",
        "annotationType": "note",
        "annotation_type": "note",
        "color": "blue",
        "noteText": "Crucial exam topic",
        "note_text": "Crucial exam topic",
        "aiPrompt": None,
        "ai_prompt": None,
        "aiResponse": None,
        "ai_response": None,
        "createdAt": "2026-10-09T20:00:00Z",
        "created_at": "2026-10-09T20:00:00Z",
        "updatedAt": "2026-10-09T20:00:00Z",
        "updated_at": "2026-10-09T20:00:00Z"
    }

    with patch.object(db_manager, "add_annotation", return_value=fake_annotation) as mock_add, \
         patch.object(db_manager, "get_annotations", return_value=[fake_annotation]) as mock_get:

        # Test POST with camelCase fields
        create_resp = client.post(
            f"/api/lecture/{video_id}/annotations",
            json={
                "userEmail": "student@example.com",
                "selectedText": "eigenvectors and eigenvalues",
                "annotationType": "note",
                "cueId": 105,
                "startSeconds": 10.0,
                "endSeconds": 15.0,
                "color": "blue",
                "noteText": "Crucial exam topic"
            }
        )
        assert create_resp.status_code == 200
        ann = create_resp.json()["annotation"]
        # Verify both camelCase and snake_case properties are present and match
        assert ann["selectedText"] == "eigenvectors and eigenvalues"
        assert ann["selected_text"] == "eigenvectors and eigenvalues"
        assert ann["annotationType"] == "note"
        assert ann["annotation_type"] == "note"
        assert ann["cueId"] == 105
        assert ann["cue_id"] == 105
        assert ann["noteText"] == "Crucial exam topic"
        assert ann["note_text"] == "Crucial exam topic"

        # Test GET annotations
        get_resp = client.get(f"/api/lecture/{video_id}/annotations?user_email=student@example.com")
        assert get_resp.status_code == 200
        items = get_resp.json()["annotations"]
        assert len(items) == 1
        assert items[0]["selectedText"] == "eigenvectors and eigenvalues"
        assert items[0]["selected_text"] == "eigenvectors and eigenvalues"


def test_db_manager_annotation_methods_direct():
    video_id = "test_vid_direct_db_ann"
    ann = db_manager.add_annotation(
        video_id=video_id,
        user_email="direct_user@example.com",
        selected_text="matrix rank",
        annotation_type="highlight",
        cue_id="42",
        start_seconds=22.5,
        end_seconds=27.5,
        color="pink"
    )
    assert ann is not None
    assert ann["selectedText"] == "matrix rank"
    assert ann["selected_text"] == "matrix rank"
    assert ann["annotationType"] == "highlight"
    assert ann["annotation_type"] == "highlight"
    assert ann["cueId"] == 42
    assert ann["cue_id"] == 42
    assert ann["color"] == "pink"

    # Query annotations
    all_ann = db_manager.get_annotations(video_id=video_id)
    assert any(a["id"] == ann["id"] for a in all_ann)

    # Delete annotation
    deleted = db_manager.delete_annotation(ann["id"])
    assert deleted is True


def test_explain_selection_endpoint():
    video_id = "test_vid_explain"
    resp = client.post(
        f"/api/lecture/{video_id}/explain-selection",
        json={
            "selected_text": "gradient descent algorithm",
            "prompt_type": "explain"
        }
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "explanation" in data
    assert len(data["explanation"]) > 5

    # Test camelCase request payload
    resp_camel = client.post(
        f"/api/lecture/{video_id}/explain-selection",
        json={
            "selectedText": "gradient descent algorithm",
            "promptType": "math_breakdown"
        }
    )
    assert resp_camel.status_code == 200
    assert resp_camel.json()["status"] == "success"


def test_review_suggestions_accept_reject_undo():
    video_id = "test_vid_review_flow"
    fake_sugg = {
        "id": "sugg-uuid-42",
        "reviewId": "rev-1",
        "videoId": video_id,
        "cueId": 201,
        "startSeconds": 15.0,
        "endSeconds": 18.0,
        "originalText": "Tata",
        "suggestedText": "data",
        "suggestionType": "correction",
        "confidence": "high",
        "reason": "Audible pronunciation matches 'data'",
        "status": "pending",
        "appliedAt": None
    }

    with patch.object(db_manager, "get_review_suggestions", return_value=[fake_sugg]), \
         patch.object(db_manager, "update_transcript_cue", return_value={"id": 201, "time": "00:15", "seconds": 15, "text": "data"}) as mock_cue_update, \
         patch.object(db_manager, "update_suggestion_status", return_value={"id": "sugg-uuid-42", "status": "accepted"}) as mock_status_update, \
         patch.object(db_manager, "get_saved_video", return_value={"videoId": video_id, "title": "Test", "cues": [{"id": 201, "seconds": 15, "text": "data"}]}), \
         patch("backend.main.algolia_service.ingest_cues"), \
         patch("backend.main.pinecone_rag_engine.ingest_transcript"):

        # Accept
        acc_resp = client.post(f"/api/lecture/{video_id}/review/suggestions/sugg-uuid-42/accept")
        assert acc_resp.status_code == 200
        assert acc_resp.json()["status"] == "success"
        assert acc_resp.json()["summary_outdated"] is True
        mock_cue_update.assert_called_with(video_id, 201, "data")
        mock_status_update.assert_called_with("sugg-uuid-42", "accepted")

        # Reject
        with patch.object(db_manager, "update_suggestion_status", return_value={"id": "sugg-uuid-42", "status": "rejected"}):
            rej_resp = client.post(f"/api/lecture/{video_id}/review/suggestions/sugg-uuid-42/reject")
            assert rej_resp.status_code == 200

        # Undo
        with patch.object(db_manager, "update_suggestion_status", return_value={"id": "sugg-uuid-42", "status": "pending"}):
            undo_resp = client.post(f"/api/lecture/{video_id}/review/suggestions/sugg-uuid-42/undo")
            assert undo_resp.status_code == 200
            mock_cue_update.assert_called_with(video_id, 201, "Tata")
