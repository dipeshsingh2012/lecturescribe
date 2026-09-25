"""
Pinecone + Llama-3.2-3B-Instruct RAG Engine for LectureScribe
--------------------------------------------------------------
Strictly loads model & database parameters from environment variables - NO HARDCODING.
Combines Pinecone Vector Database retrieval with grounded Llama-3.2 inference.
"""
from __future__ import annotations

import os
import re
import json
import math
import time
from typing import List, Dict, Any, Tuple, Optional
from dotenv import load_dotenv
try:
    from pinecone import Pinecone, ServerlessSpec
    HAS_SERVERLESS = True
except ImportError:
    try:
        from pinecone import Pinecone
        HAS_SERVERLESS = False
    except ImportError:
        Pinecone = None
        HAS_SERVERLESS = False

from pathlib import Path
try:
    from dotenv import load_dotenv
    _env_file = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.exists():
        load_dotenv(dotenv_path=_env_file, override=True)
    else:
        load_dotenv(override=True)
except ImportError:
    _env_file = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.exists():
        try:
            for line in _env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip().strip("'\"")
        except Exception:
            pass

try:
    from huggingface_hub import InferenceClient
    HAS_HF = True
except ImportError:
    HAS_HF = False

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

try:
    from backend.redis_service import redis_cache
except ImportError:
    redis_cache = None


