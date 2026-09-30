# ===================================================================
# File: backend/slm_router.py
# -------------------------------------------------------------------
# Hardened Hugging Face InferenceClient Cloud Intent Router
# ===================================================================

import os
import re
from typing import List, Dict, Any, Optional
try:
    from huggingface_hub import InferenceClient
    HAS_HF = True
except ImportError:
    InferenceClient = None
    HAS_HF = False

INTENT_SUMMARY = "SUMMARY"
INTENT_CHAT = "CHAT"

def slm_classify_intent(
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    video_title: Optional[str] = None,
) -> str:
    """
    Classifies a user query into SUMMARY or CHAT via an explicit dual-stage layer.
    Uses regex rules first for perfect keyword catching, then executes an HF Cloud call.
    """
    if not query or not query.strip():
        return INTENT_CHAT

    clean_query = query.strip().lower()

    # =================================================================
    # LAYER 1: DETERMINISTIC HEURISTIC GATEWAY (Failsafe for Summaries)
    # =================================================================
    # If the student explicitly demands a summary or reading guide, force it immediately.
    summary_keywords = [
        r"\bsummary\b", r"\bsummarise\b", r"\bsummarize\b", r"\boverview\b", 
        r"\brecap\b", r"\bwalkthrough\b", r"\bread\b", r"\bguide\b", r"\bnotes\b",
        r"\btldr\b", r"\bbreakdown\b", r"\btakeaway\b", r"\btakeaways\b"
    ]
    if any(re.search(pattern, clean_query) for pattern in summary_keywords):
        print("🧭 [Router Layer 1] Match Found! Forcing SUMMARY Route via Heuristic Match.")
        return INTENT_SUMMARY

    # =================================================================
    # LAYER 2: HUGGING FACE SERVERLESS CLOUD ROUTER
    # =================================================================
    if not HAS_HF:
        print("⚠️ [Router Warning] 'huggingface_hub' not installed. Defaulting to CHAT.")
        return INTENT_CHAT
    model_id = os.getenv("LLAMA_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
    hf_token = os.getenv("HUGGINGFACE_TOKEN","")

    system_prompt = (
        "You are an absolute, strict binary intent router for an academic lecture chatbot. "
        "Your task is to classify the user's input query into exactly one word: either 'SUMMARY' or 'CHAT'.\n\n"
        "DEFINITIONS:\n"
        "- SUMMARY: The user wants an overview, full lecture notes, structured takeaways, or a long-form chronological reading guide.\n"
        "- CHAT: The user is asking a specific question, a technical formula derivation, an implementation problem, or a single pinpoint detail.\n\n"
        "CRITICAL CONSTRAINT: Output ONLY the single uppercase word 'SUMMARY' or 'CHAT'. Do not include punctuation, reasoning, markdown backticks, or introduction text."
    )

    user_payload_lines = []
    if video_title:
        user_payload_lines.append(f"Lecture File Title: {video_title}")
    if chat_history:
        history_snippet = [
            f"{(m.get('role') or m.get('sender') or 'user').upper()}: {(m.get('content') or m.get('text') or '')[:150]}"
            for m in chat_history[-3:]
            if (m.get('content') or m.get('text'))
        ]
        if history_snippet:
            user_payload_lines.append("Recent chat history turns:\n" + "\n".join(history_snippet))
            
    user_payload_lines.append(f"Target Input Query to Classify: {query.strip()}")
    user_payload_lines.append("Classification token assignment (SUMMARY or CHAT):")
    user_prompt = "\n\n".join(user_payload_lines)

    try:
        client = InferenceClient(api_key=hf_token)
        
        completion = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.0,      # Absolute zero for greedy token extraction
            max_tokens=3,         # Hard cap to cut off any verbose filler
            top_p=0.001
        )
        
        raw_output = completion.choices.message.content or ""
        text = raw_output.strip().upper()
        text = re.sub(r"[^A-Z]", "", text) # Isolate pure alphanumeric response tokens

        if "SUMMARY" in text:
            return INTENT_SUMMARY
        return INTENT_CHAT
        
    except Exception as e:
        print(f"⚠️ [Hugging Face Cloud Router Exception]: {e}. Defaulting to CHAT path.")
        return INTENT_CHAT
