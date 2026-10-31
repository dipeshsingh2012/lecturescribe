"""
Interactive Assignment Studio Service for LectureScribe
-------------------------------------------------------
End-to-end co-creation pipeline for free-text problem statements & research prompts:
1. Ingests free-text question/prompt (for instructors or students).
2. Facilitates interactive scoping & discussion (left pane co-pilot).
3. Gathers triangulated course knowledge (lecture cues, summaries, slides).
4. Generates comprehensive, grounded first draft (right pane live preview).
5. Supports conversational iteration & direct manual edits.
6. Compiles publication-ready academic PDF with formulas, tables, and citations.
"""
from __future__ import annotations

import os
import io
import re
import sys
import json
import uuid
import time
import html
import logging
import datetime
import traceback
from typing import List, Dict, Any, Optional, Tuple

try:
    import requests
except ImportError:
    requests = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from backend.database import db_manager, to_course_slug
from backend.gcs_storage import gcs_storage_service
from backend.llm_router import llm_router, TaskType

logger = logging.getLogger("lecturescribe.assignment_studio")


# =====================================================================
# LLM CALL HELPER WITH ROUTER FAILOVER
# =====================================================================

def _call_studio_llm(
    system_prompt: str,
    user_prompt: str,
    task_type: TaskType = TaskType.ASSIGNMENT,
    json_mode: bool = False,
    max_tokens: int = 8192,
    preferred_model: Optional[str] = None
) -> str:
    """Call candidate LLMs from router with automatic provider failover, prioritizing user-selected model if provided."""
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    est_tokens = (len(system_prompt) + len(user_prompt)) // 4

    candidates = llm_router.get_candidate_models(task_type, est_tokens=est_tokens, preferred_model=preferred_model)

    for model_spec in candidates:
        model_name = model_spec.name

        # 1. Google Gemini via REST
        if model_spec.provider == "gemini" and gemini_key:
            try:
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                gen_config: Dict[str, Any] = {
                    "temperature": 0.25,
                    "maxOutputTokens": max_tokens
                }
                if json_mode:
                    gen_config["responseMimeType"] = "application/json"

                payload = {
                    "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": gen_config
                }
                resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=75)
                if resp.status_code == 200:
                    cand = (resp.json().get("candidates") or [{}])[0]
                    parts = (cand.get("content") or {}).get("parts") or []
                    raw = "".join(p.get("text", "") for p in parts).strip()
                    if raw:
                        llm_router.record_success(model_name)
                        return raw
                llm_router.record_error(model_name, resp.status_code, resp.text[:150])
            except Exception as e:
                llm_router.record_error(model_name, 500, str(e))
                logger.warning(f"[Studio LLM Gemini Notice] ({model_name}) error: {e}")

        # 2. Groq
        elif model_spec.provider == "groq" and groq_key:
            try:
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload: Dict[str, Any] = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.25,
                    "max_tokens": min(max_tokens, 4096)
                }
                if json_mode:
                    payload["response_format"] = {"type": "json_object"}

                resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=60)
                if resp.status_code == 200:
                    raw = resp.json()["choices"][0]["message"]["content"].strip()
                    if raw:
                        llm_router.record_success(model_name)
                        return raw
                llm_router.record_error(model_name, resp.status_code, resp.text[:150])
            except Exception as e:
                llm_router.record_error(model_name, 500, str(e))
                logger.warning(f"[Studio LLM Groq Notice] ({model_name}) error: {e}")

    # Fallback response if no active LLM keys in test or offline
    if json_mode:
        return json.dumps({
            "explanation": "Draft updated according to requested revisions.",
            "updated_draft": f"# Revised Document\n\n{user_prompt[:300]}"
        })
    return f"I have reviewed your request. Based on the course materials, here is the synthesis for:\n\n{user_prompt[:300]}"



# =====================================================================
# 1. COURSE KNOWLEDGE TRIANGULATION (CUES + SUMMARIES + SLIDES)
# =====================================================================

