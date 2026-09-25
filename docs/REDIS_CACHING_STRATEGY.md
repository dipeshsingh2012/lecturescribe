# ⚡ LectureScribe Smart Caching Strategy (Hosted Redis)

> **Architectural Specification & Implementation Blueprint**  
> **Status:** Planned / Prepared for Execution  
> **Target:** Hosted Cloud Redis (Upstash / Redis Cloud / Google Cloud Memorystore)  
> **Objective:** Reduce repetitive query latency from **50–90 seconds** down to **< 5 milliseconds** while cutting upstream LLM token consumption to zero for repeated student queries.

---

## 1. Executive Summary & Problem Statement

### Core Truths
1. **Transcripts are 100% Immutable**: Once a Vimeo video lecture is transcribed and processed, its timestamps, cues, spoken words, and chapter roadmap never change for that `video_id`.
2. **Student Inquiries are Highly Repetitive**: Students studying the same lecture frequently request identical or near-identical overviews (*"Create a summary for a 15 min read"*, *"Explain UNet architecture"*, *"What are the homework deadlines?"*).

### The Bottleneck Today
Every incoming query to `POST /api/rag/query` currently executes a full agent loop:
- Step 1: Upstream LLM reasoning & tool call generation ($\sim 2.5\text{–}5\text{s}$)
- Step 2: Database / Pinecone / Algolia retrieval ($\sim 0.1\text{–}0.3\text{s}$)
- Step 3: LLM synthesis generation ($\sim 30\text{–}80\text{s}$ on serverless Llama-3.1-8B)
- Step 4: Submission version generation ($\sim 10\text{–}20\text{s}$)

**Total Turnaround: 45–100 seconds per query.**  
With Hosted Redis, identical queries hit the cache and return in **$< 5\text{ms}$**.

---

## 2. Hosted Redis Architecture

```mermaid
flowchart TD
    subgraph Client [Student / Browser UI]
        Req["POST /api/rag/query"]
    end

    subgraph API [FastAPI Backend]
        Norm["Query Normalizer<br/>(lowercase, strip punctuation, trim)"]
        CheckRedis{"Redis Query Cache<br/>(ls:rag:query:...)"}
        AgentLoop["Agentic RAG Engine<br/>(Llama 3.1 8B)"]
        CheckTool{"Redis Tool Cache<br/>(ls:rag:tool:...)"}
    end

    subgraph HostedRedis [Hosted Redis Cloud / Upstash]
        QCache[("Query & Synthesis Cache<br/>TTL: Indefinite / 30d")]
        TCache[("Tool Execution Cache<br/>TTL: Indefinite")]
    end

    subgraph External [External Services]
        LLM["Hugging Face / Groq"]
        DB[("PostgreSQL")]
        Pinecone[("Pinecone Vector Store")]
    end

    Req --> Norm
    Norm --> CheckRedis
    CheckRedis -- "Hit (<5ms)" --> Ret["Return Cached RAG Result + Submission"]
    CheckRedis -- "Miss" --> AgentLoop
    
    AgentLoop --> CheckTool
    CheckTool -- "Hit (<1ms)" --> AgentLoop
    CheckTool -- "Miss" --> DB & Pinecone --> SetTool["Store Tool Result in Redis"] --> AgentLoop
    
    AgentLoop --> LLM --> SetQuery["Store Full Result in Redis"]
    SetQuery --> Ret
    Ret --> Client
```

---

## 3. Environment & Connection Setup

### Environment Variables (`.env`)
```bash
# Hosted Redis Configuration (Upstash / Redis Cloud / Memorystore)
# Supports standard redis:// or TLS-encrypted rediss:// URLs
REDIS_URL=rediss://default:your_upstash_token@your-instance.upstash.io:6379

# Cache Configuration
REDIS_CACHE_ENABLED=true
REDIS_CACHE_TTL_DAYS=30          # 0 or omitted for indefinite
REDIS_SOCKET_TIMEOUT=2.0         # Fast fail-fast connection timeout in seconds
```

### Dependency Installation
```bash
pip install redis>=5.0.0
```

---

## 4. Key Namespaces & Normalization Algorithm

To prevent cache fragmentation from cosmetic query differences (*"Create a summary?"* vs *"create a summary "*), all keys pass through deterministic normalization.

