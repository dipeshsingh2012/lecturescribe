import unittest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_manager
from backend.slide_parser import parse_slide_document, format_slides_for_llm
from backend.reading_extractor import fetch_google_books_metadata, search_web_reading_links


class TestSlideParser(unittest.TestCase):
    def test_format_slides_for_llm(self):
        slides = [
            {"slide_number": 1, "title": "Intro", "text": "Welcome to CS101\nTextbook: Cormen Algorithms", "notes": ""},
            {"slide_number": 2, "title": "Grading", "text": "Midterm 40%\nRead Bishop Chapter 2", "notes": "Check notes"}
        ]
        formatted = format_slides_for_llm(slides)
        self.assertIn("Slide 1: Intro", formatted)
        self.assertIn("Cormen Algorithms", formatted)
        self.assertIn("Speaker Notes: Check notes", formatted)

    def test_parse_empty_source(self):
        res = parse_slide_document(b"", filename="empty.pptx")
        self.assertEqual(res, [])


class TestReadingEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_course = "Algorithms & Data Structures"
        # Seed a test reading directly
        self.saved_item = db_manager.save_course_reading(self.test_course, {
            "title": "Introduction to Algorithms",
            "author": "Thomas H. Cormen, Charles E. Leiserson",
            "edition": "4th Edition, 2022",
            "reading_type": "book",
            "category": "primary_textbook",
            "source_type": "slide_ppt",
            "source_context": "Found on Slide 2 of Syllabus deck"
        })

    def tearDown(self):
        db_manager.clear_course_readings(self.test_course)

    def test_get_course_readings(self):
        res = self.client.get(f"/api/course/{self.test_course}/readings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["count"] >= 1)
        self.assertTrue(any("Introduction to Algorithms" in r["title"] for r in data["readings"]))

    def test_get_course_readings_by_slug(self):
        # Slug version of "Algorithms & Data Structures" -> "algorithms-data-structures"
        slug = "algorithms-data-structures"
        res = self.client.get(f"/api/course/{slug}/readings")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["count"] >= 1)
        self.assertTrue(any("Introduction to Algorithms" in r["title"] for r in data["readings"]))

    def test_delete_course_reading(self):
        reading_id = self.saved_item["id"]
        res = self.client.delete(f"/api/course/reading/{reading_id}")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["deleted"])

        # Verify it is deleted
        res2 = self.client.get(f"/api/course/{self.test_course}/readings")
        self.assertFalse(any(r["id"] == reading_id for r in res2.json()["readings"]))

    def test_search_reading_web(self):
        res = self.client.get("/api/course/reading/search-web", params={
            "title": "Introduction to Algorithms",
            "author": "Cormen",
            "course_name": self.test_course
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("results", data)

    def test_get_reading_reader(self):
        reading_id = self.saved_item["id"]
        res = self.client.get(f"/api/course/reading/{reading_id}/reader")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["reading_id"], reading_id)
        self.assertIn("embed_url", data)
