"""
Unit tests for Interactive Assignment Studio (Co-Pilot, Multi-Source RAG & PDF Studio)
"""
import os
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import db_manager
from backend.assignment_studio_service import (
    gather_course_knowledge,
    start_studio_session,
    studio_chat_turn,
    update_studio_draft,
    compile_studio_pdf,
    render_academic_document_to_html
)

client = TestClient(app)


@pytest.fixture
def mock_llm_responses(monkeypatch):
    """Mock LLM completions so tests execute fast and deterministically."""
    def fake_generate_completion(*args, **kwargs):
        user_prompt = kwargs.get("user_prompt", "")
        system_prompt = kwargs.get("system_prompt", "")

        # If refining with JSON expectation
        if "updated_draft" in system_prompt or "updated_draft" in user_prompt:
            return (
                '{\n'
                '  "explanation": "Added step-by-step mathematical proof for cross-entropy convexity.",\n'
                '  "updated_draft": "# Convexity Analysis\\n\\n## Step 1: Hessian Derivation\\n$$\\\\nabla^2 L(w) \\\\succeq 0$$\\nThe Hessian is positive semi-definite."\n'
                '}'
            )
        # If drafting
        if "Lead Academic Writer" in system_prompt:
            return (
                "# Comparative Analysis of Attention Mechanisms\n\n"
                "## 1. Problem Formulation\n"
                "In sequence-to-sequence architectures, the bottleneck problem emerges from encoding entire sequences into a fixed-length vector [Lecture 5, 12:40].\n\n"
                "## 2. Mathematical Formulation\n"
                "Additive alignment (Bahdanau):\n"
                "$$e_{ij} = v_a^\\top \\tanh(W_a s_{i-1} + U_a h_j)$$\n\n"
                "Dot-product alignment (Luong):\n"
                "$$e_{ij} = s_i^\\top h_j$$\n\n"
                "## 3. Complexity Analysis\n"
                "| Alignment Model | Score Formula | Time Complexity |\n"
                "|---|---|---|\n"
                "| Bahdanau | Additive | $\\mathcal{O}(d^2)$ |\n"
                "| Luong | Multiplicative | $\\mathcal{O}(d)$ |\n\n"
                "## 4. Conclusion\n"
                "As demonstrated in class, dot-product attention offers computational advantages."
            )
        # Default co-pilot conversation
        return (
            "I've analyzed your problem statement on Attention Mechanisms. "
            "Based on Lecture 5 (Slides 10-18) and Lecture 6 (Sequence Models), here is a recommended outline:\n"
            "1. Formulation & Bottleneck Overview\n"
            "2. Mathematical Formulations (Bahdanau vs Luong)\n"
            "3. Computational Complexity Comparison\n"
            "4. Conclusion & Takeaways\n\n"
            "Would you like to emphasize matrix calculus or empirical latency? Say 'Generate First Draft' when ready!"
        )

    monkeypatch.setattr("backend.assignment_studio_service._call_studio_llm", fake_generate_completion)


def test_gather_course_knowledge():
    course = "Deep Learning Systems"
    knowledge = gather_course_knowledge(course, "Attention mechanism Luong Bahdanau")
    assert isinstance(knowledge, dict)
    assert "cues" in knowledge
    assert "summaries" in knowledge
    assert "slides" in knowledge
    assert "formatted_context" in knowledge
    assert course in knowledge["formatted_context"]


def test_gather_course_knowledge_summaries_query(monkeypatch):
    executed_queries = []
    fake_cursor = MagicMock()
    fake_cursor.fetchall.return_value = [
        {"video_id": "vid1", "video_title": "Lecture 1: Intro", "markdown_text": "Overview of research methods and hypothesis testing."}
    ]

    def record_execute(query, params=None):
        executed_queries.append(query)
    fake_cursor.execute.side_effect = record_execute

    fake_conn = MagicMock()
    fake_conn.__enter__.return_value = fake_conn
    fake_conn.cursor.return_value.__enter__.return_value = fake_cursor

    monkeypatch.setattr(db_manager, "_get_connection", lambda: fake_conn)
    knowledge = gather_course_knowledge("Research Methodology", "Hypothesis testing")

    summaries_queries = [q for q in executed_queries if "lecturescribe_lecture_summaries" in q]
    assert len(summaries_queries) == 1
    assert "s.markdown_text" in summaries_queries[0]
    assert "s.summary_text" not in summaries_queries[0]

    assert len(knowledge["summaries"]) == 1
    assert knowledge["summaries"][0]["lecture_title"] == "Lecture 1: Intro"
    assert "Overview of research methods" in knowledge["summaries"][0]["summary"]


