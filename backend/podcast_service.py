"""
LectureScribe Single-Narrator Podcast & Audio Summary Service
------------------------------------------------------------
Converts lecture summaries into an engaging single-narrator podcast monologue
using a pure 2-layer Small Language Model (SLM) pipeline:
  Layer 1 (SLM): Podcast Writer — turns structured summary notes into a conversational monologue.
  Layer 2 (SLM): Voice Director — polishes the script for Google TTS (phonetics, pauses, symbol elimination).

No complex heuristics, no regex dictionaries, and no dummy fallbacks.
"""
from __future__ import annotations

import io
import json
import os
import re
import time
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

PODCASTS_DIR = Path(__file__).resolve().parent.parent / "storage" / "podcasts"
PODCASTS_DIR.mkdir(parents=True, exist_ok=True)

_active_generations_lock = threading.Lock()
_active_generations: set[str] = set()


def is_podcast_generating(video_id: str, mode: str = "study") -> bool:
    """Check if a podcast is currently being synthesized for this video and mode."""
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    key = f"{clean_vid}_{clean_mode}"
    with _active_generations_lock:
        return key in _active_generations


def _call_slm(prompt: str, temperature: float = 0.3, max_tokens: int = 2048) -> str:
    """
    Call Small Language Model (SLM) using Gemini Flash Lite or Groq LLaMA 3.2 3B.
    Raises RuntimeError if upstream API request fails.
    """
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()

    # 1. Primary SLM: Google Gemini Flash Lite
    if gemini_key:
        candidate_slms = ["gemini-2.0-flash-lite", "gemini-1.5-flash-8b", "gemini-2.5-flash"]
        for model in candidate_slms:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
            }
            try:
                resp = requests.post(url, json=payload, timeout=30)
                if resp.status_code == 200:
                    candidates = resp.json().get("candidates") or []
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts") or []
                        if parts and parts[0].get("text"):
                            return parts[0]["text"].strip()
            except Exception as e:
                print(f"[PodcastService] SLM {model} warning: {e}")

    # 2. Secondary SLM: Groq LLaMA 3.2 3B
    if groq_key:
        for model in ["llama-3.2-3b-preview", "llama-3.2-1b-preview", "llama-3.3-70b-versatile"]:
            try:
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
                resp = requests.post(url, headers=headers, json=payload, timeout=25)
                if resp.status_code == 200:
                    return resp.json()["choices"][0]["message"]["content"].strip()
            except Exception as e:
                print(f"[PodcastService] Groq SLM {model} warning: {e}")

    raise RuntimeError("SLM text generation failed: Could not reach SLM API or valid API key is missing.")


def slm_write_podcast_script(title: str, text: str, mode: str = "study") -> str:
    """
    Layer 1 (SLM Podcast Writer):
    Adapts the structured lecture summary into an engaging, conversational single-narrator script.
    """
    mode_desc = "Comprehensive Academic Study Notes" if mode == "study" else "Academic Assignment Prose"
    prompt = (
        "You are an articulate, engaging solo educational podcast host. "
        "Adapt the following university lecture summary into an engaging, single-narrator spoken podcast monologue.\n\n"
        f"LECTURE TITLE: {title}\n"
        f"SOURCE MATERIAL ({mode_desc}):\n{text[:6000]}\n\n"
        "STRICT REQUIREMENTS FOR THE SCRIPT:\n"
        "1. Write strictly as a single speaker hosting an audio recap podcast.\n"
        "2. Speak directly to the listener in a warm, enthusiastic, and conversational tone.\n"
        "3. Explain core concepts intuitively. For any math equations, variables, or formulas, explain what they mean verbally rather than reading raw symbols.\n"
        "4. Include a welcoming hook, a structured body explaining the main ideas, and a crisp concluding takeaway.\n"
        "5. Do NOT include sound effects (like [music fades]), stage directions, or markdown headers.\n"
        "6. Return ONLY the spoken monologue script."
    )
    return _call_slm(prompt, temperature=0.4, max_tokens=2048)


