import os
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.main import app


class TestMCPIntegration(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self.mcp_headers = {"Authorization": "Bearer test-mcp-token"}
        self.callback_headers = {"Authorization": "Bearer test-callback-token"}

    def test_mcp_requires_authentication(self):
        response = self.client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        self.assertEqual(response.status_code, 401)

    @patch.dict(os.environ, {"LECTURESCRIBE_MCP_TOKEN": "test-mcp-token"})
    def test_tools_list_exposes_only_fleet_tools(self):
        response = self.client.post(
            "/api/v1/mcp",
            headers=self.mcp_headers,
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        self.assertEqual(response.status_code, 200)
        tools = response.json()["result"]["tools"]
        self.assertEqual(
            {tool["name"] for tool in tools},
            {"trigger_agentic_fleet", "get_fleet_run_status"},
        )

    @patch.dict(
        os.environ,
        {
            "DATABASE_URL": "postgresql://test:test@localhost:5432/test",
            "LECTURESCRIBE_MCP_TOKEN": "test-mcp-token",
            "LECTURESCRIBE_GITHUB_DISPATCH_TOKEN": "test-github-token",
        },
    )
    @patch("backend.mcp_integration.requests.post")
    @patch("backend.mcp_integration.db_manager.update_fleet_run")
    @patch("backend.mcp_integration.db_manager.create_fleet_run")
    def test_trigger_dispatches_only_to_lecturescribe(
        self, create_run, update_run, post
    ):
        create_run.return_value = {
            "created": True,
            "run": {"request_id": "request-1", "status": "dispatching"},
        }
        update_run.return_value = {
            "request_id": "request-1",
            "tenant_id": "lecturescribe",
            "initiative_id": "initiative-1",
            "event_type": "mcp_start_dev",
            "title": "A test feature",
            "status": "queued",
        }
        post.return_value = Mock(status_code=204)

        response = self.client.post(
            "/api/v1/mcp",
            headers=self.mcp_headers,
            json={
                "jsonrpc": "2.0",
                "id": "rpc-1",
                "method": "tools/call",
                "params": {
                    "name": "trigger_agentic_fleet",
                    "arguments": {
                        "request_id": "request-1",
                        "tenant_id": "lecturescribe",
                        "initiative_id": "initiative-1",
                        "event_type": "mcp_start_dev",
                        "title": "A test feature",
                        "task": "Implement a test feature.",
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["status"], "queued")
        dispatch_url = post.call_args.args[0]
        dispatch_body = post.call_args.kwargs["json"]
        self.assertEqual(
            dispatch_url,
            "https://api.github.com/repos/dipeshsingh2012/lecturescribe/dispatches",
        )
        self.assertEqual(dispatch_body["event_type"], "mcp_start_dev")
        self.assertEqual(dispatch_body["client_payload"]["request_id"], "request-1")
        self.assertEqual(dispatch_body["client_payload"]["target_repo"], "dipeshsingh2012/lecturescribe")

    @patch.dict(
        os.environ,
        {
            "DATABASE_URL": "postgresql://test:test@localhost:5432/test",
            "LECTURESCRIBE_MCP_TOKEN": "test-mcp-token",
            "LECTURESCRIBE_GITHUB_DISPATCH_TOKEN": "test-github-token",
        },
    )
    @patch("backend.mcp_integration.requests.post")
    @patch("backend.mcp_integration.db_manager.create_fleet_run")
    def test_duplicate_request_is_not_dispatched_again(self, create_run, post):
        create_run.return_value = {
            "created": False,
            "run": {
                "request_id": "request-1",
                "tenant_id": "lecturescribe",
                "initiative_id": "initiative-1",
                "event_type": "mcp_start_dev",
                "title": "A test feature",
                "status": "queued",
            },
        }
        response = self.client.post(
            "/api/v1/mcp",
            headers=self.mcp_headers,
            json={
                "jsonrpc": "2.0",
                "id": "rpc-1",
                "method": "tools/call",
                "params": {
                    "name": "trigger_agentic_fleet",
                    "arguments": {
                        "request_id": "request-1",
                        "tenant_id": "lecturescribe",
                        "initiative_id": "initiative-1",
                        "event_type": "mcp_start_dev",
                        "title": "A test feature",
                        "task": "Implement a test feature.",
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["status"], "queued")
        post.assert_not_called()

    @patch.dict(
        os.environ,
        {
            "LECTURESCRIBE_CALLBACK_TOKEN": "test-callback-token",
            "AROADMAP_MCP_URL": "https://aroadmap.example/api/mcp",
            "AROADMAP_MCP_TOKEN": "test-roadmap-token",
        },
    )
    @patch("backend.mcp_integration._notify_aroadmap")
    @patch("backend.mcp_integration.db_manager.update_fleet_run")
    def test_callback_persists_and_synchronizes_status(self, update_run, notify):
        update_run.return_value = {
            "request_id": "request-1",
            "tenant_id": "lecturescribe",
            "initiative_id": "initiative-1",
            "status": "running",
        }
        response = self.client.post(
            "/api/v1/mcp/fleet-callback",
            headers=self.callback_headers,
            json={
                "request_id": "request-1",
                "status": "running",
                "github_run_id": "12345",
                "github_run_attempt": "1",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fleet_status"], "running")
        notify.assert_called_once_with(update_run.return_value)

    def test_callback_requires_authentication(self):
        response = self.client.post(
            "/api/v1/mcp/fleet-callback",
            json={"request_id": "request-1", "status": "running"},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
