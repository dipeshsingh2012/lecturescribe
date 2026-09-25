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

    def test_query_rag_without_cues(self):
        """Test query_rag executes successfully without cues passed in request payload."""
        # Test with video_id but no cues - should use hybrid retrieval
        result = pinecone_rag_engine.query_rag(
            query="test query",
            video_id="test_video_123",
            video_title="Test Lecture",
            cues=None,
            top_k=5,
            enable_web_search=False
        )
        
        # Should return a result with expected structure
        self.assertIn("answer", result)
        self.assertIn("citations", result)
        self.assertIn("model", result)
        self.assertIn("video_id", result)

    def test_query_rag_summary_mode(self):
        """Test query_rag accurately processes a 10 min read summary query using lecture cues."""
        mock_cues = [
            {"time": "00:00", "text": "Welcome to Computer Vision Live Session."},
            {"time": "04:30", "text": "We first analyze camera models and perspective projection."},
            {"time": "12:15", "text": "Digital images are represented as 2D matrix arrays with quantized intensity."},
            {"time": "25:00", "text": "Edge detection relies on spatial gradient calculations."},
            {"time": "45:00", "text": "Conclusion of session covering image filtering and convolution."}
        ]
        result = pinecone_rag_engine.query_rag(
            query="create a summary for a 10 min read",
            video_id="mock_cv_101",
            video_title="Introduction to Computer Vision",
            cues=mock_cues,
            top_k=5,
            enable_web_search=False
        )
        self.assertIn("answer", result)
        self.assertTrue(len(result.get("citations", [])) > 0)
        # Should have captured the mock cues across the timeline
        timestamps = [c.get("timestamp") for c in result.get("citations", [])]
        self.assertIn("00:00", timestamps)

if __name__ == "__main__":
    unittest.main()
