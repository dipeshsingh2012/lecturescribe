import unittest
from backend.web_search import search_web_for_context
from backend.google_drive_service import google_drive_service

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

if __name__ == "__main__":
    unittest.main()
