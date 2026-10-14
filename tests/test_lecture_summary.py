import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app, generate_and_store_comprehensive_summary


class TestLectureSummary(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_get_summaries_requires_video_id(self):
        res = self.client.get("/api/summary/lecture?video_id=")
        self.assertEqual(res.status_code, 400)

    @patch("backend.main.db_manager.get_lecture_summaries")
    def test_get_summaries_returns_persisted_summaries(self, mock_get):
        mock_get.return_value = {
            "comprehensive": {
                "id": 2,
                "videoId": "12345",
                "summaryType": "comprehensive",
                "markdownText": "## Comprehensive Report\nFull topics.",
                "submissionText": "Comprehensive topics described in detail.",
                "wordCount": 350,
                "model": "Llama 3.3 70B"
            }
        }
        res = self.client.get("/api/summary/lecture?video_id=12345")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["count"], 1)
        self.assertIn("comprehensive", data["summaries"])

    @patch("backend.main.db_manager.get_lecture_summary")
    def test_generate_summary_returns_cached_if_available(self, mock_get_sum):
        mock_get_sum.return_value = {
            "id": 1,
            "videoId": "12345",
            "summaryType": "comprehensive",
            "markdownText": "Cached summary text",
            "submissionText": "Cached submission text",
            "wordCount": 110
        }
        res = self.client.post("/api/summary/generate", json={
            "video_id": "12345",
            "summary_type": "comprehensive",
            "bypass_cache": False
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["cached"])
        self.assertEqual(data["summary"]["markdownText"], "Cached summary text")

    @patch("backend.main.process_chat_message")
    @patch("backend.main.pinecone_rag_engine")
    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.get_lecture_summary")
    @patch("backend.main.db_manager.save_lecture_summary", return_value=True)
    def test_generate_summary_uses_full_transcript_and_not_chat_pipeline(
        self, mock_save, mock_get_summary, mock_get_video, mock_engine, mock_chat
    ):
        cues = [
            {"time": "00:00", "text": "Welcome to calculus"},
            {"time": "40:10", "text": "Middle of the lecture"},
            {"time": "1:15:00", "text": "The very last topic"},
            {"time": "1:16:00", "text": "   "},  # blank cues are dropped
        ]
        mock_get_summary.return_value = {"markdownText": "Generated markdown", "summaryType": "comprehensive"}
        mock_get_video.return_value = {"title": "Calculus 101", "cues": cues}
        mock_engine.generate_full_transcript_summary.return_value = {
            "answer": "Generated markdown", "citations": [{"timestamp": "00:00"}], "model": "Groq test"
        }
        mock_engine.generate_submission_version.return_value = {"submission_text": "Generated submission prose"}
        mock_engine._clean_for_submission.side_effect = lambda t, **kw: t

        res = self.client.post("/api/summary/generate", json={
            "video_id": "99999",
            "summary_type": "15_min",  # legacy value is mapped to comprehensive
            "bypass_cache": True,
            "user_email": "student@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertFalse(data["cached"])

        # The chat / RAG pipeline must not be involved in summary generation.
        mock_chat.assert_not_called()

        # The model receives the entire timestamped transcript, first to last cue.
        transcript = mock_engine.generate_full_transcript_summary.call_args.kwargs["transcript_str"]
        self.assertEqual(
            transcript.splitlines(),
            ["[00:00] Welcome to calculus", "[40:10] Middle of the lecture", "[1:15:00] The very last topic"],
        )

        mock_save.assert_called_once()
        kwargs = mock_save.call_args.kwargs
        self.assertEqual(kwargs["summary_type"], "comprehensive")
        self.assertEqual(kwargs["video_id"], "99999")
        self.assertEqual(kwargs["markdown_text"], "Generated markdown")
        self.assertEqual(kwargs["submission_text"], "Generated submission prose")

    @patch("backend.main.pinecone_rag_engine")
    @patch("backend.main.db_manager.save_lecture_summary", return_value=True)
    def test_submission_failure_falls_back_to_study_guide_text(self, mock_save, mock_engine):
        mock_engine.generate_full_transcript_summary.return_value = {"answer": "Study guide body", "model": "m"}
        mock_engine.generate_submission_version.side_effect = RuntimeError("all providers down")
        mock_engine._clean_for_submission.side_effect = lambda t, **kw: t

        stored = generate_and_store_comprehensive_summary("v1", "T", [{"time": "00:01", "text": "hi"}], None)

        self.assertTrue(stored)
        self.assertEqual(mock_save.call_args.kwargs["submission_text"], "Study guide body")

    @patch("backend.main.pinecone_rag_engine")
    @patch("backend.main.db_manager.get_saved_video", return_value=None)
    @patch("backend.main.db_manager.save_lecture_summary", return_value=True)
    def test_generation_failure_returns_502_not_empty_success(self, mock_save, _gv, mock_engine):
        mock_engine.generate_full_transcript_summary.side_effect = RuntimeError("All LLM providers failed")
        res = self.client.post("/api/summary/generate", json={
            "video_id": "77777",
            "bypass_cache": True,
            "cues": [{"time": "00:00", "text": "hello there"}],
        })
        self.assertEqual(res.status_code, 502)
        mock_save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
