"""MCP gateway and Agentic Fleet dispatch/status integration."""
from __future__ import annotations

import hmac
import logging
import os
import re
import uuid
from typing import Any, Dict, Optional

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.database import db_manager

router = APIRouter(prefix="/api/v1/mcp", tags=["MCP"])
logger = logging.getLogger(__name__)

GITHUB_REPOSITORY = "dipeshsingh2012/lecturescribe"
ALLOWED_EVENTS = {"mcp_initiative", "mcp_start_dev", "fleet_trigger"}
ALLOWED_STATUSES = {"running", "succeeded", "failed", "cancelled"}
MAX_PAYLOAD_BYTES = 24_000


class FleetTriggerArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=128)
    tenant_id: str = Field(min_length=1, max_length=128)
    initiative_id: str = Field(min_length=1, max_length=128)
    event_type: str
    title: str = Field(min_length=1, max_length=500)
    task: str = Field(min_length=1, max_length=12_000)
    acceptance_criteria: list[str] = Field(default_factory=list, max_length=50)
    source: str = Field(default="aroadmap", max_length=100)


class FleetStatusArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=128)


class FleetCallback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=128)
    status: str
    github_run_id: Optional[str] = Field(default=None, max_length=32)
    github_run_attempt: Optional[str] = Field(default=None, max_length=16)
    run_url: Optional[str] = Field(default=None, max_length=2_000)
    conclusion: Optional[str] = Field(default=None, max_length=100)
    error_summary: Optional[str] = Field(default=None, max_length=2_000)


def _authorized(provided: Optional[str], expected_name: str) -> bool:
    expected = os.getenv(expected_name, "")
    return bool(expected and provided and hmac.compare_digest(provided, expected))


def _bearer_token(header: Optional[str]) -> Optional[str]:
    if not header:
        return None
    match = re.fullmatch(r"Bearer\s+(.+)", header.strip(), flags=re.IGNORECASE)
    return match.group(1) if match else None


def _rpc_error(request_id: Any, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _tool_result(request_id: Any, value: Dict[str, Any], is_error: bool = False) -> Dict[str, Any]:
    import json

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}],
            "isError": is_error,
            **value,
        },
    }


def _dispatch_fleet(args: FleetTriggerArguments) -> Dict[str, Any]:
    if args.tenant_id != "lecturescribe":
        raise ValueError("Fleet dispatch is only enabled for the LectureScribe tenant.")
    if args.event_type not in ALLOWED_EVENTS:
        raise ValueError("Unsupported fleet event type.")
    if not db_manager.postgres_url:
        raise RuntimeError("Fleet dispatch persistence is unavailable: DATABASE_URL is not configured.")

    payload = {
        "request_id": args.request_id,
        "source": args.source,
        "tenant_id": args.tenant_id,
        "initiative_id": args.initiative_id,
        "target_repo": GITHUB_REPOSITORY,
        "title": args.title,
        "task": args.task,
        "feedback": args.task,
        "prompt": args.task,
        "acceptance_criteria": args.acceptance_criteria,
    }
    import json

    if len(json.dumps(payload).encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ValueError("Fleet dispatch payload exceeds the size limit.")

    created = db_manager.create_fleet_run(
        request_id=args.request_id,
        tenant_id=args.tenant_id,
        initiative_id=args.initiative_id,
        event_type=args.event_type,
        title=args.title,
        client_payload=payload,
    )
    if not created["created"]:
        existing = created["run"]
        if (
            existing["tenant_id"] != args.tenant_id
            or existing["initiative_id"] != args.initiative_id
            or existing["event_type"] != args.event_type
            or existing["title"] != args.title
        ):
            raise ValueError("request_id has already been used for a different fleet request.")
        return existing

    token = os.getenv("LECTURESCRIBE_GITHUB_DISPATCH_TOKEN", "")
    if not token:
        db_manager.update_fleet_run(args.request_id, "failed", error_summary="GitHub dispatch credential is not configured.")
        raise RuntimeError("GitHub dispatch is not configured.")

    try:
        response = requests.post(
            f"https://api.github.com/repos/{GITHUB_REPOSITORY}/dispatches",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "LectureScribe-MCP",
            },
            json={"event_type": args.event_type, "client_payload": payload},
            timeout=(3.05, 15),
        )
    except requests.Timeout:
        db_manager.update_fleet_run(
            args.request_id,
            "dispatch_unknown",
            error_summary="GitHub dispatch timed out; reconcile this request before retrying.",
        )
        raise RuntimeError("GitHub dispatch timed out; the run may have been accepted. Query this request before retrying.")
    except requests.RequestException as exc:
        db_manager.update_fleet_run(args.request_id, "failed", error_summary="GitHub dispatch request failed.")
        raise RuntimeError("GitHub dispatch request failed.") from exc

    if response.status_code != 204:
        db_manager.update_fleet_run(
            args.request_id,
            "failed",
            error_summary=f"GitHub dispatch returned HTTP {response.status_code}.",
        )
        raise RuntimeError(f"GitHub dispatch failed with HTTP {response.status_code}.")

    queued_run = db_manager.update_fleet_run(args.request_id, "queued")
    if queued_run is None:
        raise RuntimeError("The persisted fleet request disappeared after dispatch.")
    return queued_run


