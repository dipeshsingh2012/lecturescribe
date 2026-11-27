"""Tests for 100-word key-concepts submission summary generation and API."""
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod


client = TestClient(main_mod.app)


def test_generate_short_submission_summary_uses_groq_and_sanitizes(monkeypatch):
    engine = object.__new__(type(main_mod.pinecone_rag_engine))
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    fake_model = MagicMock()
    fake_model.name = "llama-test"
    fake_model.provider = "groq"

    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": (
                        "## Heading\n"
                        "In this session, we covered gradient descent, loss landscapes, and regularization "
                        "to control overfitting in linear and neural models. The professor explained how learning "
                        "rate scaling governs convergence stability and how L2 penalties shrink parameter magnitudes [04:12]."
                    )
                }
            }
        ]
    }

    with patch("backend.llm_router.llm_router.get_candidate_models", return_value=[fake_model]), \
         patch("backend.llm_router.llm_router.record_success") as mock_success, \
         patch("requests.post", return_value=fake_resp) as mock_post:
        res = engine.generate_short_submission_summary(
            original_text="Detailed lecture notes on gradient descent, regularization, and convergence.",
            video_id="vid_short_1",
            target_words=100,
        )

    assert res["status"] == "success"
    assert res["model"] == "Groq llama-test"
    assert "##" not in res["submission_summary_100"]
    assert "[04:12]" not in res["submission_summary_100"]
    assert "gradient descent" in res["submission_summary_100"]
    assert res["word_count"] == len(res["submission_summary_100"].split())
    mock_success.assert_called_once_with("llama-test")
    sent_payload = mock_post.call_args.kwargs["json"]
    assert "KEY CONCEPTS" in sent_payload["messages"][0]["content"]


def test_generate_short_submission_summary_fallback_truncates_cleanly(monkeypatch):
    engine = object.__new__(type(main_mod.pinecone_rag_engine))
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    long_source = " ".join(["Gradient descent updates parameters iteratively."] * 35)
    with patch("backend.llm_router.llm_router.get_candidate_models", return_value=[]):
        res = engine.generate_short_submission_summary(
            original_text=long_source,
            video_id="vid_short_fallback",
            target_words=100,
        )

    assert res["status"] == "partial_fallback"
    assert res["word_count"] <= 100
    assert res["submission_summary_100"].endswith(".")


def test_short_submission_endpoint_returns_cached():
    cached_summary = {
        "videoId": "vid_cached_100",
        "summaryType": "comprehensive",
        "markdownText": "## Notes\nContent",
        "submissionText": "Longer 650-word submission prose...",
        "submissionSummary100": "In this session, we covered core optimization concepts and regularization trade-offs.",
    }
    with patch.object(main_mod.db_manager, "get_lecture_summary", return_value=cached_summary):
        resp = client.post(
            "/api/summary/submission-100",
            json={"video_id": "vid_cached_100", "force_refresh": False},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["cached"] is True
    assert data["submission_summary_100"] == cached_summary["submissionSummary100"]
    assert data["word_count"] == len(cached_summary["submissionSummary100"].split())


def test_short_submission_endpoint_generates_and_persists_on_demand():
    existing_summary = {
        "videoId": "vid_ondemand_100",
        "summaryType": "comprehensive",
        "markdownText": "## Notes\nContent",
        "submissionText": "In this session, we explored eigenvectors, PCA, and dimensionality reduction.",
        "submissionSummary100": "",
    }
    generated_text = (
        "In this session, we examined Principal Component Analysis and how covariance matrix eigenvectors "
        "identify orthogonal directions of maximum variance for dimensionality reduction."
    )
    updated_summary = {**existing_summary, "submissionSummary100": generated_text}

    with patch.object(
        main_mod.db_manager,
        "get_lecture_summary",
        side_effect=[existing_summary, updated_summary],
    ), patch.object(
        main_mod.pinecone_rag_engine,
        "generate_short_submission_summary",
        return_value={"status": "success", "submission_summary_100": generated_text, "word_count": 21},
    ) as mock_gen, patch.object(
        main_mod.db_manager,
        "update_submission_summary_100",
        return_value=True,
    ) as mock_update:
        resp = client.post(
            "/api/summary/submission-100",
            json={"video_id": "vid_ondemand_100", "user_email": "student@example.com"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["cached"] is False
    assert data["submission_summary_100"] == generated_text
    assert data["summary"]["submissionSummary100"] == generated_text
    mock_gen.assert_called_once()
    mock_update.assert_called_once_with(
        video_id="vid_ondemand_100",
        submission_summary_100=generated_text,
        summary_type="comprehensive",
        user_email="student@example.com",
    )


def test_short_submission_endpoint_404_when_no_summary():
    with patch.object(main_mod.db_manager, "get_lecture_summary", return_value=None):
        resp = client.post(
            "/api/summary/submission-100",
            json={"video_id": "vid_missing_100"},
        )
    assert resp.status_code == 404


def test_generate_and_store_comprehensive_summary_persists_short_summary():
    cues = [{"time": "00:10", "text": "Today we study support vector machines and margin maximization."}]
    with patch.object(
        main_mod.pinecone_rag_engine,
        "generate_full_transcript_summary",
        return_value={"answer": "## SVM\nMargin maximization [00:10]", "citations": [], "model": "test-model"},
    ), patch.object(
        main_mod.pinecone_rag_engine,
        "generate_submission_version",
        return_value={"submission_text": "In this session, we studied support vector machines and maximum-margin hyperplanes."},
    ), patch.object(
        main_mod.pinecone_rag_engine,
        "generate_short_submission_summary",
        return_value={"submission_summary_100": "In this session, we covered support vector machines, margin maximization, and kernel tricks."},
    ), patch.object(
        main_mod.db_manager,
        "save_lecture_summary",
        return_value=True,
    ) as mock_save, patch.object(
        main_mod,
        "predict_and_store_quizzes",
        return_value=[],
    ), patch.object(
        main_mod.db_manager,
        "get_lecture_summary",
        return_value={
            "videoId": "vid_comp_100",
            "markdownText": "## SVM\nMargin maximization [00:10]",
            "submissionText": "In this session, we studied support vector machines and maximum-margin hyperplanes.",
            "submissionSummary100": "In this session, we covered support vector machines, margin maximization, and kernel tricks.",
        },
    ):
        res = main_mod.generate_and_store_comprehensive_summary(
            video_id="vid_comp_100",
            title="SVM Lecture",
            cues=cues,
            user_email="student@example.com",
        )

    assert res is not None
    assert res["submissionSummary100"].startswith("In this session, we covered support vector machines")
    save_kwargs = mock_save.call_args.kwargs
    assert save_kwargs["submission_summary_100"] == (
        "In this session, we covered support vector machines, margin maximization, and kernel tricks."
    )
