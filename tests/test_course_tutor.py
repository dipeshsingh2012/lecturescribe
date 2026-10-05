import os
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager, to_course_slug
from backend.rag_engine import pinecone_rag_engine


class TestCourseTutor(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_to_course_slug(self):
        self.assertEqual(to_course_slug("Applied Mathematics for Data Science"), "applied-mathematics-for-data-science")
        self.assertEqual(to_course_slug("Machine Learning Paradigms! 2026"), "machine-learning-paradigms-2026")
        self.assertEqual(to_course_slug(""), "general")

    def test_database_course_chat_lifecycle(self):
        course = "Test Mathematics Course"
        user = "student@test.com"

        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            {
                "id": 42,
                "course_slug": "test-mathematics-course",
                "course_name": course,
                "user_prompt": "What is an eigenvalue?",
                "ai_reply": "An eigenvalue represents the scalar factor by which an eigenvector is stretched.",
                "citations_json": [{
                    "video_id": "vid_101",
                    "video_title": "Lecture 1: Linear Algebra",
                    "timestamp": "12:30",
                    "text": "Eigenvalues stretch eigenvectors.",
                    "cross_lecture": True
                }],
                "user_email": user,
                "model": "Test LLM",
                "created_at": None
            }
        ]
        mock_cursor.rowcount = 1
        mock_conn = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch.object(db_manager, "_get_connection", return_value=mock_conn):
            # 1. Save chat log
            db_manager.save_course_chat_log(
                course_name=course,
                user_prompt="What is an eigenvalue?",
                ai_reply="An eigenvalue represents the scalar factor by which an eigenvector is stretched.",
                citations=[{
                    "video_id": "vid_101",
                    "video_title": "Lecture 1: Linear Algebra",
                    "timestamp": "12:30",
                    "text": "Eigenvalues stretch eigenvectors.",
                    "cross_lecture": True
                }],
                user_email=user,
                model="Test LLM"
            )
            mock_cursor.execute.assert_called()
            insert_call = mock_cursor.execute.call_args[0]
            self.assertIn("INSERT INTO lecturescribe_course_chat_logs", insert_call[0])

            # 2. Retrieve history
            history = db_manager.get_course_chat_history(course, user_email=user)
            self.assertEqual(len(history), 2)  # User turn + bot turn
            self.assertEqual(history[0]["sender"], "user")
            self.assertEqual(history[0]["text"], "What is an eigenvalue?")
            self.assertEqual(history[1]["sender"], "bot")
            self.assertIn("scalar factor", history[1]["text"])
            self.assertEqual(len(history[1]["citations"]), 1)
            self.assertEqual(history[1]["citations"][0]["video_id"], "vid_101")

            # 3. Delete specific message
            deleted = db_manager.delete_course_chat_message("msg_user_42", course_name=course, user_email=user)
            self.assertTrue(deleted)
            delete_call = mock_cursor.execute.call_args[0]
            self.assertIn("DELETE FROM lecturescribe_course_chat_logs WHERE id = %s", delete_call[0])

            # 4. Clear remaining
            cleared = db_manager.clear_course_chat_history(course, user_email=user)
            self.assertTrue(cleared)
            clear_call = mock_cursor.execute.call_args[0]
            self.assertIn("DELETE FROM lecturescribe_course_chat_logs", clear_call[0])

    @patch.object(pinecone_rag_engine, "execute_course_tool")
    def test_execute_course_tool_mock(self, mock_tool):
        mock_tool.return_value = (
            '[{"video_id": "vid_1", "lecture_title": "L1", "timestamp": "[05:00]", "text": "Formula sample"}]',
            [{"video_id": "vid_1", "video_title": "L1", "timestamp": "05:00", "text": "Formula sample", "cross_lecture": True}]
        )
        res, cit = pinecone_rag_engine.execute_course_tool(
            "search_course_transcripts",
            {"query": "gradient descent", "top_k": 5},
            "Machine Learning"
        )
        self.assertIn("Formula sample", res)
        self.assertEqual(len(cit), 1)
        self.assertEqual(cit[0]["timestamp"], "05:00")

    def test_api_course_tutor_endpoints(self):
        course = "Applied AI"
        user = "learner@test.com"

        mock_result = {
            "reply": "Convolutional layers apply filters across the image dimensions.",
            "citations": [{
                "video_id": "vid_cv_1",
                "video_title": "Computer Vision Lecture 1",
                "timestamp": "14:20",
                "text": "Filter convolution step.",
                "cross_lecture": True
            }],
            "model": "Mock Gemini 2.0 Flash",
            "course_name": course
        }

        mock_history = [
            {
                "id": "msg_user_1",
                "sender": "user",
                "text": "Explain how convolution works in CNNs",
                "created_at": ""
            },
            {
                "id": "msg_bot_1",
                "sender": "bot",
                "text": "Convolutional layers apply filters across the image dimensions.",
                "citations": [{
                    "video_id": "vid_cv_1",
                    "video_title": "Computer Vision Lecture 1",
                    "timestamp": "14:20",
                    "text": "Filter convolution step.",
                    "cross_lecture": True
                }],
                "model": "Mock Gemini 2.0 Flash",
                "created_at": ""
            }
        ]

        with patch.object(pinecone_rag_engine, "query_course_rag", return_value=mock_result), \
             patch.object(db_manager, "save_course_chat_log", return_value=None), \
             patch.object(db_manager, "get_course_chat_history", return_value=mock_history), \
             patch.object(db_manager, "clear_course_chat_history", return_value=True):

            # 1. POST chat
            chat_res = self.client.post(
                f"/api/course/{course}/tutor/chat",
                json={
                    "message": "Explain how convolution works in CNNs",
                    "user_email": user
                }
            )
            self.assertEqual(chat_res.status_code, 200)
            data = chat_res.json()
            self.assertIn("Convolutional layers", data["reply"])
            self.assertEqual(len(data["citations"]), 1)
            self.assertEqual(data["citations"][0]["timestamp"], "14:20")

            # 2. GET history
            hist_res = self.client.get(f"/api/course/{course}/tutor/history?user_email={user}")
            self.assertEqual(hist_res.status_code, 200)
            hist_data = hist_res.json()
            self.assertEqual(hist_data["status"], "success")
            self.assertGreaterEqual(hist_data["count"], 2)

            # 3. DELETE history
            del_res = self.client.delete(f"/api/course/{course}/tutor/history?user_email={user}")
            self.assertEqual(del_res.status_code, 200)
            self.assertTrue(del_res.json().get("cleared"))


if __name__ == "__main__":
    unittest.main()
