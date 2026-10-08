import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import RelationalDBManager

class TestLectureProgress(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.db = RelationalDBManager(postgres_url=None)

    def test_save_and_get_progress_in_memory(self):
        res = self.db.save_lecture_progress(
            video_id="vid_test_100",
            last_timestamp="14:20",
            last_seconds=860.0,
            duration_seconds=1720.0,
            active_cue_idx=25,
            user_email="student@example.com"
        )
        self.assertIsNotNone(res)
        self.assertEqual(res["video_id"], "vid_test_100")
        self.assertEqual(res["last_timestamp"], "14:20")
        self.assertEqual(res["last_seconds"], 860.0)
        self.assertEqual(res["progress_percent"], 50.0)
        self.assertEqual(res["active_cue_idx"], 25)

        retrieved = self.db.get_lecture_progress("vid_test_100", user_email="student@example.com")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["last_timestamp"], "14:20")
        self.assertEqual(retrieved["progress_percent"], 50.0)

    def test_save_progress_calculates_percent_correctly(self):
        res = self.db.save_lecture_progress(
            video_id="vid_test_200",
            last_timestamp="00:00",
            last_seconds=0.0,
            duration_seconds=0.0,
            active_cue_idx=0
        )
        self.assertEqual(res["progress_percent"], 0.0)

        res2 = self.db.save_lecture_progress(
            video_id="vid_test_200",
            last_timestamp="30:00",
            last_seconds=1800.0,
            duration_seconds=2000.0,
            active_cue_idx=40
        )
        self.assertEqual(res2["progress_percent"], 90.0)

    def test_get_progress_endpoint_requires_video_id(self):
        res = self.client.get("/api/progress/lecture?video_id=")
        self.assertEqual(res.status_code, 400)

    @patch("backend.main.db_manager.get_lecture_progress")
    def test_get_progress_endpoint_returns_data(self, mock_get):
        mock_get.return_value = {
            "id": 1,
            "video_id": "vid_123",
            "user_email": "student@example.com",
            "last_timestamp": "42:15",
            "last_seconds": 2535.0,
            "duration_seconds": 3600.0,
            "progress_percent": 70.4,
            "active_cue_idx": 55,
            "updated_at": "2026-10-08T10:00:00Z"
        }
        res = self.client.get("/api/progress/lecture?video_id=vid_123&user_email=student@example.com")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["video_id"], "vid_123")
        self.assertEqual(data["progress"]["last_timestamp"], "42:15")
        self.assertEqual(data["progress"]["progress_percent"], 70.4)

    @patch("backend.main.db_manager.save_lecture_progress")
    def test_save_progress_endpoint(self, mock_save):
        mock_save.return_value = {
            "id": 1,
            "video_id": "vid_123",
            "user_email": "student@example.com",
            "last_timestamp": "42:15",
            "last_seconds": 2535.0,
            "duration_seconds": 3600.0,
            "progress_percent": 70.4,
            "active_cue_idx": 55
        }
        res = self.client.post("/api/progress/lecture", json={
            "video_id": "vid_123",
            "user_email": "student@example.com",
            "last_timestamp": "42:15",
            "last_seconds": 2535.0,
            "duration_seconds": 3600.0,
            "active_cue_idx": 55
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["progress"]["active_cue_idx"], 55)

    @patch("backend.main.db_manager.get_user_progress_map")
    def test_get_user_progress_endpoint(self, mock_map):
        mock_map.return_value = {
            "vid_123": {
                "video_id": "vid_123",
                "last_timestamp": "42:15",
                "progress_percent": 70.4
            },
            "vid_456": {
                "video_id": "vid_456",
                "last_timestamp": "10:00",
                "progress_percent": 25.0
            }
        }
        res = self.client.get("/api/progress/user?user_email=student@example.com&video_ids=vid_123,vid_456")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["count"], 2)
        self.assertIn("vid_123", data["progress"])
        self.assertIn("vid_456", data["progress"])

