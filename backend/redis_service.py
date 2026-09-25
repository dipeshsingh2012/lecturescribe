"""
Hosted Redis Cache Service for LectureScribe
--------------------------------------------
Provides distributed, sub-millisecond caching for:
1. RAG Query Responses (ls:rag:query:{video_id}:{hash})
2. Deterministic Agent Tools (ls:rag:tool:{video_id}:{tool_name}:{hash})
3. Video Metadata & Summaries
"""
from __future__ import annotations

import os
import re
import json
import time
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, List

try:
    from dotenv import load_dotenv
    _env_file = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.exists():
        load_dotenv(dotenv_path=_env_file, override=True)
    else:
        load_dotenv(override=True)
except ImportError:
    pass

try:
    import redis
    HAS_REDIS = True
except ImportError:
    redis = None
    HAS_REDIS = False


class RedisCacheService:
    """High-performance Redis Caching Service for LectureScribe."""

    def __init__(self, redis_url: Optional[str] = None):
        self.explicit_url = redis_url
        self.client: Optional[redis.Redis] = None
        self.enabled: bool = os.getenv("REDIS_CACHE_ENABLED", "true").lower() == "true"
        
        # TTL configuration (default: 30 days; 0 = indefinite)
        ttl_days_str = os.getenv("REDIS_CACHE_TTL_DAYS", "30")
        try:
            ttl_days = int(ttl_days_str)
            self.default_ttl: Optional[int] = (ttl_days * 86400) if ttl_days > 0 else None
        except ValueError:
            self.default_ttl = 30 * 86400

        self._init_connection()

    @property
    def redis_url(self) -> Optional[str]:
        return self.explicit_url or os.getenv("REDIS_URL")

    def _init_connection(self):
        """Establish Redis connection with fail-fast socket timeouts."""
        url = self.redis_url
        if not self.enabled or not url:
            return

        if not HAS_REDIS:
            print("⚠️ [Redis Notice] 'redis' library not installed. Caching inactive.")
            return

        try:
            timeout = float(os.getenv("REDIS_SOCKET_TIMEOUT", "2.0"))
            self.client = redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=timeout,
                socket_connect_timeout=timeout
            )
            # Test connection
            self.client.ping()
            masked_host = url.split("@")[-1] if "@" in url else "configured host"
            print(f"⚡ [Redis Cache] Connected to Hosted Redis ({masked_host}). Caching active.")
        except Exception as e:
            print(f"⚠️ [Redis Warning] Could not connect to Redis ({e}). Caching bypassed.")
            self.client = None

    def is_connected(self) -> bool:
        """Check if Redis client is connected and responsive."""
        if not self.client or not self.enabled:
            return False
        try:
            return bool(self.client.ping())
        except Exception:
            return False

    def normalize_query(self, query: str) -> str:
        """
        Normalize query string to maximize cache hit rate:
        - Lowercase
        - Strip whitespace
        - Remove peripheral punctuation (. ? ! , ; : " ')
        - Collapse multiple spaces
        """
        q = (query or "").lower().strip()
        q = re.sub(r"^[\W_]+|[\W_]+$", "", q)
        q = re.sub(r"\s+", " ", q)
        return q

    def make_query_key(self, video_id: str, query: str, model_id: str = "") -> str:
        """Generate deterministic cache key for a RAG query."""
        clean_vid = str(video_id or "").strip()
        norm_q = self.normalize_query(query)
        clean_model = str(model_id or "auto").strip().lower()
        seed = f"{clean_vid}:{norm_q}:{clean_model}"
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        return f"ls:rag:query:{clean_vid}:{digest}"

    def make_tool_key(self, video_id: str, tool_name: str, args: Dict[str, Any]) -> str:
        """Generate deterministic cache key for an agent tool execution."""
        clean_vid = str(video_id or "").strip()
        args_sorted = json.dumps(args, sort_keys=True)
        digest = hashlib.sha256(args_sorted.encode("utf-8")).hexdigest()[:16]
        return f"ls:rag:tool:{clean_vid}:{tool_name}:{digest}"

    # ---------------------------------------------------------
    # RAG Query Cache Operations
    # ---------------------------------------------------------

    def get_query(self, video_id: str, query: str, model_id: str = "") -> Optional[Dict[str, Any]]:
        """Retrieve cached RAG answer and submission text if present."""
        if not self.client or not self.enabled:
            return None

        key = self.make_query_key(video_id, query, model_id)
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                data["cached"] = True
                data["cache_tier"] = "REDIS"
                return data
        except Exception as e:
            print(f"[Redis Cache Warning] Query cache read error: {e}")
        return None

    def set_query(
        self,
        video_id: str,
        query: str,
        model_id: str,
        data: Dict[str, Any],
        ttl_seconds: Optional[int] = None
    ) -> bool:
        """Store RAG answer and submission text in Redis."""
        if not self.client or not self.enabled:
            return False

        key = self.make_query_key(video_id, query, model_id)
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        try:
            # Create a serializable clone
            payload = {
                "answer": data.get("answer", ""),
                "citations": data.get("citations", []),
                "web_sources": data.get("web_sources", []),
                "model": data.get("model", ""),
                "pinecone_vector_matches": data.get("pinecone_vector_matches", 0),
                "lecture_title": data.get("lecture_title", ""),
                "video_id": data.get("video_id", video_id),
                "submission_text": data.get("submission_text", ""),
                "submission_word_count": data.get("submission_word_count", 0),
                "cached_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            val_str = json.dumps(payload)
            if ttl and ttl > 0:
                self.client.setex(key, ttl, val_str)
            else:
                self.client.set(key, val_str)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Query cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Tool Result Cache Operations
    # ---------------------------------------------------------

    def get_tool(self, video_id: str, tool_name: str, args: Dict[str, Any]) -> Optional[str]:
        """Retrieve cached output string for a deterministic tool call."""
        if not self.client or not self.enabled:
            return None

        key = self.make_tool_key(video_id, tool_name, args)
        try:
            return self.client.get(key)
        except Exception as e:
            print(f"[Redis Cache Warning] Tool cache read error: {e}")
            return None

    def set_tool(
        self,
        video_id: str,
        tool_name: str,
        args: Dict[str, Any],
        result_str: str,
        ttl_seconds: Optional[int] = None
    ) -> bool:
        """Store deterministic tool call result in Redis."""
        if not self.client or not self.enabled:
            return False

        key = self.make_tool_key(video_id, tool_name, args)
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        try:
            if ttl and ttl > 0:
                self.client.setex(key, ttl, result_str)
            else:
                self.client.set(key, result_str)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Tool cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Invalidation & Administration
    # ---------------------------------------------------------

    def invalidate_video(self, video_id: str) -> int:
        """Purge all cached queries and tool results for a specific lecture."""
        if not self.client or not self.enabled or not video_id:
            return 0

        clean_vid = str(video_id).strip()
        deleted_count = 0
        try:
            # Find and delete both query and tool keys for this video
            patterns = [f"ls:rag:query:{clean_vid}:*", f"ls:rag:tool:{clean_vid}:*"]
            for pat in patterns:
                cursor = 0
                while True:
                    cursor, keys = self.client.scan(cursor=cursor, match=pat, count=100)
                    if keys:
                        deleted_count += self.client.delete(*keys)
                    if cursor == 0:
                        break
            print(f"🗑️ [Redis Cache] Invalidated {deleted_count} cache keys for video '{clean_vid}'.")
        except Exception as e:
            print(f"[Redis Cache Warning] Invalidation error for video '{clean_vid}': {e}")
        return deleted_count

    def get_status(self) -> Dict[str, Any]:
        """Status check payload for /health endpoint."""
        if not self.enabled:
            return {"status": "Disabled", "connected": False}
        if not self.client:
            return {"status": "Disconnected", "connected": False}
        try:
            t0 = time.time()
            self.client.ping()
            ping_ms = round((time.time() - t0) * 1000, 2)
            return {
                "status": "Connected (Hosted Redis)",
                "connected": True,
                "latency_ms": ping_ms,
                "ttl_days": self.default_ttl // 86400 if self.default_ttl else "Indefinite"
            }
        except Exception as e:
            return {"status": f"Error ({e})", "connected": False}


# Singleton instance
redis_cache = RedisCacheService()
