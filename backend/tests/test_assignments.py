"""
Unit tests for Assignment Planner & Solution Generator
"""
import os
import pytest
import json
from backend.assignment_service import (
    execute_code_cells,
    build_ipynb_structure,
    render_notebook_to_html,
    convert_html_to_pdf
)
from backend.database import db_manager


def test_code_execution_captures_stdout():
    cells = [
        {
            "cell_type": "markdown",
            "source": "# Problem 1\nCalculate factorial"
        },
        {
            "cell_type": "code",
            "source": (
                "def factorial(n):\n"
                "    return 1 if n <= 1 else n * factorial(n - 1)\n\n"
                "res = factorial(5)\n"
                "print(f'Computed Factorial(5) = {res}')\n"
                "assert res == 120\n"
                "print('Assertion PASSED')"
            )
        }
    ]

    executed = execute_code_cells(cells)
    assert len(executed) == 2
    assert executed[0]["cell_type"] == "markdown"
    assert executed[1]["cell_type"] == "code"

    outputs = executed[1]["outputs"]
    assert len(outputs) >= 1
    assert outputs[0]["output_type"] == "stream"
    assert outputs[0]["name"] == "stdout"
    stdout_text = "".join(outputs[0]["text"])
    assert "Computed Factorial(5) = 120" in stdout_text
    assert "Assertion PASSED" in stdout_text


def test_code_execution_handles_runtime_error_gracefully():
    cells = [
        {
            "cell_type": "code",
            "source": "x = 1 / 0\nprint('Never reached')"
        }
    ]

    executed = execute_code_cells(cells)
    assert len(executed) == 1
    outputs = executed[0]["outputs"]
    assert len(outputs) >= 1
    assert outputs[0]["output_type"] == "error"
    assert "ZeroDivisionError" in outputs[0]["evalue"] or "ZeroDivision" in str(outputs[0])


def test_build_ipynb_structure():
    cells = [
        {"cell_type": "markdown", "source": "# Title"},
        {"cell_type": "code", "source": "print('ok')", "outputs": []}
    ]
    nb = build_ipynb_structure(cells)
    assert nb["nbformat"] == 4
    assert nb["nbformat_minor"] == 5
    assert len(nb["cells"]) == 2
    serialized = json.dumps(nb)
    deserialized = json.loads(serialized)
    assert deserialized["nbformat"] == 4


def test_pdf_conversion():
    nb = {
        "cells": [
            {"cell_type": "markdown", "source": "# Machine Learning\nLinear Regression"},
            {"cell_type": "code", "execution_count": 1, "source": "print('Done')", "outputs": [{"output_type": "stream", "text": ["Done\n"]}]}
        ]
    }
    html = render_notebook_to_html(nb, "CS 229", "Homework 1")
    assert "Machine Learning" in html
    assert "Homework 1" in html
    assert "Done" in html

    pdf_bytes = convert_html_to_pdf(html, "CS 229", "Homework 1", nb)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 100
    assert pdf_bytes.startswith(b"%PDF")


def test_db_assignment_crud():
    aid = "asgn_test_12345"
    course = "Test Deep Learning"
    created = db_manager.create_assignment(
        assignment_id=aid,
        course_name=course,
        user_email="student@example.com",
        title="Assignment 1",
        source_filename="hw1.pdf",
        source_blob_name="courses/hw1.pdf",
        status="pending"
    )
    assert created["assignment_id"] == aid
    assert created["status"] == "pending"

    # Update status
    updated = db_manager.update_assignment(
        assignment_id=aid,
        status="completed",
        notebook_blob_name="courses/hw1.ipynb",
        pdf_blob_name="courses/hw1_solution.pdf"
    )
    assert updated["status"] == "completed"
    assert updated["notebook_blob_name"] == "courses/hw1.ipynb"

    # Get by id
    fetched = db_manager.get_assignment_by_id(aid)
    assert fetched is not None
    assert fetched["assignment_id"] == aid

    # Get by course
    all_asgn = db_manager.get_course_assignments(course)
    assert any(x["assignment_id"] == aid for x in all_asgn)

    # Delete
    deleted = db_manager.delete_assignment(aid)
    assert deleted is True
    assert db_manager.get_assignment_by_id(aid) is None


def test_detect_required_datasets():
    from backend.assignment_service import detect_required_datasets
    
    text = (
        "Question 1: Load the dataset from titanic.csv using pandas.\n"
        "Inspect the first 5 rows and summarize missing values.\n"
        "Question 2: Also examine customer_churn.xlsx and save cleaned version to clean.csv.\n"
        "Question 3: Export the cleaned student records to cleaned_student_data.csv."
    )
    detected = detect_required_datasets(text)
    assert "titanic.csv" in detected
    assert "customer_churn.xlsx" in detected
    # Output/cleaned files must NOT be flagged as missing external prerequisite datasets
    assert "clean.csv" not in detected
    assert "cleaned_student_data.csv" not in detected
    # Should not include code or non-dataset files
    assert not any(f.endswith(".py") for f in detected)