def test_start_studio_session(mock_llm_responses):
    course = "Deep Learning Systems"
    prompt = "Problem 2: Compare Bahdanau and Luong attention mechanisms mathematically."
    res = start_studio_session(
        course_name=course,
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt=prompt,
        title="Attention Mechanisms Comparison"
    )

    assert res["status"] == "success"
    assert res["session_id"].startswith("asgn_studio_")
    assert len(res["chat_history"]) == 2
    assert res["chat_history"][0]["role"] == "user"
    assert res["chat_history"][1]["role"] == "assistant"
    assert "outline" in res["chat_history"][1]["content"].lower()

    # Verify DB record
    record = db_manager.get_assignment_by_id(res["session_id"])
    assert record is not None
    assert record["assignment_type"] == "studio"
    assert record["status"] == "discussing"


def test_studio_chat_turn_discussion_and_draft_and_refine(mock_llm_responses):
    course = "Deep Learning Systems"
    init_res = start_studio_session(
        course_name=course,
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt="Explain and compare Bahdanau vs Luong attention."
    )
    sid = init_res["session_id"]

    # 1. Discussion turn
    turn1 = studio_chat_turn(sid, course, "Let's focus on matrix equations and time complexity.")
    assert turn1["status"] == "success"
    assert len(turn1["chat_history"]) == 4
    assert turn1["studio_status"] == "discussing"

    # 2. Trigger first draft
    draft_turn = studio_chat_turn(sid, course, "Looks good, please generate first draft!")
    assert draft_turn["status"] == "success"
    assert draft_turn["studio_status"] == "drafting"
    assert len(draft_turn["draft_markdown"]) > 50
    assert "Bahdanau" in draft_turn["draft_markdown"]

    # 3. Iteration / refinement turn
    refine_turn = studio_chat_turn(sid, course, "Add a formal proof for Hessian convexity.")
    assert refine_turn["status"] == "success"
    assert refine_turn["studio_status"] == "refining"
    assert "Convexity Analysis" in refine_turn["draft_markdown"]


def test_update_studio_draft():
    course = "Deep Learning Systems"
    init_res = start_studio_session(
        course_name=course,
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt="Draft test."
    )
    sid = init_res["session_id"]

    manual_text = "# Custom Edited Title\n\nDirect user edits in raw mode."
    updated = update_studio_draft(sid, manual_text)
    assert updated["status"] == "success"
    assert updated["draft_markdown"] == manual_text

    rec = db_manager.get_assignment_by_id(sid)
    assert rec["draft_markdown"] == manual_text


def test_compile_studio_pdf():
    course = "Deep Learning Systems"
    init_res = start_studio_session(
        course_name=course,
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt="Research on Transformers"
    )
    sid = init_res["session_id"]
    markdown = "# Transformers in Deep Learning\n\n## 1. Introduction\nSelf-attention replaces recurrence.\n\n$$A = \\text{softmax}(QK^T / \\sqrt{d_k})V$$"

    compiled = compile_studio_pdf(
        session_id=sid,
        course_name=course,
        title="Transformer Self-Attention",
        author="Alice Student",
        draft_markdown=markdown
    )

    assert compiled["status"] == "completed"
    assert compiled["pdf_blob_name"] is not None
    assert compiled["pdf_filename"].endswith(".pdf")
    rec = db_manager.get_assignment_by_id(sid)
    assert rec["status"] == "completed"
    assert rec["pdf_blob_name"] == compiled["pdf_blob_name"]


