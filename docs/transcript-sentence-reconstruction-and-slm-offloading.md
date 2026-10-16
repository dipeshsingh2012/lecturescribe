# Transcript Sentence Reconstruction & SLM Offloading Architecture

Last updated: 2026-10-11

## Executive Summary

In LectureScribe, raw speech-to-text (ASR) transcription sources (Whisper, native WebVTT, Zoom cloud recordings) deliver transcript cues fragmented into 2–4 second segments. These cues typically lack natural sentence boundaries, include speech disfluencies (*"um"*, *"basically"*, *"so that is why"*), and contain conversational meeting check-ins (*"am I audible"*, *"can you hear me"*, *"screen visible"*).

[`backend/summary_generator.py`](file:///home/dipes/projects/lecturescribe/backend/summary_generator.py) currently implements [`reconstruct_sentences(cues)`](file:///home/dipes/projects/lecturescribe/backend/summary_generator.py#L62-L94) to stitch fragments into grammatical sentences, filter out logistics banter, and prune speech fillers before generating chapter sections and summaries.

This document evaluates whether and how this preprocessing pipeline can be offloaded to **specialized Python NLP libraries**, **dedicated Small Language Models (SLMs)**, or **prompt-directed downstream LLM workflows**.

---

## 1. Role of `reconstruct_sentences` in the System

### The Raw ASR Fragment Problem
Raw caption cues arrive in fragmented slices:
```json
[
  {"time": "00:01", "text": "We will investigate"},
  {"time": "00:03", "text": "the formal verification"},
  {"time": "00:05", "text": "of cryptographic protocols."}
]
```

### The 4 Pillars of `reconstruct_sentences`
1. **Sentence Boundary Stitching**: Accumulates cue tokens until terminal punctuation (`.`, `?`, `!`) is reached, preserving the starting timestamp `[00:01]` of the first word.
2. **Classroom & Zoom Banter Pruning**: Compares candidate sentences against `GREETING_PHRASES` (*"can you hear me"*, *"screen visible"*, *"am I audible"*, *"yes sir"*) to discard audio checks.
3. **Speech Disfluency Stripping**: Removes conversational filler prefixes (*"Basically..."*, *"I mean..."*, *"What we mean by that is..."*) and trailing rhetorical tags (*"...right?"*).
4. **Token Overhead Reduction (40–60% Savings)**: A 60-minute lecture contains ~1,200 cues. Prepending timestamps to every 3-word fragment wastes thousands of prompt tokens. Sentence reconstruction condenses ~1,200 cue lines into ~200–350 coherent sentences.

---

## 2. Architectural Tradeoff Analysis

```
                              ┌──────────────────────────────────────────────┐
                              │  Raw Cues (1,200+ 3-second fragments)        │
                              └──────────────────────┬───────────────────────┘
                                                     │
                 ┌───────────────────────────────────┼──────────────────────────────────┐
                 ▼                                   ▼                                  ▼
      [Option A: Python NLP Library]       [Option B: SLM Pipeline]           [Option C: Main LLM Direct]
      • spaCy / NLTK SBD                   • Qwen 2.5 (1.5B / 3B)             • 30s Windowed Chunks
      • deepmultilingualpunctuation        • Llama 3.2 (1B / 3B)              • System prompt anti-banter rule
      • clean-text disfluency              • Local (Ollama/vLLM) or Groq      • 0 extra network calls
                 │                                   │                                  │
                 └───────────────────────────────────┼──────────────────────────────────┘
                                                     ▼
                                      [Executive Chapter Summary]
```

---

## 3. Evaluation of Alternatives

### Option A: Offloading to Python NLP Libraries

Instead of maintaining custom regular expressions in `summary_generator.py`, standard NLP libraries can handle sentence boundary detection (SBD), punctuation restoration, and casing.

#### Recommended Libraries
- **[`deepmultilingualpunctuation`](https://pypi.org/project/deepmultilingualpunctuation/)**: RoBERTa/BERT-based lightweight model (~80MB) trained specifically to restore commas, periods, and question marks on raw ASR output.
- **[`spacy`](https://spacy.io/) (`en_core_web_sm`)**: Rule/transition-based dependency parsing for fast, deterministic sentence boundary segmentation (`doc.sents`).
- **[`clean-text`](https://pypi.org/project/clean-text/)**: Strips conversational artifacts and standardizes unicode.

#### Reference Implementation (spaCy)
```python
import spacy

nlp = spacy.load("en_core_web_sm", disable=["ner", "tagger", "lemmatizer"])

def segment_cues_spacy(cues):
    full_text = " ".join(c.get("text", "").strip() for c in cues)
    doc = nlp(full_text)
    
    # Extract clean sentence strings
    return [
        sent.text.strip()
        for sent in doc.sents
        if len(sent.text.strip()) >= 30 and not is_greeting_or_banter(sent.text)
    ]
```

* **Pros**: Sub-millisecond execution (CPU only), deterministic, zero API token cost, no external network dependencies.
* **Cons**: Still requires heuristic banter/greeting checks; does not understand semantic context (e.g. mic check vs acoustic lecture).

---

### Option B: Offloading to a Small Language Model (SLM)

SLMs (0.5B to 3B parameters) provide semantic understanding of spoken dialogue at minimal computational cost.

#### Recommended SLMs
1. **Qwen 2.5 1.5B / 3B Instruct**: State-of-the-art reasoning among sub-4B models; ultra-fast token output on CPU/Edge.
2. **Llama 3.2 1B / 3B Instruct**: Highly optimized for text cleanup, summarization, and instruction-following.
3. **SmolLM2 1.7B**: Lightweight open weights designed specifically for on-device formatting tasks.

#### Execution Architecture
- **Local Runtime**: Deployed via `ollama run qwen2.5:1.5b` or `vLLM` on local server.
- **Hosted Cloud Runtime**: Groq API (sub-100ms inference).

#### Reference Prompt Template
```text
SYSTEM:
You are an academic transcription cleaner.
Given fragmented lecture captions with timestamps:
1. Strip spoken fillers (uh, um, basically, right?) and stutter repetitions.
2. Remove meeting logistics, audio checks ('am I audible', 'can you hear me'), and banter.
3. Preserve all mathematical terms, definitions, and formulas.
4. Output clean, punctuated sentences with the start timestamp of each sentence.

USER:
[00:01] Can you hear me? Yes sir. [00:08] So basically what we want to discuss today is eigenvalues.
```

* **Pros**: High semantic nuance (accurately discerns contextual questions from mic checks); produces naturally punctuated sentences.
* **Cons**: Adds an extra inference hop (~200–500ms latency); consumes additional tokens or server VRAM.

---

### Option C: The Pragmatic Alternative (Main LLM Direct Ingestion)

LectureScribe already uses modern high-capacity models (**Groq GPT-OSS 120B**, **Qwen 27B**, **Gemini 3.8 Flash**) with massive context windows (128k–1M+ tokens).

By pairing the **30-second windowed chunks** built in [`backend/algolia_service.py`](file:///home/dipes/projects/lecturescribe/backend/algolia_service.py) with an explicit anti-banter directive in the primary summary prompt, the separate preprocessing step can be bypassed entirely:

```text
STRICT GROUNDING & ANTI-BANTER DIRECTIVES:
- Discard opening meeting logistics, microphone/screen checks ('am I audible', 'can you hear'), 
  and student greetings.
- Begin the academic summary directly at the start of pedagogical lecture instruction.
- Preserve exact speaker notation, derivations, and inline [MM:SS] timestamps.
```

* **Pros**: 0 extra inference calls, 0 added dependencies, 0 additional latency.
* **Cons**: Slightly higher prompt token count (~15–20% more than pre-filtered sentences, but well within model limits).

---

## 4. Comparison Matrix

| Criteria | Custom Regex (`reconstruct_sentences`) | Python NLP (`spaCy`) | Dedicated SLM (Qwen/Llama 1–3B) | Main LLM Direct (30s Chunks) |
| :--- | :--- | :--- | :--- | :--- |
| **Execution Latency** | **< 1 ms** | ~5–10 ms | ~200–500 ms | **0 ms** (Merged with summary) |
| **Token Cost** | $0 | $0 | Low (~$0.0001/lec) | Included in summary call |
| **External Dependencies**| None (Pure Python) | `spacy` model package | Ollama / vLLM / Groq API | None |
| **Banter Filtering** | Hardcoded wordlist | Wordlist required | **Context-aware AI** | **Context-aware AI** |
| **Maintenance Burden** | Moderate (regex updates) | Low | Low | **Zero** |

---

## 5. Architectural Recommendation

1. **Short-Term (Current System)**: Retain [`reconstruct_sentences`](file:///home/dipes/projects/lecturescribe/backend/summary_generator.py#L62-L94) as a lightweight, zero-latency pure-Python filter that safeguards token efficiency.
2. **Medium-Term**: When migrating away from regex rules, replace `reconstruct_sentences` with **Option C** (feed 30-second windowed chunks directly to the summary LLM with the anti-banter directive). This eliminates preprocessing maintenance without introducing new infrastructure.
3. **High-Accuracy Edge Deployments**: If offline transcription cleanup is required before cloud ingestion, introduce **Qwen 2.5 1.5B** via local Ollama as a standardized transcript preprocessing worker.

