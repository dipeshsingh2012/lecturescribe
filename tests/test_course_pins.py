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



if __name__ == "__main__":
    unittest.main()