def test_academic_html_rendering():
    md = (
        "# Title of Research\n\n"
        "## Abstract\n"
        "This is an abstract.\n\n"
        "---\n\n"
        "## Evaluation Strategy\n"
        "Early Prediction Lead Time (Δ_{\\text{lead}}): Measuring lead time.\n"
        "Alternative notation: (\\Delta_{\\text{lead}}) and lead rate $\\Delta_{lead}$.\n\n"
        "---\n\n"
        "| Model | Score |\n"
        "|---|---|\n"
        "| A | 95% |\n\n"
        "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n"
    )
    html_out = render_academic_document_to_html(md, "CS 101", "Math Research", "Dr. Jane")
    assert "CS 101" in html_out
    assert "Math Research" in html_out
    assert "Dr. Jane" in html_out
    # 1. Date should not be in author header
    assert "Date:" not in html_out
    assert "Author: <strong>Dr. Jane</strong></div>" in html_out
    # 2. Section dividers '---' must not be rendered as paragraph text
    assert "<p class='academic-para'>---</p>" not in html_out
    # 3. Subscripts for Delta lead must be properly formatted
    assert "(&Delta;<sub>lead</sub>):" in html_out
    assert "(&Delta;<sub>lead</sub>)" in html_out
    assert "&Delta;<sub>lead</sub>" in html_out
    # 4. Standard tables and display math
    assert "<table class='academic-table'>" in html_out
    assert "math-display" in html_out


