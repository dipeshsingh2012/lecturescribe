"""
Dynamic AI Summary Generator for LectureScribe
----------------------------------------------
Generates structured, authentic executive summaries from video transcript cues:
1. Reconstructs complete, grammatical sentences across fragmented caption cues.
2. Generates high-quality topical chapters via LLM (Groq / Gemini / Hugging Face / OpenAI).
3. Provides a clean, minimal fallback when LLMs are unavailable.
"""
from __future__ import annotations

import os
import re
import json
from typing import List, Dict, Any, Optional

# High-salience academic discourse markers for scoring substantive sentences
DISCOURSE_MARKERS = {
    "methodology": 3.0, "hypothesis": 3.0, "framework": 3.0, "objective": 3.0,
    "strategy": 2.5, "experiment": 2.5, "analysis": 2.5, "difference": 2.5,
    "concept": 2.5, "principle": 2.5, "problem": 2.5, "solution": 2.5,
    "validation": 2.5, "formulation": 2.5, "structure": 2.0, "process": 2.0,
}

# Conversational greetings & opening logistics to filter out
GREETING_PHRASES = [
    "good evening", "good morning", "good afternoon", "can you hear", "am i audible",
    "yes sir", "no sir", "thank you", "joined by", "another meeting", "another link",
    "hello everyone", "let us start", "okay so", "yeah yeah", "bye bye", "screen visible",
    "is my screen", "audio clear", "hear me", "recording started", "where is the link",
    "struggle with finding", "share the link", "meeting link", "unmute", "microphone"
]


