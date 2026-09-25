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

if __name__ == "__main__":
    unittest.main()