def _get_tools() -> list[Dict[str, Any]]:
    return [
        {
            "name": "trigger_agentic_fleet",
            "description": "Dispatch an approved aroadmap initiative to Agentic Fleet for the LectureScribe repository.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "string", "description": "Caller-generated idempotency key."},
                    "tenant_id": {"type": "string"},
                    "initiative_id": {"type": "string"},
                    "event_type": {"type": "string", "enum": sorted(ALLOWED_EVENTS)},
                    "title": {"type": "string"},
                    "task": {"type": "string"},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
                    "source": {"type": "string", "default": "aroadmap"},
                },
                "required": ["request_id", "tenant_id", "initiative_id", "event_type", "title", "task"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_fleet_run_status",
            "description": "Get the persisted status and GitHub Actions run link for a LectureScribe fleet request.",
            "inputSchema": {
                "type": "object",
                "properties": {"request_id": {"type": "string"}},
                "required": ["request_id"],
                "additionalProperties": False,
            },
        },
    ]


def _notify_aroadmap(run: Dict[str, Any]) -> None:
    endpoint = os.getenv("AROADMAP_MCP_URL", "")
    token = os.getenv("AROADMAP_MCP_TOKEN", "")
    if not endpoint or not token:
        raise RuntimeError("Aroadmap status synchronization is not configured.")
    response = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": "report_fleet_status",
                "arguments": {
                    "tenant_id": run["tenant_id"],
                    "initiative_id": run["initiative_id"],
                    "request_id": run["request_id"],
                    "status": run["status"],
                    "github_repository": GITHUB_REPOSITORY,
                    "github_run_id": run.get("github_run_id"),
                    "github_run_attempt": run.get("github_run_attempt"),
                    "run_url": run.get("run_url"),
                    "conclusion": run.get("conclusion"),
                    "error_summary": run.get("error_summary"),
                },
            },
        },
        timeout=(3.05, 15),
    )
    response.raise_for_status()
    result = response.json()
    if result.get("error") or (result.get("result") or {}).get("isError"):
        raise RuntimeError("Aroadmap rejected the fleet status update.")


@router.post("")
def mcp_endpoint(
    body: Dict[str, Any],
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    if not _authorized(
        _bearer_token(authorization),
        "LECTURESCRIBE_MCP_TOKEN",
    ):
        raise HTTPException(status_code=401, detail="Unauthorized MCP client.")
    if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
        return _rpc_error(body.get("id") if isinstance(body, dict) else None, -32600, "Invalid JSON-RPC request.")

    request_id = body.get("id")
    method = body.get("method")
    params = body.get("params") or {}
    if not isinstance(params, dict):
        return _rpc_error(request_id, -32602, "Invalid params.")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "lecturescribe-mcp", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            },
        }
    if method == "notifications/initialized":
        return {}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": _get_tools()}}
    if method != "tools/call":
        return _rpc_error(request_id, -32601, f"Method '{method}' not found.")

    tool_name = params.get("name")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        return _rpc_error(request_id, -32602, "Tool arguments must be an object.")
    try:
        if tool_name == "trigger_agentic_fleet":
            run = _dispatch_fleet(FleetTriggerArguments.model_validate(arguments))
            return _tool_result(request_id, {"status": run["status"], "request_id": run["request_id"], "github_repository": GITHUB_REPOSITORY})
        if tool_name == "get_fleet_run_status":
            args = FleetStatusArguments.model_validate(arguments)
            run = db_manager.get_fleet_run(args.request_id)
            if not run:
                return _tool_result(request_id, {"error": "Fleet request not found."}, is_error=True)
            return _tool_result(request_id, run)
    except ValueError as exc:
        return _tool_result(request_id, {"error": str(exc)}, is_error=True)
    except RuntimeError as exc:
        return _tool_result(request_id, {"error": str(exc)}, is_error=True)
    except Exception:
        logger.exception("Unexpected error processing MCP tool '%s'.", tool_name)
        return _tool_result(request_id, {"error": "Fleet request could not be processed."}, is_error=True)
    return _rpc_error(request_id, -32602, f"Unknown tool '{tool_name}'.")


@router.post("/fleet-callback")
def fleet_status_callback(
    callback: FleetCallback,
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    if not _authorized(
        _bearer_token(authorization),
        "LECTURESCRIBE_CALLBACK_TOKEN",
    ):
        raise HTTPException(status_code=401, detail="Unauthorized fleet callback.")
    if callback.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported fleet status.")
    if callback.github_run_id and not re.fullmatch(r"\d+", callback.github_run_id):
        raise HTTPException(status_code=422, detail="Invalid GitHub run ID.")
    if callback.github_run_attempt and not re.fullmatch(r"\d+", callback.github_run_attempt):
        raise HTTPException(status_code=422, detail="Invalid GitHub run attempt.")
    try:
        run = db_manager.update_fleet_run(
            callback.request_id,
            callback.status,
            github_run_id=callback.github_run_id,
            github_run_attempt=callback.github_run_attempt,
            run_url=callback.run_url,
            conclusion=callback.conclusion,
            error_summary=callback.error_summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not run:
        raise HTTPException(status_code=404, detail="Fleet request not found.")
    try:
        _notify_aroadmap(run)
    except (requests.RequestException, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Fleet status was persisted, but aroadmap synchronization failed.") from exc
    return {"status": "recorded", "request_id": callback.request_id, "fleet_status": run["status"]}