### Normalization Logic
```python
import re
import hashlib

def normalize_query(query: str) -> str:
    """Canonicalize queries for deterministic cache lookup."""
    # 1. Lowercase
    q = query.lower().strip()
    # 2. Strip surrounding punctuation (. ? ! , ; :)
    q = re.sub(r"^[\W_]+|[\W_]+$", "", q)
    # 3. Collapse multiple whitespace characters into single space
    q = re.sub(r"\s+", " ", q)
    return q

def generate_query_cache_key(video_id: str, query: str, model_id: str = "") -> str:
    norm_q = normalize_query(query)
    seed = f"{video_id.strip()}:{norm_q}:{model_id.strip().lower()}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]
    return f"ls:rag:query:{video_id.strip()}:{digest}"
```

### Namespaces Schema

| Tier | Key Pattern | Type | Contents | TTL |
| :--- | :--- | :--- | :--- | :--- |
| **RAG Query** | `ls:rag:query:{video_id}:{sha256}` | String (JSON) | Full RAG answer, citations, web sources, submission text | Indefinite / 30 Days |
| **Tool Outline** | `ls:rag:tool:{video_id}:outline` | String (JSON) | Syllabus roadmap & chapter summaries | Indefinite |
| **Tool Window** | `ls:rag:tool:{video_id}:window:{st}_{et}` | String (JSON) | Verbatim dialogue window | Indefinite |
| **Tool Search** | `ls:rag:tool:{video_id}:search:{sha256}` | String (JSON) | Hybrid vector/keyword search matches | Indefinite |
| **Video Meta** | `ls:video:meta:{video_id}` | Hash / JSON | Title, duration, cue count | Indefinite |

---

## 5. Cached JSON Data Payload Schema

When a query is cached at `ls:rag:query:{video_id}:{digest}`, the value is a single JSON payload:

```json
{
  "answer": "Based on the lecture outline, here is a 15-minute read summary...",
  "citations": [
    {
      "timestamp": "00:00",
      "end_time": "15:30",
      "text": "Topic: Introduction to Computer Vision"
    }
  ],
  "web_sources": [],
  "model": "Hugging Face Llama 3.1 8B",
  "submission_text": "The lecture provides a foundational understanding of image processing...",
  "submission_word_count": 125,
  "lecture_title": "Introduction to Computer Vision Live session -1 (19/ 9 / 2026)",
  "video_id": "1228351347",
  "cached": true,
  "cached_at": "2026-09-25T14:30:00Z"
}
```

---

## 6. Implementation Blueprint

### File 1: `backend/redis_service.py`
```python
"""
Hosted Redis Cache Service for LectureScribe
Provides sub-5ms caching for deterministic lecture queries and tool executions.
"""
from __future__ import annotations

import os
import json
import time
import hashlib
from typing import Optional, Dict, Any

try:
    import redis
    HAS_REDIS = True
except ImportError:
    redis = None
    HAS_REDIS = False

class RedisCacheService:
    def __init__(self):
        self.client: Optional[redis.Redis] = None
        self.enabled = os.getenv("REDIS_CACHE_ENABLED", "true").lower() == "true"
        self._init_connection()

    def _init_connection(self):
        url = os.getenv("REDIS_URL", "").strip()
        if not self.enabled or not url:
            return
        if not HAS_REDIS:
            print("[Redis Warning] 'redis' package is not installed. Run `pip install redis`.")
            return

        try:
            self.client = redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=float(os.getenv("REDIS_SOCKET_TIMEOUT", "2.0")),
                socket_connect_timeout=float(os.getenv("REDIS_SOCKET_TIMEOUT", "2.0"))
            )
            self.client.ping()
            print("⚡ [Redis Cache] Connected successfully to Hosted Redis.")
        except Exception as e:
            print(f"⚠️ [Redis Notice] Could not connect to Redis ({e}). Caching disabled.")
            self.client = None

    def get_query(self, video_id: str, query: str, model_id: str = "") -> Optional[Dict[str, Any]]:
        if not self.client:
            return None
        key = self._make_query_key(video_id, query, model_id)
        try:
            raw = self.client.get(key)
            if raw:
                data = json.loads(raw)
                data["cached"] = True
                return data
        except Exception as e:
            print(f"[Redis Warning] Read error: {e}")
        return None

    def set_query(self, video_id: str, query: str, model_id: str, data: Dict[str, Any], ttl_seconds: Optional[int] = None):
        if not self.client:
            return
        key = self._make_query_key(video_id, query, model_id)
        try:
            val = json.dumps(data)
            if ttl_seconds and ttl_seconds > 0:
                self.client.setex(key, ttl_seconds, val)
            else:
                self.client.set(key, val)
        except Exception as e:
            print(f"[Redis Warning] Write error: {e}")

    def get_tool(self, video_id: str, tool_name: str, args: Dict[str, Any]) -> Optional[str]:
        if not self.client:
            return None
        key = self._make_tool_key(video_id, tool_name, args)
        try:
            return self.client.get(key)
        except Exception:
            return None

    def set_tool(self, video_id: str, tool_name: str, args: Dict[str, Any], result_str: str):
        if not self.client:
            return
        key = self._make_tool_key(video_id, tool_name, args)
        try:
            self.client.set(key, result_str)
        except Exception:
            pass

    def invalidate_video(self, video_id: str) -> int:
        """Purge all cached queries and tools for a specific video."""
        if not self.client:
            return 0
        keys = self.client.keys(f"ls:rag:*:{video_id}:*")
        if keys:
            return self.client.delete(*keys)
        return 0

    def _make_query_key(self, video_id: str, query: str, model_id: str) -> str:
        clean_q = query.lower().strip()
        seed = f"{video_id}:{clean_q}:{model_id.lower().strip()}"
        h = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        return f"ls:rag:query:{video_id}:{h}"

    def _make_tool_key(self, video_id: str, tool_name: str, args: Dict[str, Any]) -> str:
        args_sorted = json.dumps(args, sort_keys=True)
        h = hashlib.sha256(args_sorted.encode("utf-8")).hexdigest()[:16]
        return f"ls:rag:tool:{video_id}:{tool_name}:{h}"

redis_cache = RedisCacheService()
```