def test_cleaned_output_dataset_does_not_pause_pipeline(monkeypatch):
    from backend.assignment_service import process_assignment_pipeline

    aid = "asgn_cleaned_student_test"
    course = "Data Science 101"

    monkeypatch.setattr(
        "backend.assignment_service.extract_text_from_pdf",
        lambda b: (
            "Question 1: Create a student DataFrame, handle missing values, "
            "and save the cleaned dataset to 'cleaned_student_data.csv'.\n"
            "Question 2: Load 'cleaned_student_data.csv' and display summary statistics."
        )
    )
    monkeypatch.setattr(
        "backend.assignment_service.enrich_questions_with_course_rag",
        lambda c, q: q
    )

    db_manager.create_assignment(
        assignment_id=aid,
        course_name=course,
        user_email="tutor@uni.edu",
        title="Student Data Cleaning Lab",
        source_filename="student_cleaning.pdf",
        source_blob_name="courses/student_cleaning.pdf",
        status="pending"
    )

    result = process_assignment_pipeline(
        assignment_id=aid,
        course_name=course,
        user_email="tutor@uni.edu",
        pdf_bytes=b"%PDF-1.4 dummy content",
        filename="student_cleaning.pdf"
    )

    assert result["status"] == "completed"
    record = db_manager.get_assignment_by_id(aid)
    assert record["status"] == "completed"
    assert record["notebook_blob_name"] is not None
    assert record["pdf_blob_name"] is not None


def test_embedded_pdf_dataset_materialized_and_executed(monkeypatch):
    from backend.assignment_service import process_assignment_pipeline, get_assignment_workspace

    aid = "asgn_embedded_pdf_data"
    course = "Data Science 101"

    pdf_text_with_inline_data = (
        "Given the dataset below:\n"
        "StudentID,Name,Marks,Attendance\n"
        "101,Aarav,91,95\n"
        "102,Diya,84,88\n"
        "103,Rohan,79,82\n\n"
        "Question 1: Load cleaned_student_data.csv and display the first 5 rows and mean Marks."
    )

    monkeypatch.setattr(
        "backend.assignment_service.extract_text_from_pdf",
        lambda b: pdf_text_with_inline_data
    )
    monkeypatch.setattr(
        "backend.assignment_service.enrich_questions_with_course_rag",
        lambda c, q: q
    )

    db_manager.create_assignment(
        assignment_id=aid,
        course_name=course,
        user_email="tutor@uni.edu",
        title="Embedded PDF Dataset Lab",
        source_filename="lab_inline.pdf",
        source_blob_name="courses/lab_inline.pdf",
        status="pending"
    )

    result = process_assignment_pipeline(
        assignment_id=aid,
        course_name=course,
        user_email="tutor@uni.edu",
        pdf_bytes=b"%PDF-1.4 dummy content",
        filename="lab_inline.pdf"
    )

    assert result["status"] == "completed"
    ws = get_assignment_workspace(aid)
    materialized_csv = os.path.join(ws, "cleaned_student_data.csv")
    assert os.path.exists(materialized_csv)
    with open(materialized_csv, "r", encoding="utf-8") as f:
        csv_body = f.read()
    assert "Aarav" in csv_body
    assert "Diya" in csv_body


def test_execute_code_cells_with_real_workspace_dataset(tmp_path):
    # Create a real, non-synthetic CSV file in temporary work directory
    test_csv = tmp_path / "student_grades.csv"
    test_csv.write_text("Student,Score\nAlice,95\nBob,88\nCharlie,92\n")

    cells = [
        {
            "cell_type": "code",
            "source": (
                "import pandas as pd\n"
                "df = pd.read_csv('student_grades.csv')\n"
                "print(f'Loaded {len(df)} student records')\n"
                "print('Mean Score:', df['Score'].mean())\n"
            )
        }
    ]

    executed = execute_code_cells(cells, work_dir=str(tmp_path))
    assert len(executed) == 1
    outputs = executed[0]["outputs"]
    assert len(outputs) >= 1
    stdout = "".join(outputs[0]["text"])
    assert "Loaded 3 student records" in stdout
    assert "Mean Score: 91.666" in stdout


def test_pause_and_prompt_missing_dataset_flow(tmp_path, monkeypatch):
    from backend.assignment_service import process_assignment_pipeline, resume_assignment_pipeline, get_assignment_workspace

    aid = "asgn_pause_test_999"
    course = "Data Science 101"
    
    # Mock text extraction and RAG enrichment to run reliably offline
    monkeypatch.setattr(
        "backend.assignment_service.extract_text_from_pdf",
        lambda b: "Assignment 2: Load housing.csv and compute average price per room."
    )
    monkeypatch.setattr(
        "backend.assignment_service.enrich_questions_with_course_rag",
        lambda c, q: q
    )

    # Pre-create assignment record
    db_manager.create_assignment(
        assignment_id=aid,
        course_name=course,
        user_email="student@uni.edu",
        title="Housing Lab",
        source_filename="lab2.pdf",
        source_blob_name="courses/lab2.pdf",
        status="pending"
    )

    # 1. Run pipeline - should detect housing.csv is missing, pause and set status='needs_input'
    result = process_assignment_pipeline(
        assignment_id=aid,
        course_name=course,
        user_email="student@uni.edu",
        pdf_bytes=b"%PDF-1.4 dummy content",
        filename="lab2.pdf"
    )

    assert result["status"] == "needs_input"
    record = db_manager.get_assignment_by_id(aid)
    assert record["status"] == "needs_input"
    assert "housing.csv" in record["required_files"]
    assert "Missing required dataset" in record["error_message"]

    # 2. Provide the dataset file into workspace
    ws = get_assignment_workspace(aid)
    housing_csv = os.path.join(ws, "housing.csv")
    with open(housing_csv, "w") as f:
        f.write("id,rooms,price\n1,3,300000\n2,4,450000\n")

    db_manager.update_assignment(aid, dataset_files=["housing.csv"])

    # 3. Resume pipeline - all required datasets present -> completes
    completed = resume_assignment_pipeline(aid, course)
    assert completed["status"] == "completed"

    final_record = db_manager.get_assignment_by_id(aid)
    assert final_record["status"] == "completed"
    assert final_record["notebook_blob_name"] is not None
    assert final_record["pdf_blob_name"] is not None

