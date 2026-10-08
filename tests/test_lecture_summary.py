import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app

class TestLectureSummary(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_get_summaries_requires_video_id(self):
        res = self.client.get("/api/summary/lecture?video_id=")
        self.assertEqual(res.status_code, 400)

    @patch("backend.main.db_manager.get_lecture_summaries")
    def test_get_summaries_returns_persisted_summaries(self, mock_get):
        mock_get.return_value = {
            "15_min": {
                "id": 1,
                "videoId": "12345",
                "summaryType": "15_min",
                "markdownText": "## 15-Min Overview\nKey concepts.",
                "submissionText": "Key concepts summarized in authentic academic prose.",
                "wordCount": 115,
                "model": "Llama 3.3 70B"
            },
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
        self.assertEqual(data["count"], 2)
        self.assertIn("15_min", data["summaries"])
        self.assertIn("comprehensive", data["summaries"])

    @patch("backend.main.db_manager.get_lecture_summary")
    def test_generate_summary_returns_cached_if_available(self, mock_get_sum):
        mock_get_sum.return_value = {
            "id": 1,
            "videoId": "12345",
            "summaryType": "15_min",
            "markdownText": "Cached summary text",
            "submissionText": "Cached submission text",
            "wordCount": 110
        }
        res = self.client.post("/api/summary/generate", json={
            "video_id": "12345",
            "summary_type": "15_min",
            "bypass_cache": False
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["cached"])
        self.assertEqual(data["summary"]["markdownText"], "Cached summary text")

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.get_lecture_summary")
    @patch("backend.main.db_manager.save_lecture_summary")
    @patch("backend.main.process_chat_message")
    def test_generate_summary_calls_generator_and_persists_without_chat_pollution(
        self,
        mock_process,
        mock_save_summary,
        mock_get_summary,
        mock_get_video
    ):
        mock_get_summary.side_effect = [
            None,  # Cache check before generation
            {      # Returned after save
                "id": 10,
                "videoId": "99999",
                "summaryType": "15_min",
                "markdownText": "Generated markdown",
                "submissionText": "Generated submission prose",
                "wordCount": 120
            }
        ]
        mock_get_video.return_value = {
            "title": "Calculus 101",
            "cues": [{"time": "00:00", "text": "Welcome to calculus"}]
        }
        mock_process.return_value = {
            "reply": "Generated markdown",
            "citations": [],
            "submission_text": "Generated submission prose",
            "model": "Llama 3.3 70B"
        }

        res = self.client.post("/api/summary/generate", json={
            "video_id": "99999",
            "summary_type": "15_min",
            "bypass_cache": True,
            "user_email": "student@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertFalse(data["cached"])

        # Check process_chat_message was called with save_to_db=False
        mock_process.assert_called_once()
        self.assertEqual(mock_process.call_args.kwargs.get("save_to_db"), False)
        # Check save_lecture_summary was called
        mock_save_summary.assert_called_once()
        self.assertEqual(mock_save_summary.call_args.kwargs.get("summary_type"), "15_min")
        self.assertEqual(mock_save_summary.call_args.kwargs.get("video_id"), "99999")

