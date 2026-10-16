"""
backend/quiz_predictor.py

Server-side LLM-based Quiz & Exam Date Predictor.
Analyzes lecture transcript cues strictly via LLM (Gemini / Groq via llm_router)
during summary ingestion to predict upcoming quizzes, announced dates, and deadlines.
Zero manual regex, zero heuristics, zero manual NLP.
"""
from __future__ import annotations

import os
import re
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from backend.llm_router import llm_router, TaskType

logger = logging.getLogger("lecturescribe.quiz_predictor")


def predict_quizzes_from_cues(
    cues: List[Dict[str, Any]],
    title: str = "Video Lecture",
    video_id: str = "",
    lecture_title: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Predict upcoming quizzes, tests, exams, and their announced dates from lecture cues.
    Strictly powered by LLM during summary ingestion server-side.
    """
    actual_title = (lecture_title or title or "Video Lecture").strip()
    if not cues or not isinstance(cues, list):
        return []

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    groq_key = os.getenv("GROQ_API_KEY", "")
    if not (groq_key or gemini_key):
        logger.warning("[Quiz Predictor] No GEMINI_API_KEY or GROQ_API_KEY configured. Skipping LLM quiz prediction.")
        return []

    # Prepare transcript excerpt for the LLM
    # Downsample if overly large while preserving chronological order
    max_cues = 400
    if len(cues) <= max_cues:
        sampled_cues = cues
    else:
        step = max(1, len(cues) // max_cues)
        sampled_cues = cues[::step][:max_cues]

    cues_text = "\n".join([f"[{c.get('time', '00:00')}] {c.get('text', '')}" for c in sampled_cues if c.get('text')])
    if not cues_text.strip():
        return []

    current_year = datetime.now(timezone.utc).year

    system_prompt = (
        "You are LectureScribe AI. You analyze professor/instructor lecture transcripts to identify "
        "any verbal announcements regarding upcoming quizzes, tests, midterms, finals, or graded assessments.\n\n"
        "STRICT INSTRUCTIONS:\n"
        "1. Extract ONLY legitimate quiz/test/exam announcements spoken by the professor in the transcript.\n"
        "2. For each announcement, extract:\n"
        "   - 'quiz_title': clear title (e.g., 'Quiz 1: Dynamic Programming', 'Midterm Exam')\n"
        "   - 'predicted_date': the exact date or day phrase announced by the speaker (e.g., 'Next Friday, Oct 24th', 'Next Tuesday at 10 AM')\n"
        f"   - 'predicted_date_iso': ISO format date string (YYYY-MM-DD), resolving relative references to the context year {current_year}\n"
        "   - 'confidence': confidence score between 0.0 and 1.0\n"
        "   - 'cue_time': timestamp from the transcript where the announcement was made (e.g., '14:22')\n"
        "   - 'cue_text': the professor's exact spoken words announcing the quiz\n"
        "3. If no quizzes or tests are mentioned in the transcript, return an empty array [].\n"
        "4. Output MUST be a valid JSON array of objects with keys 'quiz_title', 'predicted_date', 'predicted_date_iso', 'confidence', 'cue_time', 'cue_text'. Do not include markdown or explanatory text."
    )

    user_prompt = f"Lecture Title: {actual_title}\nVideo ID: {video_id}\n\nTranscript Cues:\n{cues_text}\n\nJSON output:"
    est_tokens = (len(system_prompt) + len(user_prompt)) // 4

    candidates = llm_router.get_candidate_models(TaskType.QUIZ, est_tokens=est_tokens)
    for model_spec in candidates:
        model_name = model_spec.name
        # 1. Google Gemini via REST
        if model_spec.provider == "gemini" and gemini_key:
            try:
                import requests
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": {
                        "temperature": 0.1,
                        "responseMimeType": "application/json",
                        "maxOutputTokens": 2048
                    }
                }
                resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=45)
                if resp.status_code == 200:
                    cand = (resp.json().get("candidates") or [{}])[0]
                    parts = (cand.get("content") or {}).get("parts") or []
                    raw = "".join(p.get("text", "") for p in parts).strip()
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)
                    data = json.loads(raw)
                    if isinstance(data, list):
                        llm_router.record_success(model_name)
                        return _normalize_predictions(data, video_id)
                llm_router.record_error(model_name, resp.status_code, resp.text[:150])
            except Exception as e:
                llm_router.record_error(model_name, 500, str(e))
                logger.warning(f"[Quiz Predictor Gemini Notice] ({model_name}) Skipped: {e}")

        # 2. Groq via OpenAI-compatible endpoint
        elif model_spec.provider == "groq" and groq_key:
            try:
                import requests
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 2000
                }
                resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=45)
                if resp.status_code == 200:
                    raw = resp.json()["choices"][0]["message"]["content"].strip()
                    raw = re.sub(r"^```(?:json)?\s*", "", raw)
                    raw = re.sub(r"\s*```$", "", raw)
                    data = json.loads(raw)
                    if isinstance(data, list):
                        llm_router.record_success(model_name)
                        return _normalize_predictions(data, video_id)
                llm_router.record_error(model_name, resp.status_code, resp.text[:150])
            except Exception as e:
                llm_router.record_error(model_name, 500, str(e))
                logger.warning(f"[Quiz Predictor Groq Notice] ({model_name}) Skipped: {e}")

    return []


def _normalize_predictions(items: List[Dict[str, Any]], video_id: str) -> List[Dict[str, Any]]:
    """Clean and validate prediction entries returned by the LLM."""
    cleaned = []
    import uuid
    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("quiz_title") or "Upcoming Quiz").strip()
        date_str = str(it.get("predicted_date") or "").strip()
        if not date_str:
            continue
        iso_str = str(it.get("predicted_date_iso") or "").strip()
        cue_time = str(it.get("cue_time") or "00:00").replace("[", "").replace("]", "").strip()
        cue_text = str(it.get("cue_text") or "").strip()
        confidence = float(it.get("confidence") or 0.8)

        cleaned.append({
            "id": f"pred_quiz_{uuid.uuid4().hex[:12]}",
            "video_id": video_id,
            "quiz_title": title,
            "predicted_date": date_str,
            "predicted_date_iso": iso_str,
            "cue_time": cue_time,
            "cue_text": cue_text,
            "confidence": min(1.0, max(0.1, confidence)),
            "status": "pending"
        })
    return cleaned
