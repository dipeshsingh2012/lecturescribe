"""
Persistent Sandboxed Per-Session Python Kernel & Workspace File Service
for LectureScribe Colab (Assignment Studio Interactive Notebook).

Provides:
- Persistent subprocess Python kernel per session (variables/imports persist across cells)
- Per-cell execution timeout, SIGINT interrupt, kernel restart, and idle TTL cleanup
- Rich Jupyter nbformat v4 outputs: stdout/stderr streams, Pandas HTML tables,
  Matplotlib/Seaborn PNG figures, last-expression execute_result, and formatted tracebacks
- Per-session workspace file storage (upload, list with CSV schema preview, download, delete)
  backed by local session work_dir and optional GCS persistence
"""
from __future__ import annotations

import base64
import csv
import datetime
import io
import json
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

from backend.gcs_storage import gcs_storage_service
from backend.database import to_course_slug

logger = logging.getLogger("lecturescribe.colab_kernel")

COLAB_WORK_ROOT = os.path.join("/tmp", "lecturescribe_colab")
DEFAULT_CELL_TIMEOUT_SEC = 45
KERNEL_IDLE_TTL_SEC = 15 * 60  # 15 minutes
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

# Embedded persistent Python kernel worker script communicating over JSON-lines stdin/stdout
_KERNEL_WORKER_SCRIPT = r"""
import ast
import base64
import io
import json
import os
import sys
import traceback

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")
try:
    os.makedirs("/tmp/matplotlib", exist_ok=True)
except Exception:
    pass

try:
    import matplotlib
    matplotlib.use("Agg")
except Exception:
    pass

# Keep real stdio handles for JSON-lines protocol
_PROTO_IN = sys.stdin
_PROTO_OUT = sys.stdout

_NAMESPACE = {"__name__": "__main__"}


def _collect_matplotlib_figures():
    outputs = []
    try:
        import matplotlib.pyplot as plt
        fig_nums = list(plt.get_fignums())
        for num in fig_nums:
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            buf.seek(0)
            b64 = base64.b64encode(buf.read()).decode("ascii")
            outputs.append({
                "output_type": "display_data",
                "data": {
                    "image/png": b64,
                    "text/plain": ["<Figure>"]
                },
                "metadata": {}
            })
            plt.close(fig)
    except Exception:
        pass
    return outputs


def _format_execute_result(val, exec_count):
    if val is None:
        return None
    data = {}
    try:
        if hasattr(val, "_repr_html_") and callable(val._repr_html_):
            html_str = val._repr_html_()
            if isinstance(html_str, str) and html_str.strip():
                data["text/html"] = html_str
    except Exception:
        pass
    try:
        plain = repr(val)
        if len(plain) > 8000:
            plain = plain[:8000] + "\n... (truncated)"
        data["text/plain"] = plain
    except Exception:
        data["text/plain"] = str(type(val))
    return {
        "output_type": "execute_result",
        "execution_count": exec_count,
        "data": data,
        "metadata": {}
    }


def _run_code(code: str, exec_count: int):
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    outputs = []
    status = "ok"

    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    last_val = None
    try:
        tree = ast.parse(code, mode="exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = ast.Expression(tree.body.pop().value)
            if tree.body:
                exec(compile(tree, f"<cell-{exec_count}>", "exec"), _NAMESPACE)
            last_val = eval(compile(last_expr, f"<cell-{exec_count}>", "eval"), _NAMESPACE)
        else:
            exec(compile(tree, f"<cell-{exec_count}>", "exec"), _NAMESPACE)
    except KeyboardInterrupt:
        status = "interrupted"
        outputs.append({
            "output_type": "error",
            "ename": "KeyboardInterrupt",
            "evalue": "Execution interrupted by user.",
            "traceback": ["KeyboardInterrupt: Execution interrupted by user."]
        })
    except Exception as exc:
        status = "error"
        tb_lines = traceback.format_exc().splitlines()
        outputs.append({
            "output_type": "error",
            "ename": type(exc).__name__,
            "evalue": str(exc),
            "traceback": tb_lines
        })
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr

    out_text = stdout_buf.getvalue()
    err_text = stderr_buf.getvalue()
    stream_outputs = []
    if out_text:
        if len(out_text) > 32000:
            out_text = out_text[:32000] + "\n... (stdout truncated)"
        stream_outputs.append({
            "output_type": "stream",
            "name": "stdout",
            "text": out_text.splitlines(keepends=True)
        })
    if err_text:
        if len(err_text) > 16000:
            err_text = err_text[:16000] + "\n... (stderr truncated)"
        stream_outputs.append({
            "output_type": "stream",
            "name": "stderr",
            "text": err_text.splitlines(keepends=True)
        })

    fig_outputs = _collect_matplotlib_figures()
    res_output = _format_execute_result(last_val, exec_count) if status == "ok" else None
    all_outputs = stream_outputs + fig_outputs + ([res_output] if res_output else []) + outputs
    return status, all_outputs


# Signal ready
_PROTO_OUT.write(json.dumps({"ready": True}) + "\n")
_PROTO_OUT.flush()

for raw_line in _PROTO_IN:
    line = raw_line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    req_id = req.get("id")
    code = req.get("code", "")
    exec_count = int(req.get("execution_count", 1))
    status, outputs = _run_code(code, exec_count)
    resp = {
        "id": req_id,
        "status": status,
        "execution_count": exec_count,
        "outputs": outputs
    }
    _PROTO_OUT.write(json.dumps(resp) + "\n")
    _PROTO_OUT.flush()
"""


