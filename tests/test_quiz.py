import os
import json
import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import app, determine_lecture_quiz_count
from backend.rag_engine import pinecone_rag_engine
from backend.redis_service import RedisCacheService
from backend.database import RelationalDBManager


class TestLectureQuiz(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_generate_lecture_quiz_raises_without_llm(self):
        """Verify that generator raises RuntimeError when LLMs fail, with NO fallback synthesizers."""
        cues = [
            {"time": "00:00", "text": "Welcome to Linear Algebra. Today we study vector spaces."},
            {"time": "43:34", "text": "Slope is a geometric interpretation of vector ratios alpha u + beta v."},
            {"time": "59:45", "text": "Prime numbers generate integers under unique factorization."},
            {"time": "01:28:09", "text": "Scalar multiplication scales vectors without changing direction."},
            {"time": "01:32:00", "text": "A basis is a linearly independent spanning set."},
        ]

        # Patch requests.post to fail so all LLM attempts fail
        with patch("requests.post", side_effect=Exception("Network offline")):
            with self.assertRaises(RuntimeError) as cm:
                pinecone_rag_engine.generate_lecture_quiz(
                    video_id="101010",
                    lecture_title="Linear Algebra Session 5",
                    cues=cues,
                    num_questions=5
                )
            self.assertIn("All configured AI models failed", str(cm.exception))

    def test_generate_lecture_quiz_llm_success(self):
        """Test deterministic parsing of LLM response into quiz schema."""
        cues = [
            {"time": "00:00", "text": "Welcome to Linear Algebra. Today we study vector spaces."},
            {"time": "43:34", "text": "Slope is a geometric interpretation of vector ratios alpha u + beta v."}
        ]
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "questions": [
                            {
                                "id": 1,
                                "question": "What is a vector space?",
                                "options": [
                                    "A set closed under vector addition and scalar multiplication",
                                    "A single real number",
                                    "A geometric ray in Euclidean space",
                                    "An empty collection of matrices"
                                ],
                                "correct_index": 0,
                                "explanation": "Defined at [00:00].",
                                "timestamp": "00:00",
                                "difficulty": "easy"
                            }
                        ]
                    })
                }
            }]
        }

        with patch.dict(os.environ, {"GROQ_API_KEY": "fake_groq_key"}), patch("requests.post", return_value=mock_resp):
            quiz = pinecone_rag_engine.generate_lecture_quiz(
                video_id="101010",
                lecture_title="Linear Algebra Session 5",
                cues=cues,
                num_questions=1
            )

        self.assertEqual(quiz["video_id"], "101010")
        self.assertEqual(quiz["lecture_title"], "Linear Algebra Session 5")
        self.assertEqual(len(quiz["questions"]), 1)
        q = quiz["questions"][0]
        self.assertEqual(q["question"], "What is a vector space?")
        self.assertEqual(len(q["options"]), 4)
        self.assertEqual(q["correct_index"], 0)
        self.assertEqual(q["timestamp"], "00:00")
        self.assertEqual(q["difficulty"], "easy")

    def test_quiz_filters_greetings_and_filler(self):
        """Verify that greetings, roll-calls, and pleasantries are excluded by _filter_substantive_cues."""
        cues = [
            {"time": "00:00", "text": "Namaste,"},
            {"time": "01:30", "text": "Namaste to all of you. Are people there?"},
            {"time": "02:08", "text": "Good morning, Girish."},
            {"time": "05:15", "text": "The spectral theorem asserts that every symmetric matrix is orthogonally diagonalizable."},
            {"time": "14:40", "text": "Singular value decomposition factors any real matrix into orthogonal and diagonal components."},
            {"time": "25:00", "text": "Gram-Schmidt orthogonalization produces an orthonormal basis spanning the same subspace."}
        ]

        substantive = pinecone_rag_engine._filter_substantive_cues(cues)
        combined = " ".join(c.get("text", "") for c in substantive)
        self.assertNotIn("Namaste,", combined)
        self.assertNotIn("Are people there", combined)
        self.assertNotIn("Good morning, Girish.", combined)
        self.assertIn("spectral theorem", combined)
        self.assertIn("Singular value decomposition", combined)
        self.assertIn("Gram-Schmidt", combined)

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
        mock_redis.get.return_value = json.dumps(quiz_payload)
        cached = service.get_quiz("test_123")
        self.assertIsNotNone(cached)
        self.assertTrue(cached.get("cached"))
        self.assertEqual(cached["video_id"], "test_123")

    def test_database_quiz_persistence(self):
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
        """Test that generator clamps questions at target count (max 15)."""
        cues = [{"time": f"{i:02d}:00", "text": f"Lecture segment {i} discussing core theorem {i}."} for i in range(25)]

        generated_qs = [
            {
                "id": i,
                "question": f"Question {i}?",
                "options": ["A", "B", "C", "D"],
                "correct_index": 0,
                "explanation": f"Exp {i}",
                "timestamp": f"{i:02d}:00",
                "difficulty": "medium"
            }
            for i in range(1, 25)
        ]
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps({"questions": generated_qs})}}]
        }

        with patch.dict(os.environ, {"GROQ_API_KEY": "fake_groq_key"}), patch("requests.post", return_value=mock_resp):
            quiz_15 = pinecone_rag_engine.generate_lecture_quiz(
                video_id="vid_long",
                lecture_title="Long Lecture",
                cues=cues,
                num_questions=15
            )
            self.assertEqual(len(quiz_15["questions"]), 15)

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

    def test_generate_course_quiz_raises_without_llm(self):
        """Verify course quiz generator raises RuntimeError when LLMs fail, with NO fallback synthesizers."""
        lectures_data = [
            {"video_id": "lec_1", "title": "Lecture 1", "cues": [{"time": "01:00", "text": "Intro"}]}
        ]
        with patch("requests.post", side_effect=Exception("Network offline")):
            with self.assertRaises(RuntimeError) as cm:
                pinecone_rag_engine.generate_course_quiz(
                    course_name="Applied Linear Algebra",
                    lectures_data=lectures_data,
                    num_questions=5
                )
            self.assertIn("All configured AI models failed", str(cm.exception))

    def test_generate_course_quiz_covers_all_lectures_llm(self):
        """Test that generate_course_quiz parses multi-lecture questions from LLM."""
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

        mock_qs = [
            {
                "id": 1,
                "question": "What is linear combination?",
                "options": ["A", "B", "C", "D"],
                "correct_index": 0,
                "lecture_id": "lec_1",
                "lecture_title": "Lecture 1: Vector Spaces",
                "timestamp": "02:00",
                "difficulty": "medium",
                "explanation": "At [02:00]."
            },
            {
                "id": 2,
                "question": "What is an eigenvalue?",
                "options": ["A", "B", "C", "D"],
                "correct_index": 1,
                "lecture_id": "lec_2",
                "lecture_title": "Lecture 2: Eigenvalues",
                "timestamp": "15:30",
                "difficulty": "medium",
                "explanation": "At [15:30]."
            },
            {
                "id": 3,
                "question": "What is SVD?",
                "options": ["A", "B", "C", "D"],
                "correct_index": 2,
                "lecture_id": "lec_3",
                "lecture_title": "Lecture 3: Singular Value Decomposition",
                "timestamp": "30:00",
                "difficulty": "hard",
                "explanation": "At [30:00]."
            }
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps({"questions": mock_qs})}}]
        }

        with patch.dict(os.environ, {"GROQ_API_KEY": "fake_groq_key"}), patch("requests.post", return_value=mock_resp):
            quiz = pinecone_rag_engine.generate_course_quiz(
                course_name="Applied Linear Algebra",
                lectures_data=lectures_data,
                num_questions=3
            )

        self.assertEqual(quiz["course_name"], "Applied Linear Algebra")
        self.assertEqual(quiz["lecture_count"], 3)
        self.assertEqual(len(quiz["questions"]), 3)
        covered_lectures = {q["lecture_id"] for q in quiz["questions"]}
        self.assertEqual(covered_lectures, {"lec_1", "lec_2", "lec_3"})

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
        db = RelationalDBManager(postgres_url="")
        db.save_course_quiz("Machine Learning", data, lecture_count=2)
        saved = db.get_saved_course_quiz("Machine Learning")
        self.assertIsNotNone(saved)
        self.assertEqual(saved["course_slug"], "machine-learning")
        self.assertTrue(saved.get("persisted"))

    def test_quiz_attempt_db_persistence(self):
        """Test pure database persistence for student quiz attempts."""
        db = RelationalDBManager(postgres_url="")

        # 1. Save lecture attempt
        saved = db.save_quiz_attempt(
            quiz_type="lecture",
            target_id="vid_99",
            user_email="student@univ.edu",
            answers={"1": 2, "2": 0},
            score=1,
            completed=False
        )
        self.assertTrue(saved)

        # 2. Retrieve attempt
        attempt = db.get_quiz_attempt("lecture", "vid_99", "student@univ.edu")
        self.assertIsNotNone(attempt)
        self.assertEqual(attempt["answers"], {"1": 2, "2": 0})
        self.assertEqual(attempt["score"], 1)
        self.assertFalse(attempt["is_completed"])

        # 3. Update attempt to completed
        db.save_quiz_attempt(
            quiz_type="lecture",
            target_id="vid_99",
            user_email="student@univ.edu",
            answers={"1": 2, "2": 0, "3": 1},
            score=2,
            completed=True
        )
        updated = db.get_quiz_attempt("lecture", "vid_99", "student@univ.edu")
        self.assertEqual(updated["score"], 2)
        self.assertTrue(updated["is_completed"])

        # 4. Delete attempt
        deleted = db.delete_quiz_attempt("lecture", "vid_99", "student@univ.edu")
        self.assertTrue(deleted)
        self.assertIsNone(db.get_quiz_attempt("lecture", "vid_99", "student@univ.edu"))

    @patch("backend.database.RelationalDBManager._get_connection")
    def test_quiz_attempt_postgres_query(self, mock_conn_func):
        """Verify Postgres SQL executes UPSERT for quiz attempts."""
        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn_func.return_value = mock_conn

        db = RelationalDBManager(postgres_url="postgresql://user:pass@localhost:5432/testdb")

        res = db.save_quiz_attempt(
            quiz_type="course",
            target_id="applied-math",
            user_email="user@test.com",
            answers={"1": 0},
            score=1,
            completed=True
        )
        self.assertTrue(res)
        self.assertTrue(mock_cursor.execute.called)
        executed_sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO lecturescribe_quiz_attempts", executed_sql)
        self.assertIn("ON CONFLICT (quiz_type, target_id, user_email)", executed_sql)

    @patch("backend.database.db_manager.get_saved_video")
    @patch("backend.database.db_manager.get_saved_quiz")
    def test_quiz_answers_api_endpoints(self, mock_get_quiz, mock_get_video):
        mock_get_video.return_value = {"title": "Calculus", "cues": []}
        mock_get_quiz.return_value = {
            "video_id": "calc_1",
            "lecture_title": "Calculus",
            "questions": [{"id": 1, "question": "Q?", "options": ["A", "B", "C", "D"], "correct_index": 0}]
        }

        # 1. Save answers via POST
        res_post = self.client.post("/api/lecture/calc_1/quiz/answers", json={
            "user_email": "tester@test.com",
            "answers": {"1": 0},
            "score": 1,
            "completed": True
        })
        self.assertEqual(res_post.status_code, 200)
        self.assertTrue(res_post.json()["success"])

        # 2. Retrieve quiz with email query param - should hydrate user answers from DB
        res_get = self.client.get("/api/lecture/calc_1/quiz?email=tester@test.com")
        self.assertEqual(res_get.status_code, 200)
        data = res_get.json()
        self.assertEqual(data["user_answers"], {"1": 0})
        self.assertEqual(data["user_score"], 1)
        self.assertTrue(data["is_completed"])

        # 3. Delete answers via DELETE
        res_del = self.client.delete("/api/lecture/calc_1/quiz/answers?email=tester@test.com")
        self.assertEqual(res_del.status_code, 200)
        self.assertTrue(res_del.json()["success"])

        # 4. Verify cleared
        res_get2 = self.client.get("/api/lecture/calc_1/quiz?email=tester@test.com")
        self.assertNotIn("user_answers", res_get2.json())


if __name__ == "__main__":
    unittest.main()
