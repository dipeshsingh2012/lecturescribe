import unittest
from backend.web_search import search_web_for_context
from backend.google_drive_service import google_drive_service
from backend.rag_engine import pinecone_rag_engine

class TestServices(unittest.TestCase):
    def test_web_search_empty_query(self):
        results = search_web_for_context("")
        self.assertEqual(results, [])

    def test_gdrive_auth_status_structure(self):
        status = google_drive_service.get_auth_status()
        self.assertIn("has_libraries", status)
        self.assertIn("configured", status)
        self.assertIn("auth_type", status)

    def test_gdrive_job_creation(self):
        job_id = google_drive_service.create_job("test_video", "Test Lecture")
        self.assertTrue(len(job_id) > 0)
        job = google_drive_service.get_job(job_id)
        self.assertIsNotNone(job)
    def test_user_library_record_payload(self):
        from backend.main import UserLibraryRecordRequest
        payload = {
            "email": "dipesh.singh2012@gmail.com",
            "video_id": "1229629089",
            "video_title": "Introduction to Speech and Natural Language Processing",
            "video_url": "https://vimeo.com/1229629089",
            "duration_seconds": "1h 18m"
        }
        req = UserLibraryRecordRequest(**payload)
        self.assertEqual(req.email, "dipesh.singh2012@gmail.com")
        self.assertEqual(req.video_id, "1229629089")
        self.assertEqual(req.video_title, "Introduction to Speech and Natural Language Processing")

    def test_reciprocal_rank_fusion(self):
        """Test RRF fusion of two ranked lists."""
        list1 = [
            {"start_time": "01:00", "text": "First result from list1", "video_id": "123"},
            {"start_time": "02:00", "text": "Second result from list1", "video_id": "123"},
            {"start_time": "03:00", "text": "Third result from list1", "video_id": "123"}
        ]
        list2 = [
            {"start_time": "02:00", "text": "Second result from list1", "video_id": "123"},
            {"start_time": "01:00", "text": "First result from list1", "video_id": "123"},
            {"start_time": "04:00", "text": "Fourth result from list2", "video_id": "123"}
        ]
        
        fused = pinecone_rag_engine.reciprocal_rank_fusion([list1, list2], k=60)
        
        # Should return 4 unique items
        self.assertEqual(len(fused), 4)
        
        # Items appearing in both lists should have higher scores (ranked first)
        # Items 01:00 and 02:00 appear in both lists, so they should be ranked higher
        first_two_items = fused[:2]
        start_times = [item.get("start_time") for item in first_two_items]
        self.assertIn("01:00", start_times)
        self.assertIn("02:00", start_times)

    def test_agent_tools_declarations(self):
        """Verify the 4 agent tools are declared with valid function schemas."""
        tool_names = [t["function"]["name"] for t in pinecone_rag_engine.AGENT_TOOLS]
        self.assertIn("get_lecture_outline", tool_names)
        self.assertIn("search_transcript", tool_names)
        self.assertIn("get_transcript_window", tool_names)
        self.assertIn("search_web_context", tool_names)

    def test_agent_execute_tool_outline(self):
        """Verify execute_tool correctly executes get_lecture_outline."""
        from unittest.mock import patch
        mock_video = {
            "title": "Computer Vision 101",
            "summarySections": [
                {"title": "Intro [00:00 - 10:00]", "points": ["Cameras capture light"]}
            ],
            "cues": []
        }
        with patch("backend.database.db_manager.get_saved_video", return_value=mock_video):
            res_str, citations, web = pinecone_rag_engine.execute_tool(
                tool_name="get_lecture_outline",
                arguments={"video_id": "cv_test"},
                target_video_id="cv_test",
                lecture_title="Computer Vision 101"
            )
            self.assertIn("Cameras capture light", res_str)
            self.assertEqual(len(citations), 1)
            self.assertEqual(citations[0]["timestamp"], "00:00")

    def test_agent_execute_tool_transcript_window(self):
        """Verify execute_tool correctly fetches transcript cues for a time window."""
        from unittest.mock import patch
        mock_cues = [
            {"time": "02:00", "text": "Starting discussion on convolution filters."},
            {"time": "04:00", "text": "Filters slide across the spatial grid."},
            {"time": "12:00", "text": "Much later in the lecture."}
        ]
        with patch("backend.database.db_manager.get_saved_video", return_value={"cues": mock_cues}):
            res_str, citations, web = pinecone_rag_engine.execute_tool(
                tool_name="get_transcript_window",
                arguments={"start_time": "01:00", "end_time": "05:00", "video_id": "test_cv"},
                target_video_id="test_cv",
                lecture_title="CV"
            )
            self.assertIn("convolution filters", res_str)
            self.assertIn("Filters slide", res_str)
            self.assertNotIn("Much later", res_str)

    def test_agent_unknown_tool_fails_fast(self):
        """Verify unknown tool request raises an immediate ValueError."""
        with self.assertRaises(ValueError):
            pinecone_rag_engine.execute_tool("non_existent_tool", {}, "vid", "title")

    def test_agent_fail_fast_missing_credentials(self):
        """Verify query_rag raises RuntimeError when no LLM credentials exist."""
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {"HUGGINGFACE_TOKEN": "", "GROQ_API_KEY": "", "GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            with self.assertRaises(RuntimeError):
                pinecone_rag_engine.query_rag(query="test", video_id="vid")

    def test_submission_fails_fast_on_unexecuted_function(self):
        """Verify generate_submission_version raises ValueError when input is raw function call."""
        with self.assertRaises(ValueError):
            pinecone_rag_engine.generate_submission_version("<function=get_lecture_outline video_id=\"1228259148\"></function>")

    def test_submission_fails_fast_on_empty_text(self):
        """Verify generate_submission_version raises ValueError on empty text."""
        with self.assertRaises(ValueError):
            pinecone_rag_engine.generate_submission_version("")

    def test_transcript_window_fails_fast_when_no_cues_in_window(self):
        """Verify execute_tool raises ValueError if no cues match window (no fallback to cues[:8])."""
        from unittest.mock import patch
        mock_cues = [
            {"time": "02:00", "text": "Early cue"},
            {"time": "03:00", "text": "Another early cue"}
        ]
        with patch("backend.database.db_manager.get_saved_video", return_value={"cues": mock_cues}):
            with self.assertRaises(ValueError):
                pinecone_rag_engine.execute_tool(
                    tool_name="get_transcript_window",
                    arguments={"start_time": "50:00", "end_time": "55:00", "video_id": "test_cv"},
                    target_video_id="test_cv",
                    lecture_title="CV"
                )

    def test_chat_history_db_methods(self):
        """Verify get_chat_history and clear_chat_history format and execute correctly."""
        from unittest.mock import patch, MagicMock
        from backend.database import db_manager
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            {
                "id": 1,
                "video_id": "test_vid",
                "user_prompt": "What is attention?",
                "ai_reply": "Attention is a mechanism in deep learning.",
                "citations_json": [{"timestamp": "01:23", "text": "attention"}],
                "user_email": "student@example.com",
                "submission_text": "Attention enables models to weight tokens.",
                "model": "Groq Llama 3.3 70B",
                "web_sources_json": [],
                "created_at": None
            }
        ]
        mock_conn = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch.object(db_manager, "_get_connection", return_value=mock_conn):
            # Test retrieval
            history = db_manager.get_chat_history("test_vid", "student@example.com")
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["sender"], "user")
            self.assertEqual(history[0]["text"], "What is attention?")
            self.assertEqual(history[1]["sender"], "bot")
            self.assertEqual(history[1]["text"], "Attention is a mechanism in deep learning.")
            self.assertEqual(history[1]["model"], "Groq Llama 3.3 70B")
            self.assertEqual(history[1]["submission_text"], "Attention enables models to weight tokens.")

            # Test clear
            success = db_manager.clear_chat_history("test_vid", "student@example.com")
            self.assertTrue(success)

    def test_rag_query_request_chat_history(self):
        from backend.main import RAGQueryRequest
        req = RAGQueryRequest(
            query="Tell me more about point 2",
            video_id="test_vid",
            chat_history=[
                {"role": "user", "content": "Explain SVMs."},
                {"role": "assistant", "content": "Support Vector Machines find optimal hyperplanes."}
            ]
        )
        self.assertEqual(len(req.chat_history), 2)
        self.assertEqual(req.chat_history[0]["role"], "user")

    def test_api_chat_history_endpoints(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from backend.main import app

        client = TestClient(app)
        with patch("backend.main.db_manager.get_chat_history") as mock_get:
            mock_get.return_value = [
                {"id": "msg_user_1", "sender": "user", "text": "Hello"},
                {"id": "msg_bot_1", "sender": "bot", "text": "Welcome to class!"}
            ]
            resp = client.get("/api/chat/history?video_id=test_vid&email=test@example.com")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["count"], 2)
            self.assertEqual(len(data["messages"]), 2)

        with patch("backend.main.db_manager.clear_chat_history") as mock_clear:
            mock_clear.return_value = True
            resp = client.delete("/api/chat/history?video_id=test_vid&email=test@example.com")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "success")

    def test_extract_course_name(self):
        from backend.database import extract_course_name
        self.assertEqual(
            extract_course_name("Introduction to Financial Analytics Live session -1 (18 / 9 / 2026)"),
            "Introduction to Financial Analytics"
        )
        self.assertEqual(
            extract_course_name("Introduction to Financial Analytics Live session -2 (25 / 9 / 2026)"),
            "Introduction to Financial Analytics"
        )
        self.assertEqual(
            extract_course_name("Computer Vision Live Session - 1"),
            "Computer Vision"
        )
        self.assertEqual(
            extract_course_name("Introduction to Speech and Natural Language Processing"),
            "Introduction to Speech and Natural Language Processing"
        )

    def test_api_user_courses_endpoint(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from backend.main import app

        client = TestClient(app)
        with patch("backend.main.db_manager.get_user_courses") as mock_courses:
            mock_courses.return_value = [
                {
                    "course_name": "Introduction to Financial Analytics",
                    "lecture_count": 2,
                    "lectures": [
                        {"video_id": "1228259148", "title": "Session 1"},
                        {"video_id": "1230314346", "title": "Session 2"}
                    ]
                }
            ]
            resp = client.get("/api/user/courses?email=test@example.com")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["count"], 1)
            self.assertEqual(data["courses"][0]["course_name"], "Introduction to Financial Analytics")
            self.assertEqual(data["courses"][0]["lecture_count"], 2)

if __name__ == "__main__":
    unittest.main()