def _safe_session_dir_name(session_id: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_\-]", "_", (session_id or "default").strip())
    return clean[:96] or "default"


def _safe_filename(filename: str) -> str:
    base = os.path.basename((filename or "").strip())
    clean = re.sub(r"[^a-zA-Z0-9._\-]", "_", base)
    if not clean or clean in (".", ".."):
        raise ValueError("Invalid filename.")
    return clean


def get_session_work_dir(session_id: str) -> str:
    path = os.path.join(COLAB_WORK_ROOT, _safe_session_dir_name(session_id))
    os.makedirs(path, exist_ok=True)
    return path


class ColabKernelSession:
    """Manages a single persistent Python subprocess kernel for a studio session."""

    def __init__(self, session_id: str, work_dir: str):
        self.session_id = session_id
        self.work_dir = work_dir
        self.execution_count = 0
        self.state = "stopped"  # 'stopped' | 'idle' | 'running'
        self.last_used = time.time()
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._req_counter = 0

    def _start_locked(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return
        os.makedirs(self.work_dir, exist_ok=True)
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["MPLCONFIGDIR"] = "/tmp/matplotlib"
        self._proc = subprocess.Popen(
            [sys.executable, "-u", "-c", _KERNEL_WORKER_SCRIPT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.work_dir,
            env=env,
            text=True,
            bufsize=1,
        )
        # Wait for ready handshake
        ready_line = self._readline_with_timeout(10.0)
        if not ready_line:
            self._kill_locked()
            raise RuntimeError("Python kernel failed to initialize.")
        self.state = "idle"
        self.last_used = time.time()

    def _readline_with_timeout(self, timeout_sec: float) -> Optional[str]:
        if not self._proc or not self._proc.stdout:
            return None
        result: List[Optional[str]] = [None]

        def _reader():
            try:
                result[0] = self._proc.stdout.readline()
            except Exception:
                result[0] = None

        t = threading.Thread(target=_reader, daemon=True)
        t.start()
        t.join(timeout=timeout_sec)
        if t.is_alive():
            return None
        return result[0]

    def _kill_locked(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=3)
            except Exception:
                pass
            self._proc = None
        self.state = "stopped"

    def execute(self, code: str, timeout_sec: int = DEFAULT_CELL_TIMEOUT_SEC) -> Dict[str, Any]:
        with self._lock:
            self._start_locked()
            self.execution_count += 1
            exec_num = self.execution_count
            self._req_counter += 1
            req_id = self._req_counter
            self.state = "running"
            self.last_used = time.time()
            t0 = time.perf_counter()

            payload = json.dumps({
                "id": req_id,
                "code": code or "",
                "execution_count": exec_num
            }) + "\n"

            try:
                assert self._proc is not None and self._proc.stdin is not None
                self._proc.stdin.write(payload)
                self._proc.stdin.flush()
            except Exception as write_err:
                self._kill_locked()
                return {
                    "status": "error",
                    "execution_count": exec_num,
                    "elapsed_ms": max(1, int((time.perf_counter() - t0) * 1000)),
                    "outputs": [{
                        "output_type": "error",
                        "ename": "KernelWriteError",
                        "evalue": str(write_err),
                        "traceback": [f"KernelWriteError: {write_err}"]
                    }]
                }

            resp_line = self._readline_with_timeout(float(timeout_sec))
            elapsed_ms = max(1, int((time.perf_counter() - t0) * 1000))
            self.last_used = time.time()

            if not resp_line:
                # Timed out or kernel crashed -> recycle kernel cleanly
                self._kill_locked()
                return {
                    "status": "timeout",
                    "execution_count": exec_num,
                    "elapsed_ms": elapsed_ms,
                    "outputs": [{
                        "output_type": "error",
                        "ename": "TimeoutError",
                        "evalue": f"Cell execution timed out after {timeout_sec}s. Kernel was restarted.",
                        "traceback": [f"TimeoutError: Cell execution exceeded {timeout_sec}s limit."]
                    }]
                }

            self.state = "idle"
            try:
                resp = json.loads(resp_line)
                return {
                    "status": resp.get("status", "ok"),
                    "execution_count": resp.get("execution_count", exec_num),
                    "elapsed_ms": elapsed_ms,
                    "outputs": resp.get("outputs", [])
                }
            except Exception as parse_err:
                return {
                    "status": "error",
                    "execution_count": exec_num,
                    "elapsed_ms": elapsed_ms,
                    "outputs": [{
                        "output_type": "error",
                        "ename": "KernelProtocolError",
                        "evalue": str(parse_err),
                        "traceback": [f"KernelProtocolError: {parse_err}"]
                    }]
                }

    def interrupt(self) -> bool:
        proc = self._proc
        if proc is not None and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGINT)
                return True
            except Exception:
                return False
        return False

    def restart(self) -> Dict[str, Any]:
        with self._lock:
            self._kill_locked()
            self.execution_count = 0
            self._start_locked()
            return self.status_dict()

    def shutdown(self) -> None:
        with self._lock:
            self._kill_locked()

    def status_dict(self) -> Dict[str, Any]:
        alive = self._proc is not None and self._proc.poll() is None
        return {
            "session_id": self.session_id,
            "state": self.state if alive else "stopped",
            "execution_count": self.execution_count,
            "idle_seconds": int(max(0, time.time() - self.last_used)),
        }


class ColabKernelManager:
    """Thread-safe registry of per-session persistent Python kernels with idle TTL cleanup."""

    def __init__(self):
        self._sessions: Dict[str, ColabKernelSession] = {}
        self._guard = threading.Lock()

    def _cleanup_idle_locked(self) -> None:
        now = time.time()
        expired = [
            sid for sid, ks in self._sessions.items()
            if ks.state != "running" and (now - ks.last_used) > KERNEL_IDLE_TTL_SEC
        ]
        for sid in expired:
            ks = self._sessions.pop(sid, None)
            if ks:
                ks.shutdown()

    def get_or_create(self, session_id: str) -> ColabKernelSession:
        with self._guard:
            self._cleanup_idle_locked()
            ks = self._sessions.get(session_id)
            if ks is None:
                work_dir = get_session_work_dir(session_id)
                ks = ColabKernelSession(session_id, work_dir)
                self._sessions[session_id] = ks
            return ks

    def execute_cell(self, session_id: str, code: str, timeout_sec: int = DEFAULT_CELL_TIMEOUT_SEC) -> Dict[str, Any]:
        ks = self.get_or_create(session_id)
        return ks.execute(code, timeout_sec=timeout_sec)

    def restart_kernel(self, session_id: str) -> Dict[str, Any]:
        ks = self.get_or_create(session_id)
        return ks.restart()

    def interrupt_kernel(self, session_id: str) -> Dict[str, Any]:
        with self._guard:
            ks = self._sessions.get(session_id)
        if not ks:
            return {"status": "not_running", "interrupted": False}
        ok = ks.interrupt()
        return {"status": "interrupted" if ok else "idle", "interrupted": ok}

    def get_status(self, session_id: str) -> Dict[str, Any]:
        with self._guard:
            ks = self._sessions.get(session_id)
        if not ks:
            return {
                "session_id": session_id,
                "state": "stopped",
                "execution_count": 0,
                "idle_seconds": 0,
            }
        return ks.status_dict()


colab_kernel_manager = ColabKernelManager()


# =====================================================================
# WORKSPACE FILE MANAGEMENT (DATASETS & GENERATED ARTIFACTS)
# =====================================================================

def _preview_csv_file(filepath: str, max_rows: int = 5) -> Optional[Dict[str, Any]]:
    ext = os.path.splitext(filepath)[1].lower()
    if ext not in (".csv", ".tsv"):
        return None
    delimiter = "\t" if ext == ".tsv" else ","
    try:
        with open(filepath, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f, delimiter=delimiter)
            headers = next(reader, [])
            rows = []
            for _ in range(max_rows):
                row = next(reader, None)
                if row is None:
                    break
                rows.append(row)
        return {"columns": headers[:40], "sample_rows": rows}
    except Exception:
        return None


def list_session_files(session_id: str, course_name: str = "") -> List[Dict[str, Any]]:
    """List all uploaded and code-generated files in the session kernel workspace."""
    work_dir = get_session_work_dir(session_id)
    files: List[Dict[str, Any]] = []
    try:
        for name in sorted(os.listdir(work_dir)):
            full = os.path.join(work_dir, name)
            if not os.path.isfile(full):
                continue
            stat = os.stat(full)
            entry: Dict[str, Any] = {
                "filename": name,
                "size_bytes": stat.st_size,
                "extension": os.path.splitext(name)[1].lower(),
                "modified_at": datetime.datetime.fromtimestamp(stat.st_mtime, tz=datetime.timezone.utc).isoformat(),
            }
            csv_info = _preview_csv_file(full)
            if csv_info:
                entry["columns"] = csv_info["columns"]
                entry["sample_rows"] = csv_info["sample_rows"]
            files.append(entry)
    except Exception as e:
        logger.warning(f"[Colab Files Notice] list error for {session_id}: {e}")
    return files


def upload_session_file(
    session_id: str,
    course_name: str,
    filename: str,
    content_bytes: bytes
) -> Dict[str, Any]:
    """Save an uploaded dataset/file into the session kernel workspace and back it up to GCS."""
    if len(content_bytes) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File exceeds maximum size of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    safe_name = _safe_filename(filename)
    work_dir = get_session_work_dir(session_id)
    dest = os.path.join(work_dir, safe_name)
    with open(dest, "wb") as f:
        f.write(content_bytes)

    slug = to_course_slug(course_name or "course")
    blob_path = gcs_storage_service.get_assignment_blob_path(slug, session_id, f"files/{safe_name}")
    try:
        gcs_storage_service.upload_blob_bytes(blob_path, content_bytes)
    except Exception as gcs_err:
        logger.warning(f"[Colab Files GCS Notice]: {gcs_err}")

    info: Dict[str, Any] = {
        "filename": safe_name,
        "size_bytes": len(content_bytes),
        "extension": os.path.splitext(safe_name)[1].lower(),
        "blob_path": blob_path,
    }
    csv_info = _preview_csv_file(dest)
    if csv_info:
        info["columns"] = csv_info["columns"]
        info["sample_rows"] = csv_info["sample_rows"]
    return info


def get_session_file_bytes(session_id: str, course_name: str, filename: str) -> Optional[bytes]:
    """Read a workspace or generated file from local work_dir (falling back to GCS)."""
    safe_name = _safe_filename(filename)
    work_dir = get_session_work_dir(session_id)
    full = os.path.join(work_dir, safe_name)
    if os.path.isfile(full):
        with open(full, "rb") as f:
            return f.read()
    slug = to_course_slug(course_name or "course")
    blob_path = gcs_storage_service.get_assignment_blob_path(slug, session_id, f"files/{safe_name}")
    try:
        data = gcs_storage_service.get_blob_bytes(blob_path)
        if data:
            with open(full, "wb") as f:
                f.write(data)
            return data
    except Exception:
        pass
    return None


def delete_session_file(session_id: str, course_name: str, filename: str) -> bool:
    """Delete a file from the session workspace."""
    safe_name = _safe_filename(filename)
    work_dir = get_session_work_dir(session_id)
    full = os.path.join(work_dir, safe_name)
    if os.path.isfile(full):
        os.remove(full)
        return True
    return False


def get_dataset_schema_context(session_id: str) -> str:
    """Format uploaded workspace files and CSV schemas for Co-Pilot grounding."""
    files = list_session_files(session_id)
    if not files:
        return ""
    lines = ["Workspace Dataset Files Available in Current Working Directory (load directly by filename):"]
    for f in files:
        desc = f"- `{f['filename']}` ({f['size_bytes']} bytes)"
        if f.get("columns"):
            desc += f" | Columns: {', '.join(f['columns'])}"
        lines.append(desc)
    return "\n".join(lines)
