"""
backend/calendar_ai_service.py

AI-Powered Academic Calendar Extraction Service for LectureScribe LMS
---------------------------------------------------------------------
1. Semester Exam / Syllabus PDF Date Extractor:
   - Extracts dates, exam timetables, assignment deadlines, and academic schedules from uploaded PDFs.
   - Combines layout-preserving pypdf extraction with Google Gemini Multimodal PDF Vision and Groq LLMs.
   - Maps extracted events to LectureScribe courses and categories ('exam', 'quiz', 'assignment', 'lab', 'lecture', 'schedule').
2. Lecture Transcript Calendar Event & Deadline Extractor:
   - Analyzes lecture transcript cues to detect verbal announcements of exams, quizzes, assignment deadlines, and rescheduled classes.
   - Resolves relative dates against the lecture's anchor date and links every calendar event to the exact video_id and cue timestamp.
"""
from __future__ import annotations

import os
import re
import io
import json
import uuid
import base64
import hashlib
import logging
import datetime
from zoneinfo import ZoneInfo
from typing import List, Dict, Any, Optional, Tuple

import requests

from backend.database import db_manager, to_course_slug, extract_course_name
from backend.calendar_parser import categorize_event, IST
from backend.llm_router import llm_router, TaskType
from backend.assignment_service import extract_text_from_pdf, _safe_json_loads
try:
    from backend.video_client import parse_timestamp_to_seconds
except ImportError:
    from video_client import parse_timestamp_to_seconds

logger = logging.getLogger("lecturescribe.calendar_ai_service")


def _cue_time_to_seconds(cue_time: str) -> int:
    """Convert 'MM:SS' or 'HH:MM:SS' timestamp string to integer seconds."""
    return int(parse_timestamp_to_seconds(cue_time))


def _build_ist_iso(
    date_iso: str,
    start_time_str: str = "09:00",
    end_time_str: str = "10:00",
    is_all_day: bool = False,
) -> Tuple[str, str, bool]:
    """Build IST-aware ISO start and end timestamps from YYYY-MM-DD and HH:MM strings."""
    now_ist = datetime.datetime.now(IST)
    try:
        dt_date = datetime.date.fromisoformat(str(date_iso).strip()[:10])
    except Exception:
        dt_date = now_ist.date() + datetime.timedelta(days=1)

    if is_all_day:
        start_dt = datetime.datetime.combine(dt_date, datetime.time.min, tzinfo=IST)
        end_dt = start_dt + datetime.timedelta(days=1)
        return start_dt.isoformat(), end_dt.isoformat(), True

    def _parse_hm(hm_str: str, default_h: int, default_m: int = 0) -> datetime.time:
        s = str(hm_str or "").strip().upper()
        if not s:
            return datetime.time(default_h, default_m)
        m = re.match(r"^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$", s)
        if m:
            hh = int(m.group(1))
            mm = int(m.group(2))
            ampm = m.group(3)
            if ampm == "PM" and hh < 12:
                hh += 12
            elif ampm == "AM" and hh == 12:
                hh = 0
            hh = max(0, min(23, hh))
            mm = max(0, min(59, mm))
            return datetime.time(hh, mm)
        return datetime.time(default_h, default_m)

    t_start = _parse_hm(start_time_str, 9, 0)
    t_end = _parse_hm(end_time_str, (t_start.hour + 1) % 24, t_start.minute)

    start_dt = datetime.datetime.combine(dt_date, t_start, tzinfo=IST)
    end_dt = datetime.datetime.combine(dt_date, t_end, tzinfo=IST)
    if end_dt <= start_dt:
        end_dt = start_dt + datetime.timedelta(hours=1)

    return start_dt.isoformat(), end_dt.isoformat(), False


def _match_course_from_text(
    raw_course: str,
    title: str,
    known_courses: List[str],
    default_course: Optional[str] = None,
) -> Tuple[str, str]:
    """Match an event's course against known LectureScribe courses or return cleaned course name + slug."""
    if default_course and default_course.strip():
        resolved = db_manager.resolve_course_canonical_name(default_course.strip())
        return resolved, to_course_slug(resolved)

    cand = (raw_course or "").strip()
    combined = f"{cand} {title}".lower()

    for kc in known_courses or []:
        kc_clean = kc.strip()
        if not kc_clean:
            continue
        kc_lower = kc_clean.lower()
        kc_slug = to_course_slug(kc_clean)
        if kc_lower in combined or (kc_slug and kc_slug.replace("-", " ") in combined):
            return kc_clean, kc_slug

    if cand:
        resolved = db_manager.resolve_course_canonical_name(cand)
        return resolved, to_course_slug(resolved)

    return "", ""


