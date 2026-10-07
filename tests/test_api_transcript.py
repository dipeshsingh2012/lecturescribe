import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app

class TestAPITranscript(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.sample_vtt = """WEBVTT

1
00:00:01.000 --> 00:00:04.000
Welcome to Robotics 101.

2
00:00:05.000 --> 00:00:09.000
Today we discuss forward kinematics.
"""

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.fetch_player_config")
    @patch("backend.main.get_text_tracks")
    @patch("backend.main.fetch_vtt")
    @patch("backend.main.algolia_service.ingest_cues")
    @patch("backend.main.pinecone_rag_engine.ingest_transcript")
    @patch("backend.main.db_manager.save_video_transcript")
    def test_transcript_extracts_course_name_when_omitted(
        self,
        mock_save_transcript,
        mock_pinecone,
        mock_algolia,
        mock_fetch_vtt,
        mock_get_tracks,
        mock_fetch_config,
        mock_get_saved_video
    ):
        mock_get_saved_video.return_value = None
        mock_fetch_config.return_value = {
            "video": {
                "title": "Robotics 101 Lecture 1 - Introduction",
                "duration": 3600
            }
        }
        mock_get_tracks.return_value = [
            {"url": "https://vimeo.com/test.vtt", "label": "English", "lang": "en"}
        ]
        mock_fetch_vtt.return_value = self.sample_vtt
        mock_save_transcript.return_value = True
        mock_pinecone.return_value = []

        # Calling without course_name parameter triggers extract_course_name(title)
        response = self.client.get("/api/transcript?url=https://vimeo.com/1229247139")
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["videoId"], "1229247139")
        self.assertEqual(data["course_name"], "Robotics 101")
        self.assertEqual(len(data["cues"]), 2)
        mock_save_transcript.assert_called_once()
        self.assertEqual(mock_save_transcript.call_args[1].get("course_name"), "Robotics 101")

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.fetch_player_config")
    @patch("backend.main.get_text_tracks")
    @patch("backend.main.fetch_vtt")
    @patch("backend.main.algolia_service.ingest_cues")
    @patch("backend.main.pinecone_rag_engine.ingest_transcript")
    @patch("backend.main.db_manager.save_video_transcript")
    def test_transcript_uses_explicit_course_name(
        self,
        mock_save_transcript,
        mock_pinecone,
        mock_algolia,
        mock_fetch_vtt,
        mock_get_tracks,
        mock_fetch_config,
        mock_get_saved_video
    ):
        mock_get_saved_video.return_value = None
        mock_fetch_config.return_value = {
            "video": {
                "title": "Intro to AI Module 1",
                "duration": 1800
            }
        }
        mock_get_tracks.return_value = [
            {"url": "https://vimeo.com/test.vtt", "label": "English", "lang": "en"}
        ]
        mock_fetch_vtt.return_value = self.sample_vtt
        mock_save_transcript.return_value = True

        response = self.client.get("/api/transcript?url=https://vimeo.com/1229247139&course_name=Artificial%20Intelligence")
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["course_name"], "Artificial Intelligence")
        self.assertEqual(mock_save_transcript.call_args[1].get("course_name"), "Artificial Intelligence")

    @patch("backend.main.db_manager.get_saved_video", return_value=None)
    @patch("backend.main.fetch_player_config")
    @patch("backend.main.get_text_tracks", return_value=[])
    @patch("backend.main.fetch_vtt")
    @patch("backend.main.generate_summary_sections")
    @patch("backend.main.db_manager.save_video_transcript")
    @patch("backend.main.algolia_service.ingest_cues")
    @patch("backend.main.pinecone_rag_engine.ingest_transcript")
    @patch("backend.main.db_manager.get_drive_folder_url", return_value=None)
    def test_video_is_imported_without_caption_tracks(
        self,
        mock_get_drive_url,
        mock_ingest_transcript,
        mock_ingest_search,
        mock_save_transcript,
        mock_generate_summary,
        mock_fetch_vtt,
        mock_get_tracks,
        mock_fetch_config,
        mock_get_saved_video
    ):
        mock_fetch_config.return_value = {
            "video": {
                "title": "Introduction to Generative AI",
                "duration": 4087
            }
        }

        response = self.client.get("/api/transcript?url=https://vimeo.com/1233458452")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["videoId"], "1233458452")
        self.assertEqual(data["title"], "Introduction to Generative AI")
        self.assertEqual(data["cues"], [])
        self.assertEqual(data["summarySections"], [])
        self.assertFalse(data["transcript_available"])
        self.assertIn("no caption or subtitle tracks", data["transcript_message"])
        mock_save_transcript.assert_called_once()
        self.assertEqual(mock_save_transcript.call_args.args[4], "Unavailable")
        self.assertEqual(mock_save_transcript.call_args.args[5], [])
        self.assertEqual(mock_save_transcript.call_args.args[6], [])
        mock_generate_summary.assert_not_called()
        mock_fetch_vtt.assert_not_called()
        mock_ingest_search.assert_not_called()
        mock_ingest_transcript.assert_not_called()

    def test_transcript_invalid_url_raises_400(self):
        response = self.client.get("/api/transcript?url=not-a-valid-vimeo-link")
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.json())

if __name__ == "__main__":
    unittest.main()
