"""
Dynamic AI Summary Generator for LectureScribe
----------------------------------------------
Generates structured, dynamic executive summaries from actual video transcript cues.
NO HARDCODED DATA - extracts genuine content, timestamp ranges, and themes for any lecture.
Supports optional LLM inference (HuggingFace / OpenAI) with intelligent NLP extractive fallback.
"""
from __future__ import annotations

import os
import re
import json
from collections import Counter
from typing import List, Dict, Any, Optional

# Standard English stopwords
STOPWORDS = set(
    "the a an and or but in on at to for of with as by from is was are were be been being "
    "have has had do does did will would shall should can could may might must that this these "
    "those it its they their them we our us you your i my me he him his she her what which who "
    "whom how why when where there here all any both each few more most other some such no nor "
    "not only own same so than too very just also then into over after before about between through "
    "during without again further once here there when where why how all any both each few more most "
    "other some such no nor not only own same so than too very can will just should now actually "
    "really well like going okay right something anything someone anyone somewhere".split()
)

# Conceptual & Discourse Markers that indicate high information value in academic lectures
DISCOURSE_MARKERS = {
    "important": 2.5, "crucial": 2.5, "essential": 2.0, "objective": 2.5, "goal": 2.0,
    "concept": 2.0, "understand": 2.0, "method": 2.0, "methodology": 2.5, "process": 2.0,
    "framework": 2.0, "structure": 2.0, "problem": 2.0, "solution": 2.0, "result": 2.0,
    "analyze": 2.0, "analysis": 2.0, "research": 2.0, "study": 1.5, "evidence": 2.0,
    "difference": 2.0, "example": 1.5, "remember": 2.5, "focus": 2.0, "reason": 2.0,
    "because": 1.5, "means": 1.5, "challenge": 2.0, "step": 1.5, "future": 1.5,
    "define": 2.0, "definition": 2.0, "theory": 2.0, "model": 2.0, "approach": 2.0,
    "experiment": 2.0, "validation": 2.0, "discussion": 1.5, "hypothesis": 2.5,
}

# Conversational greetings & connection banter to filter out
GREETING_PHRASES = [
    "good evening", "good morning", "good afternoon", "can you hear", "am i audible",
    "yes sir", "no sir", "thank you", "joined by", "another meeting", "another link",
    "hello everyone", "let us start", "okay so", "yeah yeah", "bye bye", "screen visible",
    "is my screen", "audio clear", "hear me"
]


def clean_text(t: str) -> str:
    """Strip VTT/HTML tags and normalize whitespace."""
    t = re.sub(r"<[^>]+>", "", t).strip()
    return re.sub(r"\s+", " ", t)


def is_greeting_or_banter(t: str) -> bool:
    """Detect if a cue is conversational filler or greeting."""
    low = t.lower()
    return any(low.startswith(g) or g in low for g in GREETING_PHRASES)


def score_cue(text: str) -> float:
    """Score a cue based on information density, length, and academic discourse markers."""
    words = text.lower().split()
    if len(words) < 5:
        return 0.0
    score = 1.0
    if 40 <= len(text) <= 220:
        score += 2.0
    for w, weight in DISCOURSE_MARKERS.items():
        if w in words or any(w in token for token in words):
            score += weight
    if text and text[0].isupper() and text[-1] in ".?!":
        score += 1.0
    return score


def compute_similarity(s1: str, s2: str) -> float:
    """Jaccard similarity between two sentence token sets."""
    w1 = set(s1.lower().split())
    w2 = set(s2.lower().split())
    if not w1 or not w2:
        return 0.0
    return len(w1 & w2) / len(w1 | w2)


