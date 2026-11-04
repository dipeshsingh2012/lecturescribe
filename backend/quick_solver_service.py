"""
Quick Solver Service for LectureScribe
--------------------------------------
Ultra-fast, vision-powered solver for handwritten questions, mathematical notation, and MCQs.
Prioritizes sub-second turn-around time, providing direct final answers and most probable MCQ options.
"""
from __future__ import annotations

import os
import time
import base64
import logging
from typing import Dict, Any, Optional, Tuple

import requests
from backend.llm_router import llm_router, TaskType

logger = logging.getLogger("lecturescribe.quick_solver")

FAST_SYSTEM_PROMPT = (
    "You are an ultra-fast precision exam and homework problem solver specializing in handwritten questions, mathematical formulas, and MCQs.\n"
    "Your #1 priority is delivering the CORRECT final answer immediately with MAXIMUM SPEED and ZERO FLUFF.\n\n"
    "STRICT RULES:\n"
    "1. State the final answer or correct MCQ option immediately on line 1:\n"
    "   - For Multiple Choice: '**Answer: Option (X)**' (e.g. '**Answer: Option (C)**')\n"
    "   - If handwriting is slightly ambiguous: '**Most Probable: Option (B)** (or (D) if sign is negative)'\n"
    "   - For numeric/formula: '**Answer:** $\\frac{\\sqrt{3}}{2}$' or '**Answer:** $42\\text{ m/s}$'\n"
    "2. DO NOT provide step-by-step working, background, or derivations unless requested.\n"
    "3. You may provide AT MOST one single concise verification sentence or key formula (under 15 words) on line 2.\n"
    "4. Format any math strictly with standard LaTeX: $...$ for inline, $$...$$ for display equations."
)

DETAILED_SYSTEM_PROMPT = (
    "You are an expert academic exam tutor. Provide a clear, step-by-step derivation for this handwritten problem.\n"
    "1. First, state the transcribed question in LaTeX under '### 📝 Transcribed Problem'.\n"
    "2. Provide numbered, concise derivation steps with standard LaTeX math formatting ($...$ and $$...$$).\n"
    "3. State the final boxed answer prominently at the end under '### 🎯 Final Answer'."
)


def parse_image_data(image_data: str) -> Tuple[str, bytes]:
    """Extract MIME type and binary bytes from data URL or raw base64 string."""
    clean_str = (image_data or "").strip()
    if not clean_str:
        raise ValueError("image_data cannot be empty.")

    if clean_str.startswith("data:"):
        try:
            header, b64_part = clean_str.split(",", 1)
            mime = header.split(";")[0].replace("data:", "").strip() or "image/jpeg"
            raw_bytes = base64.b64decode(b64_part.strip())
            return mime, raw_bytes
        except Exception as e:
            raise ValueError(f"Invalid base64 data URL: {e}")
    else:
        try:
            raw_bytes = base64.b64decode(clean_str)
            return "image/jpeg", raw_bytes
        except Exception as e:
            raise ValueError(f"Invalid base64 image data: {e}")


def quick_solve_handwritten_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    prompt: str = "",
    course_context: str = "",
    detailed: bool = False,
    timeout_sec: float = 12.0
) -> Dict[str, Any]:
    """
    Directly query Google Gemini Vision with an image of a handwritten question.
    Returns direct answer and latency metadata.
    """
    t0 = time.time()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is required for multimodal vision quick solving.")

    system_prompt = DETAILED_SYSTEM_PROMPT if detailed else FAST_SYSTEM_PROMPT

    user_prompt_lines = []
    if course_context:
        user_prompt_lines.append(f"Course / Subject Hint: {course_context}")
    if prompt:
        user_prompt_lines.append(f"Student Instruction: {prompt}")
    
    if not detailed:
        user_prompt_lines.append("Inspect the handwritten image and provide the final answer or correct MCQ option immediately.")
    else:
        user_prompt_lines.append("Inspect the handwritten image, transcribe the problem, and provide the step-by-step solution.")

    user_prompt = "\n".join(user_prompt_lines)

    # Fetch candidate models from router (multimodal=True)
    candidates = llm_router.get_candidate_models(TaskType.QUICK_SOLVE, est_tokens=400, multimodal=True)
    if not candidates:
        # Fallback to standard fast gemini vision models if router has no candidates
        from backend.llm_router import ModelSpec
        candidates = [
            ModelSpec(name="gemini-flash-lite-latest", provider="gemini", context_window=1048576, tpm_limit=1000000, supports_multimodal=True),
            ModelSpec(name="gemini-3.5-flash-lite", provider="gemini", context_window=1048576, tpm_limit=1000000, supports_multimodal=True),
            ModelSpec(name="gemini-3.8-flash", provider="gemini", context_window=1048576, tpm_limit=1000000, supports_multimodal=True),
        ]

    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    last_err = None

    for model_spec in candidates:
        model_name = model_spec.name
        if model_spec.provider != "gemini":
            continue

        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
        user_parts = [
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": b64_image,
                }
            },
            {"text": user_prompt}
        ]

        payload = {
            "contents": [{"role": "user", "parts": user_parts}],
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 1800 if detailed else 220,
            }
        }

        try:
            resp = requests.post(api_url, json=payload, timeout=timeout_sec)
            elapsed_ms = int((time.time() - t0) * 1000)

            if resp.status_code == 200:
                res_data = resp.json()
                cand = res_data.get("candidates", [{}])[0]
                parts = cand.get("content", {}).get("parts", [{}])
                answer_text = "".join(p.get("text", "") for p in parts).strip()
                if answer_text:
                    llm_router.record_success(model_name)
                    return {
                        "status": "success",
                        "answer": answer_text,
                        "model": model_name,
                        "response_time_ms": elapsed_ms,
                        "detailed": detailed,
                        "course_context": course_context or None
                    }
                else:
                    last_err = "Empty response from Gemini vision model."
            else:
                last_err = f"Gemini API returned status {resp.status_code}: {resp.text[:200]}"
                llm_router.record_error(model_name, resp.status_code, last_err)
        except Exception as e:
            last_err = str(e)
            llm_router.record_error(model_name, 500, last_err)

    raise RuntimeError(f"Quick solver failed across candidates: {last_err or 'Unknown error'}")
