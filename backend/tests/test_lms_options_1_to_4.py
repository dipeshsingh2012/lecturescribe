"""
End-to-end tests for LMS Options 1–4:
- Option 1: Student Assignment Submissions + Calendar Deadline Sync & AI SpeedGrader
- Option 2: Centralized Course Gradebook Engine
- Option 3: Course Enrollment, Roster & Self-Enrollment Keys
- Option 4: Course Discussions / Q&A Forum with Timestamp Deep-Links & AI Triage
"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager


client = TestClient(app)


def test_option_1_assignment_publish_calendar_sync_submission_and_ai_speedgrader():
    course_name = "Statistical Inference"
    asgn_id = "asgn_test_opt1"

    # Seed tutor user
    db_manager.upsert_user_session(email="prof@iiitdwd.ac.in", name="Prof Sharma", requested_role="tutor")
    db_manager.set_user_role(email="prof@iiitdwd.ac.in", role="tutor", update_system_role=True)

    # Create assignment
    db_manager.create_assignment(
        assignment_id=asgn_id,
        course_name=course_name,
        user_email="prof@iiitdwd.ac.in",
        title="MLE & Cramer-Rao Bound Homework",
        source_filename="hw1.pdf",
        source_blob_name="courses/statistical-inference/hw1.pdf",
        status="completed",
        questions_summary=[
            {
                "question_number": 1,
                "title": "MLE of Poisson",
                "question_text": "Derive the maximum likelihood estimator for lambda in a Poisson(lambda) distribution.",
            }
        ],
    )

    # 1. Tutor publishes assignment with due_date and max_marks -> auto-syncs to LMS Calendar
    pub_resp = client.patch(
        f"/api/course/{course_name}/assignments/{asgn_id}/publish",
        json={
            "due_date": "2026-11-20T23:59:00+05:30",
            "max_marks": 50.0,
            "is_published": True,
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert pub_resp.status_code == 200
    pub_data = pub_resp.json()
    assert pub_data["assignment"]["due_date"] == "2026-11-20T23:59:00+05:30"
    assert pub_data["assignment"]["max_marks"] == 50.0
    assert pub_data["calendar_event_id"] == f"cal_asgn_{asgn_id}"

    # Verify calendar event exists in LMS calendar
    cal_events = db_manager.get_calendar_events(course_slug="statistical-inference")
    assert any(ev["id"] == f"cal_asgn_{asgn_id}" and ev["category"] == "assignment" for ev in cal_events)

    # 2. Student submits solution
    sub_resp = client.post(
        f"/api/course/{course_name}/assignments/{asgn_id}/submit",
        json={
            "student_email": "alice@student.iiitdwd.ac.in",
            "student_name": "Alice Verma",
            "submission_text": "For X_1..X_n ~ Poisson(lambda), log-likelihood l(lambda) = -n*lambda + sum(X_i)*ln(lambda). Setting derivative = 0 gives hat(lambda) = sum(X_i)/n.",
            "file_name": "alice_hw1.ipynb",
        },
    )
    assert sub_resp.status_code == 200
    sub_record = sub_resp.json()["submission"]
    sub_id = sub_record["submission_id"]
    assert sub_record["status"] == "submitted"
    assert sub_record["max_marks"] == 50.0

    # 3. Tutor runs AI SpeedGrader
    ai_grade_resp = client.post(
        f"/api/course/{course_name}/assignments/{asgn_id}/submissions/{sub_id}/ai-grade?actor_email=prof@iiitdwd.ac.in&apply_grade=false"
    )
    assert ai_grade_resp.status_code == 200
    ai_data = ai_grade_resp.json()
    assert ai_data["ai_evaluation"]["ai_suggested_score"] > 0
    assert ai_data["submission"]["ai_suggested_score"] == ai_data["ai_evaluation"]["ai_suggested_score"]

    # 4. Tutor finalizes grade
    final_grade_resp = client.patch(
        f"/api/course/{course_name}/assignments/{asgn_id}/submissions/{sub_id}/grade",
        json={
            "score": 47.5,
            "instructor_feedback": "Excellent derivation of the Poisson MLE and Fisher information.",
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert final_grade_resp.status_code == 200
    graded_sub = final_grade_resp.json()["submission"]
    assert graded_sub["status"] == "graded"
    assert graded_sub["score"] == 47.5


def test_option_2_centralized_course_gradebook_and_overrides():
    course_name = "Statistical Inference"

    # Fetch full course gradebook
    gb_resp = client.get(f"/api/course/{course_name}/gradebook")
    assert gb_resp.status_code == 200
    gb = gb_resp.json()
    assert gb["course_slug"] == "statistical-inference"
    assert len(gb["columns"]) >= 2  # Assignment + Course AI Quiz column
    alice_row = next((s for s in gb["students"] if s["student_email"] == "alice@student.iiitdwd.ac.in"), None)
    assert alice_row is not None
    assert alice_row["total_earned"] == 47.5
    assert alice_row["total_possible"] == 50.0
    assert alice_row["overall_percentage"] == 95.0
    assert alice_row["letter_grade"] == "A+"

    # Tutor adds manual/override score for Viva Voce
    ov_resp = client.post(
        f"/api/course/{course_name}/gradebook/override",
        json={
            "student_email": "alice@student.iiitdwd.ac.in",
            "item_id": "manual_viva_1",
            "item_title": "Midterm Viva",
            "item_type": "manual",
            "score": 18.0,
            "max_marks": 20.0,
            "feedback": "Clear conceptual answers",
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert ov_resp.status_code == 200

    # Re-fetch student-filtered gradebook
    gb_alice = client.get(f"/api/course/{course_name}/gradebook?student_email=alice@student.iiitdwd.ac.in").json()
    assert len(gb_alice["students"]) == 1
    assert gb_alice["students"][0]["total_earned"] == 65.5
    assert gb_alice["students"][0]["total_possible"] == 70.0


def test_option_3_course_enrollment_keys_and_roster():
    course_name = "Statistical Inference"

    # 1. Tutor generates enrollment key
    key_resp = client.post(
        f"/api/course/{course_name}/enrollment-key",
        json={"actor_email": "prof@iiitdwd.ac.in", "custom_key": "STAT-2026"},
    )
    assert key_resp.status_code == 200
    assert key_resp.json()["key_record"]["enrollment_key"] == "STAT-2026"

    # 2. Student self-enrols using the key
    enrol_resp = client.post(
        "/api/course/enrol-by-key",
        json={
            "enrollment_key": "STAT-2026",
            "user_email": "rohan@student.iiitdwd.ac.in",
            "user_name": "Rohan Kulkarni",
        },
    )
    assert enrol_resp.status_code == 200
    assert enrol_resp.json()["enrollment"]["course_role"] == "student"
    assert enrol_resp.json()["enrollment"]["enrol_method"] == "self_key"

    # 3. Verify roster includes Rohan
    roster_resp = client.get(f"/api/course/{course_name}/members")
    assert roster_resp.status_code == 200
    members = roster_resp.json()["members"]
    assert any(m["user_email"] == "rohan@student.iiitdwd.ac.in" for m in members)

    # 4. Tutor removes member
    del_resp = client.delete(
        f"/api/course/{course_name}/members/rohan@student.iiitdwd.ac.in?actor_email=prof@iiitdwd.ac.in"
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["removed"] is True


def test_option_4_course_forum_timestamp_deeplinks_ai_ta_and_endorsement():
    course_name = "Statistical Inference"

    # 1. Student creates a thread with lecture timestamp deep-link
    thr_resp = client.post(
        f"/api/course/{course_name}/forum",
        json={
            "title": "Why does Fisher Information equal -E[d^2 l / d theta^2]?",
            "body": "In Lecture 4 at [14:20], the regularity condition for interchanging integration and differentiation was mentioned. When does it fail?",
            "author_email": "alice@student.iiitdwd.ac.in",
            "author_name": "Alice Verma",
            "category": "lecture_question",
            "video_id": "vid_stat_04",
            "lecture_title": "Lecture 4: Fisher Information",
            "timestamp_str": "14:20",
        },
    )
    assert thr_resp.status_code == 200
    thread = thr_resp.json()["thread"]
    tid = thread["thread_id"]
    assert thread["timestamp_str"] == "14:20"
    assert thread["video_id"] == "vid_stat_04"

    # 2. Trigger AI TA reply
    ai_rep_resp = client.post(f"/api/course/{course_name}/forum/{tid}/ai-reply")
    assert ai_rep_resp.status_code == 200
    ai_reply = ai_rep_resp.json()["reply"]
    rid = ai_reply["reply_id"]
    assert ai_reply["is_ai_generated"] is True
    assert len(ai_reply["body"]) > 20

    # 3. Tutor endorses the AI TA reply and resolves the thread
    endorse_resp = client.patch(
        f"/api/course/{course_name}/forum/{tid}/endorse/{rid}",
        json={
            "is_endorsed": True,
            "resolve_thread": True,
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert endorse_resp.status_code == 200
    assert endorse_resp.json()["reply"]["is_instructor_endorsed"] is True

    # 4. List threads and verify nested replies + resolved status
    list_resp = client.get(f"/api/course/{course_name}/forum")
    assert list_resp.status_code == 200
    threads = list_resp.json()["threads"]
    fetched = next((t for t in threads if t["thread_id"] == tid), None)
    assert fetched is not None
    assert fetched["is_resolved"] is True
    assert len(fetched["replies"]) == 1
    assert fetched["replies"][0]["is_instructor_endorsed"] is True


def test_wave2_option_1_completion_tracking_and_restrict_access_rules():
    course_name = "Statistical Inference"
    student_email = "alice@student.iiitdwd.ac.in"

    # 1. Mark a lecture module complete for Alice
    toggle_resp = client.post(
        f"/api/course/{course_name}/completion/toggle",
        json={
            "user_email": student_email,
            "module_id": "vid_stat_01",
            "module_type": "lecture",
            "module_title": "Lecture 1: Point Estimation",
            "is_completed": True,
        },
    )
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["completion"]["status"] == "complete"

    # 2. Tutor configures a Restrict Access prerequisite rule on the Course Quiz requiring vid_stat_02
    rule_resp = client.post(
        f"/api/course/{course_name}/access-rules",
        json={
            "target_module_id": "quiz_best_statistical-inference",
            "target_module_type": "quiz",
            "target_title": "Course Comprehensive AI Exam",
            "required_module_ids": ["vid_stat_01", "vid_stat_02"],
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert rule_resp.status_code == 200
    assert "vid_stat_02" in rule_resp.json()["rule"]["required_module_ids"]

    # 3. Check Alice's completion status -> quiz should be locked until vid_stat_02 is completed
    comp_resp = client.get(f"/api/course/{course_name}/completion?user_email={student_email}")
    assert comp_resp.status_code == 200
    comp_data = comp_resp.json()
    quiz_mod = next((m for m in comp_data["modules"] if m["module_id"] == "quiz_best_statistical-inference"), None)
    assert quiz_mod is not None
    assert quiz_mod["is_locked"] is True
    assert any("vid_stat_02" in r for r in quiz_mod["lock_reasons"])

    # 4. Complete vid_stat_02 -> quiz unlocks!
    client.post(
        f"/api/course/{course_name}/completion/toggle",
        json={
            "user_email": student_email,
            "module_id": "vid_stat_02",
            "module_type": "lecture",
            "module_title": "Lecture 2: Sufficiency",
            "is_completed": True,
        },
    )
    comp_after = client.get(f"/api/course/{course_name}/completion?user_email={student_email}").json()
    quiz_after = next((m for m in comp_after["modules"] if m["module_id"] == "quiz_best_statistical-inference"), None)
    assert quiz_after["is_locked"] is False


def test_wave2_option_2_ai_question_bank_and_custom_quiz_publisher():
    course_name = "Statistical Inference"

    # 1. AI-generate Bloom-tagged questions into the bank
    gen_resp = client.post(
        f"/api/course/{course_name}/question-bank/ai-generate",
        json={
            "lecture_title": "Lecture 3: Cramer-Rao Lower Bound",
            "count": 2,
            "difficulty": "hard",
            "bloom_level": "analyze",
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert gen_resp.status_code == 200
    gen_questions = gen_resp.json()["questions"]
    assert len(gen_questions) == 2
    assert gen_questions[0]["bloom_level"] == "analyze"
    assert gen_questions[0]["difficulty"] == "hard"

    # 2. Filter question bank by bloom_level=analyze
    bank_resp = client.get(f"/api/course/{course_name}/question-bank?bloom_level=analyze")
    assert bank_resp.status_code == 200
    assert bank_resp.json()["count"] >= 2

    # 3. Publish selected questions into the active Course Quiz
    q_ids = [q["question_id"] for q in gen_questions]
    pub_resp = client.post(
        f"/api/course/{course_name}/question-bank/publish-quiz",
        json={
            "question_ids": q_ids,
            "title": "Midterm CRLB Custom Exam",
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert pub_resp.status_code == 200
    published_quiz = pub_resp.json()["quiz"]
    assert published_quiz["title"] == "Midterm CRLB Custom Exam"
    assert len(published_quiz["questions"]) == 2


def test_wave2_option_3_modular_syllabus_spine_and_ai_organizer():
    course_name = "Statistical Inference"

    # 1. AI Auto-organize syllabus into weekly curriculum modules
    org_resp = client.post(
        f"/api/course/{course_name}/syllabus/ai-organize",
        json={"actor_email": "prof@iiitdwd.ac.in"},
    )
    assert org_resp.status_code == 200
    sections = org_resp.json()["sections"]
    assert len(sections) >= 2

    # 2. Add a custom weekly module
    add_sec_resp = client.post(
        f"/api/course/{course_name}/syllabus/sections",
        json={
            "title": "Week 5: Bayesian Estimation & Conjugate Priors",
            "summary": "Posterior distributions and MAP vs Bayes risk.",
            "learning_objectives": ["Derive beta-binomial and normal-normal posteriors"],
            "items": [],
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert add_sec_resp.status_code == 200
    sec_id = add_sec_resp.json()["section"]["section_id"]

    # 3. Fetch syllabus sections
    get_resp = client.get(f"/api/course/{course_name}/syllabus")
    assert get_resp.status_code == 200
    assert any(s["section_id"] == sec_id for s in get_resp.json()["sections"])


def test_wave2_option_4_instructor_learning_analytics_and_at_risk_dashboard():
    course_name = "Statistical Inference"

    # Enrol an at-risk student with 0 submissions and 0 forum posts
    client.post(
        "/api/course/enrol-by-key",
        json={
            "enrollment_key": "STAT-2026",
            "user_email": "bob_at_risk@student.iiitdwd.ac.in",
            "user_name": "Bob Sharma",
        },
    )

    analytics_resp = client.get(f"/api/course/{course_name}/analytics")
    assert analytics_resp.status_code == 200
    data = analytics_resp.json()
    assert data["summary"]["total_students"] >= 2
    assert data["summary"]["at_risk_high_count"] >= 1

    bob_entry = next((s for s in data["students"] if s["student_email"] == "bob_at_risk@student.iiitdwd.ac.in"), None)
    assert bob_entry is not None
    assert bob_entry["risk_level"] == "high"
    assert len(bob_entry["risk_factors"]) >= 2
    assert "Bob Sharma" in bob_entry["ai_intervention_message"]


def test_wave3_option_1_2d_grading_rubrics_and_ai_generator():
    course_name = "Statistical Inference"

    # 1. AI generate a 2D rubric for the assignment
    gen_resp = client.post(
        f"/api/course/{course_name}/rubrics/ai-generate",
        json={
            "assignment_id": "asgn_test_opt1",
            "title": "MLE & Cramer-Rao Bound Homework",
            "max_marks": 50.0,
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert gen_resp.status_code == 200
    rubric = gen_resp.json()["rubric"]
    assert rubric["total_points"] == 50.0
    assert len(rubric["criteria"]) == 3

    # 2. Fetch course rubrics
    list_resp = client.get(f"/api/course/{course_name}/rubrics")
    assert list_resp.status_code == 200
    assert len(list_resp.json()["rubrics"]) >= 1


def test_wave3_option_2_course_competencies_and_mastery_matrix():
    course_name = "Statistical Inference"

    # 1. AI extract course competencies
    ext_resp = client.post(f"/api/course/{course_name}/competencies/ai-extract")
    assert ext_resp.status_code == 200
    assert ext_resp.json()["count"] >= 3

    # 2. Get competency mastery matrix
    mat_resp = client.get(f"/api/course/{course_name}/competencies")
    assert mat_resp.status_code == 200
    mat = mat_resp.json()
    assert len(mat["competencies"]) >= 3
    alice_row = next((s for s in mat["students"] if s["student_email"] == "alice@student.iiitdwd.ac.in"), None)
    assert alice_row is not None
    assert len(alice_row["competencies"]) >= 3


def test_wave3_option_3_peer_review_workshop_and_ai_calibration():
    course_name = "Statistical Inference"

    # 1. Tutor creates a Peer Review Workshop
    ws_resp = client.post(
        f"/api/course/{course_name}/workshops",
        json={
            "title": "Peer Review: Asymptotic Efficiency Proof",
            "instructions": "Verify regularity conditions and score out of 100.",
            "phase": "submission",
            "actor_email": "prof@iiitdwd.ac.in",
        },
    )
    assert ws_resp.status_code == 200
    ws_id = ws_resp.json()["workshop"]["workshop_id"]

    # 2. Student submits an artifact
    sub_resp = client.post(
        f"/api/course/{course_name}/workshops/{ws_id}/submissions",
        json={
            "student_email": "alice@student.iiitdwd.ac.in",
            "student_name": "Alice Verma",
            "title": "Cauchy-Schwarz Proof of CRLB",
            "content": "Using Cov(T, d/dtheta log f(X;theta))^2 <= Var(T) * I(theta), we obtain Var(T) >= 1/I(theta).",
        },
    )
    assert sub_resp.status_code == 200
    sub_id = sub_resp.json()["submission"]["submission_id"]

    # 3. Peer submits a detailed review -> receives high AI calibration score
    rev_resp = client.post(
        f"/api/course/{course_name}/workshops/{ws_id}/reviews",
        json={
            "submission_id": sub_id,
            "reviewer_email": "peer@student.iiitdwd.ac.in",
            "reviewer_name": "Karan Mehta",
            "peer_score": 94.0,
            "feedback": "Very clear application of the Cauchy-Schwarz inequality to the score function and unbiasedness condition.",
        },
    )
    assert rev_resp.status_code == 200
    rev = rev_resp.json()["review"]
    assert rev["ai_calibration_score"] == 95.0


def test_wave3_option_4_course_announcements_and_pedagogical_audit_log():
    course_name = "Statistical Inference"

    # 1. Tutor broadcasts an urgent announcement
    ann_resp = client.post(
        f"/api/course/{course_name}/announcements",
        json={
            "title": "Midterm Exam Room & Formula Sheet Policy",
            "body": "The midterm will be held in Lecture Hall 2. One A4 handwritten formula sheet is permitted.",
            "priority": "urgent",
            "author_email": "prof@iiitdwd.ac.in",
            "author_name": "Prof Sharma",
        },
    )
    assert ann_resp.status_code == 200
    assert ann_resp.json()["announcement"]["priority"] == "urgent"

    # 2. Fetch announcements and verify pedagogical audit log entry was automatically recorded
    get_resp = client.get(f"/api/course/{course_name}/announcements")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert len(data["announcements"]) >= 1
    assert len(data["audit_logs"]) >= 1
    assert data["audit_logs"][0]["verb"] == "broadcasted_announcement"