def generate_llm_summary(cues: List[Dict[str, str]], title: str) -> Optional[List[Dict[str, Any]]]:
    """Attempt dynamic structured summary generation using configured LLM (Hugging Face or OpenAI endpoint)."""
    hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))
    openai_base = os.getenv("LLAMA_OPENAI_BASE", "")
    model_id = os.getenv("LLAMA_MODEL", "meta-llama/Llama-3.2-3B-Instruct")

    if not (hf_token or openai_base):
        return None

    # Sample representative cues across transcript
    sample_cues = cues[::max(1, len(cues) // 50)][:50]
    sample_text = "\n".join([f"[{c.get('time', '00:00')}] {c.get('text', '')}" for c in sample_cues])

    system_prompt = (
        "You are LectureScribe AI. Summarize the provided video lecture transcript into 4 to 6 structured sections. "
        "Each section must have a descriptive title and 3-5 informative bullet points highlighting genuine topics spoken in the lecture. "
        "Respond ONLY with a valid JSON array of objects with keys 'title' and 'points'. Do not include markdown codeblocks or extra text."
    )
    user_prompt = f"Video Title: {title}\n\nTranscript Sample:\n{sample_text}\n\nJSON output:"

    # 1. Try Hugging Face
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
            # Clean possible markdown wrap
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            if isinstance(data, list) and len(data) >= 2:
                return data
        except Exception:
            pass

    # 2. Try OpenAI compatible endpoint
    if openai_base:
        try:
            from openai import OpenAI
            client = OpenAI(base_url=openai_base, api_key=os.getenv("LLAMA_OPENAI_KEY", "ollama"))
            resp = client.chat.completions.create(
                model=model_id,
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
        except Exception:
            pass

    return None


def generate_dynamic_summary(cues: List[Dict[str, str]], title: str) -> List[Dict[str, Any]]:
    """Intelligent dynamic NLP extractor that derives thematic chapters and salient bullet points from transcript cues."""
    if not cues:
        return [{"title": "📌 Overview", "points": ["No transcript cues available for summary generation."]}]

    cleaned_cues = []
    questions = []

    for c in cues:
        txt = clean_text(c.get("text", ""))
        t = c.get("time", "00:00")
        if not txt or is_greeting_or_banter(txt):
            continue
        if len(txt.split()) >= 4:
            cleaned_cues.append({"time": t, "text": txt, "score": score_cue(txt)})
        if "?" in txt and len(txt.split()) >= 5:
            questions.append({"time": t, "text": txt})

    if not cleaned_cues:
        cleaned_cues = [
            {"time": c.get("time", "00:00"), "text": clean_text(c.get("text", "")), "score": 1.0}
            for c in cues if clean_text(c.get("text", ""))
        ]

    # Calculate dynamic phases based on length
    num_phases = 5 if len(cleaned_cues) >= 25 else max(1, len(cleaned_cues) // 5)
    chunk_size = max(1, len(cleaned_cues) // num_phases)

    phase_configs = [
        ("📌 1. Session Introduction & Core Scope", "Overview"),
        ("💡 2. Theoretical Foundations & Key Themes", "Foundations"),
        ("🎯 3. Applied Methodologies & Frameworks", "Methodology"),
        ("🔬 4. In-Depth Analysis & Case Discussions", "Analysis"),
        ("🚀 5. Key Takeaways, Synthesis & Next Steps", "Conclusion"),
    ]

    sections = []

    for idx in range(num_phases):
        label, fallback_theme = phase_configs[idx] if idx < len(phase_configs) else (f"📌 {idx+1}. Lecture Phase {idx+1}", "Discussion")
        start_idx = idx * chunk_size
        end_idx = min(len(cleaned_cues), (idx + 1) * chunk_size)
        slice_cues = cleaned_cues[start_idx:end_idx]
        if not slice_cues:
            continue

        t_start = slice_cues[0]["time"]
        t_end = slice_cues[-1]["time"]

        # Extract top keywords for dynamic title
        words = []
        for sc in slice_cues:
            for w in re.findall(r"[a-zA-Z]{4,}", sc["text"].lower()):
                if w not in STOPWORDS:
                    words.append(w)
        top_kws = [k.capitalize() for k, _ in Counter(words).most_common(2) if k.capitalize() not in title]
        theme_str = f": {' & '.join(top_kws)}" if top_kws else ""

        # Pick top-scored diverse cues
        sorted_cues = sorted(slice_cues, key=lambda x: x["score"], reverse=True)
        picked_points = []
        for cand in sorted_cues:
            if len(picked_points) >= 5:
                break
            if any(compute_similarity(cand["text"], existing) > 0.45 for existing in picked_points):
                continue
            picked_points.append(cand["text"])

        # Format points with timestamps
        points_with_time = []
        for p in picked_points:
            matching_cue = next((sc for sc in slice_cues if sc["text"] == p), None)
            pt_time = matching_cue["time"] if matching_cue else t_start
            points_with_time.append(f"[{pt_time}] {p}")

        if not points_with_time:
            points_with_time = [f"[{t_start}] Key discussion segment covering {fallback_theme.lower()}."]

        sections.append({
            "title": f"{label}{theme_str} [{t_start} - {t_end}]",
            "points": points_with_time
        })

    # Optional Section 6: Key Questions asked during the lecture
    if questions:
        q_points = [f"[{q['time']}] {q['text']}" for q in questions[:5]]
        if q_points:
            sections.append({
                "title": "❓ 6. Key Questions & Interactive Inquiries",
                "points": q_points
            })

    return sections


def generate_summary_sections(cues: List[Dict[str, str]], title: str) -> List[Dict[str, Any]]:
    """Master summary function: attempts LLM synthesis first, falls back to dynamic NLP extractor."""
    # 1. Attempt LLM summary if token is present
    try:
        llm_res = generate_llm_summary(cues, title)
        if llm_res:
            return llm_res
    except Exception as e:
        print(f"[Summary Generator Notice] LLM summary attempt skipped: {e}")

    # 2. Dynamic NLP Extractive Summary
    return generate_dynamic_summary(cues, title)
