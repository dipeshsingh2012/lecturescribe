import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_manager, to_course_slug
from backend.rag_engine import pinecone_rag_engine

client = TestClient(app)


def test_save_and_retrieve_quiz_feedback():
    course_name = "Computer Vision 101"
    course_slug = to_course_slug(course_name)
    user_email = "student1@example.com"

    # 1. Save negative feedback on Question 1
    res1 = db_manager.save_quiz_feedback(
        quiz_type="course",
        target_id=course_name,
        question_id=1,
        rating="negative",
        issue_tags=["ambiguous_wording", "incorrect_answer"],
        comment="Option B is also valid in discrete time coordinates.",
        user_email=user_email,
        question_text="Which kernel operator performs edge detection?",
        options=["Sobel", "Laplacian", "Gaussian", "Median"],
        correct_index=0
    )
    assert res1["rating"] == "negative"
    assert "ambiguous_wording" in res1["issue_tags"]

    # 2. Save positive feedback on Question 2 by another student
    db_manager.save_quiz_feedback(
        quiz_type="course",
        target_id=course_name,
        question_id=2,
        rating="positive",
        issue_tags=[],
        comment="Very clear derivation question!",
        user_email="student2@example.com",
        question_text="What is the convolution property in Fourier space?",
        options=["Pointwise multiplication", "Matrix inversion", "Scalar sum", "Outer product"],
        correct_index=0
    )

    # 3. Retrieve feedback
    fb_list = db_manager.get_quiz_feedback("course", course_slug)
    assert len(fb_list) >= 2

    # 4. Summary metrics
    summary = db_manager.get_quiz_feedback_summary("course", course_slug)
    assert summary["positive"] >= 1
    assert summary["negative"] >= 1
    assert summary["issue_breakdown"].get("ambiguous_wording", 0) >= 1
    assert summary["issue_breakdown"].get("incorrect_answer", 0) >= 1

    # 5. Learned generation guidance
    guidance = db_manager.get_learned_generation_guidance("course", course_slug)
    assert any("Ambiguous Wording" in g for g in guidance)
    assert any("Incorrect Answer Key" in g for g in guidance)
    assert any("Option B is also valid" in g for g in guidance)


def test_update_feedback_for_same_user():
    course_name = "NLP Foundations"
    course_slug = to_course_slug(course_name)
    user_email = "student@nlp.local"

    # First vote: negative
    db_manager.save_quiz_feedback(
        quiz_type="course",
        target_id=course_slug,
        question_id=5,
        rating="negative",
        issue_tags=["too_hard"],
        comment="Too mathematically dense",
        user_email=user_email
    )

    # User re-reviews and updates to positive
    db_manager.save_quiz_feedback(
        quiz_type="course",
        target_id=course_slug,
        question_id=5,
        rating="positive",
        issue_tags=[],
        comment="Understood after reviewing lecture explanation",
        user_email=user_email
    )

    feedbacks = db_manager.get_quiz_feedback("course", course_slug, question_id=5, user_email=user_email)
    assert len(feedbacks) == 1
    assert feedbacks[0]["rating"] == "positive"


def test_api_submit_quiz_feedback_endpoint():
    payload = {
        "quiz_type": "course",
        "target_id": "test-data-science-course",
        "question_id": 3,
        "rating": "negative",
        "issue_tags": ["bad_explanation", "too_easy"],
        "comment": "The explanation does not show the gradient descent formula.",
        "user_email": "tester@ds.edu",
        "question_text": "What is the update step in batch gradient descent?",
        "options": ["w = w - lr * grad", "w = w + lr", "w = grad / lr", "w = 0"],
        "correct_index": 0
    }

    response = client.post("/api/quiz/feedback", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["feedback"]["rating"] == "negative"
    assert data["summary"]["issue_breakdown"]["bad_explanation"] >= 1
    assert data["summary"]["issue_breakdown"]["too_easy"] >= 1

    # Query GET /api/quiz/feedback
    get_res = client.get("/api/quiz/feedback?quiz_type=course&target_id=test-data-science-course")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert len(get_data["feedbacks"]) >= 1
    assert any("EXPLANATION CALIBRATION" in g for g in get_data["guidance"])
    assert any("Too Easy" in g for g in get_data["guidance"])

    # Query GET /api/quiz/feedback/guidance
    guid_res = client.get("/api/quiz/feedback/guidance?quiz_type=course&target_id=test-data-science-course")
    assert guid_res.status_code == 200
    guid_data = guid_res.json()
    assert len(guid_data["guidance"]) >= 2


def test_feedback_guidance_injected_into_prompts():
    captured_prompts = []

    def mock_requests_post(url, headers=None, json=None, timeout=None):
        prompt = ""
        if json and "messages" in json:
            prompt = "\n".join([m.get("content", "") for m in json["messages"]])
        captured_prompts.append(prompt)

        fake_resp = MagicMock()
        fake_resp.ok = True
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": '{"questions": [{"id": 1, "type": "mcq", "question": "What is precision?", "options": ["A", "B", "C", "D"], "correct_index": 0, "blank_answer": "", "marks": 0.5, "explanation": "Precision is TP/(TP+FP)", "lecture_id": "v1", "lecture_title": "Lecture 1", "timestamp": "05:00", "difficulty": "medium"}]}'
                }
            }]
        }
        return fake_resp

    with patch("requests.post", side_effect=mock_requests_post):
        custom_guidance = [
            "CRITICAL: Avoid confusing loss functions with accuracy metrics.",
            "CALIBRATION: Ensure questions test 1-step numerical calculation."
        ]
        pinecone_rag_engine.generate_course_quiz(
            course_name="Machine Learning",
            lectures_data=[{"video_id": "v1", "title": "Lecture 1", "summary": "Foundations"}],
            num_questions=1,
            feedback_guidance=custom_guidance
        )

    assert len(captured_prompts) > 0
    full_prompt = captured_prompts[0]
    assert "CONTINUOUS QUALITY CALIBRATION" in full_prompt
    assert "Avoid confusing loss functions with accuracy metrics." in full_prompt
    assert "Ensure questions test 1-step numerical calculation." in full_prompt

