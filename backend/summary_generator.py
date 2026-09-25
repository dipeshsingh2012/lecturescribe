"""
Dynamic AI Summary Generator for LectureScribe
----------------------------------------------
Generates structured, authentic executive summaries from video transcript cues:
1. Reconstructs complete, grammatical sentences across fragmented caption cues.
2. Generates high-quality topical chapters via LLM (Groq / Gemini / Hugging Face / OpenAI).
3. Provides a clean, deterministic time-sliced fallback when LLMs are unavailable.
4. Extracts genuine questions explored during the lecture.
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


def extract_substantive_questions(sentences: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract authentic questions asked or addressed during the lecture."""
    question_starters = (
        'what', 'how', 'why', 'can', 'should', 'is', 'are', 'which', 'who', 'where', 'when', 'does', 'do'
    )
    results = []
    seen = set()

    for s in sentences:
        txt = s["text"]
        if not txt.endswith("?"):
            continue
        if len(txt.split()) < 6:
            continue

        words = txt.lower().split()
        first_word = re.sub(r"[^a-z]", "", words[0])
        is_q = first_word in question_starters
        if not is_q and len(words) >= 2:
            is_q = words[1] in question_starters

        if is_q:
            clean_q = re.sub(r"^(?:So|Then|Now|And)[,\s]+", "", txt, flags=re.IGNORECASE)
            norm = clean_q.lower()[:35]
            if norm not in seen:
                seen.add(norm)
                results.append({"time": s["time"], "text": clean_q})

    return results


def extract_dynamic_phase_topic(sentences: List[Dict[str, Any]], video_title: str, used_topics: Optional[set] = None) -> str:
    """Legacy compatibility stub: returns safe general topic description."""
    return "Methodology & Analytical Discussions"


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


def generate_dynamic_summary(cues: List[Dict[str, str]], title: str) -> List[Dict[str, Any]]:
    """
    Deterministic NLP fallback when LLM is unavailable:
    1. Reconstructs full grammatical sentences from caption cues.
    2. Groups into chronological lecture phases.
    3. Selects top substantive takeaway statements with exact timestamps.
    4. Extracts real student and instructor inquiry questions.
    """
    if not cues:
        return [{"title": "📌 Lecture Overview", "points": ["No transcript cues available for summary generation."]}]

    sentences = reconstruct_sentences(cues)
    if not sentences:
        sentences = [
            {"time": c.get("time", "00:00"), "text": clean_sentence_text(c.get("text", ""))}
            for c in cues if len(c.get("text", "").split()) >= 4
        ]

    total_s = len(sentences)
    if total_s < 20:
        num_phases = 2
    elif total_s < 60:
        num_phases = 3
    elif total_s < 150:
        num_phases = 4
    else:
        num_phases = 5

    chunk_size = max(1, total_s // num_phases)
    sections = []

    # 1. Executive Overview from introductory lecture sentences
    intro_slice = sentences[:max(chunk_size, 15)]
    intro_scored = sorted(intro_slice, key=lambda x: score_sentence(x["text"]), reverse=True)
    intro_points = []
    for cand in intro_scored:
        if len(intro_points) >= 3:
            break
        if not any(cand["text"][:30].lower() == p[:30].lower() for p in intro_points):
            intro_points.append(f"[{cand['time']}] {cand['text']}")

    if not intro_points and sentences:
        intro_points = [f"[{sentences[0]['time']}] {sentences[0]['text']}"]

    sections.append({
        "title": "🎯 Executive Overview & Session Scope",
        "points": intro_points
    })

    # 2. Chronological Lecture Chapters
    for i in range(num_phases):
        slice_s = sentences[i * chunk_size : min(total_s, (i + 1) * chunk_size)]
        if not slice_s:
            continue

        t_start = slice_s[0]["time"]
        t_end = slice_s[-1]["time"]
        scored = sorted(slice_s, key=lambda x: score_sentence(x["text"]), reverse=True)
        picked = []
        for cand in scored:
            if len(picked) >= 4:
                break
            if any(cand["text"][:30].lower() == p[:30].lower() for p in picked):
                continue
            picked.append(f"[{cand['time']}] {cand['text']}")

        if not picked:
            picked = [f"[{t_start}] Key concepts and topics covered in this lecture segment."]

        sections.append({
            "title": f"📑 Lecture Discussion [{t_start} - {t_end}]",
            "points": picked
        })

    # 3. Substantive Questions Explored
    real_questions = extract_substantive_questions(sentences)
    if real_questions:
        q_points = [f"[{q['time']}] {q['text']}" for q in real_questions[:5]]
        if q_points:
            sections.append({
                "title": "❓ Key Concepts & Questions Explored",
                "points": q_points
            })

    return sections


def generate_summary_sections(cues: List[Dict[str, str]], title: str) -> List[Dict[str, Any]]:
    """Master summary function: Attempts LLM generation first, with clean dynamic fallback."""
    try:
        llm_res = generate_llm_summary(cues, title)
        if llm_res:
            return llm_res
    except Exception as e:
        print(f"[Summary Generator Notice] LLM summary attempt skipped: {e}")

    return generate_dynamic_summary(cues, title)
