"""
LectureScribe Single-Narrator Podcast & Audio Summary Service
------------------------------------------------------------
Converts lecture summaries into an engaging single-narrator podcast monologue
using a pure 2-layer Small Language Model (SLM) pipeline:
  Layer 1 (SLM): Podcast Writer — turns structured summary notes into a conversational monologue.
  Layer 2 (SLM): Voice Director — polishes the script for Google TTS (phonetics, pauses, symbol elimination).

All podcast audio (MP3) and metadata (JSON) are stored directly in Google Cloud Storage
alongside the lecture bundle in courses/{course_slug}/lectures/{video_id}/.
No local disk storage, no fallback models, and no artificial course defaults.
"""
from __future__ import annotations

import io
import json
import os
import re
import time
import threading
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

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
    Call Small Language Model (SLM) using Google Gemini.
    Raises RuntimeError if upstream API request fails.
    """
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    model = "gemini-flash-lite-latest"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}
    }

    resp = requests.post(url, json=payload, timeout=45)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini SLM ({model}) returned error {resp.status_code}: {resp.text[:200]}")

    candidates = resp.json().get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini SLM returned no candidates.")
    parts = candidates[0].get("content", {}).get("parts") or []
    if not parts or not parts[0].get("text"):
        raise RuntimeError("Gemini SLM returned empty text response.")

    return parts[0]["text"].strip()


def slm_write_podcast_script(title: str, text: str, mode: str = "study") -> str:
    """
    Layer 1 (SLM Podcast Writer):
    Adapts the structured lecture summary into an engaging, conversational single-narrator script.
    Differentiates clearly between:
      - 'study': Engaging educational study-guide podcast with review checkpoints and conversational intuition.
      - 'submission': Formal, scholarly student presentation and authentic spoken readout of the assignment submission essay.
    """
    clean_mode = "submission" if mode == "submission" else "study"

    if clean_mode == "submission":
        prompt = (
            "You are an accomplished university graduate student delivering an articulate, spoken academic presentation "
            "of your assignment submission write-up.\n\n"
            f"LECTURE TITLE: {title}\n"
            f"STUDENT ASSIGNMENT SUBMISSION PROSE:\n{text[:6000]}\n\n"
            "STRICT REQUIREMENTS FOR THE SUBMISSION AUDIO SCRIPT:\n"
            "1. Persona & Voice: Speak as the student author delivering your authentic academic assignment write-up in continuous, scholarly spoken prose.\n"
            "2. First-Person Scholarly Perspective: Use authentic academic narrative ('In this synthesis, I examine...', 'My analysis evaluates...', 'The primary findings demonstrate...').\n"
            "3. NO Informal Podcast Banter: Absolutely do NOT use conversational radio/podcast tropes (do NOT say 'Welcome to the podcast', 'Hey everyone', 'Thanks for tuning in', or 'Smash that like button'). Start immediately with the academic inquiry or thesis.\n"
            "4. Content Fidelity: Recite and expand upon the core assignment arguments, derivations, conceptual proofs, and conclusions from the submission text with intellectual clarity and precision.\n"
            "5. Math & Logic: Verbalize any pseudo-math formulas, metrics, or algorithmic notations naturally into spoken English without raw syntax.\n"
            "6. Do NOT include sound effects (like [music fades]), stage directions, or markdown formatting.\n"
            "7. Return ONLY the spoken academic submission monologue script."
        )
    else:
        prompt = (
            "You are an expert academic tutor and engaging solo educational podcast host. "
            "Your task is to produce a thorough, comprehensive spoken lecture review script that covers the entire study guide below.\n\n"
            f"LECTURE TITLE: {title}\n"
            f"COMPREHENSIVE STUDY NOTES:\n{text[:12000]}\n\n"
            "STRICT REQUIREMENTS FOR THE STUDY PODCAST SCRIPT:\n"
            "1. Persona & Voice: You are an articulate professor / lead teaching assistant walking a student through all the core concepts of today's lecture.\n"
            "2. Complete Coverage: Do NOT artificially shorten or compress this into a quick teaser. Cover all major chapters, key definitions, theorems, mechanisms, and exam takeaways thoroughly.\n"
            "3. Spoken Pedagogy:\n"
            "   - Walk step-by-step through the central principles, definitions, and equations in verbal English.\n"
            "   - Translate equations and mathematical relationships conceptually (no raw LaTeX).\n"
            "   - Conclude with high-yield study and exam recall checkpoints.\n"
            "4. Do NOT include sound effects (like [music fades]), stage directions, or markdown headers.\n"
            "5. Return ONLY the spoken educational monologue script."
        )

    return _call_slm(prompt, temperature=0.35, max_tokens=4096)


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
    return _call_slm(prompt, temperature=0.2, max_tokens=4096)


def generate_podcast_script_2layer(title: str, text: str, mode: str = "study") -> str:
    """
    Spoken audio readout pipeline reflecting the respective summary generated:
    - 'submission': Directly polishes the concise student assignment submission text for spoken readout,
      preserving its exact length and content without artificial compression or radio banter.
    - 'study': Synthesizes a thorough, comprehensive spoken review that covers the full study guide.
    """
    if not text or not text.strip():
        raise ValueError(f"Cannot generate podcast: No summary text available for '{title}'.")

    clean_mode = "submission" if mode == "submission" else "study"

    if clean_mode == "submission":
        # Directly polish the assignment submission text for spoken readout
        return slm_polish_speech_for_tts(text)

    # Layer 1: SLM Writer for comprehensive study notes
    draft_monologue = slm_write_podcast_script(title, text, clean_mode)

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


def synthesize_speech_google(text: str) -> bytes:
    """
    Synthesize speech using Google Cloud Text-to-Speech (Journey/Neural2 voice).
    Returns combined MP3 audio bytes.
    Raises RuntimeError if Google Cloud TTS fails.
    """
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

    chunks = chunk_text_by_sentences(text, max_chars=4000)
    audio_segments: List[bytes] = []

    for chunk in chunks:
        input_text = texttospeech.SynthesisInput(text=chunk)
        response = client.synthesize_speech(
            input=input_text,
            voice=voice_params,
            audio_config=audio_config,
        )
        audio_segments.append(response.audio_content)

    if not audio_segments:
        raise RuntimeError("Google Cloud Text-to-Speech produced no audio content.")

    return b"".join(audio_segments)


def get_gcs_podcast_folder(video_id: str, course_name: Optional[str] = None) -> str:
    """
    Resolve the canonical GCS directory where the lecture's video and materials live:
    courses/{course_slug}/lectures/{video_id}
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())

    effective_course = course_name
    if not effective_course:
        try:
            from backend.database import db_manager
            saved = db_manager.get_saved_video(clean_vid) or db_manager.get_video(clean_vid)
            if saved and saved.get("course_name"):
                effective_course = saved.get("course_name")
        except Exception:
            pass

    if not effective_course:
        try:
            from backend.gcs_storage import gcs_storage_service
            gcs_video = gcs_storage_service.find_lecture_video(clean_vid)
            if gcs_video and gcs_video.get("blob_name"):
                folder = os.path.dirname(gcs_video["blob_name"])
                if folder:
                    return folder
        except Exception:
            pass

    if not effective_course:
        raise ValueError(f"Course name is required to resolve podcast storage path for lecture '{clean_vid}'.")

    from backend.gcs_storage import to_gcs_course_slug
    slug = to_gcs_course_slug(effective_course)
    return f"courses/{slug}/lectures/{clean_vid}"


