# ===================================================================
# File: backend/slm_router.py
# -------------------------------------------------------------------
# Fast Structured LLM Intent Router for LectureScribe
# Routes queries via Groq (openai/gpt-oss-20b) with Gemini fallback.
# ===================================================================

import os
import re
import json
import requests
from typing import List, Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

# Ensure .env is explicitly loaded
_env_file = Path(__file__).resolve().parent.parent / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file, override=True)
else:
    load_dotenv(override=True)

INTENT_SUMMARY = "SUMMARY"
INTENT_CHAT = "CHAT"


def slm_classify_intent(
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    video_title: Optional[str] = None,
) -> str:
    """
    Classifies a user query into SUMMARY or CHAT using a fast, high-capability LLM.
    Guarantees structured output via JSON mode.
    """
    if not query or not query.strip():
        return INTENT_CHAT

    clean_q = query.strip().lower()
    summary_direct_patterns = [
        r"^create (?:a )?summary",
        r"^generate (?:a )?summary",
        r"^summarize\b",
        r"^summarise\b",
        r"summary for \d+\s*min",
        r"summarize (?:the )?(?:main|core )?takeaways",
        r"^explain (?:the )?(?:key |core )?(?:concepts|definitions|takeaways)",
        r"(?:key|core) concepts and definitions",
        r"\b(key takeaways|definitions)\b",
    ]
    if any(re.search(p, clean_q) for p in summary_direct_patterns):
        print(f"🧭 [Fast Intent Router] Deterministically classified as: {INTENT_SUMMARY}")
        return INTENT_SUMMARY

    groq_key = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    system_prompt = (
        "You are an intent router for an academic lecture learning platform. "
        "Classify the student query into one of two categories:\n\n"
        "1. SUMMARY: The user wants an overview, comprehensive lecture notes, key takeaways, "
        "a study guide, core definitions, or a chronological reading/walkthrough across the entire lecture.\n"
        "2. CHAT: The user is asking a specific targeted question, a formula derivation, code/concept clarification, "
        "a syllabus/university comparison, or looking for a specific topic segment.\n\n"
        "You must respond ONLY with a valid JSON object matching this schema:\n"
        '{"intent": "SUMMARY"} or {"intent": "CHAT"}'
    )

    user_payload_lines = []
    if video_title:
        user_payload_lines.append(f"Lecture Title: {video_title}")
    if chat_history:
        history_snippet = [
            f"{(m.get('role') or m.get('sender') or 'user').upper()}: {(m.get('content') or m.get('text') or '')[:120]}"
            for m in chat_history[-2:]
            if (m.get('content') or m.get('text'))
        ]
        if history_snippet:
            user_payload_lines.append("Recent Conversation:\n" + "\n".join(history_snippet))

    user_payload_lines.append(f"User Query to Classify: {query.strip()}")
    user_prompt = "\n\n".join(user_payload_lines)

    # 1. Primary: Groq Fast Classification (openai/gpt-oss-20b)
    if groq_key:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "openai/gpt-oss-20b",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.0,
                "max_tokens": 50
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                intent = str(parsed.get("intent", "")).upper()
                if intent in (INTENT_SUMMARY, INTENT_CHAT):
                    print(f"🧭 [LLM Router (Groq 20B)] Classified as: {intent}")
                    return intent
        except Exception as ge:
            print(f"⚠️ [LLM Router Notice] Groq classification failed ({ge}). Trying Gemini...")

    # 2. Fallback: Google Gemini (gemini-3.8-flash)
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "generationConfig": {
                    "temperature": 0.0,
                    "responseMimeType": "application/json",
                    "maxOutputTokens": 50
                }
            }
            resp = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=6)
            if resp.status_code == 200:
                data = resp.json()
                content = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(content)
                intent = str(parsed.get("intent", "")).upper()
                if intent in (INTENT_SUMMARY, INTENT_CHAT):
                    print(f"🧭 [LLM Router (Gemini 3.8)] Classified as: {intent}")
                    return intent
        except Exception as e:
            print(f"⚠️ [LLM Router Notice] Gemini classification failed ({e})")

    if re.search(r"\b(summary|summarize|summarise|takeaways|study guide|lecture notes|key concepts|definitions)\b", clean_q):
        print(f"🧭 [Intent Router Fallback] Classified as: {INTENT_SUMMARY} via pattern match.")
        return INTENT_SUMMARY

    print("⚠️ [LLM Router Warning] Router LLMs unavailable. Defaulting to CHAT.")
    return INTENT_CHAT