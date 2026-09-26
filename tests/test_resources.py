import unittest
from fastapi.testclient import TestClient
from backend.main import app
from backend.gcs_storage import GCSStorageService, gcs_storage_service
from backend.database import db_manager


class TestGCSStorageService(unittest.TestCase):
    def test_clean_filename(self):
        self.assertEqual(GCSStorageService.clean_filename(""), "document")
        self.assertEqual(GCSStorageService.clean_filename("my presentation.pdf"), "my_presentation.pdf")
        self.assertEqual(GCSStorageService.clean_filename("../../../etc/passwd"), "passwd")
        self.assertEqual(GCSStorageService.clean_filename("lecture#1 [notes]!.docx"), "lecture_1__notes__.docx")

    def test_get_resource_blob_path(self):
        path = GCSStorageService.get_resource_blob_path("Machine-Learning-101", "123456", "slides.pdf")
        self.assertTrue(path.startswith("courses/machine-learning-101/lectures/123456/"))
        self.assertTrue(path.endswith("_slides.pdf"))

        general_path = GCSStorageService.get_resource_blob_path("General", None, "syllabus.docx")
        self.assertTrue(general_path.startswith("courses/general/general/"))
        self.assertTrue(general_path.endswith("_syllabus.docx"))

    def test_signed_urls_emulated(self):
        # In test sandbox without ADC credentials, it returns valid emulated URLs
        res = gcs_storage_service.generate_upload_signed_url("courses/ml/test.pdf", content_type="application/pdf")
        self.assertIn("signed_url", res)
        self.assertEqual(res["blob_name"], "courses/ml/test.pdf")

        dl = gcs_storage_service.generate_download_signed_url("courses/ml/test.pdf")
        self.assertTrue(dl.startswith("https://storage.googleapis.com/"))


class TestResourceEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_presign_upload_requires_auth(self):
        # Missing or empty user_email should return 401
        res = self.client.post("/api/resources/presign-upload", json={
            "filename": "slides.pdf",
            "course_name": "CS101",
            "video_id": "999888",
            "user_email": ""
        })
        self.assertEqual(res.status_code, 401)
        self.assertIn("Only signed-in users", res.json()["detail"])

    def test_presign_upload_success(self):
        res = self.client.post("/api/resources/presign-upload", json={
            "filename": "week1_slides.pdf",
            "content_type": "application/pdf",
            "course_name": "Deep Learning",
            "video_id": "999888",
            "user_email": "student@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("signed_url", data)
        self.assertIn("blob_name", data)
        self.assertTrue(data["blob_name"].startswith("courses/deep-learning/lectures/999888/"))

    def test_confirm_upload_and_retrieve(self):
        # 1. Confirm upload
        confirm_res = self.client.post("/api/resources/confirm-upload", json={
            "filename": "cheat_sheet.pdf",
            "blob_name": "courses/cs101/lectures/777/cheat_sheet.pdf",
            "file_type": "pdf",
            "file_size_bytes": 10240,
            "course_name": "CS101",
            "video_id": "777",
            "title": "Week 1 Cheat Sheet",
            "user_email": "prof@example.com"
        })
        self.assertEqual(confirm_res.status_code, 200)
        res_data = confirm_res.json()["resource"]
        res_id = res_data["id"]
        self.assertEqual(res_data["title"], "Week 1 Cheat Sheet")
        self.assertIn("download_url", res_data)

        # 2. Retrieve by lecture
        lecture_res = self.client.get("/api/lecture/777/resources")
        self.assertEqual(lecture_res.status_code, 200)
        lecture_items = lecture_res.json()["resources"]
        matching = [item for item in lecture_items if item["id"] == res_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["title"], "Week 1 Cheat Sheet")

        # 3. Retrieve by course
        course_res = self.client.get("/api/course/CS101/resources")
        self.assertEqual(course_res.status_code, 200)
        course_items = course_res.json()["resources"]
        matching_course = [item for item in course_items if item["id"] == res_id]
        self.assertEqual(len(matching_course), 1)

        # 4. Unauthorized user cannot delete
        del_unauthorized = self.client.delete(f"/api/resources/{res_id}?user_email=other@example.com")
        self.assertEqual(del_unauthorized.status_code, 403)

        # 5. Authorized uploader can delete
        del_res = self.client.delete(f"/api/resources/{res_id}?user_email=prof@example.com")
        self.assertEqual(del_res.status_code, 200)

    def test_link_resource(self):
        # Create external link
        res = self.client.post("/api/resources/link", json={
            "title": "Official PyTorch Documentation",
            "url": "https://pytorch.org/docs/stable/index.html",
            "course_name": "Deep Learning",
            "video_id": "555444",
            "user_email": "learner@example.com"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()["resource"]
        self.assertEqual(data["file_type"], "link")
        self.assertEqual(data["file_url"], "https://pytorch.org/docs/stable/index.html")


if __name__ == "__main__":
    unittest.main()