def _deterministic_pdf_fallback_extract(
    text: str,
    filename: str = "schedule.pdf",
    default_course: Optional[str] = None,
    known_courses: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fallback regex/table extractor when LLM keys are unavailable or offline.
    Scans lines for ISO dates (YYYY-MM-DD), DD-MM-YYYY, DD/MM/YYYY, or 'Month DD, YYYY'.
    """
    events: List[Dict[str, Any]] = []
    if not text:
        return events

    month_map = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    current_year = datetime.datetime.now(IST).year
    current_page = 1

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        page_m = re.match(r"^---\s*Page\s+(\d+)\s*---$", line, re.IGNORECASE)
        if page_m:
            current_page = int(page_m.group(1))
            continue

        date_iso: Optional[str] = None
        # 1. YYYY-MM-DD
        m_iso = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", line)
        if m_iso:
            try:
                d = datetime.date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
                date_iso = d.isoformat()
            except Exception:
                pass

        # 2. DD-MM-YYYY or DD/MM/YYYY
        if not date_iso:
            m_dmy = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b", line)
            if m_dmy:
                try:
                    d = datetime.date(int(m_dmy.group(3)), int(m_dmy.group(2)), int(m_dmy.group(1)))
                    date_iso = d.isoformat()
                except Exception:
                    pass

        # 3. Month DD, YYYY or DD Month YYYY
        if not date_iso:
            m_named = re.search(
                r"\b(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?"
                r"|(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:,?\s*(20\d{2}))?)\b",
                line,
                re.IGNORECASE,
            )
            if m_named:
                try:
                    if m_named.group(1):
                        mon = month_map[m_named.group(1)[:3].lower()]
                        day = int(m_named.group(2))
                        yr = int(m_named.group(3) or current_year)
                    else:
                        day = int(m_named.group(4))
                        mon = month_map[m_named.group(5)[:3].lower()]
                        yr = int(m_named.group(6) or current_year)
                    date_iso = datetime.date(yr, mon, day).isoformat()
                except Exception:
                    pass

        if not date_iso:
            continue

        # Extract optional time range e.g. 09:30 AM - 12:30 PM or 14:00 - 17:00
        start_t = "09:30"
        end_t = "12:30"
        m_time = re.search(
            r"(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*(?:-|to|–)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)",
            line,
            re.IGNORECASE,
        )
        if m_time:
            start_t = m_time.group(1).strip()
            end_t = m_time.group(2).strip()

        # Clean line to build title
        cleaned_title = re.sub(r"\s{2,}", " | ", line).strip(" |-")
        if len(cleaned_title) < 4:
            continue

        category = categorize_event(cleaned_title, filename)
        if category == "schedule" and "exam" in filename.lower():
            category = "exam"

        c_name, c_slug = _match_course_from_text("", cleaned_title, known_courses or [], default_course)

        events.append({
            "title": cleaned_title[:200],
            "description": f"Extracted from {filename} (Page {current_page})",
            "category": category,
            "date_iso": date_iso,
            "start_time": start_t,
            "end_time": end_t,
            "is_all_day": False,
            "location": "",
            "course_name": c_name,
            "course_slug": c_slug,
            "page_number": current_page,
            "raw_quote": line,
            "confidence": 0.82,
        })

    return events


def extract_calendar_events_from_pdf(
    pdf_bytes: bytes,
    filename: str = "Semester_Exam_Schedule.pdf",
    course_name: Optional[str] = None,
    event_scope: Optional[str] = None,
    created_by_email: str = "",
    auto_save: bool = False,
    approval_status: str = "approved",
) -> List[Dict[str, Any]]:
    """
    Extract structured academic calendar events from an uploaded Exam Timetable or Syllabus PDF.
    Supports both layout-preserved text extraction and Gemini multimodal PDF vision.
    """
    if not pdf_bytes:
        return []

    extracted_text = extract_text_from_pdf(pdf_bytes)
    known_courses: List[str] = []
    try:
        known_courses = db_manager.get_all_distinct_courses() if hasattr(db_manager, "get_all_distinct_courses") else []
    except Exception:
        known_courses = []

    current_year = datetime.datetime.now(IST).year
    courses_hint = ", ".join(known_courses[:30]) if known_courses else "None specified"

    system_prompt = (
        "You are LectureScribe AI Academic Calendar & Exam Timetable Extractor.\n"
        "Analyze the provided semester exam timetable, syllabus, or academic schedule PDF and extract every "
        "exam, quiz, assignment deadline, lab evaluation, lecture, or academic milestone.\n\n"
        "STRICT EXTRACTION RULES:\n"
        "1. Extract each event into a JSON object with these exact keys:\n"
        "   - 'title': Concise, descriptive event title (e.g., 'End-Semester Exam: Machine Learning (CS301)')\n"
        "   - 'description': Additional details (syllabus coverage, instructions, seating, weightage)\n"
        "   - 'category': One of ['exam', 'quiz', 'assignment', 'lab', 'lecture', 'schedule']\n"
        f"   - 'date_iso': Exact date in 'YYYY-MM-DD' format (default year {current_year} if omitted)\n"
        "   - 'start_time': Start time in 24-hour 'HH:MM' or 'HH:MM AM/PM' format (default '09:30' for exams, '23:59' for assignment deadlines)\n"
        "   - 'end_time': End time in 24-hour 'HH:MM' or 'HH:MM AM/PM' format (default '12:30' for exams)\n"
        "   - 'is_all_day': Boolean (true only if no specific time window applies)\n"
        "   - 'location': Room, hall, venue, or online platform if mentioned (else '')\n"
        "   - 'course_name': Matched course name from the document or from Known Courses\n"
        "   - 'page_number': Integer page number where the event appears (default 1)\n"
        "   - 'raw_quote': The exact row or sentence from the PDF\n"
        "   - 'confidence': Float between 0.5 and 1.0\n"
        f"2. Known Courses in LMS: [{courses_hint}]. Map to the closest known course name when applicable.\n"
        "3. Output MUST be a valid JSON array of event objects. Do not wrap in markdown or prose."
    )

    user_prompt = (
        f"Document Filename: {filename}\n"
        f"Target Course Filter: {course_name or 'All Courses / Semester Schedule'}\n\n"
        f"Extracted PDF Text Content:\n{extracted_text[:28000]}\n\n"
        "Return JSON array of calendar events:"
    )

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()

    raw_items: List[Dict[str, Any]] = []

    if gemini_key or groq_key:
        est_tokens = max(500, (len(system_prompt) + len(user_prompt)) // 4)
        candidates = llm_router.get_candidate_models(TaskType.QUIZ, est_tokens=est_tokens)

        for model_spec in candidates:
            model_name = model_spec.name
            if model_spec.provider == "gemini" and gemini_key:
                try:
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    user_parts: List[Dict[str, Any]] = [{"text": user_prompt}]
                    # Attach raw PDF for multimodal vision when text extraction is sparse or table-heavy (< 6MB)
                    if model_spec.supports_multimodal and len(pdf_bytes) < 6 * 1024 * 1024 and len(extracted_text.strip()) < 500:
                        user_parts.insert(
                            0,
                            {
                                "inlineData": {
                                    "mimeType": "application/pdf",
                                    "data": base64.b64encode(pdf_bytes).decode("utf-8"),
                                }
                            },
                        )

                    payload = {
                        "contents": [{"role": "user", "parts": user_parts}],
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": {
                            "temperature": 0.1,
                            "responseMimeType": "application/json",
                            "maxOutputTokens": 4096,
                        },
                    }
                    resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=50)
                    if resp.status_code == 200:
                        cand = (resp.json().get("candidates") or [{}])[0]
                        parts = (cand.get("content") or {}).get("parts") or []
                        raw_str = "".join(p.get("text", "") for p in parts).strip()
                        parsed = _safe_json_loads(raw_str)
                        if isinstance(parsed, dict) and "events" in parsed:
                            parsed = parsed["events"]
                        if isinstance(parsed, list):
                            llm_router.record_success(model_name)
                            raw_items = parsed
                            break
                    llm_router.record_error(model_name, resp.status_code, resp.text[:150])
                except Exception as e:
                    llm_router.record_error(model_name, 500, str(e))
                    logger.warning(f"[Calendar PDF Gemini Notice] ({model_name}): {e}")

            elif model_spec.provider == "groq" and groq_key and len(extracted_text.strip()) > 20:
                try:
                    headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt[:18000]},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 3000,
                    }
                    resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=45)
                    if resp.status_code == 200:
                        raw_str = resp.json()["choices"][0]["message"]["content"].strip()
                        parsed = _safe_json_loads(raw_str)
                        if isinstance(parsed, dict) and "events" in parsed:
                            parsed = parsed["events"]
                        if isinstance(parsed, list):
                            llm_router.record_success(model_name)
                            raw_items = parsed
                            break
                    llm_router.record_error(model_name, resp.status_code, resp.text[:150])
                except Exception as e:
                    llm_router.record_error(model_name, 500, str(e))
                    logger.warning(f"[Calendar PDF Groq Notice] ({model_name}): {e}")

    if not raw_items:
        raw_items = _deterministic_pdf_fallback_extract(
            extracted_text,
            filename=filename,
            default_course=course_name,
            known_courses=known_courses,
        )

    normalized_events: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        date_iso = str(item.get("date_iso") or item.get("date") or "").strip()
        if not title or not date_iso:
            continue

        is_all_day = bool(item.get("is_all_day", False))
        start_iso, end_iso, is_all_day = _build_ist_iso(
            date_iso=date_iso,
            start_time_str=str(item.get("start_time") or "09:30"),
            end_time_str=str(item.get("end_time") or "12:30"),
            is_all_day=is_all_day,
        )

        raw_cat = str(item.get("category") or "").strip().lower()
        if raw_cat not in ("exam", "quiz", "assignment", "lab", "lecture", "schedule"):
            raw_cat = categorize_event(title, str(item.get("description") or ""))

        matched_course, matched_slug = _match_course_from_text(
            str(item.get("course_name") or ""),
            title,
            known_courses,
            default_course=course_name,
        )

        resolved_scope = event_scope or ("course" if matched_slug else "site")
        dedup_seed = f"pdf:{filename}:{title.lower()}:{date_iso}:{idx}"
        event_id = f"cal_pdf_{hashlib.sha1(dedup_seed.encode('utf-8')).hexdigest()[:14]}"

        ev_record = db_manager._format_calendar_event_record({
            "id": event_id,
            "title": title,
            "description": str(item.get("description") or "").strip(),
            "category": raw_cat,
            "event_scope": resolved_scope,
            "course_slug": matched_slug,
            "course_name": matched_course,
            "created_by_email": created_by_email,
            "start_time": start_iso,
            "end_time": end_iso,
            "is_all_day": is_all_day,
            "location": str(item.get("location") or "").strip(),
            "source_type": "pdf_ai",
            "approval_status": approval_status,
            "ai_confidence": float(item.get("confidence") or 0.9),
            "source_metadata": {
                "pdf_filename": filename,
                "page_number": int(item.get("page_number") or 1),
                "raw_quote": str(item.get("raw_quote") or "").strip(),
            },
        })
        normalized_events.append(ev_record)

    if auto_save and normalized_events:
        db_manager.save_calendar_events(normalized_events)

    return normalized_events


def extract_calendar_events_from_transcript(
    video_id: str,
    title: str,
    cues: List[Dict[str, Any]],
    course_name: Optional[str] = None,
    anchor_date: Optional[str] = None,
    created_by_email: str = "",
    auto_save: bool = True,
    approval_status: str = "approved",
) -> List[Dict[str, Any]]:
    """
    Analyze lecture transcript cues via LLM to extract announced exams, quizzes,
    assignment deadlines, lab evaluations, and class schedule changes.
    Links each calendar event directly to the video_id and cue timestamp.
    """
    if not cues or not isinstance(cues, list):
        return []

    resolved_course = (course_name or "").strip()
    if not resolved_course:
        saved_vid = db_manager.get_saved_video(video_id)
        if saved_vid and saved_vid.get("course_name"):
            resolved_course = str(saved_vid["course_name"]).strip()
    if not resolved_course:
        resolved_course = extract_course_name(title).strip()
    if resolved_course:
        resolved_course = db_manager.resolve_course_canonical_name(resolved_course)
    course_slug = to_course_slug(resolved_course)

    now_ist = datetime.datetime.now(IST)
    ref_date = anchor_date or now_ist.strftime("%Y-%m-%d")

    # Sample cues preserving timestamp order
    max_cues = 400
    sampled_cues = cues if len(cues) <= max_cues else cues[:: max(1, len(cues) // max_cues)][:max_cues]
    cues_text = "\n".join(
        f"[{c.get('time') or c.get('timestamp') or '00:00'}] {c.get('text', '')}"
        for c in sampled_cues
        if c.get("text")
    )
    if not cues_text.strip():
        return []

    system_prompt = (
        "You are LectureScribe AI. Analyze the professor's lecture transcript cues to extract any "
        "verbal announcements about upcoming exams, quizzes, tests, assignment deadlines, project submissions, "
        "vivas, lab evaluations, or rescheduled/extra lecture sessions.\n\n"
        "STRICT INSTRUCTIONS:\n"
        f"1. Reference / Lecture Anchor Date: {ref_date} (Asia/Kolkata). Resolve relative expressions "
        "like 'next Friday', 'this Thursday', 'tomorrow', 'in 2 weeks' relative to this anchor date.\n"
        "2. For each announced event, return a JSON object with:\n"
        "   - 'title': Clear title (e.g., 'Quiz 2: Support Vector Machines', 'Assignment 3 Submission Deadline')\n"
        "   - 'description': Brief summary of what the professor announced\n"
        "   - 'category': One of ['exam', 'quiz', 'assignment', 'lab', 'lecture', 'schedule']\n"
        "   - 'predicted_date': Human-readable date phrase spoken (e.g., 'Friday, Nov 6th at 11:59 PM')\n"
        "   - 'date_iso': Resolved ISO date 'YYYY-MM-DD'\n"
        "   - 'start_time': 'HH:MM' in 24-hour format (default '10:00' for quizzes/exams, '23:59' for assignments)\n"
        "   - 'end_time': 'HH:MM' in 24-hour format (default '11:00')\n"
        "   - 'cue_time': Exact transcript timestamp '[MM:SS]' where the announcement occurred\n"
        "   - 'cue_text': The professor's exact spoken sentence(s)\n"
        "   - 'confidence': Float between 0.5 and 1.0\n"
        "3. If no dates, deadlines, or assessments are announced, return [].\n"
        "4. Output MUST be a valid JSON array of objects only."
    )

    user_prompt = (
        f"Course: {resolved_course or 'General Course'}\n"
        f"Lecture Title: {title}\n"
        f"Video ID: {video_id}\n\n"
        f"Transcript Cues:\n{cues_text}\n\n"
        "JSON output:"
    )

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    raw_items: List[Dict[str, Any]] = []

    if gemini_key or groq_key:
        est_tokens = max(400, (len(system_prompt) + len(user_prompt)) // 4)
        candidates = llm_router.get_candidate_models(TaskType.QUIZ, est_tokens=est_tokens)
        for model_spec in candidates:
            model_name = model_spec.name
            if model_spec.provider == "gemini" and gemini_key:
                try:
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": {
                            "temperature": 0.1,
                            "responseMimeType": "application/json",
                            "maxOutputTokens": 2048,
                        },
                    }
                    resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=45)
                    if resp.status_code == 200:
                        cand = (resp.json().get("candidates") or [{}])[0]
                        parts = (cand.get("content") or {}).get("parts") or []
                        raw_str = "".join(p.get("text", "") for p in parts).strip()
                        parsed = _safe_json_loads(raw_str)
                        if isinstance(parsed, list):
                            llm_router.record_success(model_name)
                            raw_items = parsed
                            break
                    llm_router.record_error(model_name, resp.status_code, resp.text[:150])
                except Exception as e:
                    llm_router.record_error(model_name, 500, str(e))
                    logger.warning(f"[Transcript Calendar Gemini Notice] ({model_name}): {e}")

            elif model_spec.provider == "groq" and groq_key:
                try:
                    headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt[:18000]},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 2048,
                    }
                    resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=45)
                    if resp.status_code == 200:
                        raw_str = resp.json()["choices"][0]["message"]["content"].strip()
                        parsed = _safe_json_loads(raw_str)
                        if isinstance(parsed, list):
                            llm_router.record_success(model_name)
                            raw_items = parsed
                            break
                    llm_router.record_error(model_name, resp.status_code, resp.text[:150])
                except Exception as e:
                    llm_router.record_error(model_name, 500, str(e))
                    logger.warning(f"[Transcript Calendar Groq Notice] ({model_name}): {e}")

    normalized_events: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        ev_title = str(item.get("title") or item.get("quiz_title") or "").strip()
        date_iso = str(item.get("date_iso") or item.get("predicted_date_iso") or "").strip()
        if not ev_title:
            continue
        if not date_iso or not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso[:10]):
            date_iso = (now_ist.date() + datetime.timedelta(days=3)).isoformat()

        cue_time = str(item.get("cue_time") or "00:00").replace("[", "").replace("]", "").strip()
        cue_text = str(item.get("cue_text") or "").strip()
        raw_cat = str(item.get("category") or "").strip().lower()
        if raw_cat not in ("exam", "quiz", "assignment", "lab", "lecture", "schedule"):
            raw_cat = categorize_event(ev_title, cue_text)

        start_iso, end_iso, is_all_day = _build_ist_iso(
            date_iso=date_iso,
            start_time_str=str(item.get("start_time") or ("23:00" if raw_cat == "assignment" else "10:00")),
            end_time_str=str(item.get("end_time") or ("23:59" if raw_cat == "assignment" else "11:00")),
            is_all_day=False,
        )

        dedup_seed = f"tr:{video_id}:{ev_title.lower()}:{date_iso}:{cue_time}"
        event_id = f"cal_tr_{hashlib.sha1(dedup_seed.encode('utf-8')).hexdigest()[:14]}"

        ev_record = db_manager._format_calendar_event_record({
            "id": event_id,
            "title": ev_title,
            "description": str(item.get("description") or f"Announced in {title} at [{cue_time}]: \"{cue_text}\"").strip(),
            "category": raw_cat,
            "event_scope": "course" if course_slug else "site",
            "course_slug": course_slug,
            "course_name": resolved_course,
            "created_by_email": created_by_email,
            "start_time": start_iso,
            "end_time": end_iso,
            "is_all_day": is_all_day,
            "location": str(item.get("location") or "").strip(),
            "source_type": "transcript_ai",
            "approval_status": approval_status,
            "ai_confidence": float(item.get("confidence") or 0.85),
            "source_metadata": {
                "video_id": video_id,
                "lecture_title": title,
                "cue_time": cue_time,
                "timestamp_sec": _cue_time_to_seconds(cue_time),
                "cue_text": cue_text,
                "predicted_date_phrase": str(item.get("predicted_date") or date_iso),
            },
        })
        normalized_events.append(ev_record)

    if auto_save and normalized_events:
        db_manager.save_calendar_events(normalized_events)

    return normalized_events


def sync_predicted_quizzes_to_calendar(
    video_id: str,
    course_slug: str,
    course_name: str,
    lecture_title: str,
    predictions: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Bridge predicted quizzes from `predict_and_store_quizzes` directly into
    `lecturescribe_calendar_events` so background lecture ingestion populates the calendar.
    """
    if not predictions:
        return []

    now_ist = datetime.datetime.now(IST)
    cal_events: List[Dict[str, Any]] = []
    for pq in predictions:
        if not isinstance(pq, dict):
            continue
        q_title = str(pq.get("quiz_title") or pq.get("quizTitle") or "Upcoming Quiz").strip()
        date_iso = str(pq.get("predicted_date_iso") or pq.get("predictedDateIso") or "").strip()
        if not date_iso or not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso[:10]):
            date_iso = (now_ist.date() + datetime.timedelta(days=3)).isoformat()

        cue_time = str(pq.get("cue_time") or pq.get("cueTime") or "00:00").replace("[", "").replace("]", "").strip()
        cue_text = str(pq.get("cue_text") or pq.get("cueText") or "").strip()
        cat = categorize_event(q_title, cue_text)
        if cat == "schedule":
            cat = "quiz"

        start_iso, end_iso, _ = _build_ist_iso(date_iso, "10:00", "11:00", False)
        pq_id = str(pq.get("id") or f"cal_tr_{uuid.uuid4().hex[:10]}")
        cal_id = pq_id if pq_id.startswith("cal_") else f"cal_tr_{pq_id}"

        cal_events.append(
            db_manager._format_calendar_event_record({
                "id": cal_id,
                "title": q_title,
                "description": f"Announced in {lecture_title} at [{cue_time}]: \"{cue_text}\"",
                "category": cat,
                "event_scope": "course" if course_slug else "site",
                "course_slug": course_slug,
                "course_name": course_name,
                "start_time": start_iso,
                "end_time": end_iso,
                "is_all_day": False,
                "location": "",
                "source_type": "transcript_ai",
                "approval_status": "approved",
                "ai_confidence": float(pq.get("confidence") or 0.85),
                "source_metadata": {
                    "video_id": video_id,
                    "lecture_title": lecture_title,
                    "cue_time": cue_time,
                    "timestamp_sec": _cue_time_to_seconds(cue_time),
                    "cue_text": cue_text,
                    "predicted_date_phrase": str(pq.get("predicted_date") or date_iso),
                },
            })
        )

    if cal_events:
        return db_manager.save_calendar_events(cal_events)
    return []

