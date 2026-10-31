"""
backend/llm_router.py

Intelligent, capability-aware LLM router and model registry.
Persists model metadata, cooldowns, and operational health in Redis with 24-hour cache retention
so server restarts retain rate-limit and quota state across Google Gemini and Groq.
"""

import os
import json
import time
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

REDIS_MODELS_METADATA_KEY = "ls:llm_router:models_metadata"
REDIS_MODELS_CACHE_TTL = 86400  # 24 hours retention


class TaskType(str, Enum):
    COMPREHENSIVE_SUMMARY = "comprehensive_summary"  # 8k - 20k tokens: requires massive context & high TPM
    SUBMISSION = "submission"                        # 1k - 4k tokens: clean prose, student voice, pseudo-math
    SUMMARY_SECTIONS = "summary_sections"            # 2k - 5k tokens: structured JSON breakdown
    QUIZ = "quiz"                                    # 2k - 4k tokens: multiple choice JSON
    CORRECTION = "correction"                        # multimodal audio + transcript text proofreading
    ASSIGNMENT = "assignment"                        # code + markdown generation with RAG context


@dataclass
class ModelSpec:
    name: str
    provider: str  # "gemini" | "groq"
    context_window: int
    tpm_limit: int
    rpm_limit: int = 60
    supports_multimodal: bool = False
    supports_json: bool = True
    priority: int = 1
    cooldown_until: float = 0.0
    consecutive_errors: int = 0
    last_error: str = ""
    last_status: int = 200

    def is_available(self, required_tokens: int = 0) -> bool:
        """Check if model is off cooldown and can physically fit required tokens."""
        now = time.time()
        if self.cooldown_until > now:
            return False
        if required_tokens > 0:
            if required_tokens > self.context_window:
                return False
            # For TPM-constrained on-demand tiers (e.g. Groq 8k TPM), prompt must fit well below TPM
            if self.tpm_limit < 50000 and required_tokens > (self.tpm_limit - 1000):
                return False
        return True


