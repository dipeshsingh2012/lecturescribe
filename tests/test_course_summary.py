import json
import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import app, db_manager
from backend.rag_engine import pinecone_rag_engine


class TestCourseSummaryAndQuizReplay(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_generate_course_summary_success(self):
        """Test synthesizing course-level summary from lecture summaries."""
        lectures = [
            {
                "video_id": "vid_1",
                "lecture_title": "Lecture 1: Vectors and Spaces",
                "summary": "Introduction to Euclidean vectors, linear independence, and spanning sets."
            },
            {
                "video_id": "vid_2",
                "lecture_title": "Lecture 2: Matrices and Subspaces",
                "summary": "Row space, column space, and rank-nullity theorem."
            }
        ]

        mock_llm_payload = {
            "course_name": "Linear Algebra",
            "executive_summary": "Comprehensive guide to vector spaces and linear mappings.",
            "thematic_modules": [
                {
                    "module_title": "Fundamental Subspaces",
                    "lectures_covered": ["Lecture 1", "Lecture 2"],
                    "core_themes": "Spanning sets and dimensions",
                    "key_takeaways": ["Basis vectors are independent"]
                }
            ],
            "core_formulas_and_definitions": [
                {
                    "term": "Rank-Nullity",
                    "formula_or_def": "\\dim(\\text{col}(A)) + \\dim(\\text{null}(A)) = n",
                    "significance": "Conservation of dimensions"
                }
            ],
            "lecture_summaries": [
                {
                    "lecture_id": "vid_1",
                    "lecture_title": "Lecture 1: Vectors and Spaces",
                    "synopsis": "Overview of vector spaces.",
                    "key_points": ["Vectors span a space"]
                }
            ],
            "master_exam_checklist": ["Find basis for nullspace"]
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(mock_llm_payload)}}]
        }

        with patch("requests.post", return_value=mock_resp):
            summary = pinecone_rag_engine.generate_course_summary(
                course_name="Linear Algebra",
                lectures_data=lectures
            )

        self.assertEqual(summary["course_name"], "Linear Algebra")
        self.assertIn("Fundamental Subspaces", [m["module_title"] for m in summary["thematic_modules"]])
        self.assertEqual(summary["core_formulas_and_definitions"][0]["term"], "Rank-Nullity")
        self.assertEqual(len(summary["master_exam_checklist"]), 1)

    def test_course_quiz_defaults_to_20_questions(self):
        """Verify that generate_course_quiz requests 20 questions by default."""
        lectures_data = [
            {
                "title": f"Lecture {i}",
                "video_id": f"vid_{i}",
                "summary": f"Lecture {i} core definitions and theorems."
            }
            for i in range(1, 5)
        ]

        mock_20_qs = [
            {
                "id": i,
                "type": "mcq" if i % 2 == 1 else "fill_in_the_blank",
                "question": f"Question {i} testing core concept.",
                "options": ["A", "B", "C", "D"],
                "correct_index": 0,
                "blank_answer": "A" if i % 2 == 0 else "",
                "explanation": f"Explanation for Q{i}",
                "lecture_id": f"vid_{(i % 4) + 1}",
                "lecture_title": f"Lecture {(i % 4) + 1}",
                "difficulty": "medium"
            }
            for i in range(1, 21)
        ]

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps({"questions": mock_20_qs})}}]
        }

        with patch.dict("os.environ", {"GROQ_API_KEY": "fake_groq_key"}), patch("requests.post", return_value=mock_resp) as mock_post:
            quiz = pinecone_rag_engine.generate_course_quiz(
                course_name="Machine Learning",
                lectures_data=lectures_data
            )

        self.assertEqual(quiz["total_questions"], 20)
        self.assertEqual(len(quiz["questions"]), 20)
        # Verify prompt instructed 20 questions
        call_kwargs = mock_post.call_args[1]
        sent_payload = call_kwargs["json"]
        system_content = sent_payload["messages"][0]["content"]
        self.assertIn("20-question course exam", system_content)

    def test_course_summary_db_persistence(self):
        """Verify save_course_summary and get_saved_course_summary in database manager."""
        course_name = "Math Foundations"
        summary_obj = {
            "course_name": "Math Foundations",
            "executive_summary": "Discrete math principles.",
            "thematic_modules": [],
            "core_formulas_and_definitions": [],
            "lecture_summaries": [],
            "master_exam_checklist": []
        }

        # Save to DB / cache
        db_manager.save_course_summary(
            course_name=course_name,
            summary_data=summary_obj
        )

        retrieved = db_manager.get_saved_course_summary(course_name=course_name)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.get("course_name"), "Math Foundations")
        self.assertEqual(retrieved.get("executive_summary"), "Discrete math principles.")

    def test_quiz_replay_does_not_overwrite_active_attempt(self):
        """Verify that saving answers for an older quiz runs under course_replay and does not clobber active attempt."""
        course_slug = "quantum-mechanics"
        active_quiz_id = "cquiz_active_001"
        older_quiz_id = "cquiz_older_002"

        # 1. Save active quiz attempt
        db_manager.save_quiz_attempt(
            quiz_type="course",
            target_id=course_slug,
            user_email="student@univ.edu",
            answers={"1": 0, "2": 1},
            score=2,
            completed=True
        )

        # Active attempt exists
        active_attempt = db_manager.get_quiz_attempt("course", course_slug, "student@univ.edu")
        self.assertEqual(active_attempt["score"], 2)

        # 2. Mock active quiz in get_saved_course_quiz
        with patch.object(db_manager, "get_saved_course_quiz", return_value={"quiz_id": active_quiz_id, "questions": []}), \
             patch.object(db_manager, "get_course_quiz_history_by_id", return_value={"quiz_id": older_quiz_id, "quiz_json": {"questions": []}}):
            # Send replay answers for older_quiz_id
            resp = self.client.post(
                f"/api/course/{course_slug}/quiz/answers",
                json={
                    "user_email": "student@univ.edu",
                    "answers": {"1": 1, "2": 0},
                    "score": 0,
                    "completed": True,
                    "quiz_id": older_quiz_id
                }
            )
            self.assertEqual(resp.status_code, 200)

        # 3. Active attempt must remain score=2, UNTOUCHED by replay!
        active_after = db_manager.get_quiz_attempt("course", course_slug, "student@univ.edu")
        self.assertEqual(active_after["score"], 2)

        # 4. Replay attempt exists under course_replay
        replay_attempt = db_manager.get_quiz_attempt("course_replay", f"{course_slug}:{older_quiz_id}", "student@univ.edu")
        self.assertIsNotNone(replay_attempt)
        self.assertEqual(replay_attempt["score"], 0)


if __name__ == "__main__":
    unittest.main()
