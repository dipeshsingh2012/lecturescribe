import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app, process_chat_message, AUTOPOPULATE_PROMPTS
from fastapi import HTTPException

class TestChatAutopopulate(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_autopopulate_rejects_missing_or_active_video_id(self):
        """Should return HTTP 400 if video_id is blank or placeholder 'active'."""
        res1 = self.client.post("/api/chat/autopopulate", json={"video_id": ""})
        self.assertEqual(res1.status_code, 400)

        res2 = self.client.post("/api/chat/autopopulate", json={"video_id": "active"})
        self.assertEqual(res2.status_code, 400)

    @patch("backend.main.db_manager.get_chat_history")
    def test_autopopulate_returns_existing_history_immediately(self, mock_get_history):
        """If history already exists in DB, it should return instantly (<50ms) without running LLMs."""
        existing_messages = [
            {"id": "msg_user_1", "sender": "user", "text": "Create a summary for a 15 min read"},
            {"id": "msg_bot_1", "sender": "bot", "text": "15 min summary response"}
        ]
        mock_get_history.return_value = existing_messages

        with patch("backend.main.process_chat_message") as mock_process:
            res = self.client.post("/api/chat/autopopulate", json={
                "video_id": "12345",
                "video_title": "Test Lecture",
                "user_email": "student@example.com"
            })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["count"], 2)
            self.assertEqual(data["messages"], existing_messages)
            # Ensure process_chat_message was NOT called
            mock_process.assert_not_called()

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.get_chat_history")
    def test_autopopulate_handles_no_cues_gracefully(self, mock_get_history, mock_get_video):
        """If no transcript cues are found in DB or payload, return status 'no_cues' without crashing."""
        mock_get_history.return_value = []
        mock_get_video.return_value = None

        res = self.client.post("/api/chat/autopopulate", json={
            "video_id": "99999",
            "cues": []
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "no_cues")
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["messages"], [])

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.get_chat_history")
    @patch("backend.main.db_manager.save_chat_log")
    @patch("backend.main.process_chat_message")
    def test_autopopulate_executes_4_prompts_and_persists(
        self,
        mock_process,
        mock_save_log,
        mock_get_history,
        mock_get_video
    ):
        """Verify parallel execution of all 4 standard prompts and sequential DB persistence."""
        generated_messages = [
            {"id": "msg_user_1", "sender": "user", "text": AUTOPOPULATE_PROMPTS[0]},
            {"id": "msg_bot_1", "sender": "bot", "text": "15m summary", "submission_text": "sub 15"},
            {"id": "msg_user_2", "sender": "user", "text": AUTOPOPULATE_PROMPTS[1]},
            {"id": "msg_bot_2", "sender": "bot", "text": "30m summary", "submission_text": "sub 30"},
            {"id": "msg_user_3", "sender": "user", "text": AUTOPOPULATE_PROMPTS[2]},
            {"id": "msg_bot_3", "sender": "bot", "text": "full summary", "submission_text": "sub full"},
            {"id": "msg_user_4", "sender": "user", "text": AUTOPOPULATE_PROMPTS[3]},
            {"id": "msg_bot_4", "sender": "bot", "text": "concepts", "submission_text": "sub concepts"}
        ]
        mock_get_history.side_effect = [[], generated_messages]
        mock_get_video.return_value = {
            "title": "Machine Learning Overview",
            "cues": [{"time": "00:01", "text": "Intro to ML"}]
        }
        mock_process.return_value = {
            "reply": "Generated answer",
            "citations": [],
            "web_sources": [],
            "model": "Groq Llama 3.3 70B",
            "submission_text": "Academic submission text",
            "submission_word_count": 120
        }

        res = self.client.post("/api/chat/autopopulate", json={
            "video_id": "1231770905",
            "user_email": "student@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["count"], 8)
        self.assertEqual(mock_process.call_count, 4)
        self.assertEqual(mock_save_log.call_count, 4)

        # Verify all 4 standard prompt texts were passed
        executed_prompts = [call.kwargs.get("user_prompt") for call in mock_process.call_args_list]
        for expected_p in AUTOPOPULATE_PROMPTS:
            self.assertIn(expected_p, executed_prompts)

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.get_chat_history")
    @patch("backend.main.db_manager.save_chat_log")
    @patch("backend.main.process_chat_message")
    def test_autopopulate_handles_worker_partial_failure(
        self,
        mock_process,
        mock_save_log,
        mock_get_history,
        mock_get_video
    ):
        """If one worker thread fails, the others should still save and return gracefully."""
        mock_get_history.side_effect = [
            [],
            [
                {"id": "msg_user_1", "sender": "user", "text": "Prompt 1"},
                {"id": "msg_bot_1", "sender": "bot", "text": "Answer 1"}
            ]
        ]
        mock_get_video.return_value = {
            "title": "Lecture Title",
            "cues": [{"time": "00:01", "text": "Some text"}]
        }

        # Side effect: first call raises exception, others return success
        def _side_effect(**kwargs):
            if kwargs.get("user_prompt") == AUTOPOPULATE_PROMPTS[0]:
                raise RuntimeError("Temporary upstream error")
            return {
                "reply": "Good reply",
                "citations": [],
                "web_sources": [],
                "model": "Groq",
                "submission_text": "Submission",
                "submission_word_count": 100
            }

        mock_process.side_effect = _side_effect

        res = self.client.post("/api/chat/autopopulate", json={
            "video_id": "vid-partial",
            "user_email": "student@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        # 3 successful saves instead of 4
        self.assertEqual(mock_save_log.call_count, 3)

    def test_process_chat_message_empty_prompt_raises(self):
        """process_chat_message should raise HTTPException 400 for empty queries."""
        with self.assertRaises(HTTPException) as ctx:
            process_chat_message(user_prompt="   ")
        self.assertEqual(ctx.exception.status_code, 400)

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.redis_cache")
    def test_process_chat_message_cache_hit(self, mock_redis, mock_get_video):
        """process_chat_message should return instantly if cached in Redis."""
        mock_get_video.return_value = {"title": "Transformer Architecture"}
        mock_redis.get_query.return_value = {
            "answer": "Cached answer text",
            "citations": [],
            "web_sources": [],
            "model": "RedisCache",
            "submission_text": "Cached submission",
            "submission_word_count": 50,
            "video_id": "vid-123"
        }

        res = process_chat_message(
            user_prompt="Explain transformers",
            video_id="vid-123",
            video_title="Transformer Architecture",
            bypass_cache=False
        )
        self.assertTrue(res.get("cached"))
        self.assertEqual(res["reply"], "Cached answer text")

    @patch("backend.main.db_manager.get_saved_video")
    @patch("backend.main.db_manager.save_chat_log")
    @patch("backend.main.pinecone_rag_engine.query_rag")
    @patch("backend.main.pinecone_rag_engine.generate_submission_version")
    @patch("backend.main.slm_classify_intent")
    def test_process_chat_message_save_to_db_flag(
        self,
        mock_intent,
        mock_sub,
        mock_rag,
        mock_save_log,
        mock_get_video
    ):
        """When save_to_db is False, db_manager.save_chat_log should not be called."""
        mock_get_video.return_value = {"title": "Optimization"}
        from backend.slm_router import INTENT_CHAT
        mock_intent.return_value = INTENT_CHAT
        mock_rag.return_value = {"answer": "Chat reply", "citations": [], "model": "TestModel"}
        mock_sub.return_value = {"submission_text": "Sub reply", "word_count": 80}

        # save_to_db=False
        res_no_save = process_chat_message(
            user_prompt="What is gradient?",
            video_id="vid-test",
            video_title="Optimization",
            save_to_db=False
        )
        mock_save_log.assert_not_called()
        self.assertEqual(res_no_save["reply"], "Chat reply")

        # save_to_db=True
        res_save = process_chat_message(
            user_prompt="What is gradient?",
            video_id="vid-test",
            video_title="Optimization",
            save_to_db=True
        )
        mock_save_log.assert_called_once()


if __name__ == "__main__":
    unittest.main()
