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


RAG_CACHE_VERSION = "v2"


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
        """Generate deterministic cache key for a RAG query (namespaced by pipeline version)."""
        clean_vid = str(video_id or "").strip()
        norm_q = self.normalize_query(query)
        clean_model = str(model_id or "auto").strip().lower()
        seed = f"{clean_vid}:{norm_q}:{clean_model}"
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        return f"ls:rag:{RAG_CACHE_VERSION}:query:{clean_vid}:{digest}"

    def make_tool_key(self, video_id: str, tool_name: str, args: Dict[str, Any]) -> str:
        """Generate deterministic cache key for an agent tool execution."""
        clean_vid = str(video_id or "").strip()
        args_sorted = json.dumps(args, sort_keys=True)
        digest = hashlib.sha256(args_sorted.encode("utf-8")).hexdigest()[:16]
        return f"ls:rag:{RAG_CACHE_VERSION}:tool:{clean_vid}:{tool_name}:{digest}"

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
    # Quiz Cache Operations
    # ---------------------------------------------------------

    def get_quiz(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached quiz questions for a lecture."""
        if not self.client or not self.enabled or not video_id:
            return None

        clean_vid = str(video_id).strip()
        key = f"ls:quiz:{clean_vid}"
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    data["cached"] = True
                    data["cache_tier"] = "REDIS"
                    return data
        except Exception as e:
            print(f"[Redis Cache Warning] Quiz cache read error: {e}")
        return None

    def set_quiz(
        self,
        video_id: str,
        quiz_data: Dict[str, Any],
        ttl_seconds: Optional[int] = 86400
    ) -> bool:
        """Store generated quiz questions in Redis (default 24h)."""
        if not self.client or not self.enabled or not video_id:
            return False

        clean_vid = str(video_id).strip()
        key = f"ls:quiz:{clean_vid}"
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        try:
            val_str = json.dumps(quiz_data)
            if ttl and ttl > 0:
                self.client.setex(key, ttl, val_str)
            else:
                self.client.set(key, val_str)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Quiz cache write error: {e}")
            return False

    def get_course_quiz(self, course_slug: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached course-level quiz questions."""
        if not self.client or not self.enabled or not course_slug:
            return None

        clean_slug = str(course_slug).strip().lower()
        key = f"ls:course_quiz:{clean_slug}"
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    data["cached"] = True
                    data["cache_tier"] = "REDIS"
                    return data
        except Exception as e:
            print(f"[Redis Cache Warning] Course quiz cache read error: {e}")
        return None

    def set_course_quiz(
        self,
        course_slug: str,
        quiz_data: Dict[str, Any],
        ttl_seconds: Optional[int] = 86400
    ) -> bool:
        """Store generated course-level quiz questions in Redis (default 24h)."""
        if not self.client or not self.enabled or not course_slug:
            return False

        clean_slug = str(course_slug).strip().lower()
        key = f"ls:course_quiz:{clean_slug}"
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        try:
            val_str = json.dumps(quiz_data)
            if ttl and ttl > 0:
                self.client.setex(key, ttl, val_str)
            else:
                self.client.set(key, val_str)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Course quiz cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Course Summary Cache Operations
    # ---------------------------------------------------------

    def get_course_summary(self, course_slug: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached course-level executive summary."""
        if not self.client or not self.enabled or not course_slug:
            return None

        clean_slug = str(course_slug).strip().lower()
        key = f"ls:course_summary:{clean_slug}"
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    data["cached"] = True
                    data["cache_tier"] = "REDIS"
                    return data
        except Exception as e:
            print(f"[Redis Cache Warning] Course summary cache read error: {e}")
        return None

    def set_course_summary(
        self,
        course_slug: str,
        summary_data: Dict[str, Any],
        ttl_seconds: Optional[int] = 86400
    ) -> bool:
        """Store generated course-level summary in Redis (default 24h)."""
        if not self.client or not self.enabled or not course_slug:
            return False

        clean_slug = str(course_slug).strip().lower()
        key = f"ls:course_summary:{clean_slug}"
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        try:
            val_str = json.dumps(summary_data)
            if ttl and ttl > 0:
                self.client.setex(key, ttl, val_str)
            else:
                self.client.set(key, val_str)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Course summary cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Generic Key-Value Cache Primitives
    # ---------------------------------------------------------

    def get(self, key: str) -> Optional[str]:
        """Generic string get for arbitrary keys."""
        if not self.client or not self.enabled or not key:
            return None
        try:
            return self.client.get(key)
        except Exception as e:
            print(f"[Redis Cache Warning] Generic get error on '{key}': {e}")
            return None

    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        """Generic string set for arbitrary keys with optional TTL."""
        if not self.client or not self.enabled or not key:
            return False
        try:
            if ex and ex > 0:
                self.client.setex(key, ex, value)
            else:
                self.client.set(key, value)
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Generic set error on '{key}': {e}")
            return False

    def delete(self, *keys: str) -> int:
        """Generic delete for arbitrary keys."""
        if not self.client or not self.enabled or not keys:
            return 0
        try:
            return self.client.delete(*keys)
        except Exception as e:
            print(f"[Redis Cache Warning] Generic delete error on keys: {e}")
            return 0

    # ---------------------------------------------------------
    # User Courses & Library Cache Operations
    # ---------------------------------------------------------

    def get_user_courses(self, user_email: str) -> Optional[List[Dict[str, Any]]]:
        """Retrieve cached courses list for a user."""
        if not self.client or not self.enabled or not user_email:
            return None
        clean_email = user_email.strip().lower()
        key = f"ls:user_courses:{clean_email}"
        try:
            raw = self.client.get(key)
            if raw:
                return json.loads(raw)
        except Exception as e:
            print(f"[Redis Cache Warning] User courses cache read error: {e}")
        return None

    def set_user_courses(self, user_email: str, courses_data: List[Dict[str, Any]], ttl_seconds: int = 300) -> bool:
        """Cache courses list for a user (default TTL: 5 minutes / 300s)."""
        if not self.client or not self.enabled or not user_email:
            return False
        clean_email = user_email.strip().lower()
        key = f"ls:user_courses:{clean_email}"
        try:
            self.client.setex(key, ttl_seconds, json.dumps(courses_data))
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] User courses cache write error: {e}")
            return False

    def get_user_library(self, user_email: str) -> Optional[List[Dict[str, Any]]]:
        """Retrieve cached library list for a user."""
        if not self.client or not self.enabled or not user_email:
            return None
        clean_email = user_email.strip().lower()
        key = f"ls:user_library:{clean_email}"
        try:
            raw = self.client.get(key)
            if raw:
                return json.loads(raw)
        except Exception as e:
            print(f"[Redis Cache Warning] User library cache read error: {e}")
        return None

    def set_user_library(self, user_email: str, library_data: List[Dict[str, Any]], ttl_seconds: int = 300) -> bool:
        """Cache library list for a user (default TTL: 5 minutes / 300s)."""
        if not self.client or not self.enabled or not user_email:
            return False
        clean_email = user_email.strip().lower()
        key = f"ls:user_library:{clean_email}"
        try:
            self.client.setex(key, ttl_seconds, json.dumps(library_data))
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] User library cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Calendar Events Cache Operations
    # ---------------------------------------------------------

    def get_calendar_events(self, key: str = "moodle_ical_events_cache") -> Optional[List[Dict[str, Any]]]:
        """Retrieve cached Moodle calendar events."""
        if not self.client or not self.enabled:
            return None
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                if isinstance(data, list):
                    return data
        except Exception as e:
            print(f"[Redis Cache Warning] Calendar cache read error: {e}")
        return None

    def set_calendar_events(self, events: List[Dict[str, Any]], key: str = "moodle_ical_events_cache", ttl_seconds: int = 43200) -> bool:
        """Cache calendar events in Redis (default TTL: 12 hours / 43200s)."""
        if not self.client or not self.enabled:
            return False
        try:
            self.client.setex(key, ttl_seconds, json.dumps(events))
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Calendar cache write error: {e}")
            return False

    # ---------------------------------------------------------
    # Invalidation & Administration
    # ---------------------------------------------------------

    def invalidate_user(self, user_email: str) -> int:
        """Purge cached courses and library for a user upon updates/additions."""
        if not self.client or not self.enabled or not user_email:
            return 0
        clean_email = user_email.strip().lower()
        try:
            keys = [f"ls:user_courses:{clean_email}", f"ls:user_library:{clean_email}"]
            deleted = self.client.delete(*keys)
            print(f"🗑️ [Redis Cache] Invalidated user cache for '{clean_email}' ({deleted} keys removed).")
            return deleted
        except Exception as e:
            print(f"[Redis Cache Warning] Invalidation error for user '{clean_email}': {e}")
            return 0

    def update_user_course(
        self,
        user_email: str,
        course_name: str,
        lecture_entry: Optional[Dict[str, Any]] = None,
        ttl_seconds: int = 300
    ) -> bool:
        """Update only the user's target course cache entry in Redis upon lecture ingestion."""
        if not self.client or not self.enabled or not user_email or not course_name:
            return False

        clean_email = user_email.strip().lower()
        clean_course = course_name.strip()
        c_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-')
        if not c_slug:
            return False
        from backend.gcs_storage import to_gcs_course_slug
        target_base_slug = to_gcs_course_slug(clean_course)

        try:
            # Invalidate cached course quiz and course summary for this specific course slug
            self.client.delete(f"ls:course_quiz:{c_slug}", f"ls:course_summary:{c_slug}")
            if target_base_slug != c_slug:
                self.client.delete(f"ls:course_quiz:{target_base_slug}", f"ls:course_summary:{target_base_slug}")

            if not lecture_entry:
                self.invalidate_user(clean_email)
                return True

            vid = str(lecture_entry.get("video_id") or lecture_entry.get("videoId") or "").strip()
            if not vid:
                self.invalidate_user(clean_email)
                return True

            # 1. Surgical update of the specific course inside ls:user_courses:{clean_email}
            cached_courses = self.get_user_courses(clean_email)
            if isinstance(cached_courses, list):
                target_idx = None
                for idx, c in enumerate(cached_courses):
                    existing_slug = str(c.get("course_slug") or "").strip().lower()
                    existing_name = str(c.get("course_name") or "").strip()
                    if (
                        existing_slug == c_slug
                        or existing_name.lower() == clean_course.lower()
                        or to_gcs_course_slug(existing_name) == target_base_slug
                        or to_gcs_course_slug(existing_slug) == target_base_slug
                    ):
                        target_idx = idx
                        break

                if target_idx is not None:
                    target_course = dict(cached_courses[target_idx])
                    existing_lectures = [
                        l for l in (target_course.get("lectures") or [])
                        if str(l.get("video_id") or l.get("videoId") or "") != vid
                    ]
                    updated_lectures = [lecture_entry] + existing_lectures
                    target_course["course_name"] = target_course.get("course_name") or clean_course
                    target_course["course_slug"] = target_course.get("course_slug") or c_slug
                    target_course["lecture_count"] = len(updated_lectures)
                    target_course["latest_viewed_at"] = lecture_entry.get("last_viewed_at") or target_course.get("latest_viewed_at")
                    target_course["thumbnail_video_id"] = vid
                    target_course["lectures"] = updated_lectures
                    remaining_courses = [c for i, c in enumerate(cached_courses) if i != target_idx]
                    self.set_user_courses(clean_email, [target_course] + remaining_courses, ttl_seconds=ttl_seconds)
                else:
                    new_course = {
                        "course_name": clean_course,
                        "course_slug": c_slug,
                        "lecture_count": 1,
                        "latest_viewed_at": lecture_entry.get("last_viewed_at"),
                        "thumbnail_video_id": vid,
                        "lectures": [lecture_entry]
                    }
                    self.set_user_courses(clean_email, [new_course] + cached_courses, ttl_seconds=ttl_seconds)

            # 2. Surgical update of ls:user_library:{clean_email} if cached
            cached_lib = self.get_user_library(clean_email)
            if isinstance(cached_lib, list):
                filtered_lib = [
                    item for item in cached_lib
                    if str(item.get("video_id") or item.get("videoId") or "") != vid
                ]
                self.set_user_library(clean_email, [lecture_entry] + filtered_lib, ttl_seconds=ttl_seconds)

            print(f"⚡ [Redis Cache] Updated course '{clean_course}' cache for '{clean_email}' (video '{vid}').")
            return True
        except Exception as e:
            print(f"[Redis Cache Warning] Course cache update error for '{clean_email}' / '{clean_course}': {e}")
            return False

    def invalidate_video(self, video_id: str) -> int:
        """Purge all cached queries, quizzes, and tool results for a specific lecture."""
        if not self.client or not self.enabled or not video_id:
            return 0

        clean_vid = str(video_id).strip()
        deleted_count = 0
        try:
            # Find and delete both versioned and legacy query, quiz, and tool keys for this video
            patterns = [
                f"ls:rag:*:query:{clean_vid}:*",
                f"ls:rag:query:{clean_vid}:*",
                f"ls:rag:*:tool:{clean_vid}:*",
                f"ls:rag:tool:{clean_vid}:*",
                f"ls:quiz:{clean_vid}"
            ]
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
