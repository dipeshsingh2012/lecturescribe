import unittest
from fastapi.testclient import TestClient
from backend.main import app

class TestAPIHealth(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_health_route(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("service"), "lecturescribe-triad-api")

    def test_course_route_not_found(self):
        response = self.client.get("/api/course/nonexistent_course_test_123")
        self.assertEqual(response.status_code, 404)

if __name__ == "__main__":
    unittest.main()
