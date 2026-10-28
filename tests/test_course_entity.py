import unittest
import uuid
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import RelationalDBManager, db_manager


class TestCourseEntityNormalization(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Use an isolated in-memory DB manager instance for unit tests
        self.db = RelationalDBManager(postgres_url=None)

    def test_get_or_create_course_lifecycle(self):
        course_title = "1.2 Machine Learning Paradigms"
        expected_slug = "1-2-machine-learning-paradigms"

        # 1. Create course entity
        created = self.db.get_or_create_course(course_title)
        self.assertIsNotNone(created)
        self.assertEqual(created["name"], course_title)
        self.assertEqual(created["slug"], expected_slug)
        self.assertTrue(bool(created.get("id")))

        course_id = created["id"]

        # 2. Retrieve by slug
        by_slug = self.db.get_course(expected_slug)
        self.assertIsNotNone(by_slug)
        self.assertEqual(by_slug["id"], course_id)
        self.assertEqual(by_slug["name"], course_title)

        # 3. Retrieve by UUID
        by_id = self.db.get_course(course_id)
        self.assertIsNotNone(by_id)
        self.assertEqual(by_id["slug"], expected_slug)

        # 4. Idempotent get_or_create by slug
        again = self.db.get_or_create_course(expected_slug)
        self.assertEqual(again["id"], course_id)

    def test_list_courses(self):
        self.db.get_or_create_course("Advanced Algorithms")
        self.db.get_or_create_course("Computer Vision")
        self.db.get_or_create_course("Bioinformatics")

        courses = self.db.list_courses()
        self.assertGreaterEqual(len(courses), 3)
        slugs = [c["slug"] for c in courses]
        self.assertIn("advanced-algorithms", slugs)
        self.assertIn("computer-vision", slugs)
        self.assertIn("bioinformatics", slugs)

    def test_resolve_canonical_name_via_entity(self):
        canonical_title = "3.1 Natural Language Processing"
        created = self.db.get_or_create_course(canonical_title)

        # Resolving by slug should directly return canonical name from entity
        resolved = self.db.resolve_course_canonical_name("3-1-natural-language-processing")
        self.assertEqual(resolved, canonical_title)

    def test_dual_write_video_and_library(self):
        course_name = "Cloud Computing Architecture"
        video_id = "test_vid_dual_write_101"

        # Save video transcript
        self.db.save_video_transcript(
            video_id=video_id,
            title="Cloud Computing Session 1",
            duration="45:00",
            source_url="https://video.lecturescribe.local/test_vid_dual_write_101",
            caption_label="English",
            cues=[{"time": "00:00", "text": "Welcome to Cloud Computing"}],
            summary_sections=[{"title": "Overview", "summary": "Cloud fundamentals"}],
            user_email="learner@test.com",
            course_name=course_name
        )

        # Check in-memory cache for dual-written fields
        cached_vid = self.db._memory_cache.get(video_id)
        self.assertIsNotNone(cached_vid)
        self.assertEqual(cached_vid.get("course_slug"), "cloud-computing-architecture")
        self.assertTrue(bool(cached_vid.get("course_id")))
        self.assertEqual(cached_vid.get("course_name"), course_name)

        # Check user library record
        user_courses = self.db.get_user_courses("learner@test.com")
        self.assertTrue(any(c.get("course_slug") == "cloud-computing-architecture" for c in user_courses))
        course_entry = next(c for c in user_courses if c.get("course_slug") == "cloud-computing-architecture")
        self.assertTrue(bool(course_entry.get("course_id")))

    def test_dual_write_resources_and_notes(self):
        course_name = "Deep Learning Systems"

        # Create resource
        resource = self.db.create_resource(
            course_name=course_name,
            user_email="tutor@test.com",
            title="Lecture 1 Slides",
            filename="lecture1.pdf",
            blob_name="courses/deep-learning-systems/resources/lecture1.pdf",
            file_type="pdf",
            file_size_bytes=1024
        )
        self.assertEqual(resource.get("course_slug"), "deep-learning-systems")
        self.assertTrue(bool(resource.get("course_id")))

        # Create note
        note = self.db.create_course_note(
            course_name=course_name,
            user_email="student@test.com",
            title="Backpropagation derivation",
            blob_name="courses/deep-learning-systems/notes/note_1.md"
        )
        self.assertEqual(note.get("course_slug"), "deep-learning-systems")
        self.assertTrue(bool(note.get("course_id")))

    def test_api_list_courses_endpoint(self):
        with patch.object(db_manager, "list_courses", return_value=[
            {"id": str(uuid.uuid4()), "slug": "ai-ethics", "name": "AI Ethics"},
            {"id": str(uuid.uuid4()), "slug": "deep-rl", "name": "Deep Reinforcement Learning"}
        ]):
            res = self.client.get("/api/courses")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["count"], 2)
            self.assertEqual(data["courses"][0]["slug"], "ai-ethics")
            self.assertEqual(data["courses"][1]["slug"], "deep-rl")


if __name__ == "__main__":
    unittest.main()
