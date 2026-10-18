import unittest
from fastapi.testclient import TestClient
from backend.main import app
from backend.gcs_storage import gcs_storage_service
from backend.database import db_manager


class TestCourseNotesBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_email = "tester@mtech.edu"
        self.course_name = "Master of Technology"

    def test_notes_crud_lifecycle(self):
        # 1. Create a new note
        create_res = self.client.post(
            f"/api/course/{self.course_name}/notes",
            json={
                "user_email": self.user_email,
                "title": "Thesis Literature Review Scratchpad",
                "content": "Initial notes on Transformer self-attention complexity."
            }
        )
        self.assertEqual(create_res.status_code, 200)
        data = create_res.json()
        self.assertEqual(data["status"], "success")
        note = data["note"]
        note_id = note["note_id"]
        self.assertTrue(note_id.startswith("note_"))
        self.assertEqual(note["title"], "Thesis Literature Review Scratchpad")
        self.assertEqual(note["content"], "Initial notes on Transformer self-attention complexity.")
        self.assertTrue(note["blob_name"].startswith("courses/master-of-technology/notes/"))

        # 2. List notes for the course
        list_res = self.client.get(
            f"/api/course/{self.course_name}/notes?user_email={self.user_email}"
        )
        self.assertEqual(list_res.status_code, 200)
        list_data = list_res.json()
        self.assertEqual(list_data["status"], "success")
        self.assertTrue(any(n["note_id"] == note_id for n in list_data["notes"]))

        # 3. Retrieve note details and text content
        get_res = self.client.get(
            f"/api/course/{self.course_name}/notes/{note_id}?user_email={self.user_email}"
        )
        self.assertEqual(get_res.status_code, 200)
        get_data = get_res.json()
        self.assertEqual(get_data["note"]["title"], "Thesis Literature Review Scratchpad")
        self.assertEqual(get_data["note"]["content"], "Initial notes on Transformer self-attention complexity.")

        # 4. Save / Update note content and title
        update_res = self.client.put(
            f"/api/course/{self.course_name}/notes/{note_id}",
            json={
                "user_email": self.user_email,
                "title": "Thesis Literature Review (Updated)",
                "content": "Updated notes: Linear attention mechanisms review."
            }
        )
        self.assertEqual(update_res.status_code, 200)
        update_data = update_res.json()
        self.assertEqual(update_data["note"]["title"], "Thesis Literature Review (Updated)")
        self.assertEqual(update_data["note"]["content"], "Updated notes: Linear attention mechanisms review.")

        # Verify content was updated in GCS blob read
        verify_res = self.client.get(
            f"/api/course/{self.course_name}/notes/{note_id}?user_email={self.user_email}"
        )
        self.assertEqual(verify_res.status_code, 200)
        self.assertEqual(verify_res.json()["note"]["content"], "Updated notes: Linear attention mechanisms review.")

        # 4b. Verify PUT upsert creates note if client-generated note_id does not yet exist
        upsert_id = "note_client_optimistic_1"
        upsert_res = self.client.put(
            f"/api/course/{self.course_name}/notes/{upsert_id}",
            json={
                "user_email": self.user_email,
                "title": "EARLY SEPSIS DETECTION",
                "content": "<p>Cross-Attention Multimodal Fusion for Early Sepsis Detection</p>"
            }
        )
        self.assertEqual(upsert_res.status_code, 200)
        self.assertEqual(upsert_res.json()["note"]["note_id"], upsert_id)
        self.assertEqual(upsert_res.json()["note"]["title"], "EARLY SEPSIS DETECTION")
        self.client.delete(f"/api/course/{self.course_name}/notes/{upsert_id}?user_email={self.user_email}")

        # 5. Unauthorized access check (different user)
        other_user = "intruder@mtech.edu"
        forbidden_update = self.client.put(
            f"/api/course/{self.course_name}/notes/{note_id}",
            json={
                "user_email": other_user,
                "title": "Hacked",
                "content": "Malicious content"
            }
        )
        self.assertEqual(forbidden_update.status_code, 404)

        # 6. Delete note
        delete_res = self.client.delete(
            f"/api/course/{self.course_name}/notes/{note_id}?user_email={self.user_email}"
        )
        self.assertEqual(delete_res.status_code, 200)

        # 7. Confirm deleted
        post_del_res = self.client.get(
            f"/api/course/{self.course_name}/notes/{note_id}?user_email={self.user_email}"
        )
        self.assertEqual(post_del_res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
