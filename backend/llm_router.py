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
from dotenv import load_dotenv

load_dotenv()

REDIS_MODELS_METADATA_KEY = "ls:llm_router:models_metadata"
REDIS_MODELS_CACHE_TTL = 86400  # 24 hours retention


class TaskType(str, Enum):
    COMPREHENSIVE_SUMMARY = "comprehensive_summary"  # 8k - 20k tokens: requires massive context & high TPM
    SUBMISSION = "submission"                        # 1k - 4k tokens: clean prose, student voice, pseudo-math
    SUMMARY_SECTIONS = "summary_sections"            # 2k - 5k tokens: structured JSON breakdown
    QUIZ = "quiz"                                    # 2k - 4k tokens: multiple choice JSON
    CORRECTION = "correction"                        # multimodal audio + transcript text proofreading
    GENERAL = "general"                              # general QA and agentic search


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
                for name, saved in data.items():
                    spec = self._models.get(name)
                    if spec and isinstance(saved, dict):
                        spec.cooldown_until = float(saved.get("cooldown_until", 0.0))
                        spec.consecutive_errors = int(saved.get("consecutive_errors", 0))
                        spec.last_error = str(saved.get("last_error", ""))
                        spec.last_status = int(saved.get("last_status", 200))
                self._last_redis_sync = time.time()
                print(f"⚡ [LLMRouter] Restored model metadata and cooldowns from Redis (TTL: 24h).")
        except Exception as e:
            print(f"⚠️ [LLMRouter] Could not load model metadata from Redis ({e}). Using in-memory defaults.")

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
        task_type: TaskType = TaskType.GENERAL,
        est_tokens: int = 0,
        multimodal: bool = False
    ) -> List[ModelSpec]:
        """
        Return ordered list of models best suited for the given task and token load.
        Filters out models on cooldown or with insufficient TPM/context.
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

        else:
            candidates.sort(key=lambda m: m.priority)

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
