import unittest
import time
import json
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from backend.redis_service import RedisCacheService, redis_cache
from backend.main import app


class TestRedisCache(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.service = RedisCacheService()

    def test_query_normalization(self):
        """Test canonical query normalization prevents cache fragmentation."""
        q1 = "Create a summary for a 15 min read?"
        q2 = "  create a summary for a 15 min read   "
        q3 = "CREATE A SUMMARY FOR A 15 MIN READ!"
        q4 = "...create a summary   for a 15 min read..."

        norm1 = self.service.normalize_query(q1)
        norm2 = self.service.normalize_query(q2)
        norm3 = self.service.normalize_query(q3)
        norm4 = self.service.normalize_query(q4)

        self.assertEqual(norm1, "create a summary for a 15 min read")
        self.assertEqual(norm1, norm2)
        self.assertEqual(norm2, norm3)
        self.assertEqual(norm3, norm4)

    def test_make_query_key_deterministic(self):
        """Test that query cache keys are identical for semantically equivalent queries."""
        k1 = self.service.make_query_key("vid_101", "What is transfer learning?", "auto")
        k2 = self.service.make_query_key("vid_101", "  what is transfer learning?  ", "auto")
        k3 = self.service.make_query_key("vid_101", "What is deep learning?", "auto")
        k4 = self.service.make_query_key("vid_102", "What is transfer learning?", "auto")

        self.assertEqual(k1, k2)
        self.assertNotEqual(k1, k3)
        self.assertNotEqual(k1, k4)
        self.assertTrue(k1.startswith("ls:rag:v2:query:vid_101:"))

    def test_make_tool_key_order_independent(self):
        """Test that tool argument ordering does not change the cache key."""
        k1 = self.service.make_tool_key("vid_200", "search_transcript", {"query": "unet", "top_k": 5})
        k2 = self.service.make_tool_key("vid_200", "search_transcript", {"top_k": 5, "query": "unet"})

        self.assertEqual(k1, k2)
        self.assertTrue(k1.startswith("ls:rag:v2:tool:vid_200:search_transcript:"))

    def test_invalidate_video_purges_versioned_and_legacy_keys(self):
        """Verify that invalidate_video cleans both v2 and legacy cache key patterns."""
        mock_redis = MagicMock()
        mock_redis.scan.side_effect = [
            (0, ["ls:rag:v2:query:vid_999:abc"]),
            (0, ["ls:rag:query:vid_999:old"]),
            (0, ["ls:rag:v2:tool:vid_999:tool1:123"]),
            (0, [])
        ]
        mock_redis.delete.return_value = 1
        service = RedisCacheService(redis_url="redis://localhost:6379")
        service.client = mock_redis
        service.enabled = True

        deleted = service.invalidate_video("vid_999")
        self.assertEqual(deleted, 3)
        self.assertEqual(mock_redis.delete.call_count, 3)

    def test_health_check_includes_redis(self):
        """Verify that GET /health reports redis_cache status."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("redis_cache", data)
        redis_status = data["redis_cache"]
        self.assertIn("status", redis_status)

    def test_mock_cache_set_and_get(self):
        """Test cache read/write semantics using a mocked Redis client."""
        mock_redis = MagicMock()
        service = RedisCacheService(redis_url="redis://localhost:6379")
        service.client = mock_redis
        service.enabled = True

        test_data = {
            "answer": "UNet is a convolutional network...",
            "citations": [{"timestamp": "12:00", "text": "UNet intro"}],
            "model": "Llama 3.1 8B"
        }

        # Mock GET returning None (cache miss)
        mock_redis.get.return_value = None
        miss_res = service.get_query("test_vid", "Explain UNet", "auto")
        self.assertIsNone(miss_res)

        # SET call
        service.set_query("test_vid", "Explain UNet", "auto", test_data, ttl_seconds=300)
        self.assertTrue(mock_redis.setex.called or mock_redis.set.called)

        # Mock GET returning JSON string (cache hit)
        import json
        mock_redis.get.return_value = json.dumps(test_data)
        hit_res = service.get_query("test_vid", "Explain UNet?", "auto")
        self.assertIsNotNone(hit_res)
        self.assertTrue(hit_res.get("cached"))
        self.assertEqual(hit_res.get("cache_tier"), "REDIS")
        self.assertEqual(hit_res.get("answer"), "UNet is a convolutional network...")

    def test_user_courses_and_library_cache(self):
        """Test user courses & library cache get, set, and user invalidation."""
        mock_redis = MagicMock()
        service = RedisCacheService(redis_url="redis://localhost:6379")
        service.client = mock_redis
        service.enabled = True

        courses_data = [{"course_name": "CS 101", "lecture_count": 2}]
        library_data = [{"video_id": "v1", "title": "Intro"}]

        # Test set
        service.set_user_courses("test@domain.com", courses_data, ttl_seconds=300)
        mock_redis.setex.assert_called_with("ls:user_courses:test@domain.com", 300, json.dumps(courses_data))

        service.set_user_library("test@domain.com", library_data, ttl_seconds=300)
        mock_redis.setex.assert_called_with("ls:user_library:test@domain.com", 300, json.dumps(library_data))

        # Test get hit
        mock_redis.get.return_value = json.dumps(courses_data)
        courses = service.get_user_courses("test@domain.com")
        self.assertEqual(courses, courses_data)

        # Test user invalidation
        mock_redis.delete.return_value = 2
        deleted = service.invalidate_user("test@domain.com")
        self.assertEqual(deleted, 2)
        mock_redis.delete.assert_called_with("ls:user_courses:test@domain.com", "ls:user_library:test@domain.com")


if __name__ == "__main__":
    unittest.main()
