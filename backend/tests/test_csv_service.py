import csv
import io
import pytest
from app.services.csv_service import sanitize_csv_cell, sanitize_filename_part, generate_csv_chunks

def test_sanitize_csv_cell_formula_injection():
    assert sanitize_csv_cell(" =SUM(A1:A2)").startswith("'")
    assert sanitize_csv_cell("  -100").startswith("'")
    assert sanitize_csv_cell("normal_text") == "normal_text"

def test_sanitize_filename_part_path_traversal():
    """Verify that filename parts are stripped of directory traversal characters while preserving extensions."""
    # Test traversal removal
    assert sanitize_filename_part("../../etc/passwd") == "etcpasswd"
    assert sanitize_filename_part("tenant_1\r\nX-Injected: True") == "tenant_1X-InjectedTrue"
    # Test extension preservation
    assert sanitize_filename_part("file name!@#.csv") == "filename.csv"

def test_generate_csv_chunks():
    """Verify the streaming generator produces correct, sanitized CSV content using a robust parser."""
    data = [
        {"id": "1", "name": "Alice", "notes": "=SUM(1,2)"},
        {"id": "2", "name": "Bob", "notes": "Normal note"}
    ]
    headers = ["id", "name", "notes"]

    chunks = list(generate_csv_chunks(data, headers))
    full_output = "".join(chunks)

    # Use csv.DictReader to parse the output. This is more robust than string matching
    # because it correctly handles how the csv module quotes fields containing special characters.
    reader = csv.DictReader(io.StringIO(full_output))
    rows = list(reader)

    assert len(rows) == 2
    
    # Check Row 1 (with formula injection)
    assert rows[0]["id"] == "1"
    assert rows[0]["name"] == "Alice"
    assert rows[0]["notes"] == "'=SUM(1,2)"
    
    # Check Row 2
    assert rows[1]["id"] == "2"
    assert rows[1]["name"] == "Bob"
    assert rows[1]["notes"] == "Normal note"
