import unittest
import os
from types import SimpleNamespace
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

    @patch("backend.main.redis_cache.invalidate_video")
    @patch("backend.main.pinecone_rag_engine.ingest_transcript", return_value=[])
    @patch("backend.main.algolia_service.ingest_cues")
    @patch("backend.main.db_manager.save_video_transcript")
    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.requests.post")
    def test_transcription_endpoint_saves_and_indexes_generated_cues(
        self, mock_post, mock_get_video, mock_save, mock_algolia, mock_pinecone, mock_invalidate
    ):
        mock_get_video.return_value = {
            "title": "Introduction to Generative AI",
            "duration": "45m",
            "sourceUrl": "https://vimeo.com/1233458452",
            "course_name": "Artificial Intelligence",
            "cues": [],
        }
        mock_post.return_value = SimpleNamespace(
            ok=True,
            json=lambda: {
                "text": "Welcome to class.",
                "segments": [{"start": 65.3, "text": " Welcome to class. "}],
            },
        )

        with patch.dict(os.environ, {"TRANSCRIPTION_SERVICE_URL": "https://transcription.example"}):
            response = self.client.post("/api/lecture/1233458452/transcribe?email=student%40example.com")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["transcript_available"])
        self.assertEqual(data["captionLabel"], "Groq Whisper")
        self.assertEqual(data["cues"], [{"time": "01:05", "text": "Welcome to class."}])
        mock_post.assert_called_once_with(
            "https://transcription.example/transcribe/url",
            json={"url": "https://vimeo.com/1233458452"},
            timeout=(15, 900),
        )
        mock_save.assert_called_once()
        self.assertEqual(mock_save.call_args.args[4], "Groq Whisper")
        self.assertEqual(mock_save.call_args.args[5], data["cues"])
        mock_algolia.assert_called_once_with("1233458452", "Introduction to Generative AI", data["cues"])
        mock_pinecone.assert_called_once_with("1233458452", "Introduction to Generative AI", data["cues"])
        mock_invalidate.assert_called_once_with("1233458452")

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.requests.post")
    def test_transcription_endpoint_surfaces_transcription_service_error(self, mock_post, mock_get_video):
        mock_get_video.return_value = {
            "title": "Introduction to Generative AI",
            "duration": "45m",
            "cues": [],
        }
        mock_post.return_value = SimpleNamespace(
            ok=False,
            status_code=502,
            json=lambda: {"detail": "GROQ_API_KEY is not configured."},
        )

        with patch.dict(os.environ, {"TRANSCRIPTION_SERVICE_URL": "https://transcription.example"}):
            response = self.client.post("/api/lecture/1233458452/transcribe")

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json()["detail"],
            "Transcription service failed: GROQ_API_KEY is not configured.",
        )

    @patch("backend.main.requests.post")
    @patch("backend.main.db_manager.get_saved_video")
    def test_transcription_endpoint_returns_existing_cues_instead_of_conflict(
        self, mock_get_video, mock_post
    ):
        saved_cues = [{"time": "00:12", "text": "The probability density function integrates to one."}]
        mock_get_video.return_value = {
            "videoId": "1233458452",
            "title": "Introduction to Generative AI",
            "duration": "45m",
            "cues": saved_cues,
            "summarySections": [],
        }

        with patch.dict(os.environ, {"TRANSCRIPTION_SERVICE_URL": "https://transcription.example"}):
            response = self.client.post("/api/lecture/1233458452/transcribe")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cues"], saved_cues)
        self.assertTrue(response.json()["transcript_available"])
        self.assertTrue(response.json()["cached"])
        mock_post.assert_not_called()

    @patch("backend.main.db_manager.get_saved_video", return_value=None)
    def test_transcription_endpoint_requires_an_imported_video(self, _mock_get_video):
        with patch.dict(os.environ, {"TRANSCRIPTION_SERVICE_URL": "https://transcription.example"}):
            response = self.client.post("/api/lecture/1233458452/transcribe")

        self.assertEqual(response.status_code, 404)

    def test_async_transcription_endpoint_returns_accepted_job(self):
        job_id = "128ef3d8-4d98-4e77-87b9-2ec777d028a7"
        job = {
            "job_id": job_id,
            "video_id": "1233458452",
            "requested_by": "student@example.com",
            "status": "queued",
            "stage": "queued",
            "created": True,
        }
        saved_video = {"title": "Lecture", "cues": []}
        refreshed_job = {**job, "task_name": "task-resource"}
        with (
            patch.dict(
                os.environ,
                {
                    "ASYNC_TRANSCRIPTION_ENABLED": "true",
                    "TRANSCRIPTION_SERVICE_URL": "https://transcription.example",
                },
            ),
            patch("backend.main.db_manager.get_saved_video", return_value=saved_video),
            patch("backend.main.db_manager.create_transcription_job", return_value=job),
            patch("backend.main.enqueue_transcription_task", return_value="task-resource") as enqueue,
            patch("backend.main.db_manager.record_transcription_task") as record_task,
            patch("backend.main.db_manager.get_transcription_job", return_value=refreshed_job) as get_job,
        ):
            response = self.client.post(
                "/api/lecture/1233458452/transcribe?email=student%40example.com"
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["job_id"], job_id)
        self.assertEqual(response.json()["status"], "queued")
        enqueue.assert_called_once_with(job_id)
        record_task.assert_called_once_with(job_id, "task-resource")
        get_job.assert_called_once_with(job_id)

    def test_async_transcription_reuses_active_job_without_enqueueing(self):
        job = {
            "job_id": "128ef3d8-4d98-4e77-87b9-2ec777d028a7",
            "video_id": "1233458452",
            "requested_by": None,
            "status": "processing",
            "stage": "transcribing",
            "created": False,
        }
        with (
            patch.dict(
                os.environ,
                {
                    "ASYNC_TRANSCRIPTION_ENABLED": "true",
                    "TRANSCRIPTION_SERVICE_URL": "https://transcription.example",
                },
            ),
            patch("backend.main.db_manager.get_saved_video", return_value={"cues": []}),
            patch("backend.main.db_manager.create_transcription_job", return_value=job),
            patch("backend.main.enqueue_transcription_task") as enqueue,
        ):
            response = self.client.post("/api/lecture/1233458452/transcribe")

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["status"], "processing")
        enqueue.assert_not_called()

    def test_transcription_job_status_requires_matching_email_owner(self):
        job = {
            "job_id": "128ef3d8-4d98-4e77-87b9-2ec777d028a7",
            "video_id": "1233458452",
            "requested_by": "student@example.com",
            "status": "processing",
            "stage": "transcribing",
        }
        with patch("backend.main.db_manager.get_transcription_job", return_value=job):
            denied = self.client.get(
                "/api/lecture/transcription-jobs/128ef3d8-4d98-4e77-87b9-2ec777d028a7"
            )
            allowed = self.client.get(
                "/api/lecture/transcription-jobs/128ef3d8-4d98-4e77-87b9-2ec777d028a7"
                "?email=student%40example.com"
            )

        self.assertEqual(denied.status_code, 404)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["stage"], "transcribing")

    @patch("backend.main.db_manager.get_saved_video")
    def test_transcript_provides_course_slug_and_canonical_name(self, mock_get_saved):
        mock_get_saved.return_value = {
            "videoId": "1234158573",
            "title": "Machine Learning Paradigms Live Session -4 ( 8 / 10 / 2026)",
            "duration": 3600,
            "sourceUrl": "https://vimeo.com/1234158573",
            "captionLabel": "English",
            "cues": [{"time": "00:01", "text": "Welcome to ML"}],
            "summarySections": [],
            "course_name": "Machine Learning Paradigms",
            "course_slug": "machine-learning-paradigms",
            "cached": True
        }
        response = self.client.get("/api/transcript?url=https://vimeo.com/1234158573&course_name=machine-learning-paradigms")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["course_name"], "Machine Learning Paradigms")
        self.assertEqual(data["course_slug"], "machine-learning-paradigms")

if __name__ == "__main__":
    unittest.main()
