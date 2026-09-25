"""
Dynamic AI Summary Generator for LectureScribe
----------------------------------------------
Generates structured, authentic executive summaries from actual video transcript cues.
100% Dynamic Content:
- Reconstructs complete, grammatical sentences across broken Vimeo caption cues.
- Derives genuine semantic topics & chapter titles directly from lecture discussion.
- Synthesizes an Executive Overview & Scope.
- Extracts authentic intellectual inquiries and questions asked during the session.
- Seamlessly integrates with LLMs (Microsoft Phi-3.5 / Llama / OpenAI) when API keys are configured.
"""
from __future__ import annotations

import os
import re
import json
from collections import Counter
from typing import List, Dict, Any, Optional

# Comprehensive stopwords covering spoken conversational tokens & fillers
STOPWORDS = set("""
a about above across after again against all almost along already also although always
am among an and another any anybody anyone anything anyway anywhere are aren't around
as at be became because become becomes becoming been before beforehand behind being
below beside besides between beyond both but by can cannot can't come came could couldn't
did didn't do does doesn't doing don't done down during each either else elsewhere
enough even ever every everybody everyone everything everywhere except few for former
formerly from further get gets getting got had hadn't has hasn't have haven't having
he he'd he'll he's hence her here here's hers herself him himself his how however
i i'd i'll i'm i've if in into is isn't it it's its itself just keep keeps kept
let let's made make makes making many may maybe me meanwhile might mine more moreover
most mostly much must mustn't my myself near neither never nevertheless next no nobody
none noone nor not nothing now nowhere of off often on once one only onto or other
others otherwise ought our ours ourselves out over own per perhaps please rather really
said same saw see seen shall shan't she she'd she'll she's should shouldn't since so
some somebody someone something sometime sometimes somewhere still such take taken than
that that's the their theirs them themselves then thence there thereafter thereby therefore
therein thereupon these they they'd they'll they're they've this those though through
throughout thru thus to together too toward towards under until unto up upon us use
used uses using very via was wasn't way we we'd we'll we're we've well went were weren't
what whatever what's when whence whenever where whereafter whereas whereby wherein
whereupon wherever whether which while whither who whoever whole whom whose why will
with within without won't would wouldn't yes yet you you'd you'll you're you've your
yours yourself yourselves okay yeah right sir today session video lecture discussing
discuss discussed example examples kind sort thing things actually basically literally
going goes went want wanted need needed mean meant think thought know knew
""".split())

# High-salience academic discourse markers for scoring substantive sentences
DISCOURSE_MARKERS = {
    "methodology": 4.0, "hypothesis": 4.0, "framework": 3.5, "objective": 3.5,
    "strategy": 3.0, "literature": 3.5, "investigation": 3.0, "experiment": 3.0,
    "validation": 3.0, "analysis": 3.0, "perspective": 2.5, "process": 2.5,
    "difference": 3.0, "innovation": 3.0, "technology": 2.5, "independent": 3.0,
    "publication": 3.0, "patent": 3.0, "concept": 2.5, "principle": 2.5,
    "problem": 2.5, "solution": 2.5, "evaluation": 2.5, "formulation": 3.0,
    "structure": 2.5, "discovery": 3.0, "invention": 3.0, "crucial": 2.5,
    "essential": 2.5, "systematic": 3.0, "criterion": 3.0, "syllabus": 2.5
}