---

## 7. Integration Points

### In `backend/main.py`:
```python
from backend.redis_service import redis_cache

@app.post("/api/rag/query")
def rag_query(req: RAGQueryRequest):
    # 1. Check Redis Cache First (unless bypass_cache=True)
    if not req.bypass_cache:
        cached_result = redis_cache.get_query(req.video_id, req.query, req.model_id or "")
        if cached_result:
            print(f"⚡ [Cache HIT] Instant Redis response in {time.time() - t_start:.3f}s")
            return cached_result

    # 2. Live Agentic RAG Execution
    result = pinecone_rag_engine.query_rag(...)

    # 3. Store in Redis Cache
    redis_cache.set_query(req.video_id, req.query, req.model_id or "", result)
    return result
```

### In `backend/rag_engine.py` (Tool Execution):
```python
def execute_tool(self, tool_name: str, arguments: Dict[str, Any], target_video_id: str, lecture_title: str):
    # Check tool result cache
    cached_tool = redis_cache.get_tool(target_video_id, tool_name, arguments)
    if cached_tool:
        print(f"    ⚡ [Tool Cache HIT] {tool_name} returned from Redis in 0ms")
        return cached_tool, [], []

    # Execute tool logic...
    result_str, citations, web_sources = ...

    # Cache tool result
    redis_cache.set_tool(target_video_id, tool_name, arguments, result_str)
    return result_str, citations, web_sources
```

---

## 8. Cache Invalidation & Administration

1. **User Cache-Busting**: Add `bypass_cache: bool = False` to `RAGQueryRequest` so power users or developers can click "Re-run AI" without using cache.
2. **Video Re-generation Hook**: When `POST /api/summary/regenerate` is triggered, invoke `redis_cache.invalidate_video(video_id)` to ensure all subsequent queries reflect the new summary.
3. **Health Check**: Include Redis status in `GET /health`:
   ```json
   {
     "status": "ok",
     "database": "PostgreSQL Ready",
     "redis_cache": "Connected (Upstash TLS)"
   }
   ```

---

## 9. Implementation Checklist (For Later Activation)

- [ ] Add `redis>=5.0.0` to `requirements.txt`.
- [ ] Add `REDIS_URL` to Cloud Run secrets / environment configuration.
- [ ] Add `REDIS_URL` to local `.env`.
- [ ] Create `backend/redis_service.py`.
- [ ] Wire cache pre-check and post-set into `backend/main.py`.
- [ ] Wire tool-level caching into `backend/rag_engine.py`.
- [ ] Add unit test `tests/test_redis_cache.py` with mock / live Redis tests.
- [ ] Deploy to Cloud Run.