class LLMRouter:
    """Capability-aware router backed by Redis with 24-hour retention across server restarts."""

    def __init__(self):
        self._lock = threading.Lock()
        self._last_redis_sync = 0.0
        self._models: Dict[str, ModelSpec] = {
            # --- Google Gemini Active 2026 Models (1M Context, Massive Throughput) ---
            "gemini-flash-lite-latest": ModelSpec(
                name="gemini-flash-lite-latest",
                provider="gemini",
                context_window=1048576,
                tpm_limit=1000000,
                supports_multimodal=True,
                supports_json=True,
                priority=1,
            ),
            "gemini-3.5-flash-lite": ModelSpec(
                name="gemini-3.5-flash-lite",
                provider="gemini",
                context_window=1048576,
                tpm_limit=1000000,
                supports_multimodal=True,
                supports_json=True,
                priority=2,
            ),
            "gemini-3.1-flash-lite-preview": ModelSpec(
                name="gemini-3.1-flash-lite-preview",
                provider="gemini",
                context_window=1048576,
                tpm_limit=1000000,
                supports_multimodal=True,
                supports_json=True,
                priority=3,
            ),
            "gemma-4-26b-a4b-it": ModelSpec(
                name="gemma-4-26b-a4b-it",
                provider="gemini",
                context_window=131072,
                tpm_limit=1000000,
                supports_multimodal=False,
                supports_json=True,
                priority=4,
            ),
            "gemini-flash-latest": ModelSpec(
                name="gemini-flash-latest",
                provider="gemini",
                context_window=1048576,
                tpm_limit=1000000,
                supports_multimodal=True,
                supports_json=True,
                priority=5,
            ),
            "gemini-3.8-flash": ModelSpec(
                name="gemini-3.8-flash",
                provider="gemini",
                context_window=1048576,
                tpm_limit=1000000,
                supports_multimodal=True,
                supports_json=True,
                priority=6,
            ),

            # --- Groq Models (Ultra-fast SLM/LLM inference, 8k TPM On-Demand Tier) ---
            "openai/gpt-oss-120b": ModelSpec(
                name="openai/gpt-oss-120b",
                provider="groq",
                context_window=131072,
                tpm_limit=int(os.getenv("GROQ_TPM_LIMIT", "8000")),
                supports_multimodal=False,
                supports_json=True,
                priority=1,
            ),
            "qwen/qwen3.8-27b": ModelSpec(
                name="qwen/qwen3.8-27b",
                provider="groq",
                context_window=32768,
                tpm_limit=int(os.getenv("GROQ_ITPM_LIMIT_QWEN", "7000")),
                supports_multimodal=False,
                supports_json=True,
                priority=2,
            ),
            "openai/gpt-oss-20b": ModelSpec(
                name="openai/gpt-oss-20b",
                provider="groq",
                context_window=131072,
                tpm_limit=int(os.getenv("GROQ_TPM_LIMIT", "8000")),
                supports_multimodal=False,
                supports_json=True,
                priority=3,
            ),
        }
        # Hydrate dynamic state from Redis on startup
        self._load_from_redis()

    def _get_redis_client(self):
        """Safely retrieve Redis client from redis_service if available."""
        try:
            from backend.redis_service import redis_cache
            if redis_cache and redis_cache.enabled and redis_cache.client:
                return redis_cache.client
        except Exception:
            pass
        return None

    def _load_from_redis(self):
        """Restore model metadata, error history, and cooldowns from Redis."""
        client = self._get_redis_client()
        if not client:
            return

        try:
            raw = client.get(REDIS_MODELS_METADATA_KEY)
            if not raw:
                # Seed initial baseline into Redis with 24h retention
                self._save_to_redis()
                return

            data = json.loads(raw)
            if isinstance(data, dict):
                with self._lock:
                    for name, saved in data.items():
                        if not isinstance(saved, dict):
                            continue
                        spec = self._models.get(name)
                        if spec:
                            spec.cooldown_until = float(saved.get("cooldown_until", 0.0))
                            spec.consecutive_errors = int(saved.get("consecutive_errors", 0))
                            spec.last_error = str(saved.get("last_error", ""))
                            spec.last_status = int(saved.get("last_status", 200))
                        else:
                            # Dynamically restore discovered models saved in Redis
                            self._models[name] = ModelSpec(
                                name=name,
                                provider=saved.get("provider", "gemini"),
                                context_window=int(saved.get("context_window", 1048576)),
                                tpm_limit=int(saved.get("tpm_limit", 1000000)),
                                supports_multimodal=bool(saved.get("supports_multimodal", True)),
                                supports_json=bool(saved.get("supports_json", True)),
                                priority=int(saved.get("priority", 10)),
                                cooldown_until=float(saved.get("cooldown_until", 0.0)),
                                consecutive_errors=int(saved.get("consecutive_errors", 0)),
                                last_error=str(saved.get("last_error", "")),
                                last_status=int(saved.get("last_status", 200))
                            )
                self._last_redis_sync = time.time()
                print(f"⚡ [LLMRouter] Restored {len(data)} models and cooldowns from Redis (TTL: 24h).")
        except Exception as e:
            print(f"⚠️ [LLMRouter] Could not load model metadata from Redis ({e}). Using in-memory defaults.")

    def sync_available_models_to_redis(self) -> List[Dict[str, Any]]:
        """
        Probe provider endpoints (Gemini & Groq), register live available models,
        filter out deprecated ones, and persist metadata to Redis on server start.
        """
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        groq_key = os.getenv("GROQ_API_KEY", "").strip()

        # 1. Probe Google Gemini Models
        if gemini_key and requests:
            try:
                r = requests.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={gemini_key}",
                    timeout=10
                )
                if r.status_code == 200:
                    g_models = r.json().get("models", [])
                    with self._lock:
                        for gm in g_models:
                            m_name = gm.get("name", "").replace("models/", "").strip()
                            methods = gm.get("supportedGenerationMethods", [])
                            if "generateContent" in methods and not any(x in m_name for x in ("embedding", "aqa", "imagen", "tts")):
                                ctx = gm.get("inputTokenLimit", 1048576)
                                is_38 = "3.8-flash" in m_name
                                is_lite = "flash-lite" in m_name
                                prio = 1 if is_38 else (2 if is_lite else 5)
                                if m_name in self._models:
                                    self._models[m_name].context_window = ctx
                                    self._models[m_name].priority = prio
                                else:
                                    self._models[m_name] = ModelSpec(
                                        name=m_name,
                                        provider="gemini",
                                        context_window=ctx,
                                        tpm_limit=1000000,
                                        supports_multimodal=True,
                                        supports_json=True,
                                        priority=prio
                                    )
                    print(f"✅ [LLMRouter] Synced active Gemini models from Google API.")
            except Exception as e:
                print(f"⚠️ [LLMRouter] Could not probe Gemini models API ({e}). Keeping cached models.")

        # 2. Probe Groq Models
        if groq_key and requests:
            try:
                r = requests.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {groq_key}"},
                    timeout=10
                )
                if r.status_code == 200:
                    q_models = r.json().get("data", [])
                    with self._lock:
                        for qm in q_models:
                            qid = qm.get("id", "").strip()
                            if qm.get("active", True) and not any(x in qid for x in ("whisper", "embedding", "tts")):
                                ctx = qm.get("context_window", 131072)
                                prio = 1 if "120b" in qid else 2
                                if qid in self._models:
                                    self._models[qid].context_window = ctx
                                    self._models[qid].priority = prio
                                else:
                                    self._models[qid] = ModelSpec(
                                        name=qid,
                                        provider="groq",
                                        context_window=ctx,
                                        tpm_limit=int(os.getenv("GROQ_TPM_LIMIT", "8000")),
                                        supports_multimodal=False,
                                        supports_json=True,
                                        priority=prio
                                    )
                    print(f"✅ [LLMRouter] Synced active Groq models from Groq API.")
            except Exception as e:
                print(f"⚠️ [LLMRouter] Could not probe Groq models API ({e}). Keeping cached models.")

        # 3. Persist to Redis
        self._save_to_redis()
        return self.get_available_models_for_client()

    def get_available_models_for_client(self) -> List[Dict[str, Any]]:
        """
        Return the list of active models directly from Redis/memory formatted for UI selection.
        """
        self._load_from_redis()
        out = []
        now = time.time()
        gemini_key = bool(os.getenv("GEMINI_API_KEY", "").strip())
        groq_key = bool(os.getenv("GROQ_API_KEY", "").strip())

        with self._lock:
            for spec in self._models.values():
                # Filter out models if provider key is absent (unless in test mode where neither key is present)
                if (gemini_key or groq_key):
                    if spec.provider == "gemini" and not gemini_key:
                        continue
                    if spec.provider == "groq" and not groq_key:
                        continue

                # Filter out models currently on cooldown
                if spec.cooldown_until > now:
                    continue

                provider_display = "Google Gemini" if spec.provider == "gemini" else "Groq"
                is_recommended = (spec.name == "gemini-3.8-flash")

                display_name = spec.name
                if "gemini-3.8-flash" in spec.name:
                    display_name = "Gemini 3.8 Flash (Recommended)"
                elif "gemini-flash-lite-latest" in spec.name:
                    display_name = "Gemini Flash Lite Latest"
                elif "gemini-3.5-flash-lite" in spec.name:
                    display_name = "Gemini 3.5 Flash Lite"
                elif "120b" in spec.name:
                    display_name = "Groq GPT-OSS 120B"
                elif "27b" in spec.name:
                    display_name = "Groq Qwen 3.8 27B"
                elif "20b" in spec.name:
                    display_name = "Groq GPT-OSS 20B"

                out.append({
                    "id": spec.name,
                    "displayName": display_name,
                    "provider": provider_display,
                    "contextWindow": spec.context_window,
                    "isRecommended": is_recommended,
                    "supportsJson": spec.supports_json,
                    "priority": 0 if is_recommended else (spec.priority if spec.provider == "gemini" else 10 + spec.priority)
                })

        out.sort(key=lambda x: x["priority"])
        return out

    def _save_to_redis(self):
        """Persist model metadata and cooldown state to Redis with a 24-hour TTL."""
        client = self._get_redis_client()
        if not client:
            return

        try:
            payload = {}
            for name, m in self._models.items():
                payload[name] = {
                    "name": m.name,
                    "provider": m.provider,
                    "context_window": m.context_window,
                    "tpm_limit": m.tpm_limit,
                    "cooldown_until": m.cooldown_until,
                    "consecutive_errors": m.consecutive_errors,
                    "last_error": m.last_error,
                    "last_status": m.last_status,
                    "last_updated": time.time(),
                }
            client.set(REDIS_MODELS_METADATA_KEY, json.dumps(payload), ex=REDIS_MODELS_CACHE_TTL)
            self._last_redis_sync = time.time()
        except Exception as e:
            print(f"⚠️ [LLMRouter] Could not persist model metadata to Redis ({e}).")

    def record_success(self, model_name: str):
        """Reset consecutive error counts on successful generation and sync to Redis."""
        with self._lock:
            spec = self._models.get(model_name)
            if spec:
                spec.consecutive_errors = 0
                spec.last_status = 200
                spec.cooldown_until = 0.0
            self._save_to_redis()

    def record_error(self, model_name: str, status_code: int = 500, error_msg: str = ""):
        """Mark model with temporary cooldown according to error severity and sync to Redis."""
        with self._lock:
            spec = self._models.get(model_name)
            if not spec:
                return
            spec.consecutive_errors += 1
            spec.last_status = status_code
            spec.last_error = str(error_msg)[:200]
            now = time.time()

            if status_code == 429:
                # Rate limit / quota exhausted: 60s cooldown
                cooldown_sec = 60.0 * min(spec.consecutive_errors, 5)
                spec.cooldown_until = now + cooldown_sec
                print(f"⏳ [LLMRouter] Model '{model_name}' hit 429. Cooldown for {cooldown_sec:.0f}s (saved to Redis).")
            elif status_code == 404:
                # Deprecated or nonexistent: 1 hour cooldown
                spec.cooldown_until = now + 3600.0
                print(f"🚫 [LLMRouter] Model '{model_name}' returned 404 (deprecated). Cooldown for 1hr (saved to Redis).")
            elif status_code in (500, 502, 503, 504):
                # Temporary server error or high demand: 20s cooldown
                spec.cooldown_until = now + 20.0
                print(f"⚠️ [LLMRouter] Model '{model_name}' returned {status_code}. Cooldown for 20s (saved to Redis).")
            elif status_code == 413:
                # Request too large for model TPM limit: 5s cooldown
                spec.cooldown_until = now + 5.0
                print(f"⚠️ [LLMRouter] Model '{model_name}' returned 413 (Payload too large).")

            self._save_to_redis()

    def get_candidate_models(
        self,
        task_type: TaskType,
        est_tokens: int = 0,
        multimodal: bool = False,
        preferred_model: Optional[str] = None
    ) -> List[ModelSpec]:
        """
        Return ordered list of models best suited for the given task and token load.
        Filters out models on cooldown or with insufficient TPM/context.
        If preferred_model is provided, it is hoisted to the front of candidate list.
        """
        # Periodic resync with Redis if more than 30s have elapsed
        if time.time() - self._last_redis_sync > 30.0:
            self._load_from_redis()

        gemini_key = bool(os.getenv("GEMINI_API_KEY", "").strip())
        groq_key = bool(os.getenv("GROQ_API_KEY", "").strip())

        with self._lock:
            candidates: List[ModelSpec] = []
            for spec in self._models.values():
                if spec.provider == "gemini" and not gemini_key:
                    continue
                if spec.provider == "groq" and not groq_key:
                    continue
                if multimodal and not spec.supports_multimodal:
                    continue
                if spec.is_available(est_tokens):
                    candidates.append(spec)

            # If all candidates for a provider are on cooldown, fall back to best-effort available
            if not candidates:
                for spec in self._models.values():
                    if spec.provider == "gemini" and not gemini_key:
                        continue
                    if spec.provider == "groq" and not groq_key:
                        continue
                    if multimodal and not spec.supports_multimodal:
                        continue
                    if spec.context_window >= est_tokens:
                        candidates.append(spec)

        # Capability-based ordering strategy:
        if task_type == TaskType.COMPREHENSIVE_SUMMARY:
            # Full transcripts (often 8k - 20k tokens): Gemini is strictly prioritized.
            # Groq's 8k TPM limit will guarantee 413 on large transcripts, so Groq is only
            # considered if est_tokens is safely < 5000.
            def summary_sort(m: ModelSpec):
                provider_weight = 0 if m.provider == "gemini" else 10
                return (provider_weight, m.priority)
            candidates.sort(key=summary_sort)

        elif task_type == TaskType.SUBMISSION:
            # Plain-text flowing prose (< 4k tokens): Groq excels at latency and instruction following.
            # Gemini is the rock-solid fallback.
            def submission_sort(m: ModelSpec):
                provider_weight = 0 if m.provider == "groq" else 5
                return (provider_weight, m.priority)
            candidates.sort(key=submission_sort)

        elif task_type in (TaskType.SUMMARY_SECTIONS, TaskType.QUIZ):
            # Fast structured JSON outputs: Gemini Flash Lite and Groq are both high performance.
            def structured_sort(m: ModelSpec):
                return m.priority
            candidates.sort(key=structured_sort)

        elif task_type == TaskType.CORRECTION:
            # Multimodal audio cues require Gemini first
            def correction_sort(m: ModelSpec):
                multimodal_weight = 0 if m.supports_multimodal else 10
                return (multimodal_weight, m.priority)
            candidates.sort(key=correction_sort)

        elif task_type == TaskType.ASSIGNMENT:
            # Research synthesis, academic documents & notebook code solutions:
            # Gemini 3.8 Flash is specifically prioritized for deep reasoning, 1M context, and 8k+ output tokens.
            def assignment_sort(m: ModelSpec):
                is_gemini_38 = 0 if m.name == "gemini-3.8-flash" else (1 if m.provider == "gemini" else 10)
                return (is_gemini_38, m.priority)
            candidates.sort(key=assignment_sort)

        else:
            candidates.sort(key=lambda m: m.priority)

        # Hoist user's selected/preferred model to the very top if requested
        if preferred_model:
            pref_name = preferred_model.strip()
            pref_spec = next((c for c in candidates if c.name == pref_name), None)
            if pref_spec:
                candidates = [c for c in candidates if c.name != pref_name]
                candidates.insert(0, pref_spec)
            else:
                with self._lock:
                    raw_spec = self._models.get(pref_name)
                    if raw_spec:
                        has_key = (raw_spec.provider == "gemini" and gemini_key) or (raw_spec.provider == "groq" and groq_key)
                        if has_key:
                            candidates.insert(0, raw_spec)

        return candidates

    def get_status_overview(self) -> Dict[str, Any]:
        """Diagnostic snapshot of all models in the registry including Redis persistence state."""
        client = self._get_redis_client()
        redis_ttl = -1
        if client:
            try:
                redis_ttl = client.ttl(REDIS_MODELS_METADATA_KEY)
            except Exception:
                pass

        with self._lock:
            now = time.time()
            return {
                "redis_persistence": {
                    "connected": client is not None,
                    "key": REDIS_MODELS_METADATA_KEY,
                    "retention_seconds": REDIS_MODELS_CACHE_TTL,
                    "current_ttl_seconds": redis_ttl,
                },
                "active_models": [
                    {
                        "name": m.name,
                        "provider": m.provider,
                        "context_window": m.context_window,
                        "tpm_limit": m.tpm_limit,
                        "available": m.is_available(),
                        "cooling_down": m.cooldown_until > now,
                        "cooldown_remaining_sec": max(0, int(m.cooldown_until - now)),
                        "last_status": m.last_status,
                        "consecutive_errors": m.consecutive_errors,
                        "last_error": m.last_error,
                    }
                    for m in self._models.values()
                ]
            }


# Singleton instance for the application
llm_router = LLMRouter()