def upload_podcast_to_gcs(
    video_id: str,
    mode: str,
    audio_bytes: bytes,
    metadata: Dict[str, Any],
    course_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Upload generated podcast MP3 bytes and metadata JSON directly to Google Cloud Storage
    right alongside the lecture video in courses/{course_slug}/lectures/{video_id}/.
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"

    from backend.gcs_storage import gcs_storage_service
    bucket = gcs_storage_service._get_bucket()
    if not bucket:
        raise RuntimeError("Google Cloud Storage bucket is not available for podcast upload.")

    folder = get_gcs_podcast_folder(clean_vid, course_name)
    mp3_blob_name = f"{folder}/podcast_{clean_mode}.mp3"
    json_blob_name = f"{folder}/podcast_{clean_mode}.json"

    # Upload MP3 bytes directly
    mp3_blob = bucket.blob(mp3_blob_name)
    mp3_blob.upload_from_string(audio_bytes, content_type="audio/mpeg")

    # Generate GCS signed URL
    signed_url = gcs_storage_service.generate_download_signed_url(
        mp3_blob_name,
        expires_minutes=180,
        disposition="inline"
    )

    metadata["gcs_uri"] = f"gs://{gcs_storage_service.bucket_name}/{mp3_blob_name}"
    metadata["gcs_blob"] = mp3_blob_name
    metadata["gcs_folder"] = folder
    metadata["gcs_signed_url"] = signed_url
    metadata["audio_url"] = signed_url

    # Upload JSON metadata to GCS
    json_blob = bucket.blob(json_blob_name)
    json_blob.upload_from_string(json.dumps(metadata, indent=2), content_type="application/json")

    print(f"[PodcastService GCS] ✅ Uploaded audio & metadata to gs://{gcs_storage_service.bucket_name}/{folder}/")
    return metadata


def get_podcast_metadata(
    video_id: str,
    mode: str = "study",
    course_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Retrieve metadata for an existing cached podcast from GCS or report active generation."""
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"

    # 1. Check if currently generating
    if is_podcast_generating(clean_vid, clean_mode):
        return {
            "exists": False,
            "video_id": clean_vid,
            "mode": clean_mode,
            "status": "generating"
        }

    # 2. Check GCS bucket directly
    try:
        from backend.gcs_storage import gcs_storage_service
        bucket = gcs_storage_service._get_bucket()
        if not bucket:
            return None

        folder = get_gcs_podcast_folder(clean_vid, course_name)
        mp3_blob_name = f"{folder}/podcast_{clean_mode}.mp3"
        json_blob_name = f"{folder}/podcast_{clean_mode}.json"

        mp3_blob = bucket.blob(mp3_blob_name)
        if not mp3_blob.exists():
            return None

        json_blob = bucket.blob(json_blob_name)
        data: Dict[str, Any] = {}
        if json_blob.exists():
            try:
                data = json.loads(json_blob.download_as_text())
            except Exception:
                pass

        signed_url = gcs_storage_service.generate_download_signed_url(
            mp3_blob_name, expires_minutes=180, disposition="inline"
        )

        data["exists"] = True
        data["video_id"] = clean_vid
        data["mode"] = clean_mode
        data["status"] = "ready"
        data["file_size"] = mp3_blob.size
        data["gcs_uri"] = f"gs://{gcs_storage_service.bucket_name}/{mp3_blob_name}"
        data["gcs_blob"] = mp3_blob_name
        data["gcs_folder"] = folder
        data["gcs_signed_url"] = signed_url
        data["audio_url"] = signed_url
        return data
    except Exception as e:
        print(f"[PodcastService GCS Warning] {e}")

    return None


def create_or_refresh_podcast(
    video_id: str,
    title: str,
    text: str,
    mode: str = "study",
    course_name: Optional[str] = None,
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Generate or retrieve a podcast audio recap for a lecture via pure 2-layer SLM pipeline.
    Saves audio and metadata directly to Google Cloud Storage alongside the lecture video.
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    key = f"{clean_vid}_{clean_mode}"

    if not force_refresh:
        existing = get_podcast_metadata(clean_vid, clean_mode, course_name=course_name)
        if existing and existing.get("exists"):
            return existing

    with _active_generations_lock:
        _active_generations.add(key)

    try:
        # Pure 2-layer SLM pipeline (Writer SLM -> Voice Director SLM)
        script = generate_podcast_script_2layer(title=title, text=text, mode=clean_mode)

        # Synthesize audio with Google Cloud TTS
        audio_bytes = synthesize_speech_google(script)

        metadata = {
            "exists": True,
            "video_id": clean_vid,
            "mode": clean_mode,
            "title": title,
            "script": script,
            "file_size": len(audio_bytes),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "ready"
        }

        # Upload directly to Google Cloud Storage alongside the lecture video
        metadata = upload_podcast_to_gcs(
            video_id=clean_vid,
            mode=clean_mode,
            audio_bytes=audio_bytes,
            metadata=metadata,
            course_name=course_name
        )

        return metadata
    finally:
        with _active_generations_lock:
            _active_generations.discard(key)


def trigger_background_podcast_generation(
    video_id: str,
    title: str,
    text: str,
    mode: str = "study",
    course_name: Optional[str] = None,
    force_refresh: bool = False
) -> None:
    """
    Fire-and-forget background synthesis of podcast audio directly into GCS.
    """
    clean_vid = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(video_id).strip())
    clean_mode = "submission" if mode == "submission" else "study"
    key = f"{clean_vid}_{clean_mode}"

    # Avoid duplicate concurrent generation
    if is_podcast_generating(clean_vid, clean_mode):
        print(f"[PodcastService] Generation already in progress for '{clean_vid}_{clean_mode}'. Skipping duplicate trigger.")
        return

    if not force_refresh:
        meta = get_podcast_metadata(clean_vid, clean_mode, course_name=course_name)
        if meta and meta.get("exists"):
            return

    def _worker():
        try:
            create_or_refresh_podcast(
                video_id=clean_vid,
                title=title,
                text=text,
                mode=clean_mode,
                course_name=course_name,
                force_refresh=True
            )
        except Exception as e:
            print(f"[PodcastService] Background worker error for '{clean_vid}': {e}")

    thread = threading.Thread(target=_worker, daemon=True, name=f"podcast-{clean_vid}-{clean_mode}")
    thread.start()
