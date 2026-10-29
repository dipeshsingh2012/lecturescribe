"""
Unit and API tests for Milestone 1A: Tutor & Student Role System (RBAC v1).
"""
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_manager


client = TestClient(app)


def test_user_defaults_to_student_and_tutor_emails_bootstrap(monkeypatch):
    monkeypatch.setenv("TUTOR_EMAILS", "prof.smith@iiitdwd.ac.in, dean@iiitdwd.ac.in")

    # 1. Standard student sign-in defaults to 'student'
    res_student = client.post(
        "/api/auth/session",
        json={
            "email": "alice.learner@iiitdwd.ac.in",
            "name": "Alice Learner",
        },
    )
    assert res_student.status_code == 200
    s_data = res_student.json()
    assert s_data["effective_role"] == "student"
    assert s_data["is_student"] is True
    assert s_data["is_tutor"] is False

    # 2. Bootstrapped tutor email automatically receives 'tutor'
    res_tutor = client.post(
        "/api/auth/session",
        json={
            "email": "prof.smith@iiitdwd.ac.in",
            "name": "Prof Smith",
        },
    )
    assert res_tutor.status_code == 200
    t_data = res_tutor.json()
    assert t_data["system_role"] == "tutor"
    assert t_data["effective_role"] == "tutor"
    assert t_data["is_tutor"] is True
    assert t_data["is_student"] is False


def test_switch_role_between_tutor_and_student():
    email = "switch.tester@iiitdwd.ac.in"
    client.post("/api/auth/session", json={"email": email, "name": "Switch Tester"})

    # Switch to tutor
    res_to_tutor = client.patch(
        "/api/auth/role",
        json={"email": email, "role": "tutor", "update_system_role": True},
    )
    assert res_to_tutor.status_code == 200
    assert res_to_tutor.json()["effective_role"] == "tutor"
    assert res_to_tutor.json()["is_tutor"] is True

    # Switch to student view
    res_to_student = client.patch(
        "/api/auth/role",
        json={"email": email, "role": "student"},
    )
    assert res_to_student.status_code == 200
    assert res_to_student.json()["effective_role"] == "student"
    assert res_to_student.json()["is_student"] is True


def test_course_membership_assignment_and_roster():
    tutor_email = "course.tutor@iiitdwd.ac.in"
    student_email = "course.student@iiitdwd.ac.in"
    course_name = "Machine Learning Paradigms"

    db_manager.set_user_role(tutor_email, "tutor", update_system_role=True)
    db_manager.set_user_role(student_email, "student", update_system_role=True)

    # Tutor assigns student to course
    res_assign = client.post(
        f"/api/course/{course_name}/members",
        json={
            "user_email": student_email,
            "course_role": "student",
            "actor_email": tutor_email,
        },
    )
    assert res_assign.status_code == 200
    assert res_assign.json()["member"]["course_role"] == "student"

    # Student attempting to promote themselves is blocked (403)
    res_forbidden = client.post(
        f"/api/course/{course_name}/members",
        json={
            "user_email": student_email,
            "course_role": "tutor",
            "actor_email": student_email,
        },
    )
    assert res_forbidden.status_code == 403

    # Roster lists the enrolled member
    res_roster = client.get(f"/api/course/{course_name}/members")
    assert res_roster.status_code == 200
    members = res_roster.json()["members"]
    assert any(m["user_email"] == student_email for m in members)


def test_student_blocked_from_deleting_course_or_uploading_assignments():
    student_email = "restricted.student@iiitdwd.ac.in"
    db_manager.set_user_role(student_email, "student", update_system_role=True)

    # Student cannot delete a course
    res_del = client.delete(f"/api/course/Deep-Learning?email={student_email}")
    assert res_del.status_code == 403
    assert "Only Tutors" in res_del.json()["detail"]

    # Student cannot upload an assignment to the AI solver
    res_upload = client.post(
        "/api/course/Deep-Learning/assignments/upload",
        data={"user_email": student_email, "title": "HW1"},
        files={"file": ("hw1.pdf", b"%PDF-1.4 test content", "application/pdf")},
    )
    assert res_upload.status_code == 403
    assert "Only Tutors" in res_upload.json()["detail"]


def test_rename_resource_by_tutor_and_student():
    # 1. Create a link resource
    res_create = client.post(
        "/api/resources/link",
        json={
            "title": "Initial Slides Deck",
            "url": "https://example.com/slides.pdf",
            "course_name": "CS101",
            "user_email": "tutor@iiitdwd.ac.in",
        },
    )
    assert res_create.status_code == 200
    res_data = res_create.json()["resource"]
    res_id = res_data["id"]

    # 2. Student renames resource
    res_rename_student = client.patch(
        f"/api/resources/{res_id}",
        json={"title": "Updated Slides Deck by Student", "user_email": "student@iiitdwd.ac.in"},
    )
    assert res_rename_student.status_code == 200
    assert res_rename_student.json()["resource"]["title"] == "Updated Slides Deck by Student"

    # 3. Tutor renames resource
    res_rename_tutor = client.patch(
        f"/api/resources/{res_id}",
        json={"title": "Final Lecture Deck by Tutor", "user_email": "tutor@iiitdwd.ac.in"},
    )
    assert res_rename_tutor.status_code == 200
    assert res_rename_tutor.json()["resource"]["title"] == "Final Lecture Deck by Tutor"


