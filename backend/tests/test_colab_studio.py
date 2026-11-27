"""End-to-end tests for LectureScribe Colab (Phases 1-5):
persistent kernel, workspace files, cell-aware Co-Pilot, and LMS submission.
"""
import io
import json
from fastapi.testclient import TestClient

from backend.main import app
from backend.colab_kernel_service import (
    colab_kernel_manager,
    upload_session_file,
    list_session_files,
    get_session_file_bytes,
    delete_session_file,
    get_dataset_schema_context,
)
from backend.assignment_studio_service import start_studio_session


client = TestClient(app)


def test_persistent_kernel_preserves_state_and_restarts_cleanly():
    sid = "colab_test_persist_01"
    try:
        # Cell 1 defines a variable
        r1 = colab_kernel_manager.execute_cell(sid, "alpha = 21\nprint('set alpha')")
        assert r1["status"] == "ok"
        assert r1["execution_count"] == 1
        assert any("set alpha" in "".join(o.get("text", [])) for o in r1["outputs"] if o["output_type"] == "stream")

        # Cell 2 reuses variable from Cell 1 and evaluates last expression
        r2 = colab_kernel_manager.execute_cell(sid, "alpha * 2")
        assert r2["status"] == "ok"
        assert r2["execution_count"] == 2
        res_outs = [o for o in r2["outputs"] if o["output_type"] == "execute_result"]
        assert res_outs and res_outs[0]["data"]["text/plain"] == "42"

        # Restart kernel -> variable alpha should no longer exist
        st = colab_kernel_manager.restart_kernel(sid)
        assert st["state"] == "idle"
        assert st["execution_count"] == 0

        r3 = colab_kernel_manager.execute_cell(sid, "print(alpha)")
        assert r3["status"] == "error"
        err_outs = [o for o in r3["outputs"] if o["output_type"] == "error"]
        assert err_outs and err_outs[0]["ename"] == "NameError"
    finally:
        ks = colab_kernel_manager._sessions.pop(sid, None)
        if ks:
            ks.shutdown()


def test_workspace_files_upload_schema_and_kernel_read():
    sid = "colab_test_files_01"
    csv_bytes = b"feature,label\n1.5,0\n2.5,1\n3.5,1\n"
    try:
        info = upload_session_file(sid, "Data Science Lab", "sample_data.csv", csv_bytes)
        assert info["filename"] == "sample_data.csv"
        assert info["columns"] == ["feature", "label"]

        files = list_session_files(sid, "Data Science Lab")
        assert any(f["filename"] == "sample_data.csv" for f in files)

        schema_ctx = get_dataset_schema_context(sid)
        assert "sample_data.csv" in schema_ctx
        assert "feature, label" in schema_ctx

        # Kernel can read the uploaded file directly from its cwd
        r = colab_kernel_manager.execute_cell(
            sid,
            "import csv\nwith open('sample_data.csv') as f:\n    rows = list(csv.reader(f))\nlen(rows)"
        )
        assert r["status"] == "ok"
        res_outs = [o for o in r["outputs"] if o["output_type"] == "execute_result"]
        assert res_outs and res_outs[0]["data"]["text/plain"] == "4"

        downloaded = get_session_file_bytes(sid, "Data Science Lab", "sample_data.csv")
        assert downloaded == csv_bytes

        assert delete_session_file(sid, "Data Science Lab", "sample_data.csv") is True
    finally:
        ks = colab_kernel_manager._sessions.pop(sid, None)
        if ks:
            ks.shutdown()


def test_colab_api_endpoints_execute_assist_files_and_lms_submit(monkeypatch):
    def fake_llm(system_prompt, user_prompt, **kwargs):
        if kwargs.get("json_mode"):
            return json.dumps({
                "explanation": "Defined missing variable x before printing.",
                "updated_source": "x = 10\nprint(x)"
            })
        return "Outline ready. Say 'Generate First Draft' when ready."

    monkeypatch.setattr("backend.assignment_studio_service._call_studio_llm", fake_llm)

    init_res = start_studio_session(
        course_name="Data Science Lab",
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt="Assignment 7 Jupyter Notebook"
    )
    sid = init_res["session_id"]

    try:
        # 1. Upload dataset via API
        up_resp = client.post(
            f"/api/course/Data%20Science%20Lab/assignments/studio/{sid}/notebook/files",
            files={"file": ("train.csv", io.BytesIO(b"a,b\n1,2\n3,4\n"), "text/csv")},
        )
        assert up_resp.status_code == 200
        assert up_resp.json()["file"]["columns"] == ["a", "b"]

        # 2. Execute single cell via API
        exec_resp = client.post(
            f"/api/course/Data%20Science%20Lab/assignments/studio/{sid}/notebook/execute-cell",
            json={"cell_index": 0, "code": "val = 7 * 6\nprint(val)"},
        )
        assert exec_resp.status_code == 200
        exec_data = exec_resp.json()
        assert exec_data["status"] == "ok"
        assert any("42" in "".join(o.get("text", [])) for o in exec_data["outputs"] if o["output_type"] == "stream")

        # 3. Execute all cells via API
        all_resp = client.post(
            f"/api/course/Data%20Science%20Lab/assignments/studio/{sid}/notebook/execute-all",
            json={
                "cells": [
                    {"cell_type": "markdown", "source": "# Lab 7"},
                    {"cell_type": "code", "source": "a = 5"},
                    {"cell_type": "code", "source": "print(a + 3)"},
                ],
                "restart_first": True,
            },
        )
        assert all_resp.status_code == 200
        all_data = all_resp.json()
        assert all_data["status"] == "ok"
        assert all_data["executed_code_cells"] == 2

        # 4. Cell-aware Co-Pilot fix via API
        assist_resp = client.post(
            f"/api/course/Data%20Science%20Lab/assignments/studio/{sid}/notebook/cell-assist",
            json={
                "cell_source": "print(x)",
                "action": "fix",
                "error_traceback": "NameError: name 'x' is not defined",
            },
        )
        assert assist_resp.status_code == 200
        assert assist_resp.json()["updated_source"] == "x = 10\nprint(x)"

        # 5. Submit executed notebook directly to LMS via API
        sub_resp = client.post(
            f"/api/course/Data%20Science%20Lab/assignments/studio/{sid}/notebook/submit-lms",
            json={
                "student_email": "student@iiitdwd.ac.in",
                "student_name": "Dipesh",
                "title": "Assignment_7_26mda017",
                "draft_markdown": "# Assignment 7\n\n```python\nprint('done')\n```",
            },
        )
        assert sub_resp.status_code == 200
        sub_data = sub_resp.json()
        assert sub_data["status"] == "submitted"
        assert sub_data["ipynb_filename"] == "Assignment_7_26mda017.ipynb"
        assert sub_data["submission"]["student_email"] == "student@iiitdwd.ac.in"
    finally:
        ks = colab_kernel_manager._sessions.pop(sid, None)
        if ks:
            ks.shutdown()


def test_create_blank_notebook_session_endpoint():
    resp = client.post(
        "/api/course/Data%20Science%20Lab/assignments/studio/notebook/new",
        json={"user_email": "student@iiitdwd.ac.in", "title": "Lab_Scratchpad.ipynb"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["session_id"].startswith("asgn_studio_nb_")
    assert data["title"] == "Lab_Scratchpad.ipynb"
    assert data["notebook_json"]["nbformat"] == 4
    assert len(data["notebook_json"]["cells"]) == 1
    assert data["notebook_json"]["cells"][0]["cell_type"] == "code"