def slm_polish_speech_for_tts(draft_script: str) -> str:
    """
    Layer 2 (SLM Voice Director / Phonetic Audio Prep):
    Inspects the draft script and produces 100% pronounceable speech text ready for Google TTS.
    """
    prompt = (
        "You are a professional audio voice director and phonetic speech specialist. "
        "Your job is to prepare the following draft script for a Text-to-Speech (TTS) engine "
        "so that it sounds completely natural, fluent, and human when read aloud.\n\n"
        f"DRAFT SCRIPT:\n{draft_script}\n\n"
        "STRICT RULES:\n"
        "1. Remove any and all markdown formatting, asterisks, hashtags, underscores, brackets, and math delimiters.\n"
        "2. Phonetically expand any abbreviations or shorthand (e.g. 'e.g.' -> 'for example', 'i.e.' -> 'that is', 'vs.' -> 'versus', 'approx.' -> 'approximately', 'eq.' -> 'equation').\n"
        "3. Ensure all numbers, variables, and technical terms are written out phonetically (e.g. 'O(n)' -> 'O of n', 'x^2' -> 'x squared', 'CO2' -> 'C O two', 'km/h' -> 'kilometers per hour').\n"
        "4. Adjust punctuation (commas, em-dashes, periods) to create natural breathing pauses and cadence for speech synthesis.\n"
        "5. Return ONLY the polished, 100% pronounceable text with no explanations, notes, or quotes."
    )
    return _call_slm(prompt, temperature=0.2, max_tokens=2048)


def generate_podcast_script_2layer(title: str, text: str, mode: str = "study") -> str:
    """
    Pure 2-layer SLM pipeline:
      1. SLM Writer converts summary into monologue.
      2. SLM Voice Director converts monologue into phonetic TTS copy.
    """
    if not text or not text.strip():
        raise ValueError(f"Cannot generate podcast: No summary text available for '{title}'.")

    # Layer 1: SLM Writer
    draft_monologue = slm_write_podcast_script(title, text, mode)

    # Layer 2: SLM Voice Director
    tts_ready_speech = slm_polish_speech_for_tts(draft_monologue)

    return tts_ready_speech