def test_studio_api_endpoints(mock_llm_responses):
    course = "AI-101"

    # 1. Start Studio endpoint
    resp1 = client.post(
        f"/api/course/{course}/assignments/studio/start",
        json={
            "prompt": "Explain Backpropagation through time (BPTT).",
            "title": "BPTT Study",
            "role": "student",
            "user_email": "student@iiitdwd.ac.in"
        }
    )
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["status"] == "success"
    sid = data1["session_id"]

    # 2. Chat endpoint
    resp2 = client.post(
        f"/api/course/{course}/assignments/studio/{sid}/chat",
        json={
            "message": "Let's generate the first draft now.",
            "user_email": "student@iiitdwd.ac.in"
        }
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "success"
    assert "draft_markdown" in data2

    # 3. Draft update endpoint
    resp3 = client.put(
        f"/api/course/{course}/assignments/studio/{sid}/draft",
        json={
            "draft_markdown": "# Updated BPTT Notes\n\nExplicit vanishing gradient analysis."
        }
    )
    assert resp3.status_code == 200
    assert resp3.json()["draft_markdown"] == "# Updated BPTT Notes\n\nExplicit vanishing gradient analysis."

    # 4. Compile PDF endpoint
    resp4 = client.post(
        f"/api/course/{course}/assignments/studio/{sid}/compile-pdf",
        json={
            "title": "BPTT Report",
            "author": "Student Author"
        }
    )
    assert resp4.status_code == 200
    assert resp4.json()["status"] == "completed"

    # 5. Get Session endpoint
    resp5 = client.get(f"/api/course/{course}/assignments/studio/{sid}")
    assert resp5.status_code == 200
    data5 = resp5.json()
    assert data5["session_id"] == sid
    assert data5["studio_status"] == "completed"
    assert data5["download_pdf_url"] is not None


def test_available_models_endpoint_and_studio_model_selection(mock_llm_responses):
    # 1. Available models from Redis/memory
    resp = client.get("/api/llm/available-models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert isinstance(data["models"], list)
    assert len(data["models"]) > 0
    assert any("gemini" in m["id"] for m in data["models"])
    assert data["recommended_model"] == "gemini-3.8-flash"

    # 2. Start studio with explicit model
    chosen_model = "gemini-3.8-flash"
    resp2 = client.post(
        "/api/course/AI-101/assignments/studio/start",
        json={
            "prompt": "Investigate attention models with Gemini 3.8 Flash.",
            "title": "Attention Study",
            "model_name": chosen_model
        }
    )
    assert resp2.status_code == 200
    res_data = resp2.json()
    assert res_data["selected_model"] == chosen_model
    sid = res_data["session_id"]

    # 3. Chat turn retains or updates selected model
    resp3 = client.post(
        f"/api/course/AI-101/assignments/studio/{sid}/chat",
        json={
            "message": "Let's use Groq for faster drafting.",
            "model_name": "openai/gpt-oss-120b"
        }
    )
    assert resp3.status_code == 200
    assert resp3.json()["selected_model"] == "openai/gpt-oss-120b"

    # 4. Verify persisted in DB
    rec = db_manager.get_assignment_by_id(sid)
    assert rec["selected_model"] == "openai/gpt-oss-120b"


def test_draft_generation_intent_matching_and_action(mock_llm_responses):
    from backend.assignment_studio_service import is_draft_generation_intent

    # Ensure all common button and conversational phrasing triggers draft generation
    assert is_draft_generation_intent("Looks good, please generate the first draft!") is True
    assert is_draft_generation_intent("Generate First Draft") is True
    assert is_draft_generation_intent("Generate the first draft") is True
    assert is_draft_generation_intent("Please write the draft") is True
    assert is_draft_generation_intent("Let's draft") is True
    assert is_draft_generation_intent("What is attention?") is False

    # Start session
    init_res = start_studio_session(
        course_name="Deep Learning Systems",
        user_email="student@iiitdwd.ac.in",
        role="student",
        prompt="Explain attention mechanisms."
    )
    sid = init_res["session_id"]

    # Trigger draft via the exact phrase clicked in right pane button
    # Uses the last complete co-pilot response without retriggering LLM calls
    turn = studio_chat_turn(sid, "Deep Learning Systems", "Looks good, please generate the first draft!")
    assert turn["status"] == "success"
    assert turn["draft_markdown"] != ""
    assert "Attention Mechanisms" in turn["draft_markdown"]
    assert turn["studio_status"] == "drafting"

    # Repeated draft trigger does not re-trigger LLM calls and keeps the draft
    turn_repeat = studio_chat_turn(sid, "Deep Learning Systems", "Generate First Draft")
    assert turn_repeat["status"] == "success"
    assert turn_repeat["draft_markdown"] == turn["draft_markdown"]

    # Explicit regeneration command triggers fresh LLM generation
    turn_regen = studio_chat_turn(sid, "Deep Learning Systems", "Please regenerate from scratch")
    assert turn_regen["status"] == "success"
    assert "Comparative Analysis" in turn_regen["draft_markdown"]


def test_studio_chat_refinement_preserves_dialogue_context(monkeypatch):
    from backend.assignment_studio_service import refine_existing_draft

    captured_prompts = []

    def mock_llm_capture(*args, **kwargs):
        captured_prompts.append({
            "system_prompt": kwargs.get("system_prompt", ""),
            "user_prompt": kwargs.get("user_prompt", "")
        })
        return (
            "<explanation>\n"
            "I have updated the research plan for Dr. Manjunath by adding a bi-weekly communication cadence "
            "and removing all Python code and mathematical formulas.\n"
            "</explanation>\n\n"
            "<updated_draft>\n"
            "# M.Tech Research Plan (Advisor: Dr. Manjunath)\n\n"
            "## 1. Scope & Timeline\n"
            "This 4-semester project begins with exploratory formulation.\n\n"
            "## 2. Mentor Cadence\n"
            "Bi-weekly progress reviews with Dr. Manjunath.\n"
            "</updated_draft>"
        )

    monkeypatch.setattr("backend.assignment_studio_service._call_studio_llm", mock_llm_capture)

    chat_history = [
        {"role": "user", "content": "mentor: Dr. Manjunath, dataset: MIMIC-IV"},
        {"role": "assistant", "content": "Acknowledged mentor Dr. Manjunath and MIMIC-IV dataset."},
        {"role": "user", "content": "this is a 4-semester project, no code or math formulas required."}
    ]

    current_draft = "# Initial Draft\nSome preliminary text."
    user_feedback = "you have not added the communication cadence with mentor"

    updated_draft, explanation = refine_existing_draft(
        course_name="Introduction to Research",
        current_draft=current_draft,
        user_feedback=user_feedback,
        course_context="Course Live Session 3: Mentor meetings",
        chat_history=chat_history
    )

    # Assert dialogue context was passed into user_prompt
    assert len(captured_prompts) == 1
    passed_prompt = captured_prompts[0]["user_prompt"]
    assert "Dr. Manjunath" in passed_prompt
    assert "4-semester project" in passed_prompt
    assert "communication cadence" in passed_prompt

    # Assert tags were correctly extracted
    assert "Dr. Manjunath" in updated_draft
    assert "Bi-weekly progress reviews" in updated_draft
    assert "I have updated the research plan for Dr. Manjunath" in explanation
