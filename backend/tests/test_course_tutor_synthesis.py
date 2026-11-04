import json
import pytest
from unittest.mock import MagicMock, patch
from backend.database import db_manager
from backend.rag_engine import pinecone_rag_engine

def test_course_tutor_tools_registered():
    """Verify all 5 course agent tools are registered in COURSE_AGENT_TOOLS."""
    tool_names = [t["function"]["name"] for t in pinecone_rag_engine.COURSE_AGENT_TOOLS]
    assert "search_course_transcripts" in tool_names
    assert "search_course_summaries" in tool_names
    assert "search_course_slides_and_materials" in tool_names
    assert "get_course_outline_and_lectures" in tool_names
    assert "get_course_reading_materials" in tool_names

def test_search_course_transcripts_memory_and_citations():
    """Verify transcript searching pulls cues and formats timestamps & citations."""
    course_name = "1.8 Introduction to Research"
    db_manager._memory_cache["vid-res-1"] = {
        "title": "Sampling Techniques & Probability Designs",
        "course_name": course_name,
        "cues": [
            {"timestamp": "05:20", "text": "Probability sampling guarantees each unit in the target population has a known, non-zero probability."},
            {"timestamp": "18:45", "text": "Non-probability sampling like snowball sampling is often used in exploratory qualitative field studies."}
        ]
    }

    res_json, citations = pinecone_rag_engine.execute_course_tool(
        "search_course_transcripts",
        {"query": "probability sampling", "top_k": 5},
        course_name
    )
    data = json.loads(res_json)
    assert len(data) > 0
    assert "probability sampling guarantees" in data[0]["text"].lower()
    assert len(citations) > 0
    assert citations[0]["video_id"] == "vid-res-1"
    assert citations[0]["timestamp"] == "05:20"

def test_search_course_summaries():
    """Verify searching lecture summaries retrieves executive takeaways and core concepts."""
    course_name = "1.8 Introduction to Research"
    db_manager._memory_cache["vid-res-2"] = {
        "title": "Experimental Design & Threats to Validity",
        "course_name": course_name,
        "summaryMarkdown": (
            "## Executive Summary\n"
            "This lecture covers internal and external validity in experimental research designs.\n\n"
            "### Core Concepts: Threats to Internal Validity\n"
            "Key threats include history effects, maturation, instrumentation drift, and testing effects.\n"
            "Randomized controlled trials (RCTs) mitigate these confounding factors."
        )
    }

    res_json, citations = pinecone_rag_engine.execute_course_tool(
        "search_course_summaries",
        {"query": "internal validity", "top_k": 4},
        course_name
    )
    data = json.loads(res_json)
    assert len(data) > 0
    assert "internal validity" in data[0]["text"].lower()
    assert citations[0]["timestamp"] == "Summary"
    assert "Summary" in citations[0]["text"]

def test_search_course_slides_and_materials():
    """Verify searching course slides and materials extracts slide titles and bullet points."""
    course_name = "1.8 Introduction to Research"
    
    mock_resource = {
        "id": 101,
        "title": "Lecture 03 Slides - Quantitative vs Qualitative Paradigms",
        "filename": "lec03_paradigms.pdf",
        "file_type": "pdf",
        "blob_name": "courses/1-8-intro/lec03.pdf"
    }

    with patch.object(db_manager, "get_course_resources", return_value=[mock_resource]), \
         patch("backend.gcs_storage.gcs_storage_service.get_blob_bytes", return_value=b"%PDF-mock"), \
         patch("backend.slide_parser.parse_slide_document", return_value=[
             {
                 "slide_number": 4,
                 "title": "Positivism vs Constructivism",
                 "text": "Positivism assumes an objective reality measurable via quantitative metrics.",
                 "notes": "Remind students about ontological assumptions for exam."
             }
         ]):
        res_json, citations = pinecone_rag_engine.execute_course_tool(
            "search_course_slides_and_materials",
            {"query": "positivism", "top_k": 5},
            course_name
        )
        data = json.loads(res_json)
        assert len(data) > 0
        assert "positivism" in data[0]["text"].lower()
        assert citations[0]["timestamp"] == "Slide 4"

def test_query_course_rag_synthesizes_10_mark_answer():
    """Verify query_course_rag injects summaries, transcripts, and system prompt for 10-mark descriptive answers."""
    course_name = "1.8 Introduction to Research"
    db_manager._memory_cache["vid-res-1"] = {
        "title": "Sampling Techniques & Probability Designs",
        "course_name": course_name,
        "cues": [
            {"timestamp": "05:20", "text": "Probability sampling guarantees each unit has a known non-zero probability."}
        ],
        "summaryMarkdown": "## Key Takeaways\nSampling error decreases with larger sample sizes and stratification."
    }

    mock_llm_reply = (
        "### 1. Conceptual Definition & Theoretical Foundations\n"
        "Sampling design is a fundamental pillar of empirical investigation [Sampling Techniques · 05:20]. "
        "Probability sampling ensures every unit has a non-zero probability of inclusion, enabling inferential statistics.\n\n"
        "### 2. Methodological Procedure & Design\n"
        "Researchers execute stratified random sampling by partitioning the target population into mutually exclusive strata.\n\n"
        "### 3. Concrete Research Example\n"
        "In a public health survey assessing vaccine efficacy across demographic cohorts, stratified sampling minimizes variance.\n\n"
        "### 4. Threats to Validity & Limitations\n"
        "Selection bias occurs if the sampling frame is incomplete. Non-response bias threatens external generalizability [Sampling Techniques · Summary]."
    )

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": mock_llm_reply
                }
            }
        ]
    }

    with patch("requests.post", return_value=mock_response) as mock_post, \
         patch("backend.algolia_service.algolia_service.search", side_effect=Exception("Offline")):
        res = pinecone_rag_engine.query_course_rag(
            query="Analyze probability vs non-probability sampling with design steps, research examples, and validity threats for 10 marks.",
            course_name=course_name
        )

        assert len(res["reply"]) > 200
        assert "Conceptual Definition" in res["reply"]
        assert "Threats to Validity" in res["reply"]
        assert len(res["citations"]) > 0

        # Verify the outgoing payload received system prompt and pre-fetched summaries
        sent_payload = mock_post.call_args[1]["json"]
        sent_messages = sent_payload["messages"]
        system_msg = sent_messages[0]["content"]
        assert "10-mark exam questions" in system_msg
        assert any("lecture summaries" in m["content"] or "cues" in m["content"] for m in sent_messages if m["role"] == "system")
