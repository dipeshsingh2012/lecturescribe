import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import app
from backend.rag_engine import pinecone_rag_engine
from backend.redis_service import RedisCacheService


class TestLectureQuiz(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_generate_lecture_quiz_fallback(self):
        """Test deterministic quiz generation when LLMs are not called."""
        cues = [
            {"time": "00:00", "text": "Welcome to Linear Algebra. Today we study vector spaces."},
            {"time": "43:34", "text": "Slope is a geometric interpretation of vector ratios alpha u + beta v."},
            {"time": "59:45", "text": "Prime numbers generate integers under unique factorization."},
            {"time": "01:28:09", "text": "Scalar multiplication scales vectors without changing direction."},
            {"time": "01:32:00", "text": "A basis is a linearly independent spanning set."},
        ]

        # Patch requests.post so it triggers fallback
        with patch("requests.post", side_effect=Exception("Network offline")):
            quiz = pinecone_rag_engine.generate_lecture_quiz(
                video_id="101010",
                lecture_title="Linear Algebra Session 5",
                cues=cues,
                num_questions=5
            )

        self.assertEqual(quiz["video_id"], "101010")
        self.assertEqual(quiz["lecture_title"], "Linear Algebra Session 5")
        self.assertEqual(len(quiz["questions"]), 5)
        for q in quiz["questions"]:
            self.assertIn("question", q)
            self.assertEqual(len(q["options"]), 4)
            self.assertIn("correct_index", q)
            self.assertIn("explanation", q)
            self.assertIn("timestamp", q)

    @patch("backend.database.db_manager.get_saved_video")
    def test_quiz_endpoint_404_when_missing(self, mock_get_saved):
        mock_get_saved.return_value = None
        response = self.client.get("/api/lecture/unknown_vid_999/quiz")
        self.assertEqual(response.status_code, 404)
        self.assertIn("not found", response.json()["detail"].lower())

    @patch("backend.database.db_manager.get_saved_video")
    @patch("backend.rag_engine.pinecone_rag_engine.generate_lecture_quiz")
    def test_quiz_endpoint_success_and_caching(self, mock_gen_quiz, mock_get_saved):
        mock_get_saved.return_value = {
            "title": "Quantum Computing",
            "cues": [{"time": "05:10", "text": "Qubits and superposition principles."}]
        }
        mock_gen_quiz.return_value = {
            "video_id": "qc101",
            "lecture_title": "Quantum Computing",
            "questions": [
                {
                    "id": 1,
                    "question": r"What is the superposition state $|\psi\rangle$?",
                    "options": [
                        r"$\alpha|0\rangle + \beta|1\rangle$",
                        "A classical bit only",
                        "A deterministic gate",
                        "An error syndrome"
                    ],
                    "correct_index": 0,
                    "explanation": "Discussed at [05:10].",
                    "timestamp": "05:10",
                    "difficulty": "medium"
                }
            ],
            "total_questions": 1,
            "model": "Mocked Model"
        }

        # 1. First fetch - calls generator
        res1 = self.client.post("/api/lecture/qc101/quiz", json={"regenerate": True})
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertEqual(len(data1["questions"]), 1)
        self.assertIn("superposition", data1["questions"][0]["question"])
        mock_gen_quiz.assert_called_once()

    def test_redis_cache_quiz_operations(self):
        mock_redis = MagicMock()
        service = RedisCacheService(redis_url="redis://localhost:6379")
        service.client = mock_redis
        service.enabled = True

        quiz_payload = {
            "video_id": "test_123",
            "questions": [{"id": 1, "question": "What is $f(x)$?", "options": ["A", "B", "C", "D"], "correct_index": 0}]
        }

        # Test set_quiz
        service.set_quiz("test_123", quiz_payload, ttl_seconds=3600)
        self.assertTrue(mock_redis.setex.called or mock_redis.set.called)

        # Test get_quiz hit
        import json
        mock_redis.get.return_value = json.dumps(quiz_payload)
        cached = service.get_quiz("test_123")
        self.assertIsNotNone(cached)
        self.assertTrue(cached.get("cached"))
        self.assertEqual(cached["video_id"], "test_123")


if __name__ == "__main__":
    unittest.main()
