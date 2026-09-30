"""
Pinecone + Multi-Provider Tool-Calling RAG Engine for LectureScribe
-------------------------------------------------------------------
Strictly loads model & database parameters from environment variables.
Consolidated on Groq (openai/gpt-oss-120b, openai/gpt-oss-20b) and Gemini (gemini-3.8-flash).
"""
from __future__ import annotations

import os
import re
import json
import math
import time
from typing import List, Dict, Any, Tuple, Optional
from pathlib import Path
from dotenv import load_dotenv

_env_file = Path(__file__).resolve().parent.parent / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file, override=True)
else:
    load_dotenv(override=True)

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

try:
    from backend.redis_service import redis_cache
except ImportError:
    redis_cache = None


class Llama3PineconeRAGStore:
    """RAG Engine powered by Hybrid Search + Agentic LLM Tool Execution."""

    def __init__(self):
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "lecturescribe_v1")
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
                print("[RAG Warning] Pinecone package not installed. Using local chunk store.")
                return

            if self.api_key:
                self.pc = Pinecone(api_key=self.api_key)
                self.index = self.pc.Index(self.index_name)
                print(f"[RAG] Connected to Pinecone Index '{self.index_name}' (Namespace: '{self.namespace}').")
            else:
                print("[RAG Warning] PINECONE_API_KEY environment variable is not set.")
        except Exception as e:
            print(f"[RAG Warning] Could not initialize Pinecone: {e}")

    def setup_index(self) -> bool:
        """Create and verify Pinecone index on server start."""
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "lecturescribe_v1")

        if not Pinecone or not self.api_key:
            return False

        try:
            if not self.pc:
                self.pc = Pinecone(api_key=self.api_key)

            existing_indexes = [idx.name for idx in self.pc.list_indexes()]
            if self.index_name not in existing_indexes:
                print(f"🚀 [Pinecone Startup] Creating index '{self.index_name}' (dim=768, metric=cosine)...")
                if HAS_SERVERLESS:
                    self.pc.create_index(
                        name=self.index_name,
                        dimension=768,
                        metric="cosine",
                        spec=ServerlessSpec(cloud="aws", region="us-east-1")
                    )
                else:
                    self.pc.create_index(name=self.index_name, dimension=768, metric="cosine")
            self.index = self.pc.Index(self.index_name)
            return True
        except Exception as e:
            print(f"⚠️ [Pinecone Startup Warning]: {e}")
            return False

    def _generate_embedding(self, text: str) -> List[float]:
        """Generate 768-dim deterministic embedding vector."""
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
            except Exception as e:
                print(f"[RAG Warning] Pinecone upsert error: {e}")

        return len(self.local_chunks)

    def get_supported_models(self) -> List[Dict[str, Any]]:
        """Return unified active models."""
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        return [
            {
                "id": "openai/gpt-oss-120b",
                "name": "Groq GPT-OSS 120B",
                "provider": "Groq Cloud",
                "badge": "🚀 Primary Reasoning & Tools",
                "is_configured": bool(groq_key),
                "is_recommended": True,
                "free_tier_info": "Active via GROQ_API_KEY"
            },
            {
                "id": "openai/gpt-oss-20b",
                "name": "Groq GPT-OSS 20B",
                "provider": "Groq Cloud",
                "badge": "⚡ Ultra-Fast Fallback",
                "is_configured": bool(groq_key),
                "is_recommended": False,
                "free_tier_info": "Active via GROQ_API_KEY"
            },
            {
                "id": "gemini-3.8-flash",
                "name": "Gemini 3.8 Flash",
                "provider": "Google",
                "badge": "⚡ 1M Long-Context Fallback",
                "is_configured": bool(gemini_key),
                "is_recommended": True,
                "free_tier_info": "Google AI Studio"
            }
        ]

    def reciprocal_rank_fusion(self, ranked_lists: List[List[Dict[str, Any]]], k: int = 60) -> List[Dict[str, Any]]:
        """Combine multiple ranked lists using Reciprocal Rank Fusion."""
        rrf_scores = {}
        chunk_map = {}

        for ranked_list in ranked_lists:
            for rank_0, item in enumerate(ranked_list):
                rank = rank_0 + 1
                doc_id = f"{item.get('start_time', '')}_{item.get('text', '')[:60]}"
                if doc_id not in chunk_map:
                    chunk_map[doc_id] = item
                rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank)

        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        return [chunk_map[doc_id] for doc_id in sorted_ids]

    def _parse_timestamp(self, ts: str) -> float:
        """Convert timestamp string to total seconds."""
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
                "description": "Fetch structured chapter outlines and key takeaways with timestamps.",
                "parameters": {
                    "type": "object",
                    "properties": {"video_id": {"type": "string"}},
                    "required": ["video_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_transcript",
                "description": "Search the transcript using hybrid vector and keyword search.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "top_k": {"type": "integer"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_transcript_window",
                "description": "Fetch dialogue between two timestamps.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_time": {"type": "string"},
                        "end_time": {"type": "string"}
                    },
                    "required": ["start_time", "end_time"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_web_context",
                "description": "Search DuckDuckGo and Wikipedia for external courses, syllabi (e.g. IITs, Stanford, MIT, NPTEL), and technical context.",
                "parameters": {
                    "type": "object",
                    "properties": {"search_query": {"type": "string"}},
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
        """Execute agent tool calls."""
        citations = []
        web_sources = []
        vid_cache = target_video_id or str(arguments.get("video_id", "")).strip()

        if redis_cache and vid_cache and tool_name in ("get_lecture_outline", "get_transcript_window", "search_transcript"):
            cached_pkg_str = redis_cache.get_tool(vid_cache, tool_name, arguments)
            if cached_pkg_str:
                try:
                    pkg = json.loads(cached_pkg_str)
                    return pkg.get("result", ""), pkg.get("citations", []), pkg.get("web_sources", [])
                except Exception:
                    pass

        if tool_name == "get_lecture_outline":
            vid = vid_cache
            if not vid:
                raise ValueError("get_lecture_outline requires a valid video_id.")
            from backend.database import db_manager
            saved = db_manager.get_saved_video(vid)
            if not saved:
                raise ValueError(f"Lecture '{vid}' not found in database.")

            sections = saved.get("summarySections") or saved.get("summary_sections") or []
            formatted = []
            for sec in sections:
                title = sec.get("title", "")
                points = sec.get("points", [])
                ts_match = re.search(r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]", title)
                start_t = ts_match.group(1) if ts_match else "00:00"
                end_t = ts_match.group(2) if (ts_match and ts_match.group(2)) else start_t

                clean_title = re.sub(r"\[.*?\]", "", title).strip()
                citations.append({"timestamp": start_t, "end_time": end_t, "text": f"Topic: {clean_title}"})
                formatted.append({
                    "chapter": clean_title,
                    "timestamp": f"{start_t} - {end_t}",
                    "core_concepts": points
                })
            return json.dumps(formatted), citations, web_sources

        elif tool_name == "search_transcript":
            query = str(arguments.get("query", "")).strip()
            top_k = int(arguments.get("top_k", 5))
            vid = vid_cache

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
                            if m and m.metadata:
                                pinecone_matches.append(m.metadata)
                except Exception:
                    pass

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
            except Exception:
                pass

            ranked = [s for s in [pinecone_matches, algolia_matches] if s]
            combined = self.reciprocal_rank_fusion(ranked, k=60)[:top_k] if ranked else []

            # Fallback to PostgreSQL transcript cues if vector & sparse return zero hits
            if not combined and vid:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(vid)
                if saved and saved.get("cues"):
                    cues = saved["cues"]
                    q_words = re.findall(r"\w+", query.lower())
                    scored_cues = []
                    for c in cues:
                        txt = c.get("text", "")
                        score = sum(1 for w in q_words if w in txt.lower())
                        scored_cues.append((score, c))
                    scored_cues.sort(key=lambda x: x[0], reverse=True)
                    for _, c in scored_cues[:top_k]:
                        combined.append({
                            "start_time": c.get("time", "00:00"),
                            "end_time": c.get("time", "00:00"),
                            "text": c.get("text", "")
                        })

            out = []
            for item in combined:
                st = item.get("start_time", "00:00")
                txt = item.get("text", "")
                citations.append({"timestamp": st, "end_time": item.get("end_time", st), "text": txt[:120] + "..."})
                out.append({"timestamp": f"[{st}]", "text": txt})
            return json.dumps(out), citations, web_sources

        elif tool_name == "get_transcript_window":
            st = str(arguments.get("start_time", "00:00")).strip()
            et = str(arguments.get("end_time", "00:00")).strip()
            vid = vid_cache

            st_sec = self._parse_timestamp(st)
            et_sec = self._parse_timestamp(et)
            from backend.database import db_manager
            saved = db_manager.get_saved_video(vid)
            cues = saved.get("cues", []) if saved else []
            window = [c for c in cues if st_sec <= self._parse_timestamp(c.get("time", "00:00")) <= et_sec]

            if not window:
                raise ValueError(f"No transcript cues found within time window [{st} - {et}].")

            dialogue = " ".join([f"[{c.get('time', '00:00')}] {c.get('text', '')}" for c in window])
            citations.append({"timestamp": st, "end_time": et, "text": dialogue[:120] + "..."})
            return json.dumps({"start_time": st, "end_time": et, "transcript": dialogue}), citations, web_sources

        elif tool_name == "search_web_context":
            sq = str(arguments.get("search_query", "")).strip()
            from backend.web_search import search_web_for_context
            hits = search_web_for_context(sq, max_results=3)
            for h in hits:
                web_sources.append(h)
            return json.dumps(hits), citations, web_sources
        else:
            raise ValueError(f"Unknown tool '{tool_name}' requested.")

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
        get_user_email: Optional[str] = None,
        user_email: Optional[str] = None
    ) -> Dict[str, Any]:
        """Unified Agentic RAG Execution."""
        import requests
        target_video_id = str(video_id).strip() if video_id else ""
        lecture_title = video_title or self.video_title or "Active Lecture"

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        candidates = []
        if groq_key:
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "openai/gpt-oss-120b",
                "display": "Groq GPT-OSS 120B"
            })
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "openai/gpt-oss-20b",
                "display": "Groq GPT-OSS 20B"
            })
        if gemini_key:
            candidates.append({
                "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                "auth_header": f"Bearer {gemini_key}",
                "model_name": "gemini-3.8-flash",
                "display": "Gemini 3.8 Flash (OpenAI API)"
            })

        if not candidates:
            raise RuntimeError("No active LLM keys (GROQ_API_KEY or GEMINI_API_KEY) found.")

        active_tools = self.AGENT_TOOLS if enable_web_search else [
            t for t in self.AGENT_TOOLS if t["function"]["name"] != "search_web_context"
        ]

        web_instruction = (
            "2. When the user asks to compare this lecture with other university courses (e.g., IITs, Stanford, MIT, NPTEL), standard syllabi, "
            "external benchmarks, or real-world implementations, you MUST call 'search_web_context' to retrieve "
            "real course references and include external web links in your answer.\n"
            "3. If external web sources are used, summarize their findings and cite the source URLs."
            if enable_web_search else
            "2. Answer student questions using only the retrieved lecture outline and transcript data."
        )

        system_prompt = (
            f"You are an Academic AI Tutor for lecture: '{lecture_title}'.\n"
            "1. Ground specific statements about this lecture with exact [MM:SS] timestamps inline.\n"
            f"{web_instruction}"
        )

        last_error = None
        for prov in candidates:
            endpoint = prov["endpoint"]
            auth_header = prov["auth_header"]
            model_name = prov["model_name"]
            display_model = prov["display"]

            print(f"🤖 [Agentic RAG] Initializing query: '{query}' using {display_model}")
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Student Request: {query}"}
            ]

            all_citations = []
            all_web_sources = []
            max_steps = 3
            current_step = 0
            final_answer = ""
            headers = {"Authorization": auth_header, "Content-Type": "application/json"}

            try:
                while current_step < max_steps:
                    current_step += 1
                    payload = {
                        "model": model_name,
                        "messages": messages,
                        "tools": active_tools,
                        "tool_choice": "auto",
                        "max_tokens": 1024,
                        "temperature": 0.3
                    }

                    resp = None
                    try:
                        for attempt in range(3):
                            resp = requests.post(endpoint, headers=headers, json=payload, timeout=45)
                            if resp.status_code in (429, 503):
                                backoff = (attempt + 1) * 2.0
                                print(f"⚠️ [{display_model} status {resp.status_code}] Backing off {backoff:.1f}s...")
                                time.sleep(backoff)
                                continue
                            break
                    except requests.exceptions.RequestException as net_err:
                        raise RuntimeError(f"Network error: {net_err}")

                    if resp is None or resp.status_code != 200:
                        status_val = resp.status_code if resp is not None else "N/A"
                        body_val = resp.text[:300] if resp is not None else "No response received"
                        raise RuntimeError(f"Agent API failed ({status_val}): {body_val}")

                    data = resp.json()
                    msg = data.get("choices", [{}])[0].get("message", {})
                    tool_calls = msg.get("tool_calls", []) or []
                    content_str = msg.get("content", "") or ""

                    if not tool_calls:
                        final_answer = content_str.strip()
                        break

                    messages.append({"role": "assistant", "content": content_str, "tool_calls": tool_calls})
                    for tc in tool_calls:
                        func_name = tc["function"]["name"]
                        raw_args = tc["function"]["arguments"]
                        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                        tool_res, tool_cit, tool_web = self.execute_tool(func_name, args, target_video_id, lecture_title)
                        all_citations.extend(tool_cit)
                        all_web_sources.extend(tool_web)
                        messages.append({"role": "tool", "tool_call_id": tc["id"], "name": func_name, "content": tool_res})

                if not final_answer:
                    messages.append({
                        "role": "user",
                        "content": "Please synthesize a final, clear academic answer to the original question using the information retrieved above."
                    })
                    payload = {
                        "model": model_name,
                        "messages": messages,
                        "tools": active_tools,
                        "tool_choice": "none",
                        "max_tokens": 1024,
                        "temperature": 0.3
                    }
                    r = requests.post(endpoint, headers=headers, json=payload, timeout=45)
                    if r.status_code == 200:
                        final_answer = r.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()

                if not final_answer:
                    final_answer = f"The requested topic was not explicitly identified in the transcript for '{lecture_title}'. Please check the lecture outline or specify a timestamp range."

                return {
                    "answer": final_answer,
                    "citations": all_citations,
                    "web_sources": all_web_sources,
                    "model": display_model,
                    "lecture_title": lecture_title,
                    "video_id": target_video_id
                }

            except Exception as pe:
                print(f"⚠️ [Agent Fallback] {display_model} failed ({pe}). Cascading...")
                last_error = pe
                continue

        raise RuntimeError(f"All unified LLM providers failed. Last error: {last_error}")

    def _clean_for_submission(self, text: str, target_words: int = 100) -> str:
        """Strip markdown syntax, timestamps, and AI boilerplate."""
        cleaned = text.strip()
        cleaned = re.sub(r"```[\s\S]*?```", "", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"#{1,6}\s*", "", cleaned)
        cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
        cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
        cleaned = re.sub(r"\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?\]", "", cleaned)
        cleaned = re.sub(r"(?i)^here\s+is\s+a\s+concise\s+academic\s+submission[^:.\n]*[:.\n]+\s*", "", cleaned)
        cleaned = re.sub(r"(?i)^based\s+on\s+the\s+professor('s)?\s+lecture\s+transcript[^:.\n]*[:.\n]+\s*", "", cleaned)
        cleaned = re.sub(r"(?i)here('s|\s+is)\s+what\s+i\s+found\s+regarding\s+[^:.\n]*[:.\n]*\s*", "", cleaned)
        cleaned = re.sub(r"(?i)here('s|\s+is)\s+what\s+i\s+found[^:.\n]*[:.\n]*\s*", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def generate_submission_version(
        self,
        original_text: str,
        video_id: Optional[str] = "",
        word_count: int = 100,
        model_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Synthesize plain-text MTech student submission version."""
        if not original_text or not original_text.strip():
            raise ValueError("original_text cannot be empty.")
        if re.search(r"<\s*function\s*=", original_text):
            raise ValueError("Input contains raw unexecuted function call tags.")

        clean_base = self._clean_for_submission(original_text, target_words=word_count * 2)

        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")

        if not (groq_key or gemini_key):
            raise RuntimeError("No LLM keys configured for submission generation.")

        system_prompt = (
            f"You are an Indian M.Tech graduate student drafting an academic submission. "
            f"Write a comprehensive, professional submission paragraph of approximately {word_count} words "
            "(strictly between 80 and 120 words) thoroughly explaining the core academic takeaways from the provided text. "
            "Do not include markdown headers, bullet points, citations, or timestamps. Output plain text only."
        )
        user_content = f"Synthesize this lecture insight into a full graduate submission paragraph: {clean_base}"

        if groq_key:
            try:
                import requests
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": "openai/gpt-oss-120b",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 300
                }
                r = requests.post(url, headers=headers, json=payload, timeout=20)
                if r.status_code == 200:
                    raw_output = r.json()["choices"][0]["message"]["content"].strip()
                    final_sub = self._clean_for_submission(raw_output, target_words=word_count + 20)
                    words = final_sub.split()
                    
                    # Ensure minimum academic paragraph length if source point was brief
                    if len(words) < 40 and len(clean_base.split()) >= len(words):
                        final_sub = f"{final_sub} The lecture emphasized these principles as key analytical foundations for system design and theoretical evaluation."

                    return {
                        "status": "success",
                        "submission_text": final_sub,
                        "word_count": len(final_sub.split()),
                        "model": "Groq GPT-OSS 120B"
                    }
            except Exception as ge:
                print(f"⚠️ [Submission Generation Notice] Groq failed ({ge}). Trying Gemini fallback...")

        if gemini_key:
            try:
                import requests
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": f"{system_prompt}\n\n{user_content}"}]}],
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300}
                }
                r = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=20)
                if r.status_code == 200:
                    raw_output = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                    final_sub = self._clean_for_submission(raw_output, target_words=word_count + 20)
                    return {
                        "status": "success",
                        "submission_text": final_sub,
                        "word_count": len(final_sub.split()),
                        "model": "Gemini 3.8 Flash"
                    }
            except Exception:
                pass

        final_sub = " ".join(clean_base.split()[:word_count]) + "."
        return {
            "status": "success",
            "submission_text": final_sub,
            "word_count": len(final_sub.split()),
            "model": "Local Extractor"
        }
    def _build_summary_response(self, text: str, model_name: str, title: str, video_id: str) -> Dict[str, Any]:
        """Helper to extract timestamps and format summary response."""
        citations = []
        seen = set()
        ts_pattern = re.compile(r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]")
        for match in ts_pattern.finditer(text):
            start_t = match.group(1)
            key = (start_t, text[max(0, match.start() - 20):min(len(text), match.end() + 20)])
            if key not in seen:
                seen.add(key)
                citations.append({
                    "timestamp": start_t,
                    "end_time": match.group(2) or start_t,
                    "text": "Extracted segment"
                })

        return {
            "answer": text,
            "citations": citations,
            "web_sources": [],
            "model": model_name,
            "lecture_title": title,
            "video_id": video_id,
            "pinecone_vector_matches": 0
        }

    def generate_full_transcript_summary(
        self,
        transcript_str: str,
        lecture_title: str,
        video_id: str,
        user_original_request: str,
        model_id: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """SUMMARY-branch completion: Uncut, chronological context processed by Groq or Gemini."""
        import requests

        target_video_id = str(video_id).strip() if video_id else ""
        title = lecture_title or "Active Lecture"
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        system_prompt = (
            f"You are an AI Tutor for lecture: '{title}'. Unpack the unabridged transcript "
            "chronologically into distinct Markdown chapters using ## headers. Ground every statement "
            "with exact inline [MM:SS] timestamps."
        )
        user_prompt = f"Task: {user_original_request}\n\nTranscript Content:\n{transcript_str}"

        # 1. Groq GPT-OSS 120B
        if groq_key:
            print("🚀 [Summary Engine] Dispatching to Groq GPT-OSS 120B...")
            try:
                groq_payload = {
                    "model": "openai/gpt-oss-120b",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 4096
                }
                groq_headers = {
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json"
                }
                r = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers=groq_headers,
                    json=groq_payload,
                    timeout=90
                )
                if r.status_code == 200:
                    ans = r.json()["choices"][0]["message"]["content"].strip()
                    return self._build_summary_response(ans, "Groq GPT-OSS 120B", title, target_video_id)
            except Exception as ge:
                print(f"⚠️ [Groq Summary Notice] {ge}")

        # 2. Google Gemini
        if gemini_key:
            candidate_models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]
            payload = {
                "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096}
            }
            headers = {"Content-Type": "application/json"}

            for model_name in candidate_models:
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                try:
                    resp = requests.post(api_url, headers=headers, json=payload, timeout=90)
                    if resp.status_code == 200:
                        res_data = resp.json()
                        final_answer = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                        return self._build_summary_response(final_answer, f"{model_name} (Native REST API)", title, target_video_id)
                except Exception as e:
                    print(f"⚠️ [Gemini Summary Notice] {e}")

        raise RuntimeError("All LLM providers failed to generate summary.")

    @staticmethod
    def check_llm_connectivity() -> Dict[str, Any]:
        """Probes Groq and Gemini connectivity and intent router status."""
        import requests
        results = {}
        active = None
        configured_count = 0

        probes = [
            (
                "groq",
                "Groq GPT-OSS 120B",
                os.getenv("GROQ_API_KEY", ""),
                "https://api.groq.com/openai/v1/models",
                {"Authorization": f"Bearer {os.getenv('GROQ_API_KEY', '')}"}
            ),
            (
                "gemini",
                "Gemini 3.8 Flash",
                os.getenv("GEMINI_API_KEY", ""),
                f"https://generativelanguage.googleapis.com/v1beta/models?key={os.getenv('GEMINI_API_KEY', '')}",
                {}
            ),
        ]

        for provider_key, display_name, key, probe_url, headers in probes:
            if not key:
                results[provider_key] = {"display": display_name, "configured": False, "reachable": False, "error": "API key not configured"}
                continue

            configured_count += 1
            t0 = time.time()
            reachable = False
            err_msg = None
            try:
                r = requests.get(probe_url, headers=headers, timeout=5)
                reachable = (r.status_code == 200)
                if not reachable:
                    err_msg = f"HTTP {r.status_code}"
            except Exception as exc:
                err_msg = str(exc)

            results[provider_key] = {
                "display": display_name,
                "configured": True,
                "reachable": reachable,
                "latency_ms": round((time.time() - t0) * 1000, 2) if reachable else None,
                "error": err_msg
            }
            if active is None and reachable:
                active = provider_key

        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        router_ready = bool(groq_key or gemini_key)
        results["intent_router"] = {
            "display": "Fast LLM Router (Groq 20B / Gemini)",
            "configured": router_ready,
            "reachable": results.get("groq", {}).get("reachable", False) or results.get("gemini", {}).get("reachable", False),
            "latency_ms": results.get("groq", {}).get("latency_ms") or results.get("gemini", {}).get("latency_ms"),
            "error": None if router_ready else "Missing GROQ_API_KEY and GEMINI_API_KEY"
        }

        return {
            "status": "ready" if any(r["reachable"] for k, r in results.items() if k != "intent_router") else "degraded",
            "active_provider": active,
            "configured_count": configured_count,
            "providers": results
        }


pinecone_rag_engine = Llama3PineconeRAGStore()