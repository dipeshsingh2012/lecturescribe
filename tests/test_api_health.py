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

if __name__ == "__main__":
    unittest.main()