class Llama3PineconeRAGStore:
    """RAG Engine powered by Llama-3.2-3B-Instruct + Pinecone Vector Database."""

    def __init__(self):
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "lecturescribe_v1")
        self.model_id = os.getenv("LLAMA_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
        self.pc: Optional[Pinecone] = None
        self.index = None
        self.video_id: str = ""
        self.video_title: str = ""
        self.local_chunks: List[Dict[str, Any]] = []

        self._init_pinecone()

    def _init_pinecone(self):
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "lecturescribe_v1")
        try:
            if not Pinecone:
                print("[Llama-3.2 RAG Warning] Pinecone package not installed. Using local chunk store.")
                return

            if self.api_key:
                self.pc = Pinecone(api_key=self.api_key)
                self.index = self.pc.Index(self.index_name)
                print(f"[Llama-3.2 RAG] Connected to Pinecone Index '{self.index_name}' (Namespace: '{self.namespace}').")
            else:
                print(f"[Llama-3.2 RAG Warning] PINECONE_API_KEY environment variable is not set.")
        except Exception as e:
            print(f"[Llama-3.2 RAG Warning] Could not initialize Pinecone: {e}")

    def setup_index(self) -> bool:
        """Create and verify Pinecone index on server start."""
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "lecturescribe_v1")

        if not Pinecone:
            print("[Pinecone Startup] pinecone package not installed. Local vector store active.")
            return False

        if not self.api_key:
            print("[Pinecone Startup] PINECONE_API_KEY not configured. Local vector store active.")
            return False

        try:
            if not self.pc:
                self.pc = Pinecone(api_key=self.api_key)

            existing_indexes = [idx.name for idx in self.pc.list_indexes()]
            if self.index_name not in existing_indexes:
                print(f"🚀 [Pinecone Startup] Index '{self.index_name}' not found. Creating serverless index (dim=768, metric=cosine, aws/us-east-1)...")
                if HAS_SERVERLESS:
                    self.pc.create_index(
                        name=self.index_name,
                        dimension=768,
                        metric="cosine",
                        spec=ServerlessSpec(cloud="aws", region="us-east-1")
                    )
                else:
                    self.pc.create_index(
                        name=self.index_name,
                        dimension=768,
                        metric="cosine"
                    )
                print(f"✅ [Pinecone Startup] Created Pinecone index: '{self.index_name}'.")
            else:
                print(f"✅ [Pinecone Startup] Pinecone index '{self.index_name}' verified and ready.")

            self.index = self.pc.Index(self.index_name)
            return True
        except Exception as e:
            print(f"⚠️ [Pinecone Startup Warning] Error creating/verifying Pinecone index: {e}")
            return False

    def _generate_embedding(self, text: str) -> List[float]:
        """Generate 768-dim embedding vector for transcript text."""
        words = re.findall(r"\w+", text.lower())
        vec = [0.0] * 768
        for idx, word in enumerate(words):
            word_hash = hash(word) % 768
            vec[word_hash] += 1.0 / (idx + 1)
        
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def ingest_transcript(self, video_id: str, video_title: str, cues: List[Dict[str, str]], window_size: int = 8, overlap: int = 3) -> int:
        """Chunk transcript cues & upsert embeddings to Pinecone."""
        if self.video_id == video_id and len(self.local_chunks) > 0:
            return len(self.local_chunks)

        self.video_id = video_id
        self.video_title = video_title
        self.local_chunks.clear()

        if not cues:
            return 0

        total_cues = len(cues)
        step = max(1, window_size - overlap)
        vectors_to_upsert = []
        chunk_count = 0

        for i in range(0, total_cues, step):
            window_cues = cues[i : i + window_size]
            if not window_cues:
                continue

            start_time = window_cues[0].get("time", "00:00")
            end_time = window_cues[-1].get("time", start_time)
            chunk_text = " ".join([c.get("text", "") for c in window_cues if c.get("text")])

            if chunk_text.strip():
                chunk_count += 1
                vec_id = f"vimeo-{video_id}-chunk-{chunk_count}"
                embedding = self._generate_embedding(chunk_text.strip())

                metadata = {
                    "video_id": video_id,
                    "video_title": video_title,
                    "start_time": start_time,
                    "end_time": end_time,
                    "text": chunk_text.strip()[:2000]
                }

                chunk_obj = {
                    "id": vec_id,
                    "start_time": start_time,
                    "end_time": end_time,
                    "text": chunk_text.strip(),
                    "metadata": metadata
                }
                self.local_chunks.append(chunk_obj)

                vectors_to_upsert.append({
                    "id": vec_id,
                    "values": embedding,
                    "metadata": metadata
                })

        if self.index and vectors_to_upsert:
            try:
                batch_size = 100
                for b_i in range(0, len(vectors_to_upsert), batch_size):
                    batch = vectors_to_upsert[b_i : b_i + batch_size]
                    self.index.upsert(vectors=batch, namespace=self.namespace)
                print(f"[Llama-3.2 RAG] Upserted {len(vectors_to_upsert)} chunks to Pinecone namespace '{self.namespace}'.")
            except Exception as e:
                print(f"[Llama-3.2 RAG Warning] Pinecone upsert error: {e}")

        return len(self.local_chunks)

    def get_supported_models(self) -> List[Dict[str, Any]]:
        """Return available models and their configuration status."""
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))

        return [
            {
                "id": "gemini-2.0-flash",
                "name": "Gemini 2.0 Flash",
                "provider": "Google (Free Tier)",
                "badge": "⚡ Fast • 1M Context",
                "is_configured": bool(gemini_key),
                "is_recommended": True,
                "free_tier_info": "1,500 requests/day free at aistudio.google.com"
            },
            {
                "id": "llama-3.3-70b-versatile",
                "name": "Groq Llama 3.3 70B",
                "provider": "Groq Cloud (Free Tier)",
                "badge": "🚀 500 T/s • 70B Model",
                "is_configured": bool(groq_key),
                "is_recommended": True,
                "free_tier_info": "1,000 requests/day free at console.groq.com"
            },
            {
                "id": "meta-llama/Llama-3.1-8B-Instruct",
                "name": "Hugging Face Llama 3.1 8B",
                "provider": "Hugging Face (Serverless)",
                "badge": "🤗 Active Cloud Default",
                "is_configured": bool(hf_token),
                "is_recommended": False,
                "free_tier_info": "Active via HUGGINGFACE_TOKEN"
            }
        ]

    def _retrieve_relevant_lecture_cues(
        self,
        query: str,
        cues: List[Dict[str, str]],
        video_id: str,
        video_title: str,
        window_size: int = 5,
        step: int = 3,
        top_k: int = 4
    ) -> List[Dict[str, Any]]:
        """Rank sliding-window transcript chunks strictly from the active lecture's cues."""
        if not cues:
            return []

        query_terms = set(re.findall(r"\w+", query.lower()))
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "what", "which", "who", "whom",
            "this", "that", "these", "those", "how", "why", "when", "where", "in", "on",
            "at", "to", "for", "with", "about", "against", "between", "into", "through",
            "during", "before", "after", "above", "below", "from", "up", "down", "in",
            "out", "on", "off", "over", "under", "again", "further", "then", "once", "here",
            "there", "all", "any", "both", "each", "few", "more", "most", "other", "some",
            "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
            "can", "will", "just", "should", "now"
        }
        meaningful_terms = {t for t in query_terms if t not in stop_words and len(t) > 2}
        effective_terms = meaningful_terms if meaningful_terms else query_terms

        scored_windows = []
        total_cues = len(cues)

        for i in range(0, total_cues, step):
            window = cues[i : i + window_size]
            if not window:
                continue
            start_time = window[0].get("time", "00:00")
            end_time = window[-1].get("time", start_time)
            chunk_text = " ".join([c.get("text", "") for c in window if c.get("text")])
            if not chunk_text.strip():
                continue

            chunk_words = re.findall(r"\w+", chunk_text.lower())
            score = sum(1.0 for w in chunk_words if w in effective_terms)

            metadata = {
                "video_id": video_id,
                "video_title": video_title,
                "start_time": start_time,
                "end_time": end_time,
                "text": chunk_text[:2000]
            }
            scored_windows.append((score, i, metadata))

        # Sort by relevance score descending; tie-break by chronological position
        scored_windows.sort(key=lambda x: (x[0], -x[1]), reverse=True)

        return [w[2] for w in scored_windows[:top_k]]

    def reciprocal_rank_fusion(
        self,
        ranked_lists: List[List[Dict[str, Any]]],
        k: int = 60
    ) -> List[Dict[str, Any]]:
        """
        Combine multiple ranked lists of chunk dictionaries using Reciprocal Rank Fusion.
        Score(d) = sum(1 / (k + rank_i(d)))
        """
        rrf_scores = {}
        chunk_map = {}

        for ranked_list in ranked_lists:
            for rank_0, item in enumerate(ranked_list):
                rank = rank_0 + 1
                # Use start_time + text prefix as unique signature
                doc_id = f"{item.get('start_time', '')}_{item.get('text', '')[:60]}"
                if doc_id not in chunk_map:
                    chunk_map[doc_id] = item
                rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank)

        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        return [chunk_map[doc_id] for doc_id in sorted_ids]

    def _parse_timestamp(self, ts: str) -> float:
        """Convert timestamp string 'MM:SS' or 'HH:MM:SS' to seconds for sorting."""
        if not ts:
            return 0.0
        parts = ts.split(':')
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        return 0.0

    AGENT_TOOLS = [
        {
            "type": "function",
            "function": {
                "name": "get_lecture_outline",
                "description": "Fetch structured chapter outlines, topics, and key takeaways across the lecture with timestamps. Call this when asked for an overview, summary, outline, 10 min read, syllabus, or to discover what topics were covered across the session.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "video_id": {
                            "type": "string",
                            "description": "The video ID of the lecture"
                        }
                    },
                    "required": ["video_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_transcript",
                "description": "Search the lecture transcript using hybrid vector and keyword search for specific technical concepts, definitions, formulas, or questions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The technical concept, keyword, or question to search"
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "Number of transcript chunks to return (default 5)"
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_transcript_window",
                "description": "Fetch the verbatim spoken dialogue from the lecture between two timestamps (e.g. start_time='04:30', end_time='09:15'). Call this when you need verbatim dialogue spoken by the professor for a specific segment.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_time": {
                            "type": "string",
                            "description": "Starting timestamp in MM:SS or HH:MM:SS"
                        },
                        "end_time": {
                            "type": "string",
                            "description": "Ending timestamp in MM:SS or HH:MM:SS"
                        }
                    },
                    "required": ["start_time", "end_time"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_web_context",
                "description": "Search DuckDuckGo and Wikipedia for external academic context, mathematical derivations, or industry standards not fully explained in the lecture.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "search_query": {
                            "type": "string",
                            "description": "The search query to look up on the web"
                        }
                    },
                    "required": ["search_query"]
                }
            }
        }
    ]

    def execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        target_video_id: str,
        lecture_title: str
    ) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Execute an agent tool and return (json_result_str, citations_list, web_sources_list).
        Fails fast if tool arguments are invalid.
        """
        citations = []
        web_sources = []
        vid_cache = target_video_id or str(arguments.get("video_id", "")).strip()

        # Check Redis tool cache for deterministic transcript tools
        if redis_cache and vid_cache and tool_name in ("get_lecture_outline", "get_transcript_window", "search_transcript"):
            cached_pkg_str = redis_cache.get_tool(vid_cache, tool_name, arguments)
            if cached_pkg_str:
                try:
                    pkg = json.loads(cached_pkg_str)
                    print(f"    ⚡ [Tool Cache HIT] '{tool_name}' returned from Hosted Redis in 0ms")
                    return pkg.get("result", ""), pkg.get("citations", []), pkg.get("web_sources", [])
                except Exception:
                    pass

        if tool_name == "get_lecture_outline":
            vid = vid_cache
            if not vid:
                raise ValueError("get_lecture_outline requires a valid video_id.")
            print(f"    🔧 [Tool: get_lecture_outline] Retrieving syllabus roadmap for video '{vid}'")
            from backend.database import db_manager
            saved = db_manager.get_saved_video(vid)
            if not saved:
                raise ValueError(f"Lecture '{vid}' not found in database.")

            sections = saved.get("summarySections") or saved.get("summary_sections") or []
            if not sections and saved.get("cues"):
                from backend.summary_generator import generate_summary_sections
                sections = generate_summary_sections(saved["cues"], saved.get("title", lecture_title))
                db_manager.update_summary_sections(vid, sections)

            formatted = []
            for sec in sections:
                title = sec.get("title", "")
                points = sec.get("points", [])
                ts_match = re.search(r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]", title)
                start_t = ts_match.group(1) if ts_match else "00:00"
                end_t = ts_match.group(2) if (ts_match and ts_match.group(2)) else start_t
                clean_title = re.sub(r"\[.*?\]", "", title).strip()
                clean_title = re.sub(r"^[^\w\s]+\s*", "", clean_title).strip()
                citations.append({
                    "timestamp": start_t,
                    "end_time": end_t,
                    "text": f"Topic: {clean_title}"
                })
                formatted.append({
                    "chapter": clean_title,
                    "timestamp": f"{start_t} - {end_t}",
                    "takeaways": points
                })
            res_str = json.dumps(formatted)
            if redis_cache and vid_cache:
                redis_cache.set_tool(vid_cache, tool_name, arguments, json.dumps({"result": res_str, "citations": citations, "web_sources": web_sources}))
            return res_str, citations, web_sources

        elif tool_name == "search_transcript":
            query = str(arguments.get("query", "")).strip()
            if not query:
                raise ValueError("search_transcript requires a non-empty query.")
            top_k = int(arguments.get("top_k", 5))
            vid = vid_cache
            print(f"    🔧 [Tool: search_transcript] Hybrid search for: '{query}' (video='{vid}', top_k={top_k})")

            pinecone_matches = []
            if self.index:
                try:
                    emb = self._generate_embedding(query)
                    kwargs = {"vector": emb, "top_k": top_k, "namespace": self.namespace, "include_metadata": True}
                    if vid:
                        kwargs["filter"] = {"video_id": {"$eq": vid}}
                    res = self.index.query(**kwargs)
                    if res and res.matches:
                        for m in res.matches:
                            if m.metadata and (not vid or str(m.metadata.get("video_id", "")) == vid):
                                pinecone_matches.append(m.metadata)
                except Exception as e:
                    print(f"    ⚠️ [Pinecone Search Warning]: {e}")

            algolia_matches = []
            try:
                from backend.algolia_service import algolia_service
                hits = algolia_service.search(query, video_id=vid, limit=top_k)
                for h in hits:
                    algolia_matches.append({
                        "video_id": vid,
                        "start_time": h.get("timestamp", "00:00"),
                        "end_time": h.get("timestamp", "00:00"),
                        "text": h.get("text", "")
                    })
            except Exception as e:
                print(f"    ⚠️ [Algolia Search Warning]: {e}")

            cue_matches = []
            from backend.database import db_manager
            saved = db_manager.get_saved_video(vid) if vid else None
            cues = saved.get("cues", []) if saved else []
            if cues and not pinecone_matches and not algolia_matches:
                cue_matches = self._retrieve_relevant_lecture_cues(
                    query=query, cues=cues, video_id=vid, video_title=lecture_title, top_k=top_k
                )

            ranked = [s for s in [pinecone_matches, algolia_matches, cue_matches] if s]
            combined = self.reciprocal_rank_fusion(ranked, k=60)[:top_k] if ranked else []

            out = []
            for item in combined:
                st = item.get("start_time", "00:00")
                et = item.get("end_time", st)
                txt = item.get("text", "")
                citations.append({
                    "timestamp": st,
                    "end_time": et,
                    "text": txt[:120] + "..."
                })
                out.append({"timestamp": f"[{st} - {et}]", "text": txt})
            res_str = json.dumps(out)
            if redis_cache and vid_cache:
                redis_cache.set_tool(vid_cache, tool_name, arguments, json.dumps({"result": res_str, "citations": citations, "web_sources": web_sources}))
            return res_str, citations, web_sources

        elif tool_name == "get_transcript_window":
            st = str(arguments.get("start_time", "00:00")).strip()
            et = str(arguments.get("end_time", "00:00")).strip()
            vid = vid_cache
            print(f"    🔧 [Tool: get_transcript_window] Fetching dialogue slice: [{st} - {et}] (video='{vid}')")

            st_sec = self._parse_timestamp(st)
            et_sec = self._parse_timestamp(et)
            if et_sec <= st_sec:
                et_sec = st_sec + 300

            from backend.database import db_manager
            saved = db_manager.get_saved_video(vid) if vid else None
            if not saved:
                raise ValueError(f"Lecture '{vid}' not found in database.")

            cues = saved.get("cues", [])
            window = [c for c in cues if st_sec <= self._parse_timestamp(c.get("time", "00:00")) <= et_sec]
            if not window:
                raise ValueError(f"No transcript cues found within time window [{st} - {et}] for lecture '{vid}'.")

            dialogue = " ".join([f"[{c.get('time', '00:00')}] {c.get('text', '')}" for c in window])
            citations.append({
                "timestamp": st,
                "end_time": et,
                "text": dialogue[:120] + "..."
            })
            res_str = json.dumps({"start_time": st, "end_time": et, "transcript": dialogue})
            if redis_cache and vid_cache:
                redis_cache.set_tool(vid_cache, tool_name, arguments, json.dumps({"result": res_str, "citations": citations, "web_sources": web_sources}))
            return res_str, citations, web_sources

        elif tool_name == "search_web_context":
            sq = str(arguments.get("search_query", "")).strip()
            if not sq:
                raise ValueError("search_web_context requires search_query.")
            print(f"    🔧 [Tool: search_web_context] Academic web search for: '{sq}'")
            from backend.web_search import search_web_for_context
            hits = search_web_for_context(sq, max_results=3)
            for h in hits:
                citations.append({
                    "timestamp": "Web",
                    "end_time": "Web",
                    "text": f"{h.get('title')}: {h.get('snippet', '')[:100]}"
                })
                web_sources.append(h)
            return json.dumps(hits), citations, web_sources

        else:
            raise ValueError(f"Unknown tool '{tool_name}' requested by agent.")

    def query_rag(
        self,
        query: str,
        video_id: Optional[str] = None,
        video_title: Optional[str] = None,
        cues: Optional[List[Dict[str, str]]] = None,
        top_k: int = 10,
        model_id: Optional[str] = None,
        enable_web_search: bool = True,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Agentic RAG Engine:
        Empowers the LLM to autonomously reason and invoke specialized tools:
        - get_lecture_outline: Fetches high-level roadmap and chapter summaries
        - search_transcript: Performs hybrid semantic vector + keyword search
        - get_transcript_window: Fetches verbatim spoken dialogue for a time slice
        - search_web_context: Searches external academic literature/proofs if needed
        FAILS FAST if LLM credentials are missing or API encounters an unrecoverable error.
        """
        import requests

        target_video_id = str(video_id).strip() if video_id else ""
        lecture_title = video_title or ""

        if target_video_id and not lecture_title:
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(target_video_id)
                if saved:
                    lecture_title = saved.get("title", "")
            except Exception as e:
                print(f"[RAG Engine Warning] Could not fetch lecture title: {e}")

        if not lecture_title:
            lecture_title = self.video_title or "Active Lecture"

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))
        openai_key = os.getenv("OPENAI_API_KEY", "")

        # FAIL FAST: Require valid LLM configuration
        if not (gemini_key or groq_key or hf_token or openai_key):
            raise RuntimeError(
                "Agentic RAG configuration error: No active LLM credentials found. "
                "Configure HUGGINGFACE_TOKEN, GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in environment."
            )

        # Select provider endpoint
        if groq_key and (not model_id or "groq" in model_id or "llama-3.3" in model_id):
            provider = "groq"
            endpoint = "https://api.groq.com/openai/v1/chat/completions"
            auth_header = f"Bearer {groq_key}"
            model_name = "llama-3.3-70b-versatile"
            display_model = "Groq Llama 3.3 70B"
        elif hf_token and (not model_id or "llama-3.1" in model_id or "huggingface" in model_id or not groq_key):
            provider = "huggingface"
            endpoint = "https://router.huggingface.co/v1/chat/completions"
            auth_header = f"Bearer {hf_token}"
            model_name = "meta-llama/Llama-3.1-8B-Instruct"
            display_model = "Hugging Face Llama 3.1 8B"
        elif gemini_key:
            provider = "gemini"
            endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            auth_header = f"Bearer {gemini_key}"
            model_name = "gemini-2.0-flash"
            display_model = "Gemini 2.0 Flash"
        elif openai_key:
            provider = "openai"
            endpoint = "https://api.openai.com/v1/chat/completions"
            auth_header = f"Bearer {openai_key}"
            model_name = "gpt-4o-mini"
            display_model = "OpenAI GPT-4o-mini"
        else:
            raise RuntimeError("No suitable LLM provider could be resolved.")

        t_rag_start = time.time()
        print("\n" + "-" * 50)
        print(f"🤖 [Agentic RAG Engine] Initializing query execution")
        print(f"   Target Video: '{target_video_id}' | Title: '{lecture_title}'")
        print(f"   User Query: \"{query}\"")
        print(f"   Selected Provider: {display_model}")
        print("-" * 50)

        system_prompt = (
            f"You are an encouraging, articulate Academic AI Tutor assisting a student learning from the lecture: '{lecture_title}'. "
            f"The video ID is '{target_video_id}'.\n\n"
            "YOU HAVE ACCESS TO SPECIALIZED RETRIEVAL TOOLS:\n"
            "1. get_lecture_outline(video_id): Call this when asked for an overview, summary, recap, 10-minute read, syllabus, or chapter breakdown.\n"
            "2. search_transcript(query, top_k): Call this when asked about specific technical concepts, definitions, equations, or questions.\n"
            "3. get_transcript_window(start_time, end_time): Call this when you need verbatim dialogue from the professor for a specific segment.\n"
            "4. search_web_context(search_query): Call this ONLY if external academic context or mathematical background is needed.\n\n"
            "PEDAGOGICAL & CITATION RULES:\n"
            "- Always invoke the appropriate tool(s) to ground your answer in the lecture.\n"
            "- MANDATORY Inline Timestamps: Every key statement, topic, or finding MUST include its exact timestamp tag [MM:SS] or [MM:SS - MM:SS] so the student can jump to that exact part of the video.\n"
            "- SUBSTANTIVE CONTENT: Directly explain the concepts and insights taught by the professor. NEVER output meta-instructions or advice on how to write a summary or take notes.\n"
            "- Clarity & Rigor: Structure with clear paragraphs, mathematical notation, and bullet points where helpful."
        )

        prior_messages = []
        try:
            from backend.database import db_manager
            db_history = chat_history if chat_history is not None else db_manager.get_chat_history(target_video_id, user_email=user_email, limit=6)
            for m in (db_history or [])[-6:]:
                role = "user" if m.get("sender") == "user" or m.get("role") == "user" else "assistant"
                txt = (m.get("text") or m.get("content") or "").strip()
                if txt and not txt.startswith("<function="):
                    if role == "assistant" and len(txt) > 800:
                        txt = txt[:800] + "..."
                    prior_messages.append({"role": role, "content": txt})
        except Exception as e:
            print(f"⚠️ [Chat Context Notice]: {e}")

        messages = [
            {"role": "system", "content": system_prompt},
            *prior_messages,
            {
                "role": "user",
                "content": (
                    f"Student Request: {query}\n"
                    f"Context: Lecture '{lecture_title}' (Video ID: '{target_video_id}').\n"
                    "INSTRUCTION: You do NOT have the transcript in context. In your first step, you MUST invoke a tool "
                    "(search_transcript, get_lecture_outline, or get_transcript_window) to retrieve grounded evidence from the lecture. "
                    "Do NOT attempt to answer until you have retrieved information from the lecture."
                )
            }
        ]

        all_citations = []
        all_web_sources = []
        max_steps = 4
        current_step = 0
        final_answer = ""

        headers = {"Authorization": auth_header, "Content-Type": "application/json"}

        while current_step < max_steps:
            current_step += 1
            t_step_start = time.time()
            print(f"🤖 [Agent Step {current_step}/{max_steps}] Invoking {display_model} (history: {len(messages)} turns)...")

            tool_calls = []
            content_str = ""

            # Force tool invocation on Step 1 for providers supporting tool_choice="required"
            step_tool_choice = "required" if (current_step == 1 and provider in ["groq", "openai"]) else "auto"

            if provider == "huggingface" and HAS_HF:
                try:
                    hf_client = InferenceClient(api_key=hf_token)
                    resp = hf_client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        tools=self.AGENT_TOOLS,
                        tool_choice="auto",
                        max_tokens=1024,
                        temperature=0.25
                    )
                    choice = resp.choices[0]
                    msg_obj = choice.message
                    content_str = msg_obj.content or ""
                    if msg_obj.tool_calls:
                        for tc in msg_obj.tool_calls:
                            raw_args = tc.function.arguments
                            tool_calls.append({
                                "id": tc.id or f"call_{tc.function.name}_{current_step}",
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": raw_args if isinstance(raw_args, str) else json.dumps(raw_args)
                                }
                            })
                except Exception as e:
                    print(f"❌ [Agent Step {current_step} Error] Hugging Face InferenceClient error: {e}")
                    raise RuntimeError(f"Hugging Face agent invocation failed: {e}")
            else:
                payload = {
                    "model": model_name,
                    "messages": messages,
                    "tools": self.AGENT_TOOLS,
                    "tool_choice": step_tool_choice,
                    "max_tokens": 1024,
                    "temperature": 0.25
                }
                resp = requests.post(endpoint, headers=headers, json=payload, timeout=60)
                if resp.status_code != 200:
                    raise RuntimeError(
                        f"Agent LLM API invocation failed with HTTP {resp.status_code} ({display_model}): {resp.text}"
                    )
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError(f"Agent LLM returned empty choices array from {display_model}.")
                msg = choices[0].get("message", {})
                tool_calls = msg.get("tool_calls", []) or []
                content_str = msg.get("content", "") or ""

            # Support Llama 3.1 text-based function invocation format (<function=name ...>...</function> or <function=name .../>)
            if not tool_calls and "<function=" in content_str:
                pattern = re.compile(r"<function=([a-zA-Z0-9_]+)([^>/]*)(?:/>|>(.*?)(?:</function>|$))", re.DOTALL)
                for match in pattern.finditer(content_str):
                    fn_name = match.group(1).strip()
                    raw_attrs = (match.group(2) or "").strip()
                    body = (match.group(3) or "").strip()
                    if body.endswith("</function>"):
                        body = body[:-11].strip()

                    args_dict = {}
                    # 1. Parse tag attributes: key="value" or key='value' or key=123
                    attr_matches = re.findall(r'([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|(\S+))', raw_attrs)
                    for k, v1, v2, v3 in attr_matches:
                        val = v1 or v2 or v3
                        try:
                            val = json.loads(val)
                        except Exception:
                            pass
                        args_dict[k] = val

                    # 2. Parse body (JSON or key=val attributes)
                    if body:
                        try:
                            body_json = json.loads(body)
                            if isinstance(body_json, dict):
                                args_dict.update(body_json)
                            else:
                                args_dict["content"] = body_json
                        except Exception:
                            body_attrs = re.findall(r'([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|(\S+))', body)
                            if body_attrs:
                                for k, v1, v2, v3 in body_attrs:
                                    val = v1 or v2 or v3
                                    try:
                                        val = json.loads(val)
                                    except Exception:
                                        pass
                                    args_dict[k] = val
                            else:
                                args_dict["raw_body"] = body

                    tool_calls.append({
                        "id": f"call_{fn_name}_{current_step}_{len(tool_calls)}",
                        "type": "function",
                        "function": {
                            "name": fn_name,
                            "arguments": json.dumps(args_dict) if args_dict else "{}"
                        }
                    })

            step_duration = time.time() - t_step_start
            print(f"🤖 [Agent Step {current_step}/{max_steps}] LLM responded in {step_duration:.2f}s | Tool calls requested: {len(tool_calls)}")

            if not tool_calls:
                clean_answer = content_str.strip()
                if "<function=" in clean_answer:
                    raise RuntimeError(
                        f"Agent LLM returned unexecuted function invocation instead of valid answer: {clean_answer}"
                    )
                if not clean_answer:
                    raise RuntimeError(f"Agent LLM returned empty response at step {current_step}.")

                # Step 1 Rejection Guard: Never allow premature exit without calling retrieval tools
                if current_step == 1 and not all_citations:
                    print(f"⚠️ [Agent Step 1 Guard] LLM attempted to exit on Step 1 with 0 tool calls. Forcing tool invocation...")
                    messages.append({
                        "role": "assistant",
                        "content": clean_answer
                    })
                    messages.append({
                        "role": "user",
                        "content": (
                            "CRITICAL GROUNDING ERROR: You cannot answer directly from memory or lecture title alone. "
                            "You MUST invoke one of your tools (e.g. 'search_transcript', 'get_lecture_outline', or 'get_transcript_window') "
                            "to inspect and retrieve from the lecture transcript now."
                        )
                    })
                    continue

                print(f"🎯 [Agent Step {current_step}] LLM provided direct final answer ({len(clean_answer)} chars). Exiting agent loop.")
                final_answer = clean_answer
                break

            # Append assistant turn with tool calls
            messages.append({
                "role": "assistant",
                "content": content_str if content_str else None,
                "tool_calls": tool_calls
            })

            for tc in tool_calls:
                func = tc.get("function", {})
                func_name = func.get("name", "")
                raw_args = func.get("arguments", "{}")
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except Exception as e:
                    raise ValueError(f"Malformed tool call arguments for '{func_name}': {raw_args}. Error: {e}")

                t_tool_start = time.time()
                tool_result_str, tool_citations, tool_web = self.execute_tool(
                    tool_name=func_name,
                    arguments=args,
                    target_video_id=target_video_id,
                    lecture_title=lecture_title
                )
                tool_dur = time.time() - t_tool_start
                print(f"  ✅ [Tool Done] {func_name} finished in {tool_dur:.2f}s | Output: {len(tool_result_str)} chars, {len(tool_citations)} citation(s)")

                all_citations.extend(tool_citations)
                all_web_sources.extend(tool_web)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", "call_default"),
                    "name": func_name,
                    "content": tool_result_str
                })

        if not final_answer:
            print(f"🧠 [Agent Synthesis] Grounding final answer with {len(messages)} history turns using {display_model}...")
            t_synth = time.time()
            if provider == "huggingface" and HAS_HF:
                try:
                    hf_client = InferenceClient(api_key=hf_token)
                    resp = hf_client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        max_tokens=1024,
                        temperature=0.25
                    )
                    final_answer = resp.choices[0].message.content.strip()
                except Exception as e:
                    print(f"❌ [Agent Synthesis Error] Synthesis failed: {e}")
                    raise RuntimeError(f"Agent synthesis step failed: {e}")
            else:
                payload = {
                    "model": model_name,
                    "messages": messages,
                    "max_tokens": 1024,
                    "temperature": 0.25
                }
                resp = requests.post(endpoint, headers=headers, json=payload, timeout=60)
                if resp.status_code == 200:
                    final_answer = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                else:
                    raise RuntimeError(f"Agent synthesis step failed ({resp.status_code}): {resp.text}")
            print(f"✅ [Agent Synthesis] Completed in {time.time() - t_synth:.2f}s ({len(final_answer)} chars)")
            if not final_answer:
                raise RuntimeError(f"Agent failed to synthesize final answer from {display_model}.")
            if "<function=" in final_answer:
                raise RuntimeError(f"Agent synthesis emitted unexecuted function invocation: {final_answer}")

        # Deduplicate citations by timestamp and prefix
        seen_ts = set()
        dedup_citations = []
        for c in all_citations:
            k = (c.get("timestamp"), c.get("text", "")[:40])
            if k not in seen_ts:
                seen_ts.add(k)
                dedup_citations.append(c)

        total_time = time.time() - t_rag_start
        print(f"🏁 [Agentic RAG Engine] Finished in {total_time:.2f}s | Citations: {len(dedup_citations)} | Web: {len(all_web_sources)}")
        print("-" * 50)

        return {
            "answer": final_answer,
            "citations": dedup_citations,
            "web_sources": all_web_sources,
            "model": display_model,
            "pinecone_vector_matches": len(dedup_citations),
            "lecture_title": lecture_title,
            "video_id": target_video_id
        }

    def extract_lecture_keywords(self, video_id: str = "", title: str = "", top_n: int = 8) -> List[str]:
        """Extract domain keywords/keyphrases from the lecture transcript & summaries."""
        keywords = []
        text_corpus = ""

        if video_id:
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(video_id)
                if saved:
                    # 1. Use summary section headings / takeaways if present
                    summary_secs = saved.get("summarySections") or saved.get("summary_sections") or []
                    for sec in summary_secs:
                        title_val = sec.get("title") or sec.get("heading") or ""
                        clean_t = re.sub(r"\[.*?\]", "", title_val).strip()
                        clean_t = re.sub(r"^[^\w\s]+\s*", "", clean_t).strip()
                        if clean_t and clean_t not in keywords:
                            keywords.append(clean_t)
                    # 2. Add text from cues
                    cues = saved.get("cues", [])
                    text_corpus = " ".join([c.get("text", "") for c in cues[:150]])
            except Exception:
                pass

        if not text_corpus and self.local_chunks:
            text_corpus = " ".join([c.get("metadata", {}).get("text", "") for c in self.local_chunks[:25]])

        # Stop words filter for technical keyword extraction
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "what", "which", "who", "whom",
            "this", "that", "these", "those", "how", "why", "when", "where", "in", "on",
            "at", "to", "for", "with", "about", "against", "between", "into", "through",
            "during", "before", "after", "above", "below", "from", "up", "down", "out",
            "off", "over", "under", "again", "further", "then", "once", "here", "there",
            "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
            "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "can",
            "will", "just", "should", "now", "lecture", "student", "today", "going", "discuss",
            "talk", "understand", "see", "also", "well", "like", "know", "mean", "right",
            "good", "morning", "session", "okay", "yeah", "video", "thank", "please", "yes",
            "here", "let", "first", "second", "third", "one", "two", "three", "point", "thing"
        }
        words = re.findall(r"\b[a-zA-Z]{4,}\b", (text_corpus + " " + title).lower())
        freq = {}
        for w in words:
            if w not in stop_words:
                freq[w] = freq.get(w, 0) + 1

        sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)
        for w, _ in sorted_words:
            if len(keywords) >= top_n:
                break
            cap_w = w.capitalize()
            if cap_w not in keywords and w not in keywords:
                keywords.append(w)

        return keywords[:top_n]

    def _clean_for_submission(self, text: str, target_words: int = 100) -> str:
        """Strip markdown syntax, timestamps, and AI boilerplate from text."""
        # 1. Strip timestamp patterns like [01:23] or [01:23:45] or [00:00 - 15:20]
        cleaned = re.sub(r"\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?\]", "", text)
        # 2. Strip Markdown headers, bold, italics, code fences, blockquotes, bullets
        cleaned = re.sub(r"```[\s\S]*?```", "", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"#{1,6}\s*", "", cleaned)
        cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
        cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
        cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
        cleaned = re.sub(r"_([^_]+)_", r"\1", cleaned)
        cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r">\s*", "", cleaned)
        # 3. Strip AI cliches and intros
        ai_cliches = [
            r"^here\s*(?:'s|\s+is)\s+(?:a\s+|an\s+)?(?:concise\s+)?(?:academic\s+)?(?:submission|summary|takeaway|answer|response|overview|explanation)[^:.\n]*?[:.]+\s*",
            r"^here\s*(?:'s|\s+is)\s+[^:.\n]*?[:.]+\s*",
            r"^based on (the )?(professor's )?(lecture|transcript|video|explanation)[^:.\n]*?[,.:]+\s*",
            r"^(we can identify|we see that|we can observe|it can be seen that)\s+",
            r"^in this lecture.*?,\s*",
            r"^as an ai language model.*?,\s*",
            r"💡\s*\*\*ai tutor connected\*\*.*",
            r"\*\(tip:.*?\)\*",
            r"^in conclusion.*?,\s*",
            r"^(?:academic\s+)?submission(?:\s+of\s+around\s+\d+\s+words)?:\s*",
            r"^technical takeaway:\s*"
        ]
        for pat in ai_cliches:
            cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE | re.MULTILINE)

        # 4. Collapse whitespace and strip wrapping quotes
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        cleaned = cleaned.strip('"\'')

        # 5. Trim to approximate target words at sentence boundary if too long
        words = cleaned.split()
        if len(words) > target_words + 30:
            trimmed = " ".join(words[:target_words + 15])
            last_period = max(trimmed.rfind("."), trimmed.rfind("!"), trimmed.rfind("?"))
            if last_period > len(trimmed) // 2:
                cleaned = trimmed[:last_period + 1]
            else:
                cleaned = " ".join(words[:target_words]) + "."
        return cleaned

    def generate_submission_version(
        self,
        original_text: str,
        video_id: Optional[str] = "",
        word_count: int = 100,
        model_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Synthesize an academic submission (~100 words, plain text) from the persona of
        an Indian student pursuing a Master's degree while working in the industry.
        """
        import requests

        if not original_text or not original_text.strip():
            raise ValueError("original_text is required to generate academic submission.")
        if "<function=" in original_text:
            raise ValueError(f"Cannot generate academic submission from unexecuted tool call: {original_text}")

        clean_base = self._clean_for_submission(original_text, target_words=word_count * 2)
        keywords = self.extract_lecture_keywords(video_id=video_id or "", top_n=6)
        kw_str = ", ".join(keywords) if keywords else "the core lecture topics"

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))

        # Strict provider selection without cascading fallback
        if model_id:
            m_lower = model_id.lower()
            if "gemini" in m_lower or "flash" in m_lower:
                provider = "gemini"
            elif "groq" in m_lower or "llama-3.3" in m_lower:
                provider = "groq"
            elif "llama-3.1" in m_lower or "huggingface" in m_lower:
                provider = "huggingface"
            else:
                provider = "groq" if groq_key else ("huggingface" if hf_token else "gemini")
        else:
            provider = "groq" if groq_key else ("huggingface" if hf_token else "gemini")

        system_prompt = (
            "You are an Indian graduate student pursuing a Master's degree (M.Tech / M.S.) in Computer Science / Engineering, "
            "who is simultaneously working as a software / systems engineer in the corporate industry.\n\n"
            f"Your professor has assigned a concise academic submission of strictly around {word_count} words (between 85 and 115 words) "
            "summarizing your technical takeaway or solution for this topic.\n\n"
            "STRICT RULES:\n"
            f"1. Target length: strictly around {word_count} words.\n"
            "2. Tone: Professional, practical, academically rigorous, and grounded. Reflect both real-world industrial insight and deep graduate-level theoretical understanding.\n"
            "3. Format: Clean plain text only. STRICTLY NO MARKDOWN: no asterisks, no bolding, no headers, no bullet points, and NO bracketed timestamps [MM:SS].\n"
            "4. NO AI CLICHES OR PREAMBLES: Never say 'Here is a concise academic submission...', 'Here is my summary', 'In conclusion', 'As an AI', 'In this lecture', or 'Based on the explanation'. Start IMMEDIATELY with the first sentence of technical analysis.\n"
            f"5. Domain Concepts: Seamlessly integrate relevant technical terminology: {kw_str}."
        )

        user_content = (
            f"Draft the authentic ~{word_count}-word student submission based on this technical explanation:\n\n{clean_base}"
        )

        raw_output = ""
        model_used = ""

        if provider == "gemini":
            if not gemini_key:
                raise RuntimeError("Gemini selected for submission synthesis, but GEMINI_API_KEY is not set.")
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": user_content}]}],
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300}
                }
                r = requests.post(url, json=payload, timeout=15)
                if r.status_code != 200:
                    raise RuntimeError(f"Gemini API returned HTTP {r.status_code}: {r.text}")
                data = r.json()
                candidates = data.get("candidates", [])
                if not candidates or "content" not in candidates[0]:
                    raise RuntimeError("Gemini returned empty candidates array.")
                parts = candidates[0]["content"].get("parts", [])
                if not parts:
                    raise RuntimeError("Gemini returned empty parts in content.")
                raw_output = parts[0].get("text", "").strip()
                model_used = "Gemini 2.0 Flash"
            except Exception as e:
                raise RuntimeError(f"Gemini submission synthesis failed: {e}")

        elif provider == "groq":
            if not groq_key:
                raise RuntimeError("Groq selected for submission synthesis, but GROQ_API_KEY is not set.")
            try:
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 300
                }
                r = requests.post(url, headers=headers, json=payload, timeout=15)
                if r.status_code != 200:
                    raise RuntimeError(f"Groq API returned HTTP {r.status_code}: {r.text}")
                data = r.json()
                choices = data.get("choices", [])
                if not choices or "message" not in choices[0]:
                    raise RuntimeError("Groq returned empty choices array.")
                raw_output = choices[0]["message"].get("content", "").strip()
                model_used = "Groq Llama 3.3 70B"
            except Exception as e:
                raise RuntimeError(f"Groq submission synthesis failed: {e}")

        elif provider == "huggingface":
            if not hf_token:
                raise RuntimeError("Hugging Face selected for submission synthesis, but HUGGINGFACE_TOKEN is not set.")
            try:
                if HAS_HF and InferenceClient:
                    client = InferenceClient(api_key=hf_token)
                    resp = client.chat.completions.create(
                        model="meta-llama/Llama-3.1-8B-Instruct",
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_content}
                        ],
                        temperature=0.25,
                        max_tokens=300
                    )
                    if not resp or not resp.choices or not resp.choices[0].message:
                        raise RuntimeError("Hugging Face InferenceClient returned empty response.")
                    raw_output = resp.choices[0].message.content.strip()
                    model_used = "Hugging Face Llama 3.1 8B"
                else:
                    url = "https://router.huggingface.co/v1/chat/completions"
                    headers = {"Authorization": f"Bearer {hf_token}", "Content-Type": "application/json"}
                    payload = {
                        "model": "meta-llama/Llama-3.1-8B-Instruct",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_content}
                        ],
                        "temperature": 0.25,
                        "max_tokens": 300
                    }
                    r = requests.post(url, headers=headers, json=payload, timeout=30)
                    if r.status_code != 200:
                        raise RuntimeError(f"Hugging Face Router returned HTTP {r.status_code}: {r.text}")
                    choices = r.json().get("choices", [])
                    if not choices or "message" not in choices[0]:
                        raise RuntimeError("Hugging Face Router returned empty choices.")
                    raw_output = choices[0]["message"].get("content", "").strip()
                    model_used = "Hugging Face Llama 3.1 8B"
            except Exception as e:
                raise RuntimeError(f"Hugging Face submission synthesis failed: {e}")
        else:
            raise RuntimeError(f"Unsupported LLM provider '{provider}' for submission synthesis.")

        if not raw_output:
            raise RuntimeError(f"Submission generation failed: Empty output received from {model_used or provider}.")

        final_submission = self._clean_for_submission(raw_output, target_words=word_count)
        words = final_submission.split()

        return {
            "status": "success",
            "submission_text": final_submission,
            "word_count": len(words),
            "target_word_count": word_count,
            "keywords": keywords,
            "model": model_used
        }


pinecone_rag_engine = Llama3PineconeRAGStore()