def chunk_text_by_sentences(text: str, max_chars: int = 4000) -> List[str]:
    """Split text into sentence-aware chunks that do not exceed max_chars."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current_chunk: List[str] = []
    current_len = 0

    for s in sentences:
        s_clean = s.strip()
        if not s_clean:
            continue
        if current_len + len(s_clean) + 1 > max_chars and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = [s_clean]
            current_len = len(s_clean)
        else:
            current_chunk.append(s_clean)
            current_len += len(s_clean) + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks or [text]


def synthesize_speech_google(text: str, output_path: Path) -> Path:
    """
    Synthesize speech using Google Cloud Text-to-Speech (Journey/Neural2 voice),
    with automatic fallback to gTTS if cloud credentials are not active.
    Raises RuntimeError if both fails.
    """
    chunks = chunk_text_by_sentences(text, max_chars=4000)
    audio_segments: List[bytes] = []

    # Attempt Google Cloud Text-to-Speech client
    gcloud_success = False
    try:
        from google.cloud import texttospeech
        client = texttospeech.TextToSpeechClient()

        voice_params = texttospeech.VoiceSelectionParams(
            language_code="en-US",
            name="en-US-Journey-F",
            ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,
        )

        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=1.02,
            pitch=0.0,
        )

        for chunk in chunks:
            input_text = texttospeech.SynthesisInput(text=chunk)
            response = client.synthesize_speech(
                input=input_text,
                voice=voice_params,
                audio_config=audio_config,
            )
            audio_segments.append(response.audio_content)

        gcloud_success = True
    except Exception as e:
        print(f"[PodcastService] Google Cloud TTS notice (falling back to gTTS): {e}")

    # Fallback to gTTS if Google Cloud credentials are not configured
    if not gcloud_success or not audio_segments:
        import gtts
        audio_segments = []
        for chunk in chunks:
            tts = gtts.gTTS(text=chunk, lang="en", tld="com", slow=False)
            buf = io.BytesIO()
            tts.write_to_fp(buf)
            buf.seek(0)
            audio_segments.append(buf.read())

    if not audio_segments:
        raise RuntimeError("Failed to synthesize audio segments via Google TTS.")

    # Write combined audio bytes to output file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f_out:
        for seg in audio_segments:
            f_out.write(seg)

    return output_path


def get_podcast_metadata(video_id: str, mode: str = "study") -> Optional[Dict[str, Any]]:
    """Retrieve metadata for an existing cached podcast or report active generation."""
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    mp3_path = PODCASTS_DIR / f"{clean_vid}_{clean_mode}.mp3"
    meta_path = PODCASTS_DIR / f"{clean_vid}_{clean_mode}.json"

    # 1. Check if currently generating
    if is_podcast_generating(clean_vid, clean_mode):
        return {
            "exists": False,
            "video_id": clean_vid,
            "mode": clean_mode,
            "status": "generating"
        }

    # 2. Check if cached audio exists
    if mp3_path.exists() and mp3_path.stat().st_size > 0:
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    data["exists"] = True
                    data["status"] = "ready"
                    data["audio_url"] = f"/api/lectures/{clean_vid}/podcast/stream?mode={clean_mode}"
                    return data
            except Exception:
                pass

        return {
            "exists": True,
            "video_id": clean_vid,
            "mode": clean_mode,
            "audio_url": f"/api/lectures/{clean_vid}/podcast/stream?mode={clean_mode}",
            "file_size": mp3_path.stat().st_size,
            "status": "ready"
        }

    return None


def create_or_refresh_podcast(
    video_id: str,
    title: str,
    text: str,
    mode: str = "study",
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Generate or retrieve a podcast audio recap for a lecture via pure 2-layer SLM pipeline.
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    mp3_path = PODCASTS_DIR / f"{clean_vid}_{clean_mode}.mp3"
    meta_path = PODCASTS_DIR / f"{clean_vid}_{clean_mode}.json"
    key = f"{clean_vid}_{clean_mode}"

    if not force_refresh:
        existing = get_podcast_metadata(clean_vid, clean_mode)
        if existing and existing.get("exists"):
            return existing

    with _active_generations_lock:
        _active_generations.add(key)

    try:
        # Pure 2-layer SLM pipeline (Writer SLM -> Voice Director SLM)
        script = generate_podcast_script_2layer(title=title, text=text, mode=clean_mode)

        # Synthesize audio with Google TTS
        synthesize_speech_google(script, mp3_path)

        metadata = {
            "exists": True,
            "video_id": clean_vid,
            "mode": clean_mode,
            "title": title,
            "script": script,
            "audio_url": f"/api/lectures/{clean_vid}/podcast/stream?mode={clean_mode}",
            "file_size": mp3_path.stat().st_size if mp3_path.exists() else 0,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "ready"
        }

        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
        except Exception as e:
            print(f"[PodcastService] Warning saving metadata: {e}")

        return metadata
    finally:
        with _active_generations_lock:
            _active_generations.discard(key)


def trigger_background_podcast_generation(
    video_id: str,
    title: str,
    text: str,
    mode: str = "study",
    force_refresh: bool = False
) -> None:
    """
    Fire-and-forget background synthesis of podcast audio so that it is pre-generated
    and immediately ready when the user opens the lecture summary.
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    if not force_refresh:
        meta = get_podcast_metadata(clean_vid, clean_mode)
        if meta and (meta.get("exists") or meta.get("status") == "generating"):
            return

    def _worker():
        try:
            create_or_refresh_podcast(
                video_id=clean_vid,
                title=title,
                text=text,
                mode=clean_mode,
                force_refresh=force_refresh
            )
        except Exception as e:
            print(f"[PodcastService] Background worker notice for '{clean_vid}': {e}")

    thread = threading.Thread(target=_worker, daemon=True, name=f"podcast-{clean_vid}-{clean_mode}")
    thread.start()
