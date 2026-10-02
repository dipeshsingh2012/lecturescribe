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

    def test_database_quiz_persistence(self):
        from backend.database import RelationalDBManager
        db = RelationalDBManager(postgres_url="")

        quiz_data = {
            "video_id": "math_201",
            "lecture_title": "Applied Mathematics",
            "questions": [
                {
                    "id": 1,
                    "question": "What is the rank of matrix $A$?",
                    "options": ["Dimension of column space", "Number of zeroes", "Trace", "Determinant"],
                    "correct_index": 0,
                    "explanation": "At [12:00], rank is defined.",
                    "timestamp": "12:00"
                }
            ]
        }

        # 1. Test save_quiz
        saved = db.save_quiz("math_201", quiz_data)
        self.assertTrue(saved)

        # 2. Test get_saved_quiz hit
        retrieved = db.get_saved_quiz("math_201")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["video_id"], "math_201")
        self.assertEqual(len(retrieved["questions"]), 1)
        self.assertTrue(retrieved.get("persisted"))

    @patch("backend.database.RelationalDBManager._get_connection")
    def test_database_quiz_postgres_query(self, mock_conn_func):
        from backend.database import RelationalDBManager
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn_func.return_value = mock_conn

        db = RelationalDBManager(postgres_url="postgresql://user:pass@localhost:5432/testdb")

        quiz_data = {
            "video_id": "cs50",
            "questions": [{"id": 1, "question": "Q?", "options": ["A", "B", "C", "D"], "correct_index": 0}]
        }
        res = db.save_quiz("cs50", quiz_data)
        self.assertTrue(res)
        self.assertTrue(mock_cursor.execute.called)
        executed_sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO lecturescribe_quizzes", executed_sql)

    @patch("backend.database.db_manager.get_saved_video")
    @patch("backend.database.db_manager.get_saved_quiz")
    @patch("backend.rag_engine.pinecone_rag_engine.generate_lecture_quiz")
    def test_quiz_endpoint_returns_persisted_quiz(self, mock_gen, mock_get_quiz, mock_get_saved):
        mock_get_saved.return_value = {
            "title": "Algorithms",
            "cues": [{"time": "01:00", "text": "Asymptotic analysis."}]
        }
        mock_get_quiz.return_value = {
            "video_id": "algo_101",
            "lecture_title": "Algorithms",
            "questions": [{"id": 1, "question": "What is $O(n)$?", "options": ["Linear", "Quadratic", "Log", "Const"], "correct_index": 0}]
        }

        # Calling without regenerate should hit DB and NOT call generator
        response = self.client.post("/api/lecture/algo_101/quiz", json={"regenerate": False})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["video_id"], "algo_101")
        self.assertEqual(data["questions"][0]["question"], "What is $O(n)$?")
        mock_gen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