# Conversational greetings & opening logistics to skip
GREETING_PHRASES = [
    "good evening", "good morning", "good afternoon", "can you hear", "am i audible",
    "yes sir", "no sir", "thank you", "joined by", "another meeting", "another link",
    "hello everyone", "let us start", "okay so", "yeah yeah", "bye bye", "screen visible",
    "is my screen", "audio clear", "hear me", "recording started"
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
    Stitch fragmented Vimeo caption cues into full grammatical sentences.
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


def extract_dynamic_phase_topic(sentences: List[Dict[str, Any]], video_title: str, used_topics: Optional[set] = None) -> str:
    """
    Derives genuine semantic topics (bigrams/trigrams) from sentences in a specific segment.
    Ensures non-overlapping, specific topical labels across lecture phases.
    """
    if used_topics is None:
        used_topics = set()

    phrases = []
    title_words = set(re.sub(r"[^a-z0-9 ]", "", video_title.lower()).split())

    for s in sentences:
        words = [re.sub(r"[^a-z0-9]", "", w) for w in s["text"].lower().split()]
        words = [w for w in words if w and len(w) >= 3]

        for i in range(len(words) - 1):
            w1, w2 = words[i], words[i + 1]
            if w1 not in STOPWORDS and w2 not in STOPWORDS:
                phrases.append(f"{w1.capitalize()} {w2.capitalize()}")

        for i in range(len(words) - 2):
            w1, w2, w3 = words[i], words[i + 1], words[i + 2]
            if w1 not in STOPWORDS and w3 not in STOPWORDS:
                phrases.append(f"{w1.capitalize()} {w2.capitalize()} {w3.capitalize()}")

    counts = Counter(phrases)
    picked = None
    for cand, _ in counts.most_common(25):
        cand_words = set(cand.lower().split())
        if not (cand_words & used_topics) and not all(w in title_words for w in cand_words):
            picked = cand
            break

    if not picked:
        for cand, _ in counts.most_common(25):
            cand_words = set(cand.lower().split())
            if not all(w in title_words for w in cand_words):
                picked = cand
                break

    if picked:
        used_topics.update(picked.lower().split())
        return picked
    return "Methodology & Analytical Discussions"


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
    """
    Extracts authentic questions asked or addressed during the lecture.
    Excludes conversational question tags like 'right?' or 'okay?'.
    """
    QUESTION_STARTERS = (
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
        is_q = first_word in QUESTION_STARTERS
        if not is_q and len(words) >= 2:
            is_q = words[1] in QUESTION_STARTERS

        if is_q:
            clean_q = re.sub(r"^(?:So|Then|Now|And)[,\s]+", "", txt, flags=re.IGNORECASE)
            norm = clean_q.lower()[:35]
            if norm not in seen:
                seen.add(norm)
                results.append({"time": s["time"], "text": clean_q})

    return results


def generate_llm_summary(cues: List[Dict[str, str]], title: str) -> Optional[List[Dict[str, Any]]]:
    """
    Optional LLM generation: If Groq, Gemini, Hugging Face, OpenAI, or Ollama credentials are configured,
    generates structured summary using an instruction-tuned language model.
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
    Intelligent dynamic NLP engine:
    1. Reconstructs full grammatical sentences across broken subtitle lines.
    2. Derives authentic, specific topic titles for each time segment.
    3. Selects high-value, complete takeaway statements with exact clickable timestamps.
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
    used_topics = set()
    clean_title = re.sub(r"\s*Live\s*session.*", "", title, flags=re.IGNORECASE).strip()

    # 1. Synthesize Executive Overview dynamically from genuine introductory lecture sentences
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

    # 2. Generate Thematic Chapters
    for i in range(num_phases):
        slice_s = sentences[i * chunk_size : min(total_s, (i + 1) * chunk_size)]
        if not slice_s:
            continue

        t_start = slice_s[0]["time"]
        t_end = slice_s[-1]["time"]
        topic = extract_dynamic_phase_topic(slice_s, title, used_topics)

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
            "title": f"📑 {topic} [{t_start} - {t_end}]",
            "points": picked
        })

    # 3. Extract Substantive Lecture Questions & Inquiries
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
    """Master summary function: Attempts LLM generation first, with intelligent dynamic NLP fallback."""
    try:
        llm_res = generate_llm_summary(cues, title)
        if llm_res:
            return llm_res
    except Exception as e:
        print(f"[Summary Generator Notice] LLM summary attempt skipped: {e}")

    return generate_dynamic_summary(cues, title)
