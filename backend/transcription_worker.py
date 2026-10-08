"""Cloud Run Job entry point for asynchronous lecture transcription."""
from __future__ import annotations

import os
import sys

from backend.transcription_jobs import _safe_error_message, process_transcription_job


def main() -> int:
    job_id = os.getenv("TRANSCRIPTION_JOB_ID", "").strip()
    if not job_id:
        print("TRANSCRIPTION_JOB_ID is required.", file=sys.stderr)
        return 2
    try:
        process_transcription_job(job_id)
    except Exception as exc:
        print(f"Transcription worker failed: {_safe_error_message(exc)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
