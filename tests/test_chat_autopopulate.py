import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.main import app, process_chat_message
from fastapi import HTTPException

class TestChatMessageProcessing(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

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
    def test_process_chat_message_save_to_db_flag(
        self,
        mock_rag,
        mock_save_log,
        mock_get_video
    ):
        """When save_to_db is False, db_manager.save_chat_log should not be called."""
        mock_get_video.return_value = {"title": "Optimization"}
        mock_rag.return_value = {"answer": "Chat reply", "citations": [], "model": "TestModel"}

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

    @patch("backend.main.db_manager.delete_chat_message")
    @patch("backend.main.redis_cache")
    def test_delete_chat_message_endpoint(self, mock_redis, mock_delete_msg):
        """DELETE /api/chat/message deletes row from DB and invalidates video cache."""
        mock_delete_msg.return_value = True
        res = self.client.delete("/api/chat/message?message_id=msg_user_123&video_id=vid_999&email=test@example.com")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["message_id"], "msg_user_123")
        mock_delete_msg.assert_called_once_with(
            message_id="msg_user_123",
            video_id="vid_999",
            user_email="test@example.com"
        )
        mock_redis.invalidate_video.assert_called_once_with("vid_999")

    def test_delete_chat_message_endpoint_missing_id(self):
        """DELETE /api/chat/message without message_id returns 422/400 validation error."""
        res = self.client.delete("/api/chat/message")
        self.assertIn(res.status_code, (400, 422))

    @patch("backend.database.RelationalDBManager._get_connection")
    def test_delete_chat_message_db_method(self, mock_get_conn):
        """RelationalDBManager.delete_chat_message correctly parses message IDs and executes parameterized query."""
        from backend.database import db_manager
        
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.rowcount = 1
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_get_conn.return_value = mock_conn

        # Test with msg_user_ prefix
        success = db_manager.delete_chat_message("msg_user_456", video_id="vid1", user_email="user@test.com")
        self.assertTrue(success)
        mock_cursor.execute.assert_called_with(
            "DELETE FROM lecturescribe_chat_logs WHERE id = %s AND video_id = %s AND (user_email = %s OR user_email IS NULL);",
            (456, "vid1", "user@test.com")
        )

        # Test with msg_bot_ prefix
        success2 = db_manager.delete_chat_message("msg_bot_789")
        self.assertTrue(success2)
        mock_cursor.execute.assert_called_with(
            "DELETE FROM lecturescribe_chat_logs WHERE id = %s;",
            (789,)
        )

        # Test with invalid string ID
        success3 = db_manager.delete_chat_message("invalid_id")
        self.assertFalse(success3)


if __name__ == "__main__":
    unittest.main()

