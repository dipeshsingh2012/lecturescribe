import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch

from backend.transcription_jobs import (
    dispatch_transcription_job,
    enqueue_transcription_task,
    launch_transcription_cloud_run_job,
    process_transcription_job,
    verify_cloud_task_identity,
)


class TestTranscriptionJobs(unittest.TestCase):
    @patch("backend.transcription_jobs.redis_cache.invalidate_video")
    @patch("backend.transcription_jobs.pinecone_rag_engine.ingest_transcript", return_value=[])
    @patch("backend.transcription_jobs.algolia_service.ingest_cues")
    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.db_manager.save_video_transcript")
    @patch("backend.transcription_jobs.requests.post")
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={
            "job_id": "128ef3d8-4d98-4e77-87b9-2ec777d028a7",
            "video_id": "123",
            "status": "queued",
        },
    )
    def test_worker_persists_indexes_and_completes(
        self,
        _get_job,
        _claim,
        get_video,
        post,
        save,
        update,
        algolia,
        pinecone,
        invalidate,
    ):
        get_video.return_value = {
            "title": "Lecture",
            "duration": "45m",
            "sourceUrl": "https://vimeo.com/123",
            "course_name": "AI",
            "cues": [],
            "summarySections": [],
        }
        post.return_value = SimpleNamespace(
            ok=True,
            json=lambda: {
                "segments": [{"start": 65.3, "text": " Welcome to class. "}],
            },
        )

        with patch.dict("os.environ", {"TRANSCRIPTION_SERVICE_URL": "https://transcription.example"}):
            process_transcription_job("128ef3d8-4d98-4e77-87b9-2ec777d028a7")

        saved_cues = [{"time": "01:05", "text": "Welcome to class."}]
        save.assert_called_once_with(
            "123",
            "Lecture",
            "45m",
            "https://vimeo.com/123",
            "Groq Whisper",
            saved_cues,
            [],
            user_email=None,
            course_name="AI",
        )
        algolia.assert_called_once_with("123", "Lecture", saved_cues)
        pinecone.assert_called_once_with("123", "Lecture", saved_cues)
        invalidate.assert_called_once_with("123")
        self.assertEqual(update.call_args.args[:3], (
            "128ef3d8-4d98-4e77-87b9-2ec777d028a7", "completed", "completed"
        ))

    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=False)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"status": "processing"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    def test_duplicate_worker_execution_does_not_process(self, get_video, _get_job, _claim):
        process_transcription_job("128ef3d8-4d98-4e77-87b9-2ec777d028a7")
        get_video.assert_not_called()

    def test_error_details_redact_urls_and_credentials(self):
        from backend.transcription_jobs import _safe_error_message

        message = _safe_error_message(
            RuntimeError("request failed at https://example.test/private?token=secret API_KEY=abc")
        )
        self.assertNotIn("https://", message)
        self.assertNotIn("secret", message)
        self.assertNotIn("abc", message)

    @patch("google.cloud.tasks_v2.CloudTasksClient")
    def test_cloud_task_contains_only_job_id_and_uses_stable_task_name(self, client_type):
        client = client_type.return_value
        client.queue_path.return_value = "projects/p/locations/us-central1/queues/q"
        with patch.dict(
            "os.environ",
            {
                "GOOGLE_CLOUD_PROJECT": "p",
                "TRANSCRIPTION_TASKS_QUEUE": "q",
                "TRANSCRIPTION_TASKS_DISPATCH_URL": "https://api.example",
                "TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT": "tasks@example.iam.gserviceaccount.com",
            },
        ):
            task_name = enqueue_transcription_task(
                "128ef3d8-4d98-4e77-87b9-2ec777d028a7"
            )

        task = client.create_task.call_args.kwargs["request"]["task"]
        self.assertEqual(
            task_name,
            "projects/p/locations/us-central1/queues/q/tasks/transcription-"
            "128ef3d8-4d98-4e77-87b9-2ec777d028a7",
        )
        self.assertEqual(
            json.loads(task["http_request"]["body"]),
            {"job_id": "128ef3d8-4d98-4e77-87b9-2ec777d028a7"},
        )
        self.assertEqual(
            task["http_request"]["oidc_token"]["service_account_email"],
            "tasks@example.iam.gserviceaccount.com",
        )

    @patch("backend.transcription_jobs.AuthorizedSession")
    @patch("backend.transcription_jobs.google.auth.default", return_value=(object(), None))
    def test_cloud_run_job_is_started_with_only_persisted_job_id(self, _credentials, session_type):
        session_type.return_value.post.return_value = SimpleNamespace(
            ok=True,
            json=lambda: {"name": "projects/p/locations/us-central1/jobs/job/executions/run-1"},
        )
        with patch.dict(
            "os.environ",
            {
                "GOOGLE_CLOUD_PROJECT": "p",
                "TRANSCRIPTION_CLOUD_RUN_JOB": "transcriber",
            },
        ):
            execution = launch_transcription_cloud_run_job("job-id")

        self.assertTrue(execution.endswith("/executions/run-1"))
        payload = session_type.return_value.post.call_args.kwargs["json"]
        self.assertEqual(
            payload["overrides"]["containerOverrides"][0]["env"],
            [{"name": "TRANSCRIPTION_JOB_ID", "value": "job-id"}],
        )

    @patch(
        "backend.transcription_jobs.id_token.verify_oauth2_token",
        return_value={
            "email": "tasks@example.iam.gserviceaccount.com",
            "email_verified": True,
        },
    )
    def test_dispatch_auth_requires_expected_verified_service_account(self, _verify):
        with patch.dict(
            "os.environ",
            {
                "TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT": "tasks@example.iam.gserviceaccount.com",
                "TRANSCRIPTION_TASKS_DISPATCH_URL": "https://api.example",
            },
        ):
            self.assertTrue(verify_cloud_task_identity("Bearer valid-token"))
            self.assertFalse(verify_cloud_task_identity("invalid"))


    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "video_id": "123", "status": "queued"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video", return_value=None)
    def test_worker_fails_when_video_not_found(self, _get_video, _get_job, _claim, update_job):
        with self.assertRaises(RuntimeError) as ctx:
            process_transcription_job("job-1")
        self.assertIn("Imported lecture was not found", str(ctx.exception))
        update_job.assert_called_once_with(
            "job-1", "failed", "failed", error_message="Imported lecture was not found."
        )

    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.requests.post")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "video_id": "123", "status": "queued"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    def test_worker_fails_on_service_http_error(
        self, get_video, _get_job, _claim, post_mock, update_job
    ):
        get_video.return_value = {"title": "L1", "cues": []}
        post_mock.return_value = SimpleNamespace(ok=False, status_code=502)
        with patch.dict("os.environ", {"TRANSCRIPTION_SERVICE_URL": "https://transcribe.test"}):
            with self.assertRaises(RuntimeError):
                process_transcription_job("job-1")
        update_job.assert_called_once()
        self.assertEqual(update_job.call_args.args[1:3], ("failed", "failed"))
        self.assertIn("HTTP 502", update_job.call_args.kwargs.get("error_message", ""))

    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.requests.post")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "video_id": "123", "status": "queued"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    def test_worker_fails_on_empty_transcript_output(
        self, get_video, _get_job, _claim, post_mock, update_job
    ):
        get_video.return_value = {"title": "L1", "cues": []}
        post_mock.return_value = SimpleNamespace(ok=True, json=lambda: {"segments": [], "text": ""})
        with patch.dict("os.environ", {"TRANSCRIPTION_SERVICE_URL": "https://transcribe.test"}):
            with self.assertRaises(RuntimeError) as ctx:
                process_transcription_job("job-1")
        self.assertIn("no transcript text", str(ctx.exception))
        self.assertEqual(update_job.call_args.args[1:3], ("failed", "failed"))

    @patch("backend.transcription_jobs.redis_cache.invalidate_video")
    @patch("backend.transcription_jobs.pinecone_rag_engine.ingest_transcript", return_value=[])
    @patch("backend.transcription_jobs.algolia_service.ingest_cues")
    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.requests.post")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "video_id": "123", "status": "queued"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    def test_worker_skips_transcription_when_cues_already_present(
        self, get_video, _get_job, _claim, post_mock, update_job, algolia, pinecone, invalidate
    ):
        existing_cues = [{"time": "00:10", "text": "Already transcribed"}]
        get_video.return_value = {"title": "L1", "cues": existing_cues}
        process_transcription_job("job-1")

        post_mock.assert_not_called()
        algolia.assert_called_once_with("123", "L1", existing_cues)
        pinecone.assert_called_once_with("123", "L1", existing_cues)
        invalidate.assert_called_once_with("123")
        update_job.assert_any_call("job-1", "processing", "indexing")
        update_job.assert_any_call("job-1", "completed", "completed")

    @patch("backend.transcription_jobs.algolia_service.ingest_cues", side_effect=Exception("Algolia unreachable"))
    @patch("backend.transcription_jobs.db_manager.update_transcription_job")
    @patch("backend.transcription_jobs.requests.post")
    @patch("backend.transcription_jobs.db_manager.save_video_transcript")
    @patch("backend.transcription_jobs.db_manager.claim_transcription_job", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "video_id": "123", "status": "queued"},
    )
    @patch("backend.transcription_jobs.db_manager.get_saved_video")
    def test_worker_handles_indexing_failure_gracefully(
        self, get_video, _get_job, _claim, _save, post_mock, update_job, _algolia
    ):
        get_video.return_value = {"title": "L1", "cues": []}
        post_mock.return_value = SimpleNamespace(
            ok=True,
            json=lambda: {"segments": [{"start": 10.0, "text": "Hello"}]},
        )
        with patch.dict("os.environ", {"TRANSCRIPTION_SERVICE_URL": "https://transcribe.test"}):
            with self.assertRaises(Exception):
                process_transcription_job("job-1")

        update_job.assert_any_call("job-1", "processing", "indexing")
        self.assertEqual(update_job.call_args.args[1:3], ("failed", "failed"))
        self.assertIn("Algolia unreachable", update_job.call_args.kwargs.get("error_message", ""))

    @patch("backend.transcription_jobs.db_manager.reset_transcription_dispatch")
    @patch("backend.transcription_jobs.launch_transcription_cloud_run_job", side_effect=RuntimeError("GCP down"))
    @patch("backend.transcription_jobs.db_manager.claim_transcription_dispatch", return_value=True)
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "status": "queued", "run_execution_name": None},
    )
    def test_dispatch_resets_claim_on_launch_error(
        self, _get_job, _claim, _launch, reset_dispatch
    ):
        with self.assertRaises(RuntimeError) as ctx:
            dispatch_transcription_job("job-1")
        self.assertIn("Unable to start transcription", str(ctx.exception))
        reset_dispatch.assert_called_once_with("job-1")

    @patch("backend.transcription_jobs.db_manager.claim_transcription_dispatch")
    @patch(
        "backend.transcription_jobs.db_manager.get_transcription_job",
        return_value={"job_id": "job-1", "status": "completed"},
    )
    def test_dispatch_skips_terminal_job(self, _get_job, claim):
        dispatch_transcription_job("job-1")
        claim.assert_not_called()


if __name__ == "__main__":
    unittest.main()