def clean_sentence_text(text: str) -> str:
    """Normalize speech fillers, stutter repetitions, and rhetorical conversational tags."""
    t = text.strip()
    t = re.sub(r"<[^>]+>", "", t).strip()

    t = re.sub(
        r"^(?:So|And|Then|Okay|Now|Yeah|Well|Right|Also|Basically|Actually|I mean|For example|In that sense|As I mentioned|So that is why|That is why|What we mean by that is)[,\s]+",
        "",
        t,
        flags=re.IGNORECASE
    )

    t = re.sub(r"[,–—\s]+(?:right|okay|correct|fine|yes|no)\?*$", ".", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*--\s*", " — ", t)

    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    if t and t[-1] not in ".?!":
        t += "."
    return t


def is_greeting_or_banter(t: str) -> bool:
    """Detect if a sentence is merely conversational filler or meeting check-in."""
    low = t.lower()
    return any(low.startswith(g) or g in low for g in GREETING_PHRASES)


def reconstruct_sentences(cues: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """
    Stitch fragmented caption cues into full grammatical sentences.
    Preserves exact starting timestamp of each sentence.
    """
    sentences = []
    curr_text = ""
    curr_time = None

    for c in cues:
        raw = c.get("text", "").strip()
        t = c.get("time", "00:00")
        if not raw:
            continue

        for w in raw.split():
            if curr_time is None:
                curr_time = t
            curr_text += (" " if curr_text else "") + w

            if w.endswith((".", "?", "!")) and not (len(w) <= 3 and w[0].isupper()):
                clean_s = clean_sentence_text(curr_text)
                if len(clean_s) >= 32 and len(clean_s.split()) >= 6 and not is_greeting_or_banter(clean_s):
                    sentences.append({"time": curr_time, "text": clean_s})
                curr_text = ""
                curr_time = None

    if curr_text and len(curr_text) >= 32:
        clean_s = clean_sentence_text(curr_text)
        if len(clean_s.split()) >= 6 and not is_greeting_or_banter(clean_s):
            sentences.append({"time": curr_time or "00:00", "text": clean_s})

    return sentences


def score_sentence(s: str) -> float:
    """Score sentence by information density, optimal length, and key academic discourse markers."""
    words = s.lower().split()
    score = 1.0
    if 50 <= len(s) <= 220:
        score += 2.5
    elif len(s) > 220:
        score += 1.0

    for w, weight in DISCOURSE_MARKERS.items():
        if w in words or any(w in t for t in words):
            score += weight

    return score


def generate_llm_summary(cues: List[Dict[str, str]], title: str) -> Optional[List[Dict[str, Any]]]:
    """
    Generate structured summary using an instruction-tuned language model
    (Groq, Gemini, Hugging Face, OpenAI, or local endpoint).
    """
    groq_key = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))
    openai_key = os.getenv("OPENAI_API_KEY", "")
    openai_base = os.getenv("LLAMA_OPENAI_BASE", os.getenv("LLAMA_API_BASE", ""))
    model_id = os.getenv("LLAMA_MODEL", "meta-llama/Llama-3.1-8B-Instruct")

    if not (groq_key or gemini_key or hf_token or openai_key or openai_base):
        return None

    sentences = reconstruct_sentences(cues)
    if not sentences:
        return None

    sample_size = min(len(sentences), 50)
    step = max(1, len(sentences) // sample_size)
    sampled = sentences[::step][:sample_size]
    sample_text = "\n".join([f"[{s['time']}] {s['text']}" for s in sampled])

    system_prompt = (
        "You are LectureScribe AI. Summarize the provided video lecture transcript into 4 to 6 structured sections. "
        "Every section must have an informative, topical title (including the approximate timestamp range like [00:00 - 15:30]) "
        "and 3-5 clear, complete bullet points explaining what was taught. "
        "Each bullet point MUST start with its exact video timestamp in brackets, e.g., '[12:34] Sentence here.' "
        "Respond ONLY with a valid JSON array of objects with keys 'title' and 'points'. Do not include markdown codeblocks or extra text."
    )
    user_prompt = f"Video Title: {title}\n\nTranscript Excerpt:\n{sample_text}\n\nJSON output:"

    # 1. Groq (High speed, reliable)
    if groq_key:
        try:
            from openai import OpenAI
            client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
            resp = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1500,
                temperature=0.2
            )
            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            if isinstance(data, list) and len(data) >= 2:
                return data
        except Exception as e:
            print(f"[LLM Groq Notice] Skipped: {e}")

    # 2. Google Gemini
    if gemini_key:
        try:
            from openai import OpenAI
            client = OpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
            resp = client.chat.completions.create(
                model="gemini-2.0-flash",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1500,
                temperature=0.2
            )
            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            if isinstance(data, list) and len(data) >= 2:
                return data
        except Exception as e:
            print(f"[LLM Gemini Notice] Skipped: {e}")

    # 3. HuggingFace Inference Client
    if hf_token:
        try:
            from huggingface_hub import InferenceClient
            client = InferenceClient(model=model_id, token=hf_token)
            resp = client.chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1024,
                temperature=0.2
            )
            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            if isinstance(data, list) and len(data) >= 2:
                return data
        except Exception as e:
            print(f"[LLM HF Notice] Skipped: {e}")

    # 4. OpenAI / Ollama compatible endpoint
    if openai_key or openai_base:
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=openai_base if openai_base else None,
                api_key=openai_key if openai_key else "ollama"
            )
            resp = client.chat.completions.create(
                model=model_id if openai_base else "gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1024,
                temperature=0.2
            )
            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            if isinstance(data, list) and len(data) >= 2:
                return data
        except Exception as e:
            print(f"[LLM OpenAI Notice] Skipped: {e}")

    return None


def generate_summary_sections(cues: List[Dict[str, str]], title: str) -> List[Dict[str, Any]]:
    """Master summary function: Generates structured summary sections using LLM."""
    if not cues:
        return [{"title": "📌 Lecture Overview", "points": ["No transcript cues available for summary generation."]}]

    try:
        llm_res = generate_llm_summary(cues, title)
        if llm_res:
            return llm_res
    except Exception as e:
        print(f"[Summary Generator Notice] LLM summary attempt skipped: {e}")

    # Clean fallback when LLM is unavailable
    sentences = reconstruct_sentences(cues)
    points = [f"[{s['time']}] {s['text']}" for s in sentences[:4]] if sentences else ["Lecture summary in progress."]
    return [{"title": "🎯 Session Overview", "points": points}]


# Backward compatibility aliases
generate_dynamic_summary = generate_summary_sections
extract_dynamic_phase_topic = lambda *args, **kwargs: "Methodology & Analytical Discussions"
extract_substantive_questions = lambda *args, **kwargs: []
