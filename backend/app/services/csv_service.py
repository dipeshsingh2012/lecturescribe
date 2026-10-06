import csv
import io
import re
from typing import Any, AsyncGenerator, Dict, Iterator, List

def sanitize_csv_cell(value: Any) -> str:
    """Strip whitespace and escape formula injection characters."""
    val_str = str(value) if value is not None else ""
    cleaned = val_str.strip()
    dangerous_chars = ('=', '+', '-', '@', '\t', '\r')
    if cleaned.startswith(dangerous_chars):
        return f"'{cleaned}"
    return val_str

def sanitize_filename_part(part: str) -> str:
    """Strictly sanitize filename part against path traversal and header splitting."""
    # 1. Allow alphanumeric, underscores, hyphens, and dots (for extensions)
    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "", str(part).strip())
    # 2. Prevent directory traversal by stripping all leading dots (e.g., "../../" -> "etcpasswd")
    return sanitized.lstrip(".")

def generate_csv_chunks(rows: List[Dict[str, Any]], headers: List[str]) -> Iterator[str]:
    """Memory-efficient streaming generator that yields CSV rows incrementally."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    yield output.getvalue()
    output.seek(0)
    output.truncate(0)
    for row in rows:
        sanitized_row = [sanitize_csv_cell(row.get(h, "")) for h in headers]
        writer.writerow(sanitized_row)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)