def gather_course_knowledge(
    course_name: str,
    query: str,
    user_email: Optional[str] = None,
    top_cues: int = 6
) -> Dict[str, Any]:
    """
    Search and aggregate three course knowledge sources:
    1. Transcript Cues with timestamps and lecture titles.
    2. Lecture Summaries & Course Summary.
    3. Slide notes & Course Resources.
    """
    cname = (course_name or "").strip()
    clean_query = (query or "").strip()
    citations = []
    cues_list = []
    summaries_list = []
    slides_list = []

    # 1. Transcript Cues via Pinecone / Algolia / PostgreSQL
    try:
        from backend.rag_engine import pinecone_rag_engine
        if pinecone_rag_engine and hasattr(pinecone_rag_engine, "execute_course_tool"):
            raw_cues_json, raw_citations = pinecone_rag_engine.execute_course_tool(
                "search_course_transcripts",
                {"query": clean_query, "top_k": top_cues},
                cname,
                user_email=user_email
            )
            parsed_cues = json.loads(raw_cues_json) if isinstance(raw_cues_json, str) else raw_cues_json
            if isinstance(parsed_cues, list):
                for item in parsed_cues:
                    ltitle = item.get("lecture_title") or "Course Lecture"
                    ts = item.get("timestamp") or "00:00"
                    txt = item.get("text") or ""
                    cues_list.append({
                        "lecture_title": ltitle,
                        "timestamp": ts,
                        "text": txt
                    })
            if raw_citations:
                citations.extend(raw_citations[:top_cues])
    except Exception as e:
        logger.warning(f"[Studio Knowledge Notice] Could not fetch cues via RAG engine: {e}")

    # Fallback to direct DB cues query if RAG engine returned few results
    if len(cues_list) < 2:
        try:
            conn = db_manager._get_connection()
            with conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT c.video_id, v.title as video_title, c.timestamp, c.text
                        FROM lecturescribe_transcript_cues c
                        JOIN lecturescribe_videos v ON c.video_id = v.video_id
                        WHERE (LOWER(v.course_name) ILIKE %s OR v.title ILIKE %s)
                          AND c.text ILIKE %s
                        LIMIT %s;
                    """, (f"%{cname.lower()}%", f"%{cname}%", f"%{clean_query[:50]}%", top_cues))
                    rows = cursor.fetchall() or []
                    for r in rows:
                        cues_list.append({
                            "lecture_title": r.get("video_title") or "Lecture",
                            "timestamp": r.get("timestamp") or "00:00",
                            "text": r.get("text") or ""
                        })
                        citations.append({
                            "video_id": r.get("video_id"),
                            "video_title": r.get("video_title") or "Lecture",
                            "timestamp": r.get("timestamp") or "00:00",
                            "text": r.get("text", "")[:120]
                        })
        except Exception as db_err:
            logger.warning(f"[Studio Knowledge Notice] DB cues query error: {db_err}")

    # 2. Lecture Summaries & Course Summary
    try:
        conn = db_manager._get_connection()
        with conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT s.video_id, v.title as video_title, s.markdown_text
                    FROM lecturescribe_lecture_summaries s
                    JOIN lecturescribe_videos v ON s.video_id = v.video_id
                    WHERE (LOWER(v.course_name) ILIKE %s OR v.title ILIKE %s)
                      AND LENGTH(TRIM(COALESCE(s.markdown_text, ''))) > 0
                    ORDER BY s.updated_at DESC
                    LIMIT 3;
                """, (f"%{cname.lower()}%", f"%{cname}%"))
                s_rows = cursor.fetchall() or []
                for sr in s_rows:
                    summaries_list.append({
                        "lecture_title": sr.get("video_title") or "Lecture",
                        "summary": (sr.get("markdown_text") or sr.get("summary_text") or "")[:500]
                    })
    except Exception as sum_err:
        logger.warning(f"[Studio Knowledge Notice] Summaries query error: {sum_err}")

    # 3. Slide Notes & Course Resources
    try:
        resources = db_manager.get_course_resources(cname) or []
        for res in resources[:5]:
            fname = res.get("filename") or res.get("title") or "Material"
            ftype = res.get("file_type") or "document"
            slides_list.append({
                "title": fname,
                "file_type": ftype
            })
    except Exception as res_err:
        logger.warning(f"[Studio Knowledge Notice] Resources query error: {res_err}")

    # Formatted Context String for the LLM
    context_lines = [f"### Course: {cname}"]
    if cues_list:
        context_lines.append("\n#### Transcript Cues from Course Lectures:")
        for idx, c in enumerate(cues_list[:6], 1):
            context_lines.append(f"{idx}. [{c['lecture_title']} @ {c['timestamp']}]: \"{c['text']}\"")
    if summaries_list:
        context_lines.append("\n#### Lecture Summaries:")
        for s in summaries_list[:2]:
            context_lines.append(f"- **{s['lecture_title']}**: {s['summary']}")
    if slides_list:
        context_lines.append("\n#### Course Slides & Resources on Record:")
        for sl in slides_list[:4]:
            context_lines.append(f"- {sl['title']} ({sl['file_type']})")

    return {
        "cues": cues_list,
        "summaries": summaries_list,
        "slides": slides_list,
        "citations": citations,
        "formatted_context": "\n".join(context_lines)
    }


# =====================================================================
# 2. START STUDIO SESSION (STEP 1 & STEP 2: PROMPT + SCOPING)
# =====================================================================

