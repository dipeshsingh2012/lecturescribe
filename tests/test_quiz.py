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

    def test_quiz_filters_greetings_and_filler(self):
        """Verify that greetings, roll-calls, and pleasantries are excluded from questions."""
        cues = [
            {"time": "00:00", "text": "Namaste,"},
            {"time": "01:30", "text": "Namaste to all of you. Are people there?"},
            {"time": "02:08", "text": "Good morning, Girish."},
            {"time": "05:15", "text": "The spectral theorem asserts that every symmetric matrix is orthogonally diagonalizable."},
            {"time": "14:40", "text": "Singular value decomposition factors any real matrix into orthogonal and diagonal components."},
            {"time": "25:00", "text": "Gram-Schmidt orthogonalization produces an orthonormal basis spanning the same subspace."}
        ]

        with patch("requests.post", side_effect=Exception("Network offline")):
            quiz = pinecone_rag_engine.generate_lecture_quiz(
                video_id="math_test",
                lecture_title="Advanced Linear Algebra",
                cues=cues,
                num_questions=3
            )

        for q in quiz["questions"]:
            full_content = q["question"] + " " + " ".join(q["options"]) + " " + q["explanation"]
            self.assertNotIn("Namaste", full_content)
            self.assertNotIn("Girish", full_content)
            self.assertNotIn("Are people there", full_content)
            self.assertNotIn("introductory greeting with no mathematical bearing", full_content.lower())

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

    def test_determine_lecture_quiz_count(self):
        from backend.main import determine_lecture_quiz_count

        # 1. Short lecture <= 15m -> 5 questions
        self.assertEqual(determine_lecture_quiz_count(duration_str="12m"), 5)

        # 2. 16m - 30m -> 7 questions
        self.assertEqual(determine_lecture_quiz_count(duration_str="25m"), 7)

        # 3. 31m - 50m -> 9 questions
        self.assertEqual(determine_lecture_quiz_count(duration_str="45m"), 9)

        # 4. 51m - 75m -> 12 questions
        self.assertEqual(determine_lecture_quiz_count(duration_str="1h 10m"), 12)

        # 5. > 75m -> 15 questions (max cap)
        self.assertEqual(determine_lecture_quiz_count(duration_str="1h 35m"), 15)

        # 6. Ultra-long lecture (3h) -> clamped at 15 max
        self.assertEqual(determine_lecture_quiz_count(duration_str="3h 0m"), 15)

        # 7. Inferred from cue timestamps when duration_str is missing
        long_cues = [
            {"time": "00:00", "text": "Intro"},
            {"time": "01:25:00", "text": "Advanced basis concepts"}
        ]
        self.assertEqual(determine_lecture_quiz_count(cues=long_cues), 15)

    def test_generate_lecture_quiz_scaling_and_clamping(self):
        """Test that generator scales up to 15 questions and clamps over 15."""
        cues = [{"time": f"{i:02d}:00", "text": f"Lecture segment {i} discussing core theorem {i}."} for i in range(25)]

        with patch("requests.post", side_effect=Exception("Network offline")):
            # 1. Requesting 15 questions produces exactly 15
            quiz_15 = pinecone_rag_engine.generate_lecture_quiz(
                video_id="vid_long",
                lecture_title="Long Lecture",
                cues=cues,
                num_questions=15
            )
            self.assertEqual(len(quiz_15["questions"]), 15)

            # 2. Requesting 25 questions clamps to max 15
            quiz_clamped = pinecone_rag_engine.generate_lecture_quiz(
                video_id="vid_long",
                lecture_title="Long Lecture",
                cues=cues,
                num_questions=25
            )
            self.assertEqual(len(quiz_clamped["questions"]), 15)

    @patch("backend.database.db_manager.get_saved_video")
    @patch("backend.database.db_manager.get_saved_quiz")
    @patch("backend.rag_engine.pinecone_rag_engine.generate_lecture_quiz")
    def test_quiz_endpoint_auto_scales_for_long_lecture(self, mock_gen, mock_get_quiz, mock_get_saved):
        mock_get_quiz.return_value = None  # Force generation
        mock_get_saved.return_value = {
            "title": "Full Length University Lecture",
            "duration": "1h 40m",
            "cues": [{"time": "01:40:00", "text": "Conclusion of lecture."}]
        }
        mock_gen.return_value = {
            "video_id": "long_lecture_1",
            "lecture_title": "Full Length University Lecture",
            "questions": [{"id": i, "question": f"Q{i}", "options": ["A", "B", "C", "D"], "correct_index": 0} for i in range(1, 16)]
        }

        # Request without specifying num_questions
        response = self.client.post("/api/lecture/long_lecture_1/quiz", json={"regenerate": True})
        self.assertEqual(response.status_code, 200)

        # Check that mock_gen was called with num_questions=15
        self.assertTrue(mock_gen.called)
        _, kwargs = mock_gen.call_args
        self.assertEqual(kwargs.get("num_questions"), 15)

    def test_generate_course_quiz_covers_all_lectures(self):
        """Test that generate_course_quiz distributes questions across all course lectures."""
        lectures_data = [
            {
                "video_id": "lec_1",
                "title": "Lecture 1: Vector Spaces",
                "cues": [{"time": "02:00", "text": "Linear combinations of vectors."}]
            },
            {
                "video_id": "lec_2",
                "title": "Lecture 2: Eigenvalues",
                "cues": [{"time": "15:30", "text": "Characteristic polynomials and det(A - lambda I)."}]
            },
            {
                "video_id": "lec_3",
                "title": "Lecture 3: Singular Value Decomposition",
                "cues": [{"time": "30:00", "text": "Orthogonal matrices and singular values."}]
            }
        ]

        with patch("requests.post", side_effect=Exception("Network offline")):
            quiz = pinecone_rag_engine.generate_course_quiz(
                course_name="Applied Linear Algebra",
                lectures_data=lectures_data,
                num_questions=6
            )

        self.assertEqual(quiz["course_name"], "Applied Linear Algebra")
        self.assertEqual(quiz["lecture_count"], 3)
        self.assertEqual(len(quiz["questions"]), 6)

        # Verify that questions cover all 3 lectures
        covered_lectures = {q["lecture_id"] for q in quiz["questions"]}
        self.assertEqual(covered_lectures, {"lec_1", "lec_2", "lec_3"})
        for q in quiz["questions"]:
            self.assertIn("lecture_title", q)
            self.assertIn("timestamp", q)
            self.assertEqual(len(q["options"]), 4)

    @patch("backend.database.db_manager.get_course_details")
    @patch("backend.database.db_manager.get_saved_video")
    @patch("backend.database.db_manager.get_saved_course_quiz")
    @patch("backend.rag_engine.pinecone_rag_engine.generate_course_quiz")
    def test_course_quiz_endpoint(self, mock_gen, mock_get_quiz, mock_get_video, mock_get_course):
        mock_get_quiz.return_value = None  # Force generation
        mock_get_course.return_value = {
            "course_name": "Machine Learning",
            "lecture_count": 2,
            "lectures": [
                {"video_id": "ml_1", "title": "Supervised Learning"},
                {"video_id": "ml_2", "title": "Neural Networks"}
            ]
        }
        mock_get_video.side_effect = lambda vid: {
            "title": f"Title {vid}",
            "cues": [{"time": "05:00", "text": f"Concepts in {vid}"}]
        }
        mock_gen.return_value = {
            "course_name": "Machine Learning",
            "course_slug": "machine-learning",
            "lecture_count": 2,
            "total_questions": 4,
            "questions": [
                {
                    "id": 1,
                    "question": "What is gradient descent?",
                    "options": ["Opt", "Loss", "Rate", "Step"],
                    "correct_index": 0,
                    "lecture_id": "ml_1",
                    "lecture_title": "Supervised Learning",
                    "timestamp": "05:00",
                    "difficulty": "medium",
                    "explanation": "At [05:00] in Supervised Learning."
                }
            ]
        }

        # 1. Fetching generates quiz
        res = self.client.post("/api/course/Machine%20Learning/quiz", json={"regenerate": True})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["course_name"], "Machine Learning")
        self.assertEqual(len(data["questions"]), 1)
        self.assertEqual(data["questions"][0]["lecture_id"], "ml_1")

        # 2. Test course quiz database persistence
        from backend.database import RelationalDBManager
        db = RelationalDBManager(postgres_url="")
        db.save_course_quiz("Machine Learning", data, lecture_count=2)
        saved = db.get_saved_course_quiz("Machine Learning")
        self.assertIsNotNone(saved)
        self.assertEqual(saved["course_slug"], "machine-learning")
        self.assertTrue(saved.get("persisted"))


if __name__ == "__main__":
    unittest.main()
