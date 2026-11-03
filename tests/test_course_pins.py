"""
Tests for course pinning functionality:
1. Pinning courses appends to the queue (FIFO order preserved).
2. Unpinning removes the course without affecting other pinned courses' order.
3. Re-pinning appends to the end of the pinned list.
4. API endpoint /api/user/courses/pin toggles pin state and validates input.
5. get_user_courses prioritizes pinned courses according to append order.
"""

import unittest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_manager


class TestCoursePins(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_email = "test_pin_user@example.com"
        # Clear pins for test user before each test
        if hasattr(db_manager, "_user_course_pins_memory"):
            db_manager._user_course_pins_memory.pop(self.test_email, None)

    def tearDown(self):
        if hasattr(db_manager, "_user_course_pins_memory"):
            db_manager._user_course_pins_memory.pop(self.test_email, None)

    def test_toggle_course_pin_appends_in_order(self):
        """Verify pinning multiple courses appends them rather than prepending."""
        # Pin Course A
        is_pinned_a = db_manager.toggle_course_pin(self.test_email, "physics-101")
        self.assertTrue(is_pinned_a)
        pins = db_manager.get_pinned_courses(self.test_email)
        self.assertEqual(pins, ["physics-101"])

        # Pin Course B -> should append after A
        is_pinned_b = db_manager.toggle_course_pin(self.test_email, "chem-201")
        self.assertTrue(is_pinned_b)
        pins = db_manager.get_pinned_courses(self.test_email)
        self.assertEqual(pins, ["physics-101", "chem-201"])

        # Pin Course C -> should append after B
        is_pinned_c = db_manager.toggle_course_pin(self.test_email, "math-301")
        self.assertTrue(is_pinned_c)
        pins = db_manager.get_pinned_courses(self.test_email)
        self.assertEqual(pins, ["physics-101", "chem-201", "math-301"])

    def test_unpin_and_repin_order(self):
        """Verify unpinning removes item, and re-pinning appends to the end."""
        db_manager.toggle_course_pin(self.test_email, "course-1")
        db_manager.toggle_course_pin(self.test_email, "course-2")
        db_manager.toggle_course_pin(self.test_email, "course-3")

        # Unpin course-1
        is_pinned = db_manager.toggle_course_pin(self.test_email, "course-1")
        self.assertFalse(is_pinned)
        pins = db_manager.get_pinned_courses(self.test_email)
        self.assertEqual(pins, ["course-2", "course-3"])

        # Re-pin course-1 -> it should now append at the end (after course-3)
        is_pinned = db_manager.toggle_course_pin(self.test_email, "course-1")
        self.assertTrue(is_pinned)
        pins = db_manager.get_pinned_courses(self.test_email)
        self.assertEqual(pins, ["course-2", "course-3", "course-1"])

    def test_api_toggle_course_pin(self):
        """Verify POST /api/user/courses/pin toggles pin and returns updated list."""
        resp = self.client.post("/api/user/courses/pin", json={
            "email": self.test_email,
            "course_slug": "quantum-physics"
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["is_pinned"])
        self.assertEqual(data["pinned_courses"], ["quantum-physics"])

        # Toggle again to unpin
        resp2 = self.client.post("/api/user/courses/pin", json={
            "email": self.test_email,
            "course_slug": "quantum-physics"
        })
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertFalse(data2["is_pinned"])
        self.assertEqual(data2["pinned_courses"], [])

    def test_api_toggle_course_pin_validation(self):
        """Verify validation errors for missing or blank parameters."""
        resp = self.client.post("/api/user/courses/pin", json={
            "email": "",
            "course_slug": "quantum-physics"
        })
        self.assertEqual(resp.status_code, 400)

        resp2 = self.client.post("/api/user/courses/pin", json={
            "email": self.test_email,
            "course_slug": ""
        })
        self.assertEqual(resp2.status_code, 400)

    def test_get_user_courses_orders_pinned_first(self):
        """Verify get_user_courses outputs pinned courses first in append order."""
        from unittest.mock import MagicMock, patch
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [
            {"video_id": "v1", "title": "Bio Session 1", "duration": "10:00", "source_url": None, "drive_folder_url": None, "last_viewed_at": "2026-10-18T10:00:00", "course_name": "Biology"},
            {"video_id": "v2", "title": "Physics Session 1", "duration": "10:00", "source_url": None, "drive_folder_url": None, "last_viewed_at": "2026-10-18T09:00:00", "course_name": "Physics"},
            {"video_id": "v3", "title": "Math Session 1", "duration": "10:00", "source_url": None, "drive_folder_url": None, "last_viewed_at": "2026-10-18T08:00:00", "course_name": "Math"}
        ]
        with patch.object(db_manager, "_get_connection", return_value=mock_conn):
            with patch.object(db_manager, "get_pinned_courses", return_value=["physics", "math"]):
                courses = db_manager.get_user_courses(self.test_email)
                self.assertEqual(len(courses), 3)
                # Pinned courses come first in append order (physics then math)
                self.assertEqual(courses[0]["course_slug"], "physics")
                self.assertTrue(courses[0]["is_pinned"])
                self.assertEqual(courses[1]["course_slug"], "math")
                self.assertTrue(courses[1]["is_pinned"])
                # Unpinned course comes last
                self.assertEqual(courses[2]["course_slug"], "biology")
                self.assertFalse(courses[2]["is_pinned"])

    def test_single_query_courses_and_zero_db_redis_hit_and_no_empty_poisoning(self):
        """
        Verify:
        1. Joined query executes 1 SQL statement total (no N+1 get_course / get_pinned_courses / progress queries).
        2. Redis cache hit on /api/user/courses executes 0 DB calls.
        3. Transient DB exception fallback sets db_error=True so empty [] is NOT cached in Redis.
        """
        from unittest.mock import MagicMock, patch
        import backend.main as main_mod

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [
            {
                "video_id": "v10",
                "title": "Master of Technology Session 1",
                "duration": "40:00",
                "source_url": None,
                "drive_folder_url": None,
                "last_viewed_at": "2026-10-20T10:00:00",
                "course_name": "Master of Technology",
                "course_slug": "master-of-technology",
                "course_id": "11111111-1111-1111-1111-111111111111",
                "joined_course_id": "11111111-1111-1111-1111-111111111111",
                "joined_course_slug": "master-of-technology",
                "joined_course_name": "Master of Technology",
                "prog_user_email": self.test_email,
                "prog_last_timestamp": "20:00",
                "prog_last_seconds": 1200.0,
                "prog_duration_seconds": 2400.0,
                "prog_progress_percent": 50.0,
                "prog_active_cue_idx": 12,
                "prog_updated_at": "2026-10-20T10:20:00",
                "pinned_slugs_arr": ["master-of-technology"],
                "has_joined_meta": True,
            }
        ]

        with patch.object(db_manager, "_explicit_url", "postgresql://mock/db"), \
             patch.object(db_manager, "_get_connection", return_value=mock_conn) as mock_get_conn:
            courses = db_manager.get_user_courses(self.test_email)
            self.assertEqual(mock_get_conn.call_count, 1)
            self.assertEqual(mock_cursor.execute.call_count, 1)
            self.assertEqual(len(courses), 1)
            self.assertTrue(courses[0]["is_pinned"])
            self.assertEqual(courses[0]["lectures"][0]["progress"]["progress_percent"], 50.0)
            meta = db_manager.consume_last_courses_meta(self.test_email)
            self.assertEqual(meta["pinned_courses"], ["master-of-technology"])
            self.assertFalse(meta["db_error"])

        # Redis cache hit path: 0 DB calls
        mock_cache = MagicMock()
        mock_cache.get_user_courses_bundle.return_value = (courses, ["master-of-technology"])
        with patch.object(main_mod, "redis_cache", mock_cache), \
             patch.object(db_manager, "get_user_courses") as mock_db_courses, \
             patch.object(db_manager, "get_pinned_courses") as mock_db_pins:
            resp = self.client.get(f"/api/user/courses?email={self.test_email}")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertTrue(body["cached"])
            self.assertEqual(body["pinned_courses"], ["master-of-technology"])
            mock_db_courses.assert_not_called()
            mock_db_pins.assert_not_called()

        # Transient DB timeout fallback: must NOT poison Redis with empty []
        mock_cache_miss = MagicMock()
        mock_cache_miss.get_user_courses_bundle.return_value = (None, None)
        with patch.object(main_mod, "redis_cache", mock_cache_miss), \
             patch.object(db_manager, "_explicit_url", "postgresql://mock/db"), \
             patch.object(db_manager, "_get_connection", side_effect=RuntimeError("Neon connect timeout")), \
             patch.object(db_manager, "get_pinned_courses", return_value=[]):
            resp_err = self.client.get(f"/api/user/courses?email={self.test_email}")
            self.assertEqual(resp_err.status_code, 200)
            mock_cache_miss.set_user_courses_bundle.assert_not_called()


if __name__ == "__main__":
    unittest.main()