def start_studio_session(
    course_name: str,
    user_email: Optional[str],
    role: str,
    prompt: str,
    title: Optional[str] = None,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Initialize a new Assignment Studio session.
    1. Gathers initial course knowledge for the prompt.
    2. Co-Pilot analyzes the prompt, identifies grounded lecture cues, proposes an outline, and asks scoping questions.
    3. Persists session in database with status='discussing'.
    """
    clean_course = db_manager.resolve_course_canonical_name((course_name or "").strip())
    clean_prompt = (prompt or "").strip()
    clean_role = (role or "student").strip().lower()
    clean_email = (user_email or "").strip().lower() if user_email else None
    auto_title = (title or "").strip() or clean_prompt.split("\n")[0][:60].strip() or f"{clean_course} Assignment"
    session_id = f"asgn_studio_{uuid.uuid4().hex[:12]}"

    # Step 3 pre-fetch: Gather course knowledge
    knowledge = gather_course_knowledge(clean_course, clean_prompt, user_email=clean_email)
    context_str = knowledge["formatted_context"]
    citations = knowledge["citations"]

    system_prompt = (
        f"You are the LectureScribe Assignment Studio Co-Pilot, an expert academic advisor, researcher, and teaching assistant for {clean_course}. "
        f"A user ({clean_role}) has submitted an assignment problem statement, research topic, or essay prompt.\n\n"
        "YOUR OBJECTIVE IN THIS INITIAL DISCUSSION STEP:\n"
        "1. Warmly acknowledge and concisely synthesize what the problem statement/prompt requires.\n"
        "2. Explicitly cite the specific lecture sessions, transcript timestamps, or course slide topics found in course knowledge that will ground this work.\n"
        "3. Propose a clear, structured document outline (e.g., 1. Executive Summary / Problem Formulation, 2. Theoretical Framework & Derivations, 3. Comparative Analysis / Methodology, 4. Discussion & Implications).\n"
        "4. Ask 2-3 focused scoping questions to calibrate the draft (e.g. theoretical vs empirical depth, preferred mathematical notation, specific lecture concepts to emphasize).\n"
        "5. Conclude by letting the user know they can tweak this outline, answer the scoping questions, or say 'Generate First Draft' whenever they are ready to produce the full draft.\n\n"
        "Tone: Scholarly, encouraging, and collaborative. Use clean markdown formatting."
    )

    user_prompt = (
        f"User Role: {clean_role.capitalize()}\n"
        f"Problem Statement / Prompt:\n{clean_prompt}\n\n"
        f"Grounded Course Context:\n{context_str}\n\n"
        "Please provide your initial co-pilot analysis, course references, proposed outline, and scoping questions."
    )

    try:
        co_pilot_reply = _call_studio_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            task_type=TaskType.ASSIGNMENT,
            max_tokens=1400,
            preferred_model=model_name
        )
    except Exception as llm_err:
        logger.error(f"[Studio Start LLM Error]: {llm_err}")
        co_pilot_reply = (
            f"Welcome to the Assignment Studio for **{clean_course}**! I've ingested your prompt:\n\n"
            f"> *\"{clean_prompt[:200]}...\"*\n\n"
            f"Based on our course lectures and materials, I will help you research, structure, and synthesize a comprehensive document. "
            "Shall we proceed with a standard 4-part academic structure (Problem Formulation, Theoretical Analysis, Methodology, and Discussion), "
            "or do you have specific sections in mind? You can reply with adjustments or say **'Generate First Draft'** to begin drafting."
        )

    initial_chat = [
        {
            "role": "user",
            "content": clean_prompt,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
        },
        {
            "role": "assistant",
            "content": co_pilot_reply,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
    ]

    record = db_manager.create_studio_assignment(
        assignment_id=session_id,
        course_name=clean_course,
        user_email=clean_email,
        title=auto_title,
        problem_statement=clean_prompt,
        chat_history=initial_chat,
        citations=citations,
        draft_markdown="",
        status="discussing",
        selected_model=model_name
    )

    return {
        "status": "success",
        "session_id": session_id,
        "course_name": clean_course,
        "title": auto_title,
        "chat_history": initial_chat,
        "draft_markdown": "",
        "citations": citations,
        "selected_model": model_name,
        "record": record
    }


# =====================================================================
# 3. CHAT TURN & ITERATIVE DRAFT REFINEMENT (STEP 3 & STEP 4)
# =====================================================================

def is_draft_generation_intent(message: str) -> bool:
    """Detect if the user message signals readiness to produce the first draft."""
    if not message:
        return False
    lowered = message.lower().strip()

    # 1. Flexible regex patterns (handles "generate [the/a] [first] draft", "please draft [the] solution", etc.)
    regex_patterns = [
        r"(re-?generate|generate|produce|write|create|start|begin|make|synthesize)\s+(the\s+|a\s+|an\s+)?(first\s+)?(draft|document|paper|solution|assignment)",
        r"(draft|write|synthesize|re-?generate)\s+(it|the\s+solution|the\s+document|the\s+paper)",
        r"\b(let'?s\s+(draft|write|start|begin|generate))\b",
        r"\b(ready\s+(to|for)\s+(draft|write|generate))\b",
        r"\b(start\s+(drafting|writing))\b",
        r"\b(looks\s+good|proceed|go\s+ahead)\b",
        r"\b(re-?generate\s+from\s+scratch|start\s+over\s+from\s+scratch)\b",
    ]
    for pattern in regex_patterns:
        if re.search(pattern, lowered):
            return True

    # 2. String triggers list for direct and partial matches
    triggers = [
        "generate draft",
        "generate first draft",
        "generate the first draft",
        "generate the draft",
        "generate a draft",
        "regenerate draft",
        "regenerate the draft",
        "regenerate from scratch",
        "produce draft",
        "write draft",
        "create draft",
        "start draft",
        "proceed with draft",
        "looks good, proceed",
        "looks good proceed",
        "looks good",
        "proceed",
        "go ahead",
        "draft it",
        "generate it",
        "let's draft",
        "lets draft",
        "make the draft",
        "first draft",
        "full draft"
    ]
    return any(t in lowered for t in triggers)


def generate_first_draft(
    course_name: str,
    title: str,
    problem_statement: str,
    chat_history: List[Dict[str, Any]],
    course_context: str,
    model_name: Optional[str] = None
) -> str:
    """Synthesize a complete, rigorous, course-grounded academic first draft in Markdown + KaTeX."""
    system_prompt = (
        f"You are the Lead Academic Writer and Researcher for {course_name}. "
        "Your task is to write a comprehensive, rigorous, publication-grade academic document/solution draft "
        "based on the problem statement and discussion.\n\n"
        "STRICT GROUNDING & FORMATTING GUIDELINES:\n"
        "1. Academic Document Structure: Use Markdown headings (# Title, ## Section, ### Subsection). Include an Abstract / Overview, Theoretical Formulation, Detailed Exposition / Derivations, Practical Analysis / Examples, and Conclusion.\n"
        "2. Mathematical Rigor: Format all formulas using standard LaTeX math ($...$ inline, $$...$$ display equations). Show step-by-step mathematical logic and deductions.\n"
        "3. Course Grounding & Inline Citations: Integrate concepts taught in class, using inline academic citations pointing to the lectures, e.g. [Lecture 4, 18:30] or [Slide 12].\n"
        "4. Tables & Code: If comparing methods, architectures, or complexities, provide structured Markdown tables. If code is appropriate for demonstration, use clean, readable Python code blocks with comments.\n"
        "5. Tone: Scholarly, authentic, objective, and deeply grounded in course concepts. Do NOT include conversational meta-chatter ('Sure, here is your draft'). Output ONLY the document content in markdown."
    )

    discussion_summary = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in chat_history[-14:]])
    user_prompt = (
        f"Document Title: {title}\n"
        f"Course: {course_name}\n"
        f"Original Problem Statement:\n{problem_statement}\n\n"
        f"Discussion & Outline History:\n{discussion_summary}\n\n"
        f"Course Knowledge Base:\n{course_context}\n\n"
        "Generate the complete, exhaustive first draft in Markdown with LaTeX math."
    )

    draft = _call_studio_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        task_type=TaskType.ASSIGNMENT,
        max_tokens=8192,
        preferred_model=model_name
    )
    return draft.strip()


def refine_existing_draft(
    course_name: str,
    current_draft: str,
    user_feedback: str,
    course_context: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    model_name: Optional[str] = None
) -> Tuple[str, str]:
    """Iteratively revise the existing draft according to user critique and conversational history, returning (updated_draft, explanation)."""
    system_prompt = (
        f"You are the Lead Academic Editor, Co-Pilot, and Research Collaborator for {course_name}.\n"
        "The student is actively working on their assignment/research draft and providing ongoing feedback, adjustments, and corrections.\n\n"
        "CORE EDITING RULES:\n"
        "1. STRICT USER CONSTRAINT PRECEDENCE: The student's instructions, corrections, and scope guidelines ALWAYS override generic course templates. "
        "If the student instructs to remove sections (such as Python code, theoretical equations, or course lecture citations), completely eliminate them. "
        "If the student states specific institutional requirements (e.g. mentor name, 4-semester trajectory, first-semester scope, mentor communication cadence), strictly integrate them.\n"
        "2. FULL DIALOGUE AWARENESS: Maintain full continuity with the conversation history. Understand references like 'you have not updated' or 'remove formulas' in the context of prior messages.\n"
        "3. RIGOROUS & POLISHED REVISION: Produce a publication-grade, well-organized markdown document reflecting all cumulative feedback.\n"
        "4. OUTPUT FORMAT REQUIREMENTS:\n"
        "   Structure your response into two distinct, clearly tagged sections:\n\n"
        "   <explanation>\n"
        "   A natural, conversational response to the student summarizing what was changed, what was added (e.g. mentor communication cadence), "
        "   what was removed according to their instructions, and answering any specific questions or concerns they raised.\n"
        "   </explanation>\n\n"
        "   <updated_draft>\n"
        "   The complete, updated markdown document text.\n"
        "   </updated_draft>\n\n"
        "   (Alternatively, if returning JSON, provide an object with 'explanation' and 'updated_draft' keys)."
    )

    # Format dialogue history to provide complete context
    dialogue_lines = []
    if chat_history:
        for m in chat_history[-16:]:
            role = "STUDENT" if m.get("role") == "user" else "CO-PILOT"
            content = (m.get("content") or "").strip()
            # If a prior assistant response contains thousands of characters of raw draft, summarize to save tokens
            if role == "CO-PILOT" and len(content) > 400:
                content = content[:400] + "..."
            dialogue_lines.append(f"{role}: {content}")
    dialogue_history = "\n".join(dialogue_lines) if dialogue_lines else "No previous dialogue."

    user_prompt = (
        f"FULL CONVERSATION CONTEXT & CUMULATIVE CONSTRAINTS:\n"
        f"{dialogue_history}\n\n"
        f"LATEST STUDENT MESSAGE / EDIT REQUEST:\n"
        f"{user_feedback}\n\n"
        f"CURRENT DOCUMENT DRAFT TO REVISE:\n"
        f"{current_draft}\n\n"
        f"COURSE BACKGROUND (Reference only; student instructions take precedence):\n"
        f"{course_context}\n\n"
        "Please revise the document and provide your response with <explanation> and <updated_draft>."
    )

    try:
        raw_res = _call_studio_llm(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            task_type=TaskType.ASSIGNMENT,
            max_tokens=8192,
            preferred_model=model_name
        )

        res_str = raw_res.strip()

        # Check if response is JSON (either from test mocks or json-formatted output)
        if (res_str.startswith("{") and "updated_draft" in res_str) or '"updated_draft"' in res_str:
            try:
                clean_json = re.sub(r"^```(?:json)?\s*", "", res_str, flags=re.MULTILINE)
                clean_json = re.sub(r"\s*```$", "", clean_json, flags=re.MULTILINE)
                data = json.loads(clean_json, strict=False)
                if data.get("updated_draft"):
                    return data["updated_draft"].strip(), data.get("explanation", "I have updated the draft according to your feedback.")
            except Exception:
                pass

        # Tag-based extraction (<explanation> and <updated_draft>)
        expl_match = re.search(r"<explanation>(.*?)</explanation>", res_str, re.DOTALL | re.IGNORECASE)
        draft_match = re.search(r"<updated_draft>(.*?)</updated_draft>", res_str, re.DOTALL | re.IGNORECASE)

        if expl_match and draft_match:
            expl = expl_match.group(1).strip()
            updated = draft_match.group(1).strip()
            return updated, expl
        elif draft_match:
            updated = draft_match.group(1).strip()
            expl = re.sub(r"<updated_draft>.*?</updated_draft>", "", res_str, flags=re.DOTALL | re.IGNORECASE).strip()
            if not expl:
                expl = "I have revised the draft to address your latest feedback and conversation context."
            return updated, expl
        elif expl_match:
            expl = expl_match.group(1).strip()
            updated = re.sub(r"<explanation>.*?</explanation>", "", res_str, flags=re.DOTALL | re.IGNORECASE).strip()
            if not updated:
                updated = current_draft
            return updated, expl

        # If model returned markdown document directly with a conversational intro
        parts = res_str.split("\n\n", 1)
        if len(parts) == 2 and not parts[0].strip().startswith("#") and len(parts[0].strip()) < 500:
            return parts[1].strip(), parts[0].strip()

        return res_str, "I have updated your draft based on your latest instructions and conversation context."

    except Exception as e:
        logger.error(f"[Studio Refine Error]: {e}")
        return current_draft, f"I encountered an issue revising the draft ({str(e)[:100]}). Please try again."


def studio_chat_turn(
    session_id: str,
    course_name: str,
    user_message: str,
    user_email: Optional[str] = None,
    model_name: Optional[str] = None,
    action: Optional[str] = None
) -> Dict[str, Any]:
    """
    Handle one conversational turn in the Studio session.
    Routes between:
    - Step 3: Draft Generation (if requested)
    - Step 4: Iterative Refinement (if draft exists)
    - Step 2: Ongoing Discussion & Scoping (if still in planning)
    """
    clean_msg = (user_message or "").strip()
    record = db_manager.get_assignment_by_id(session_id)
    if not record:
        raise ValueError(f"Session with ID '{session_id}' not found.")

    cname = record.get("course_name") or course_name
    title = record.get("title") or "Assignment Studio"
    problem_statement = record.get("problem_statement") or ""
    current_draft = record.get("draft_markdown") or ""
    chat_history = record.get("chat_history") or []
    citations = record.get("citations") or []
    current_status = record.get("status") or "discussing"
    active_model = (model_name or "").strip() or record.get("selected_model") or None

    # Refresh course knowledge if needed
    knowledge = gather_course_knowledge(cname, f"{problem_statement} {clean_msg}", user_email=user_email)
    course_context = knowledge["formatted_context"]
    if knowledge["citations"]:
        citations = knowledge["citations"]

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    chat_history.append({
        "role": "user",
        "content": clean_msg,
        "timestamp": now_iso
    })

    is_draft_request = (action == "generate_draft") or is_draft_generation_intent(clean_msg)
    is_explicit_regenerate = bool(
        re.search(r"\b(re-?generate|start over|from scratch|brand new draft)\b", clean_msg.lower())
    )
    has_existing_draft = bool(current_draft and current_draft.strip())

    # Find the last complete assistant message in prior chat history (excluding the user msg just appended)
    last_complete_assistant_msg = None
    for msg in reversed(chat_history[:-1]):
        if msg.get("role") == "assistant":
            c = (msg.get("content") or "").strip()
            if c and not c.startswith("I encountered a temporary issue") and len(c) > 40:
                last_complete_assistant_msg = c
                break

    will_call_llm = True
    if is_draft_request and not is_explicit_regenerate and (has_existing_draft or last_complete_assistant_msg):
        will_call_llm = False

    # Persist user message immediately so in-flight progress is never lost across tab switches
    db_manager.update_studio_session(
        assignment_id=session_id,
        chat_history=chat_history,
        draft_markdown=current_draft,
        citations=citations,
        status="generating" if will_call_llm else current_status,
        selected_model=active_model
    )

    try:
        # Case A: User triggers First Draft Generation / Preview
        if is_draft_request:
            if not is_explicit_regenerate and has_existing_draft:
                logger.info(f"[Studio Chat] Reusing existing draft for {session_id} without re-triggering LLM")
                ai_reply = (
                    f"I have displayed your draft in the **Preview Pane** on the right.\n\n"
                    f"You can review the rendered document, make direct edits in 'Edit Raw' mode, or tell me what you'd like to refine "
                    f"(e.g., expand proofs, add diagrams, adjust tone, or include more examples), or click **'Compile to PDF'** when ready!"
                )
                current_status = "drafting"
            elif not is_explicit_regenerate and last_complete_assistant_msg:
                logger.info(f"[Studio Chat] Adopting last complete co-pilot response as draft for {session_id} without re-triggering LLM")
                current_draft = last_complete_assistant_msg
                ai_reply = (
                    f"I have loaded the complete co-pilot synthesis into your **First Draft** preview on the right pane.\n\n"
                    f"You can review the rendered document, make direct edits in 'Edit Raw' mode, or tell me what you'd like to refine "
                    f"(e.g., expand proofs, add diagrams, adjust tone, or include more examples), or click **'Compile to PDF'** when ready!"
                )
                current_status = "drafting"
            else:
                logger.info(f"[Studio Chat] Generating first draft via LLM for {session_id} using model {active_model}")
                new_draft = generate_first_draft(cname, title, problem_statement, chat_history, course_context, model_name=active_model)
                ai_reply = (
                    f"I have synthesized the **First Draft** of your document based on our discussion and grounded it in the "
                    f"course concepts from **{cname}**.\n\n"
                    f"You can review the rendered document on the right pane. Let me know what you'd like to refine "
                    f"(e.g., expand proofs, add diagrams, adjust tone, or include more examples), or click **'Compile to PDF'** "
                    f"when ready!"
                )
                current_draft = new_draft
                current_status = "drafting"

        # Case B: Draft already exists -> User is refining it (Step 4)
        elif current_draft.strip():
            logger.info(f"[Studio Chat] Refining existing draft for {session_id} using model {active_model}")
            updated_draft, explanation = refine_existing_draft(
                course_name=cname,
                current_draft=current_draft,
                user_feedback=clean_msg,
                course_context=course_context,
                chat_history=chat_history,
                model_name=active_model
            )
            current_draft = updated_draft
            ai_reply = explanation
            current_status = "refining"

        # Case C: Still in discussion/scoping phase (Step 2)
        else:
            logger.info(f"[Studio Chat] Continuing discussion for {session_id} using model {active_model}")
            system_prompt = (
                f"You are the LectureScribe Assignment Studio Co-Pilot for {cname}. "
                "You are discussing the problem statement, refining the outline, and answering questions before drafting.\n"
                "Keep the discussion focused, collaborative, and grounded in course concepts. "
                "Remind the user they can say 'Generate First Draft' at any time."
            )
            recent_history = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in chat_history[-14:]])
            ai_reply = _call_studio_llm(
                system_prompt=system_prompt,
                user_prompt=f"Recent Conversation:\n{recent_history}\n\nCourse Context:\n{course_context}\n\nRespond to the user's latest message:",
                task_type=TaskType.ASSIGNMENT,
                max_tokens=1000,
                preferred_model=active_model
            )
            current_status = "discussing"
    except Exception as llm_err:
        logger.error(f"[Studio Chat Turn Error]: {llm_err}")
        ai_reply = f"I encountered a temporary issue processing your request ({str(llm_err)[:120]}). Please click **'Preview'** or send your message again."
        current_status = "drafting" if current_draft.strip() else "discussing"

    chat_history.append({
        "role": "assistant",
        "content": ai_reply,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    })

    updated_record = db_manager.update_studio_session(
        assignment_id=session_id,
        chat_history=chat_history,
        draft_markdown=current_draft,
        citations=citations,
        status=current_status,
        selected_model=active_model
    )

    return {
        "status": "success",
        "session_id": session_id,
        "reply": ai_reply,
        "chat_history": chat_history,
        "draft_markdown": current_draft,
        "citations": citations,
        "selected_model": active_model,
        "studio_status": current_status,
        "record": updated_record
    }


def update_studio_draft(session_id: str, draft_markdown: str) -> Dict[str, Any]:
    """Save manual direct edits from 'Edit Raw' mode."""
    updated = db_manager.update_studio_session(
        assignment_id=session_id,
        draft_markdown=draft_markdown
    )
    return {
        "status": "success",
        "session_id": session_id,
        "draft_markdown": draft_markdown,
        "record": updated
    }


# =====================================================================
# 4. ACADEMIC PDF COMPILATION (STEP 5)
# =====================================================================

def render_academic_document_to_html(
    markdown_content: str,
    course_name: str,
    title: str,
    author: Optional[str] = None,
    citations: Optional[List[Dict[str, Any]]] = None
) -> str:
    """Render markdown + LaTeX math into a styled academic HTML document ready for PDF compilation."""
    author_display = (author or "Academic Researcher / Student").strip()
    date_display = datetime.date.today().strftime("%B %d, %Y")

    # Replace placeholder name if actual author name is known
    if author_display and author_display != "Academic Researcher / Student":
        markdown_content = re.sub(r"\[Your Name\]", author_display, markdown_content, flags=re.IGNORECASE)

    def format_inline(text: str) -> str:
        t = html.escape(text.strip())
        t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", t)
        t = re.sub(r"`([^`]+)`", r"<code class='inline-code'>\1</code>", t)

        # LaTeX subscripts and superscripts:
        # e.g. _{\text{lead}} -> <sub>lead</sub>, _{lead} -> <sub>lead</sub>, ^{2} -> <sup>2</sup>, \text{lead} -> lead
        t = re.sub(r"_\{?\\?text\{([^}]+)\}\}?", r"<sub>\1</sub>", t)
        t = re.sub(r"_\{([^}]+)\}", r"<sub>\1</sub>", t)
        t = re.sub(r"\^\{?\\?text\{([^}]+)\}\}?", r"<sup>\1</sup>", t)
        t = re.sub(r"\^\{([^}]+)\}", r"<sup>\1</sup>", t)
        t = re.sub(r"\\text\{([^}]+)\}", r"\1", t)

        # Math symbols & Greek letters
        t = t.replace(r"\Delta", "&Delta;").replace("Δ", "&Delta;")
        t = t.replace(r"\alpha", "&alpha;").replace(r"\beta", "&beta;").replace(r"\gamma", "&gamma;").replace(r"\sigma", "&sigma;")
        t = t.replace(r"\mu", "&mu;").replace(r"\theta", "&theta;").replace(r"\lambda", "&lambda;").replace(r"\omega", "&omega;")
        t = t.replace(r"\ge", "&ge;").replace(r"\le", "&le;").replace(r"\ne", "&ne;").replace(r"\approx", "&asymp;")
        t = t.replace(r"\times", "&times;").replace(r"\pm", "&plusmn;").replace(r"\cdot", "&sdot;")
        t = t.replace(r"\mathcal{O}", "&#119978;")

        # Display Math: $$ ... $$
        t = re.sub(r"\$\$(.*?)\$\$", r"<div class='math-display'>\1</div>", t)
        # Inline Math: $ ... $
        t = re.sub(r"\$([^\$]+)\$", r"<span class='math-inline'>\1</span>", t)
        return t

    # Simple markdown-to-HTML parser for standard academic blocks
    html_body = []
    lines = markdown_content.splitlines()
    in_code_block = False
    code_block_lines = []
    in_list = False
    in_table = False
    table_rows = []

    def close_open_tags():
        nonlocal in_list, in_table, table_rows
        out = []
        if in_list:
            out.append("</ul>")
            in_list = False
        if in_table:
            out.append("<table class='academic-table'>")
            for idx, r in enumerate(table_rows):
                out.append("<tr>")
                for cell in r:
                    tag = "th" if idx == 0 else "td"
                    out.append(f"<{tag}>{format_inline(cell)}</{tag}>")
                out.append("</tr>")
            out.append("</table>")
            in_table = False
            table_rows = []
        return out

    for line in lines:
        sline = line.strip()

        # Code block boundaries
        if sline.startswith("```"):
            if in_code_block:
                code_text = html.escape("\n".join(code_block_lines))
                html_body.append(f"<pre class='academic-code'><code>{code_text}</code></pre>")
                code_block_lines = []
                in_code_block = False
            else:
                html_body.extend(close_open_tags())
                in_code_block = True
                code_block_lines = []
            continue

        if in_code_block:
            code_block_lines.append(line)
            continue

        # Markdown tables
        if sline.startswith("|") and sline.endswith("|"):
            if not in_table:
                html_body.extend(close_open_tags())
                in_table = True
                table_rows = []
            # Skip separator line |---|---| or |:---|:---|
            if set(sline.replace("|", "").strip()) <= {"-", " ", ":"}:
                continue
            cells = [c for c in sline.split("|")[1:-1]]
            table_rows.append(cells)
            continue
        elif in_table:
            html_body.extend(close_open_tags())

        # Horizontal rules / section dividers (e.g. ---, ***, ___) -> Suppress from academic PDF
        if re.match(r"^([-*_]\s*){3,}$", sline):
            html_body.extend(close_open_tags())
            continue

        # Headings
        if sline.startswith("# "):
            html_body.extend(close_open_tags())
            html_body.append(f"<h1 class='doc-title'>{html.escape(sline[2:].strip())}</h1>")
        elif sline.startswith("## "):
            html_body.extend(close_open_tags())
            html_body.append(f"<h2 class='section-h2'>{html.escape(sline[3:].strip())}</h2>")
        elif sline.startswith("### "):
            html_body.extend(close_open_tags())
            html_body.append(f"<h3 class='section-h3'>{html.escape(sline[4:].strip())}</h3>")
        elif sline.startswith("- ") or sline.startswith("* "):
            if not in_list:
                html_body.extend(close_open_tags())
                html_body.append("<ul class='academic-list'>")
                in_list = True
            item_text = format_inline(sline[2:].strip())
            html_body.append(f"<li>{item_text}</li>")
        elif sline.startswith("> "):
            html_body.extend(close_open_tags())
            callout = format_inline(sline[2:].strip())
            html_body.append(f"<blockquote class='academic-quote'>{callout}</blockquote>")
        elif sline == "":
            html_body.extend(close_open_tags())
        else:
            html_body.extend(close_open_tags())
            para = format_inline(sline)
            html_body.append(f"<p class='academic-para'>{para}</p>")

    html_body.extend(close_open_tags())

    # Footnotes / Course Citations Section (only if markdown does not already have its own references)
    citations_html = ""
    has_own_references = bool(re.search(r"##?\s*references", markdown_content, re.IGNORECASE))
    if citations and not has_own_references:
        citations_html = """
        <div class='references-section'>
            <h2 class='section-h2'>Course References & Citations</h2>
            <ol class='references-list'>
        """
        for cit in citations[:8]:
            title_c = html.escape(cit.get("video_title") or "Lecture")
            ts_c = html.escape(cit.get("timestamp") or "00:00")
            txt_c = html.escape(cit.get("text") or "")
            citations_html += f"<li><strong>{title_c}</strong> (Timestamp: {ts_c}): <em>\"{txt_c[:140]}...\"</em></li>"
        citations_html += "</ol></div>"

    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{html.escape(title)}</title>
    <style>
        @page {{
            size: A4;
            margin: 22mm 20mm 24mm 20mm;
            @top-right {{
                content: "{html.escape(course_name)}";
                font-family: 'Times New Roman', Georgia, serif;
                font-size: 8.5pt;
                color: #64748b;
            }}
            @bottom-right {{
                content: "Page " counter(page) " of " counter(pages);
                font-family: 'Times New Roman', Georgia, serif;
                font-size: 8.5pt;
                color: #64748b;
            }}
        }}
        body {{
            font-family: 'Times New Roman', Times, 'Liberation Serif', Georgia, serif;
            font-size: 11pt;
            line-height: 1.6;
            color: #1e293b;
            margin: 0;
            padding: 0;
        }}
        .header-meta {{
            text-align: center;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
            margin-bottom: 24px;
        }}
        .header-course {{
            font-size: 12pt;
            font-weight: bold;
            color: #1e40af;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 6px;
        }}
        .header-title {{
            font-size: 20pt;
            font-weight: bold;
            color: #0f172a;
            margin: 6px 0;
            line-height: 1.25;
        }}
        .header-author {{
            font-size: 10.5pt;
            color: #475569;
            margin-top: 8px;
        }}
        .section-h2 {{
            font-size: 14pt;
            font-weight: bold;
            color: #0f172a;
            border-bottom: 1px solid #cbd5e1;
            padding-bottom: 4px;
            margin-top: 22px;
            margin-bottom: 10px;
            page-break-after: avoid;
        }}
        .section-h3 {{
            font-size: 12pt;
            font-weight: bold;
            color: #1e40af;
            margin-top: 16px;
            margin-bottom: 6px;
            page-break-after: avoid;
        }}
        .academic-para {{
            margin-bottom: 12px;
            text-align: justify;
        }}
        sub {{
            font-size: 75%;
            line-height: 0;
            position: relative;
            vertical-align: baseline;
            bottom: -0.25em;
        }}
        sup {{
            font-size: 75%;
            line-height: 0;
            position: relative;
            vertical-align: baseline;
            top: -0.5em;
        }}
        .math-display {{
            text-align: center;
            font-family: 'Cambria Math', 'Latin Modern Math', 'Times New Roman', serif;
            font-size: 12.5pt;
            background: #f8fafc;
            border-left: 3px solid #3b82f6;
            padding: 8px 14px;
            margin: 14px 0;
            overflow-x: auto;
        }}
        .math-inline {{
            font-family: 'Cambria Math', 'Latin Modern Math', 'Times New Roman', serif;
            font-style: italic;
        }}
        .academic-code {{
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 10px 14px;
            font-family: 'Courier New', Courier, monospace;
            font-size: 9pt;
            line-height: 1.4;
            color: #0f172a;
            overflow-x: auto;
            margin: 14px 0;
        }}
        .academic-table {{
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 10pt;
            page-break-inside: avoid;
            break-inside: avoid;
        }}
        .academic-table tr {{
            page-break-inside: avoid;
            break-inside: avoid;
        }}
        .academic-table th, .academic-table td {{
            border: 1px solid #cbd5e1;
            padding: 6px 10px;
            text-align: left;
        }}
        .academic-table th {{
            background-color: #f8fafc;
            font-weight: bold;
            color: #0f172a;
        }}
        .academic-quote {{
            border-left: 3px solid #64748b;
            margin: 12px 0;
            padding-left: 14px;
            font-style: italic;
            color: #334155;
        }}
        .references-section {{
            margin-top: 30px;
            padding-top: 14px;
            border-top: 2px solid #e2e8f0;
            page-break-inside: avoid;
        }}
        .references-list {{
            font-size: 9.5pt;
            color: #475569;
            padding-left: 20px;
        }}
        .references-list li {{
            margin-bottom: 6px;
        }}
    </style>
</head>
<body>
    <div class="header-meta">
        <div class="header-course">{html.escape(course_name)}</div>
        <div class="header-title">{html.escape(title)}</div>
        <div class="header-author">Author: <strong>{html.escape(author_display)}</strong></div>
    </div>

    {"".join(html_body)}

    {citations_html}
</body>
</html>
"""
    return full_html


def compile_studio_pdf(
    session_id: str,
    course_name: str,
    title: Optional[str] = None,
    author: Optional[str] = None,
    draft_markdown: Optional[str] = None
) -> Dict[str, Any]:
    """
    Compile the current studio draft markdown into an academic PDF, persist to GCS, and update status.
    """
    clean_course = db_manager.resolve_course_canonical_name((course_name or "").strip())
    slug = to_course_slug(clean_course)
    record = db_manager.get_assignment_by_id(session_id) or {}

    doc_title = (title or record.get("title") or "Academic Assignment Solution").strip()
    content_to_compile = (draft_markdown or record.get("draft_markdown") or "").strip()
    if not content_to_compile:
        content_to_compile = f"# {doc_title}\n\n*Draft in progress. No content recorded yet.*"

    citations = record.get("citations") or []
    author_name = author or record.get("user_email") or "Student / Researcher"

    # Render academic HTML
    html_doc = render_academic_document_to_html(
        markdown_content=content_to_compile,
        course_name=clean_course,
        title=doc_title,
        author=author_name,
        citations=citations
    )

    # Convert to PDF bytes via WeasyPrint or ReportLab fallback
    pdf_bytes = None
    try:
        import weasyprint
        pdf_bytes = weasyprint.HTML(string=html_doc).write_pdf()
    except Exception as wp_err:
        logger.warning(f"[Studio WeasyPrint Notice] WeasyPrint error: {wp_err}. Using ReportLab fallback.")

    if not pdf_bytes:
        # ReportLab fallback
        try:
            from reportlab.lib.pagesizes import letter
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib import colors

            buf = io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
            styles = getSampleStyleSheet()
            h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontSize=16, leading=20, textColor=colors.HexColor('#0f172a'))
            h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=12, leading=16, textColor=colors.HexColor('#1e40af'))
            p = ParagraphStyle('P', parent=styles['BodyText'], fontSize=10, leading=14, textColor=colors.HexColor('#1e293b'))

            story = [
                Paragraph(f"<b>{clean_course}</b>", h2),
                Paragraph(f"<b>{doc_title}</b>", h1),
                Paragraph(f"Author: {author_name}", p),
                Spacer(1, 14)
            ]
            for line in content_to_compile.splitlines():
                sline = line.strip()
                if sline.startswith("# "):
                    story.append(Paragraph(f"<b>{line[2:]}</b>", h1))
                elif sline.startswith("## "):
                    story.append(Paragraph(f"<b>{line[3:]}</b>", h2))
                elif re.match(r"^([-*_]\s*){3,}$", sline):
                    continue
                elif sline:
                    clean_l = format_inline(line)
                    story.append(Paragraph(clean_l, p))
                story.append(Spacer(1, 4))

            doc.build(story)
            pdf_bytes = buf.getvalue()
        except Exception as rl_err:
            logger.error(f"[Studio ReportLab Fallback Error]: {rl_err}")
            # Minimal PDF bytes fallback
            pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 712 Td (Academic Report) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000216 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n308\n%%EOF"

    # Persist PDF to GCS
    clean_filename = re.sub(r"[^\w\-]+", "_", doc_title.lower()) + ".pdf"
    pdf_blob = gcs_storage_service.get_assignment_blob_path(slug, session_id, clean_filename)
    try:
        gcs_storage_service.upload_blob_bytes(pdf_blob, pdf_bytes, content_type="application/pdf")
    except Exception as gcs_err:
        logger.warning(f"[Studio GCS Upload Notice]: {gcs_err}")

    # Update database record status to completed
    updated = db_manager.update_studio_session(
        assignment_id=session_id,
        pdf_blob_name=pdf_blob,
        status="completed",
        title=doc_title
    )

    return {
        "status": "completed",
        "session_id": session_id,
        "title": doc_title,
        "pdf_blob_name": pdf_blob,
        "pdf_filename": clean_filename,
        "pdf_url": f"/api/course/{slug}/assignments/{session_id}/download/pdf",
        "record": updated
    }
