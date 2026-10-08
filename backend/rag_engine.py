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
import random
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

    def _filter_and_deduplicate_citations(
        self,
        citations: List[Dict[str, Any]],
        answer: str,
        target_video_id: str = ""
    ) -> List[Dict[str, Any]]:
        """
        Filter and deduplicate candidate citations against the synthesized final answer.
        - Suppresses citations completely if the answer indicates topic is not covered / boundary notice.
        - Deduplicates candidate citations by (video_id, timestamp_seconds).
        - If inline timestamps [MM:SS] are present in the answer, retains strictly the referenced citations.
        """
        if not citations or not answer:
            return []

        lower_ans = answer.lower()
        negative_markers = [
            "course boundary notice",
            "not explicitly identified",
            "not covered in this lecture",
            "not covered in your course",
            "not found in the transcript",
            "was not discussed in the transcript",
            "could not find any mention",
            "is not covered in '"
        ]
        if any(marker in lower_ans for marker in negative_markers):
            # If the response is a boundary notice or negative refusal,
            # suppress candidate lecture chunks unless it's a cross-lecture citation that was explicitly referenced
            cross_cites = [c for c in citations if c.get("cross_lecture")]
            if not cross_cites:
                return []

        # Deduplicate citations by (video_id, parsed_seconds)
        unique_citations = []
        seen_keys = set()
        for c in citations:
            vid = c.get("video_id") or target_video_id
            ts = c.get("timestamp", "00:00")
            sec = self._parse_timestamp(ts)
            key = (vid, sec)
            if key not in seen_keys:
                seen_keys.add(key)
                unique_citations.append(c)

        # Extract all timestamps referenced in the answer
        raw_ts_in_answer = re.findall(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", answer)
        if raw_ts_in_answer:
            cited_seconds = {self._parse_timestamp(t) for t in raw_ts_in_answer}
            matched_citations = [
                c for c in unique_citations
                if self._parse_timestamp(c.get("timestamp", "00:00")) in cited_seconds
            ]
            return matched_citations

        # If answer is positive but didn't write inline timestamps, return top 5 unique candidates
        return unique_citations[:5]

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
                "name": "search_course_lectures",
                "description": "Search for topics or concepts across all OTHER lectures in this course when not found in the current lecture.",
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

    COURSE_AGENT_TOOLS = [
        {
            "type": "function",
            "function": {
                "name": "search_course_transcripts",
                "description": "Search across all lectures in this course for relevant dialogue, concepts, derivations, and formulas.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Academic search query or topic name"},
                        "top_k": {"type": "integer", "description": "Number of lecture segments to retrieve (default 8)"}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_course_outline_and_lectures",
                "description": "Get the complete list of lectures in this course, their sequence, titles, and IDs.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_course_reading_materials",
                "description": "Fetch course library items: professor slides, textbooks, and recommended reading materials.",
                "parameters": {
                    "type": "object",
                    "properties": {}
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
        vid_cache = target_video_id.strip() if target_video_id and target_video_id != "active" else str(arguments.get("video_id", "")).strip()

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
            if not vid or vid == "active":
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
            if self.index and vid and vid != "active":
                try:
                    emb = self._generate_embedding(query)
                    kwargs = {
                        "vector": emb,
                        "top_k": top_k,
                        "namespace": self.namespace,
                        "include_metadata": True,
                        "filter": {"video_id": {"$eq": vid}}
                    }
                    res = self.index.query(**kwargs)
                    if res and res.matches:
                        for m in res.matches:
                            if m and m.metadata:
                                pinecone_matches.append(m.metadata)
                except Exception:
                    pass

            algolia_matches = []
            if vid and vid != "active":
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
            if not combined and vid and vid != "active":
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
            if not vid or vid == "active":
                raise ValueError("get_transcript_window requires a valid video_id.")

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

        elif tool_name == "search_course_lectures":
            query = str(arguments.get("query", "")).strip()
            top_k = int(arguments.get("top_k", 5))
            current_vid = vid_cache

            # 1. Determine the course name for this lecture
            course_name = ""
            if current_vid and current_vid != "active":
                try:
                    from backend.database import db_manager, extract_course_name
                    saved = db_manager.get_saved_video(current_vid)
                    if saved:
                        course_name = saved.get("course_name") or extract_course_name(saved.get("title", ""))
                except Exception:
                    pass
            if not course_name and lecture_title:
                from backend.database import extract_course_name
                course_name = extract_course_name(lecture_title)

            # 2. Search Algolia across all lectures (without filtering to current_vid)
            course_matches = []
            try:
                from backend.algolia_service import algolia_service
                hits = algolia_service.search(query, video_id=None, limit=top_k * 4)
                for h in hits:
                    hit_vid = str(h.get("video_id", "")).strip()
                    if hit_vid and hit_vid != current_vid:
                        hit_title = h.get("video_title") or "Lecture"
                        hit_course = extract_course_name(hit_title)
                        if not course_name or hit_course.lower() == course_name.lower():
                            course_matches.append({
                                "video_id": hit_vid,
                                "video_title": hit_title,
                                "timestamp": h.get("timestamp", "00:00"),
                                "text": h.get("text", "")
                            })
            except Exception as e:
                print(f"⚠️ [Cross-Lecture Algolia Search Notice]: {e}")

            # 3. If Algolia has no hits, search PostgreSQL cross-lecture cues
            if not course_matches:
                try:
                    from backend.database import db_manager
                    conn = db_manager._get_connection()
                    with conn:
                        with conn.cursor() as cursor:
                            q_pattern = f"%{query}%"
                            cursor.execute("""
                                SELECT c.video_id, v.title as video_title, c.timestamp, c.text
                                FROM lecturescribe_transcript_cues c
                                JOIN lecturescribe_videos v ON c.video_id = v.video_id
                                WHERE c.video_id != %s
                                  AND c.text ILIKE %s
                                LIMIT %s;
                            """, (current_vid, q_pattern, top_k))
                            rows = cursor.fetchall() or []
                            for r in rows:
                                course_matches.append({
                                    "video_id": r["video_id"],
                                    "video_title": r.get("video_title") or "Lecture",
                                    "timestamp": r.get("timestamp") or "00:00",
                                    "text": r.get("text") or ""
                                })
                except Exception as e:
                    print(f"⚠️ [Cross-Lecture PostgreSQL Notice]: {e}")

            out = []
            for item in course_matches[:top_k]:
                st = item.get("timestamp", "00:00")
                txt = item.get("text", "")
                vid_item = item.get("video_id", "")
                title_item = item.get("video_title", "Lecture")
                citations.append({
                    "video_id": vid_item,
                    "video_title": title_item,
                    "timestamp": st,
                    "end_time": st,
                    "text": f"[{title_item}] {txt[:120]}...",
                    "cross_lecture": True
                })
                out.append({
                    "video_id": vid_item,
                    "lecture_title": title_item,
                    "timestamp": f"[{st}]",
                    "text": txt
                })
            return json.dumps(out), citations, web_sources

        elif tool_name == "search_web_context":
            sq = str(arguments.get("search_query", "")).strip()
            from backend.web_search import search_web_for_context
            hits = search_web_for_context(sq, max_results=3)
            for h in hits:
                web_sources.append(h)
            return json.dumps(hits), citations, web_sources
        else:
            raise ValueError(f"Unknown tool '{tool_name}' requested.")

    def execute_course_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        course_name: str,
        user_email: Optional[str] = None
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """Execute tool calls scoped strictly to course knowledge (lectures, transcripts, outlines, readings)."""
        citations = []
        cname = (course_name or "").strip()

        if tool_name == "search_course_transcripts":
            query = str(arguments.get("query", "")).strip()
            top_k = int(arguments.get("top_k", 8))

            from backend.database import db_manager, extract_course_name
            course_details = db_manager.get_course_details(cname, user_email=user_email)
            lectures = course_details.get("lectures", []) if course_details else []
            video_ids = [str(l["video_id"]).strip() for l in lectures if l.get("video_id")]
            title_map = {str(l["video_id"]).strip(): l.get("title", "Lecture") for l in lectures if l.get("video_id")}

            course_matches = []
            seen_chunks = set()

            # 1. Algolia search across all lectures
            try:
                from backend.algolia_service import algolia_service
                hits = algolia_service.search(query, video_id=None, limit=top_k * 4)
                for h in hits:
                    hit_vid = str(h.get("video_id", "")).strip()
                    hit_title = h.get("video_title") or title_map.get(hit_vid) or "Lecture"
                    hit_course = extract_course_name(hit_title)
                    is_in_course = (hit_vid in video_ids) or (cname.lower() in hit_course.lower()) or (hit_course.lower() in cname.lower())
                    if is_in_course:
                        chunk_key = (hit_vid, h.get("timestamp", "00:00"))
                        if chunk_key not in seen_chunks:
                            seen_chunks.add(chunk_key)
                            course_matches.append({
                                "video_id": hit_vid,
                                "video_title": hit_title,
                                "timestamp": h.get("timestamp", "00:00"),
                                "text": h.get("text", "")
                            })
            except Exception as e:
                print(f"⚠️ [Course Tutor Algolia Search Notice]: {e}")

            # 2. PostgreSQL search across course cues if Algolia returns few
            if len(course_matches) < top_k:
                try:
                    conn = db_manager._get_connection()
                    with conn:
                        with conn.cursor() as cursor:
                            if video_ids:
                                cursor.execute("""
                                    SELECT c.video_id, v.title as video_title, c.timestamp, c.text
                                    FROM lecturescribe_transcript_cues c
                                    JOIN lecturescribe_videos v ON c.video_id = v.video_id
                                    WHERE c.video_id = ANY(%s)
                                      AND c.text ILIKE %s
                                    LIMIT %s;
                                """, (video_ids, f"%{query}%", top_k * 2))
                            else:
                                cursor.execute("""
                                    SELECT c.video_id, v.title as video_title, c.timestamp, c.text
                                    FROM lecturescribe_transcript_cues c
                                    JOIN lecturescribe_videos v ON c.video_id = v.video_id
                                    WHERE (LOWER(v.course_name) ILIKE %s OR v.title ILIKE %s)
                                      AND c.text ILIKE %s
                                    LIMIT %s;
                                """, (f"%{cname.lower()}%", f"%{cname}%", f"%{query}%", top_k * 2))
                            rows = cursor.fetchall() or []
                            for r in rows:
                                vid = str(r["video_id"]).strip()
                                ts = r.get("timestamp") or "00:00"
                                chunk_key = (vid, ts)
                                if chunk_key not in seen_chunks:
                                    seen_chunks.add(chunk_key)
                                    course_matches.append({
                                        "video_id": vid,
                                        "video_title": r.get("video_title") or title_map.get(vid) or "Lecture",
                                        "timestamp": ts,
                                        "text": r.get("text", "")
                                    })
                except Exception as pg_err:
                    print(f"⚠️ [Course Tutor PostgreSQL Cues Search Notice]: {pg_err}")

            # Format results and generate citations
            out = []
            for item in course_matches[:top_k]:
                vid_item = item["video_id"]
                title_item = item["video_title"]
                st = item["timestamp"]
                txt = item["text"]
                citations.append({
                    "video_id": vid_item,
                    "video_title": title_item,
                    "timestamp": st,
                    "end_time": st,
                    "text": f"[{title_item}] {txt[:120]}...",
                    "cross_lecture": True
                })
                out.append({
                    "video_id": vid_item,
                    "lecture_title": title_item,
                    "timestamp": f"[{st}]",
                    "text": txt
                })
            return json.dumps(out), citations

        elif tool_name == "get_course_outline_and_lectures":
            from backend.database import db_manager
            course_details = db_manager.get_course_details(cname, user_email=user_email)
            lectures = course_details.get("lectures", []) if course_details else []
            out_lectures = [
                {
                    "lecture_index": i + 1,
                    "video_id": l.get("video_id"),
                    "title": l.get("title", "Lecture")
                }
                for i, l in enumerate(lectures)
            ]
            return json.dumps({"course_name": cname, "total_lectures": len(out_lectures), "lectures": out_lectures}), citations

        elif tool_name == "get_course_reading_materials":
            from backend.database import db_manager
            resources = db_manager.get_course_resources(cname) or []
            readings = db_manager.get_course_readings(cname) or []
            return json.dumps({
                "course_name": cname,
                "slides_and_materials": [{"title": r.get("title"), "category": r.get("category")} for r in resources],
                "recommended_books_and_readings": [{"title": b.get("title"), "author": b.get("author"), "category": b.get("category")} for b in readings]
            }), citations

        else:
            raise ValueError(f"Unknown course tool '{tool_name}' requested.")

    def query_rag(
        self,
        query: str,
        video_id: Optional[str] = None,
        video_title: Optional[str] = None,
        cues: Optional[List[Dict[str, str]]] = None,
        top_k: int = 10,
        enable_web_search: bool = True,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        get_user_email: Optional[str] = None,
        user_email: Optional[str] = None,
        enforce_regenerate: bool = False
    ) -> Dict[str, Any]:
        """Unified Agentic RAG Execution."""
        import requests
        target_video_id = str(video_id).strip() if video_id else ""
        if not video_title and target_video_id and target_video_id != "active":
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(target_video_id)
                if saved and saved.get("title"):
                    video_title = saved["title"]
            except Exception:
                pass
        lecture_title = video_title or (self.video_title if self.video_id == target_video_id else "") or "Active Lecture"

        # Sync singleton state to target video if switching lectures
        if target_video_id and target_video_id != "active" and target_video_id != self.video_id:
            target_cues = cues
            if not target_cues:
                try:
                    from backend.database import db_manager
                    saved = db_manager.get_saved_video(target_video_id)
                    if saved and saved.get("cues"):
                        target_cues = saved["cues"]
                except Exception:
                    pass
            if target_cues:
                self.ingest_transcript(target_video_id, lecture_title, target_cues)

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        candidates = []
        if groq_key:
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "llama-3.3-70b-versatile",
                "display": "Groq Llama 3.3 70B Versatile"
            })
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "llama-3.1-8b-instant",
                "display": "Groq Llama 3.1 8B Instant"
            })
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
                "model_name": "gemini-2.0-flash",
                "display": "Gemini 2.0 Flash (OpenAI API)"
            })
            candidates.append({
                "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                "auth_header": f"Bearer {gemini_key}",
                "model_name": "gemini-1.5-flash",
                "display": "Gemini 1.5 Flash (OpenAI API)"
            })
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
            "2. THREE-TIER WATERFALL PROTOCOL (Strict Non-Hallucination & Mandatory Citations):\n"
            "   - Tier 1 (Current Lecture): Always search the current lecture first using 'search_transcript'. If found, ground statements with exact [MM:SS] timestamps inline.\n"
            "   - Tier 2 (Course-Wide Cross-Lecture Search): If the concept is not found in the current lecture (e.g., student asks about an earlier or different session like ELIZA in Session 3), you MUST call 'search_course_lectures' to check if another lecture in this course discusses it. If found in another lecture, explicitly state: 'This concept was not discussed in this lecture, but was covered by the professor in [Lecture Title] at [MM:SS]', and cite that lecture with its timestamp.\n"
            "   - Citation Formatting: Always cite lectures with clear natural titles and timestamps (e.g., in **[Lecture Title]** at **[MM:SS]**). NEVER leak internal tool names or raw bracketed function tokens like '【search_course_lectures】' in your output.\n"
            "   - Tier 3 (Academic Foundations & Web Search): If the concept is absent from all lectures in this course, you MUST call 'search_web_context' to retrieve verified external academic sources. Synthesize a clear, direct, and rigorous academic answer using the retrieved web snippets and grounded academic knowledge. Explicitly state the course boundary notice: '⚠️ **Course Boundary Notice**: This topic is not covered in this lecture or course syllabus. Grounded in standard academic literature:'. You MUST summarize the findings and cite the source URLs using clean markdown links: [Source Name / Domain](URL). NEVER output raw JSON dictionaries, stringified objects, or bracketed function tokens like '【\"Web Result...\", \"url\": \"...\"】'.\n"
            "   - STRICT NON-HALLUCINATION RULE: Never invent timestamps. Never claim a topic was taught in a lecture if it was not. Always provide citations for claims."
            if enable_web_search else
            "2. TWO-TIER WATERFALL PROTOCOL:\n"
            "   - Tier 1: Search current lecture using 'search_transcript' and cite [MM:SS].\n"
            "   - Tier 2: If absent, call 'search_course_lectures' to check other course lectures. If found, cite that lecture.\n"
            "   - Citation Formatting: Always cite lectures with clear natural titles and timestamps (e.g., in **[Lecture Title]** at **[MM:SS]**). NEVER leak internal tool names or raw bracketed function tokens like '【search_course_lectures】' in your output.\n"
            "   - If absent from the course entirely, provide the grounded academic definition with: '⚠️ **Course Boundary Notice**: This topic is not covered in your course lectures. Grounded in standard academic foundations:'."
        )

        system_prompt = (
            f"You are an Academic AI Tutor for lecture: '{lecture_title}'.\n"
            "You are helpful, precise, non-hallucinatory, and academically rigorous.\n"
            "Always format mathematical and scientific formulas using standard LaTeX notation: "
            "use single dollar signs for inline formulas like $E=mc^2$ or $\\sigma(z)$, and double dollar signs for standalone block equations like $$\\text{MSE} = \\frac{1}{n} \\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2$$. "
            "Always use `_` for subscripts (for example, $\\hat{\\beta}_{1}$), never `*`; wrap every equation in the appropriate dollar-sign delimiters and do not put display equations inside square brackets. "
            "When using math expressions inside markdown tables, never use raw unescaped pipe `|` characters (e.g. use `\\mid` or `\\vert` in set-builder notation like `\\{ x \\mid P(x) \\}`).\n"
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
                if enforce_regenerate:
                    try:
                        print("🧭 [Regenerate Enforcement] Forcing Level 2 (course-wide) check: search_course_lectures")
                        lvl2_has_hits = False
                        lvl2_res, lvl2_cit, _lvl2_web = self.execute_tool(
                            "search_course_lectures",
                            {"query": query, "top_k": max(5, min(12, top_k * 2))},
                            target_video_id,
                            lecture_title
                        )
                        if lvl2_cit:
                            lvl2_has_hits = True
                            all_citations.extend(lvl2_cit)
                            messages.insert(1, {
                                "role": "system",
                                "content": (
                                    "Level 2 course-wide search results (JSON). "
                                    "If the concept is not present in this lecture, you MUST use these results, "
                                    "state that it was not covered in this lecture, and cite the other lecture with [MM:SS]:\n"
                                    f"{lvl2_res}"
                                )
                            })
                        if (not lvl2_has_hits) and enable_web_search:
                            print("🧭 [Regenerate Enforcement] Level 2 had no hits. Triggering Level 3 (web) check: search_web_context")
                            lvl3_res, _lvl3_cit, lvl3_web = self.execute_tool(
                                "search_web_context",
                                {"search_query": query},
                                target_video_id,
                                lecture_title
                            )
                            if lvl3_web:
                                all_web_sources.extend(lvl3_web)
                                messages.insert(1, {
                                    "role": "system",
                                    "content": (
                                        "Level 3 web context results (JSON). "
                                        "If the topic is not covered in this lecture or course, you MUST begin with the Course Boundary Notice "
                                        "and cite URLs from these sources:\n"
                                        f"{lvl3_res}"
                                    )
                                })
                    except Exception as e_lvl2:
                        print(f"⚠️ [Regenerate Enforcement Notice] Level 2 search failed: {e_lvl2}")
                        if enable_web_search:
                            try:
                                print("🧭 [Regenerate Enforcement] Level 2 failed. Triggering Level 3 (web) check: search_web_context")
                                lvl3_res, _lvl3_cit, lvl3_web = self.execute_tool(
                                    "search_web_context",
                                    {"search_query": query},
                                    target_video_id,
                                    lecture_title
                                )
                                if lvl3_web:
                                    all_web_sources.extend(lvl3_web)
                                    messages.insert(1, {
                                        "role": "system",
                                        "content": (
                                            "Level 3 web context results (JSON). "
                                            "If the topic is not covered in this lecture or course, you MUST begin with the Course Boundary Notice "
                                            "and cite URLs from these sources:\n"
                                            f"{lvl3_res}"
                                        )
                                    })
                            except Exception as e_lvl3:
                                print(f"⚠️ [Regenerate Enforcement Notice] Level 3 search failed: {e_lvl3}")

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
                    # Autonomous Waterfall Tier 3: If no citations or web sources retrieved yet, trigger web search directly
                    if enable_web_search and not all_web_sources and not all_citations:
                        try:
                            from backend.web_search import search_web_for_context
                            hits = search_web_for_context(query, max_results=3)
                            for h in hits:
                                all_web_sources.append(h)
                            if hits:
                                web_summary = "\n".join(f"- {h['title']} ({h['url']}): {h['snippet']}" for h in hits)
                                messages.append({
                                    "role": "system",
                                    "content": f"External Web References retrieved for academic query:\n{web_summary}\n\nGround your answer using these external sources and begin with: '⚠️ **Course Boundary Notice**: This topic is not covered in this lecture. Grounded in standard academic literature:'."
                                })
                        except Exception as e_ws:
                            print(f"⚠️ [Autonomous Web Fallback Notice]: {e_ws}")

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
                    final_answer = f"⚠️ **Course Boundary Notice**: The topic '{query}' is not covered in '{lecture_title}'. Please verify the concept or check other course lectures."

                filtered_citations = self._filter_and_deduplicate_citations(
                    citations=all_citations,
                    answer=final_answer,
                    target_video_id=target_video_id
                )

                # Deduplicate web sources by URL
                unique_web_sources = []
                seen_urls = set()
                for ws in all_web_sources:
                    url = ws.get("url", "").strip()
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        unique_web_sources.append(ws)

                return {
                    "answer": final_answer,
                    "citations": filtered_citations,
                    "web_sources": unique_web_sources,
                    "model": display_model,
                    "lecture_title": lecture_title,
                    "video_id": target_video_id
                }

            except Exception as pe:
                print(f"⚠️ [Agent Fallback] {display_model} failed ({pe}). Cascading...")
                last_error = pe
                continue

        raise RuntimeError(f"All unified LLM providers failed. Last error: {last_error}")

    def query_course_rag(
        self,
        query: str,
        course_name: str,
        user_email: Optional[str] = None,
        chat_history: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Course-Level RAG backed strictly by course knowledge.
        Coordinates multi-lecture transcript retrieval, course outline, materials, and citations.
        """
        import requests
        cname = (course_name or "").strip()
        if not cname:
            raise ValueError("course_name cannot be empty.")

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        candidates = []
        if groq_key:
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "llama-3.3-70b-versatile",
                "display": "Groq Llama 3.3 70B Versatile"
            })
            candidates.append({
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "auth_header": f"Bearer {groq_key}",
                "model_name": "llama-3.1-8b-instant",
                "display": "Groq Llama 3.1 8B Instant"
            })
        if gemini_key:
            candidates.append({
                "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                "auth_header": f"Bearer {gemini_key}",
                "model_name": "gemini-2.0-flash",
                "display": "Gemini 2.0 Flash (OpenAI API)"
            })
            candidates.append({
                "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                "auth_header": f"Bearer {gemini_key}",
                "model_name": "gemini-1.5-flash",
                "display": "Gemini 1.5 Flash (OpenAI API)"
            })

        if not candidates:
            raise RuntimeError("No active LLM keys (GROQ_API_KEY or GEMINI_API_KEY) found.")

        # Pre-fetch course transcript cues for query to prime model context
        pre_res, pre_cit = self.execute_course_tool(
            "search_course_transcripts",
            {"query": query, "top_k": 8},
            cname,
            user_email=user_email
        )

        system_prompt = (
            f"You are the Academic AI Tutor for the course: '{cname}'.\n"
            "Your mission is to help students synthesize knowledge across all lectures in the course, "
            "master core concepts, compare topics across lectures, and prepare thoroughly for academic exams.\n\n"
            "Strict Instructions:\n"
            "1. Ground your answers strictly and directly in the course lecture transcripts and materials. "
            "When referencing or explaining a concept from a lecture, cite the lecture title and timestamp: "
            "e.g. `[Lecture Title · MM:SS]` or in **[Lecture Title]** at `[MM:SS]`.\n"
            "2. Always format mathematical formulas and equations using standard LaTeX notation: "
            "single dollar signs for inline math ($...$) and double dollar signs ($$...$$) for standalone block equations. "
            "Always use `_` for subscripts (for example, $\\hat{\\beta}_{1}$), never `*`; wrap every equation in the appropriate dollar-sign delimiters and do not put display equations inside square brackets. "
            "When using math expressions inside markdown tables, never use raw unescaped pipe `|` characters (e.g. use `\\mid` or `\\vert` in set-builder notation like `\\{ x \\mid P(x) \\}`).\n"
            "3. If a student asks to compare topics, synthesize the similarities and differences across the lectures.\n"
            "4. If a concept was NOT covered in any lecture or material in this course, explicitly state that it was not covered in the course syllabus or lecture recordings. Do not generate or substitute external unverified information.\n"
            "5. Maintain an encouraging, academically rigorous, clear, and structured tone (use markdown sections and bullet points).\n"
            "6. NEVER output raw bracketed function tokens like '【search_course_transcripts】' or JSON objects."
        )

        active_tools = self.COURSE_AGENT_TOOLS

        last_error = None
        for prov in candidates:
            endpoint = prov["endpoint"]
            auth_header = prov["auth_header"]
            model_name = prov["model_name"]
            display_model = prov["display"]

            messages = [{"role": "system", "content": system_prompt}]

            # Inject pre-fetched course context
            if pre_res and pre_res != "[]":
                messages.append({
                    "role": "system",
                    "content": f"Relevant course lecture excerpts retrieved for this query:\n{pre_res}"
                })

            # Append recent chat history if available
            if chat_history:
                for h in chat_history[-6:]:
                    r = "assistant" if h.get("sender") == "bot" else "user"
                    txt = h.get("text", "")
                    if txt:
                        messages.append({"role": r, "content": txt})

            messages.append({"role": "user", "content": query})

            all_citations = list(pre_cit)
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
                        "max_tokens": 1500,
                        "temperature": 0.3
                    }

                    resp = None
                    for attempt in range(3):
                        resp = requests.post(endpoint, headers=headers, json=payload, timeout=45)
                        if resp.status_code in (429, 503):
                            time.sleep((attempt + 1) * 2.0)
                            continue
                        break

                    if resp is None or resp.status_code != 200:
                        status_val = resp.status_code if resp is not None else "N/A"
                        body_val = resp.text[:300] if resp is not None else "No response"
                        raise RuntimeError(f"Course Agent API failed ({status_val}): {body_val}")

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
                        tool_res, tool_cit = self.execute_course_tool(func_name, args, cname, user_email=user_email)
                        all_citations.extend(tool_cit)
                        messages.append({"role": "tool", "tool_call_id": tc["id"], "name": func_name, "content": tool_res})

                if not final_answer:
                    messages.append({
                        "role": "user",
                        "content": "Please synthesize a final, clear academic answer grounded in the course material."
                    })
                    payload = {
                        "model": model_name,
                        "messages": messages,
                        "max_tokens": 1500,
                        "temperature": 0.3
                    }
                    resp = requests.post(endpoint, headers=headers, json=payload, timeout=45)
                    if resp.status_code == 200:
                        data = resp.json()
                        final_answer = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

                # Deduplicate citations
                seen_cites = set()
                deduped_citations = []
                for c in all_citations:
                    k = (c.get("video_id"), c.get("timestamp"))
                    if k not in seen_cites:
                        seen_cites.add(k)
                        deduped_citations.append(c)

                return {
                    "reply": final_answer,
                    "citations": deduped_citations[:10],
                    "model": display_model,
                    "course_name": cname
                }

            except Exception as pe:
                print(f"⚠️ [Course Tutor Agent Notice] {display_model} failed ({pe}). Cascading...")
                last_error = pe
                continue

        raise RuntimeError(f"All LLM providers failed for Course Tutor. Last error: {last_error}")

    def _clean_for_submission(
        self,
        text: str,
        target_words: int = 100,
        preserve_paragraphs: bool = True,
        allow_bold: bool = False
    ) -> str:
        """Strip markdown syntax, timestamps, and AI boilerplate while preserving paragraphs."""
        cleaned = text.strip()
        cleaned = re.sub(r"```[\s\S]*?```", "", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"#{1,6}\s*", "", cleaned)
        if not allow_bold:
            cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
            cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
        cleaned = re.sub(r"\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?\]", "", cleaned)
        cleaned = re.sub(r"(?i)^here\s+is\s+a\s+concise\s+academic\s+submission[^:.\n]*[:.\n]+\s*", "", cleaned)
        cleaned = re.sub(r"(?i)^based\s+on\s+the\s+professor('s)?\s+lecture\s+transcript[^:.\n]*[:.\n]+\s*", "", cleaned)
        cleaned = re.sub(r"(?i)here('s|\s+is)\s+what\s+i\s+found\s+regarding\s+[^:.\n]*[:.\n]*\s*", "", cleaned)
        cleaned = re.sub(r"(?i)here('s|\s+is)\s+what\s+i\s+found[^:.\n]*[:.\n]*\s*", "", cleaned)
        if preserve_paragraphs:
            lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.splitlines()]
            cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        else:
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def generate_submission_version(
        self,
        original_text: str,
        video_id: Optional[str] = "",
        word_count: int = 100,
        query: Optional[str] = None
    ) -> Dict[str, Any]:
        """Synthesize plain-text MTech student submission version with query-adaptive word counts."""
        if not original_text or not original_text.strip():
            raise ValueError("original_text cannot be empty.")
        if re.search(r"<\s*function\s*=", original_text):
            raise ValueError("Input contains raw unexecuted function call tags.")

        query_lower = (query or "").lower().strip()
        is_comprehensive = any(k in query_lower for k in ["comprehensive", "full summary", "detailed summary", "full comprehensive"])
        is_concepts = any(k in query_lower for k in ["concept", "definition", "key concepts", "definitions", "terminology"])
        is_30min = "30 min" in query_lower

        if is_comprehensive:
            target_words = max(word_count, 600)
            system_prompt = (
                "You are an Indian M.Tech graduate student drafting an in-depth academic assignment submission report. "
                "Write an exhaustive, thorough, and academically rigorous multi-paragraph submission report covering "
                "all core topics, methodologies, mathematical models, algorithms, and technical insights from the lecture. "
                "Do NOT restrict yourself to a short word limit or artificially condense the material; provide complete, "
                "in-depth coverage across multiple well-developed paragraphs separated by blank lines. "
                "STRICT NON-HALLUCINATION: Strictly ground your report in the lecture material provided. "
                "Do not include conversational filler, timestamps, or raw citations. Format all mathematical notation cleanly with standard LaTeX ($...$)."
            )
            user_content = f"Synthesize this lecture insight into an exhaustive, multi-paragraph academic submission report without word count restrictions:\n\n{original_text[:35000]}"
            max_tokens_val = 2500
        elif is_concepts:
            target_words = max(word_count, 250)
            min_w, max_w = 200, 350
            system_prompt = (
                f"You are an Indian M.Tech graduate student drafting an academic assignment submission glossary. "
                f"Write a structured compilation of the key technical concepts and definitions from the lecture of approximately {target_words} words "
                f"(between {min_w} and {max_w} words). "
                "Format each definition clearly with the concept term followed by its definition on separate lines. "
                "Do not include conversational filler, timestamps, or raw citations."
            )
            user_content = f"Synthesize these lecture definitions into a structured academic key concepts submission: {original_text[:8000]}"
            max_tokens_val = 650
        elif is_30min:
            target_words = max(word_count, 200)
            min_w, max_w = 160, 260
            system_prompt = (
                f"You are an Indian M.Tech graduate student drafting an academic assignment submission. "
                f"Write a detailed academic summary paragraph of approximately {target_words} words "
                f"(between {min_w} and {max_w} words) thoroughly explaining the core academic takeaways from the provided text. "
                "Do not include markdown headers, bullet points, citations, or timestamps. Output clean academic prose."
            )
            clean_base = self._clean_for_submission(original_text, target_words=target_words * 2)
            user_content = f"Synthesize this lecture insight into an academic submission paragraph: {clean_base}"
            max_tokens_val = 500
        else:
            target_words = word_count or 120
            min_w, max_w = 80, 150
            system_prompt = (
                f"You are an Indian M.Tech graduate student drafting an academic submission. "
                f"Write a comprehensive, professional submission paragraph of approximately {target_words} words "
                f"(strictly between {min_w} and {max_w} words) thoroughly explaining the core academic takeaways from the provided text. "
                "Do not include markdown headers, bullet points, citations, or timestamps. Output plain text only."
            )
            clean_base = self._clean_for_submission(original_text, target_words=target_words * 2)
            user_content = f"Synthesize this lecture insight into a full graduate submission paragraph: {clean_base}"
            max_tokens_val = 350

        clean_base = self._clean_for_submission(original_text, target_words=target_words * 2)

        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")

        if not (groq_key or gemini_key):
            raise RuntimeError("No LLM keys configured for submission generation.")

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
                    "max_tokens": max_tokens_val
                }
                r = requests.post(url, headers=headers, json=payload, timeout=20)
                if r.status_code == 200:
                    raw_output = r.json()["choices"][0]["message"]["content"].strip()
                    final_sub = self._clean_for_submission(raw_output) if is_comprehensive else self._clean_for_submission(raw_output, target_words=target_words + 25)
                    words = final_sub.split()
                    
                    # Ensure minimum academic paragraph length if source point was brief
                    if len(words) < 40 and len(clean_base.split()) >= len(words):
                        final_sub = f"{final_sub}\n\nThe lecture emphasized these principles as key analytical foundations for system design and theoretical evaluation."

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
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": max_tokens_val}
                }
                r = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=20)
                if r.status_code == 200:
                    raw_output = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                    final_sub = self._clean_for_submission(raw_output) if is_comprehensive else self._clean_for_submission(raw_output, target_words=target_words + 25)
                    return {
                        "status": "success",
                        "submission_text": final_sub,
                        "word_count": len(final_sub.split()),
                        "model": "Gemini 3.8 Flash"
                    }
            except Exception:
                pass

        # Intelligent local fallback: preserve sentence boundaries up to target_words
        words = clean_base.split()
        if is_comprehensive or len(words) <= target_words:
            final_sub = clean_base
        else:
            truncated = " ".join(words[:target_words])
            last_p = max(truncated.rfind('.'), truncated.rfind('!'), truncated.rfind('?'))
            if last_p > int(len(truncated) * 0.7):
                final_sub = truncated[:last_p + 1]
            else:
                final_sub = truncated + "."

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
        user_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """SUMMARY-branch completion: Uncut, chronological context processed by Groq or Gemini."""
        import requests

        target_video_id = str(video_id).strip() if video_id else ""
        title = lecture_title or "Active Lecture"
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")

        system_prompt = (
            f"You are an Expert Academic AI Tutor creating an exhaustive, in-depth study guide for the lecture: '{title}'.\n\n"
            "MISSION & EXHAUSTIVE DEPTH:\n"
            "- Do NOT artificially shorten, compress, or constrain your summary by word limits. Provide a full, exhaustive, in-depth academic breakdown that thoroughly covers the entire lecture from beginning to end.\n"
            "- Unpack the chronological progression of the lecture into comprehensive Markdown chapters using `##` headers with clear timestamps (e.g. `## 1. Introduction & Foundational Concepts [00:00 - 18:24]`).\n"
            "- Under each chapter, provide comprehensive narrative explanations, core definitions, mathematical formulations, algorithmic steps, concrete examples, and theoretical trade-offs introduced by the instructor.\n\n"
            "STRICT NON-HALLUCINATION & FACTUAL ACCURACY PROTOCOL:\n"
            "- Strictly ground all explanations, definitions, mathematical models, and examples in the provided lecture transcript.\n"
            "- NEVER invent or hallucinate topics, formulas, external theorems, or statements that the professor did not discuss in this lecture.\n"
            "- Ground every major statement, claim, and concept with its exact inline `[MM:SS]` timestamp from the transcript.\n\n"
            "MATHEMATICAL & SCIENTIFIC NOTATION:\n"
            "- Format all mathematical notation, variables, and formulas using standard LaTeX: single dollar signs for inline math (e.g., `$d_{i,j}$`, `$\\mathbb{R}^2$`) and double dollar signs for block equations (`$$...$$`).\n"
            "- Use `_` for subscripts (e.g., `$x_{1}$`), never `*`.\n"
            "- When writing equations in markdown tables, do not use raw unescaped pipe `|` symbols (use `\\mid` or `\\vert`).\n\n"
            "STRUCTURE & RIGOR:\n"
            "- For every technical topic covered, explain the 'why', the 'how', the formal definition, and the concrete example or counter-example used in class.\n"
            "- Include bulleted key takeaways, comparison tables where appropriate, and synthesis sections."
        )
        user_prompt = (
            f"Generate a full, exhaustive academic summary and study guide for this lecture based on the complete transcript.\n"
            f"Do not restrict by word count; cover every topic, example, and derivation thoroughly and accurately without hallucination.\n\n"
            f"Lecture Title: {title}\n\n"
            f"Transcript Content:\n{transcript_str}"
        )

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
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8192}
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
        # 3. Fallback: Synthesize from saved summary sections for this specific video
        if target_video_id and target_video_id != "active":
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(target_video_id)
                sections = (saved.get("summarySections") or saved.get("summary_sections")) if saved else None
                if sections and isinstance(sections, list) and len(sections) > 0:
                    md_lines = [f"# Summary: {title}\n"]
                    for sec in sections:
                        sec_title = sec.get("title", "Key Concept")
                        md_lines.append(f"## {sec_title}")
                        for pt in sec.get("points", []):
                            md_lines.append(f"- {pt}")
                        md_lines.append("")
                    ans = "\n".join(md_lines).strip()
                    return self._build_summary_response(ans, "Extracted Lecture Summary", title, target_video_id)
            except Exception as fe:
                print(f"⚠️ [Summary Fallback Notice] {fe}")

        raise RuntimeError("All LLM providers failed to generate summary.")

    @staticmethod
    def _parse_time_to_seconds(time_str: str) -> float:
        """Parse HH:MM:SS or MM:SS to seconds."""
        if not time_str:
            return 0.0
        parts = str(time_str).strip().split(":")
        try:
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            elif len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            return float(parts[0])
        except (ValueError, TypeError):
            return 0.0

    @classmethod
    def _is_conversational_filler(cls, text: str, time_str: str = "") -> bool:
        """Detect greeting, roll-call, audio-check, or conversational filler cues."""
        if not text:
            return True
        t = text.strip()
        if len(t) < 15:
            return True

        # First 2.5 minutes (0 to 150 seconds): strict greeting / session setup filter
        sec = cls._parse_time_to_seconds(time_str)
        if 0.0 <= sec <= 150.0:
            early_pattern = re.compile(
                r'(namaste|good morning|good afternoon|good evening|hello|hi\b|welcome|'
                r'can you hear me|am i audible|audio check|mic check|screen visible|'
                r'live session|session \d+|attendance|let us start|let me share)',
                re.IGNORECASE
            )
            if early_pattern.search(t):
                academic_keywords = re.compile(
                    r'\b(matrix|vector|subspace|eigen|derivative|integral|theorem|proof|algorithm|loss|gradient|distribution|probability)\b',
                    re.IGNORECASE
                )
                if not academic_keywords.search(t):
                    return True

        filler_pattern = re.compile(
            r'^(namaste|good morning|good afternoon|good evening|hello|hi\b|welcome|'
            r'can you hear me|am i audible|are you there|are people there|is my screen|'
            r'audio check|mic check|attendance|roll call|yes sir|no sir|okay sir|thank you|'
            r'bye bye|goodbye|see you|let us start|let me share|give me a second|give me a minute)',
            re.IGNORECASE
        )
        if filler_pattern.search(t):
            academic_keywords = re.compile(
                r'\b(matrix|vector|subspace|eigen|derivative|integral|theorem|proof|algorithm|loss|gradient|distribution|probability|dimension|rank|null space)\b',
                re.IGNORECASE
            )
            if not academic_keywords.search(t):
                return True

        return False

    @classmethod
    def _filter_substantive_cues(cls, cues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter out introductory chit-chat, greetings, and short non-academic cues."""
        substantive = []
        for c in (cues or []):
            txt = str(c.get("text") or "").strip()
            ts = str(c.get("time") or "00:00")
            if not cls._is_conversational_filler(txt, ts):
                substantive.append(c)
        if len(substantive) >= 2:
            return substantive
        non_empty = [c for c in (cues or []) if str(c.get("text") or "").strip()]
        return non_empty if non_empty else cues

    @classmethod
    def _sanitize_quiz_question_text(cls, text: str) -> str:
        """
        Sanitize quiz questions to be concept-first and self-contained,
        stripping episodic timestamp preambles, lecture title references, and fixing math formatting.
        """
        if not text:
            return ""
        cleaned = str(text).strip()
        patterns = [
            # In 'Lecture Title' (date) at MM:SS, ...
            r"^In\s+['\"‘“][^'\"’”]+['\"’”]\s*(?:\([^)]*\)\s*)?(?:at\s+\d{1,2}:\d{2}(?::\d{2})?,?\s*)?(?:,\s*)?",
            # In session 5 at MM:SS, ...
            r"^In\s+(?:the\s+)?(?:session|live\s+session|lecture|class|module)\s*[-–—0-9]*\s*(?:\([^)]*\)\s*)?(?:at\s+\d{1,2}:\d{2}(?::\d{2})?,?\s*)?(?:,\s*)?",
            # When the lecturer mentions...
            r"^(?:When|As)\s+(?:the\s+)?(?:lecturer|instructor|professor|speaker)\s+(?:mentions?|discusses?|introduces?|explains?|states?)\s+[^,]+,\s*(?:at\s+\d{1,2}:\d{2}(?::\d{2})?,?\s*)?",
            r"^In\s+(?:the\s+)?[^,]+(?:described|discussed|introduced|mentioned|taught)\s+at\s+\d{1,2}:\d{2}(?::\d{2})?,?\s*",
            r"^(?:At|Around)\s+\d{1,2}:\d{2}(?::\d{2})?,?\s*(?:when\s+[^,]+,\s*)?",
            r"^(?:According\s+to\s+(?:the\s+)?(?:lecture|professor|instructor|timestamp)\s*(?:at\s+\d{1,2}:\d{2}(?::\d{2})?|[0-9]+)?,?\s*)",
        ]
        for pat in patterns:
            cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE).strip()

        # Remove explicit "at MM:SS" or "[MM:SS]" leftover phrases from question stem
        cleaned = re.sub(r"\s*(?:\(|\[)?\bat\s+\d{1,2}:\d{2}(?::\d{2})?\b(?:\)|\])?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"\[\d{1,2}:\d{2}(?::\d{2})?\]", "", cleaned).strip()

        # Clean duplicated unformatted variable artifacts (e.g., "xx" -> "$x$", "yy" -> "$y$")
        cleaned = re.sub(r"\b([a-zA-Z])\1\b", r"$\1$", cleaned)

        if cleaned:
            cleaned = cleaned[0].upper() + cleaned[1:]
        return cleaned or str(text).strip()

    @classmethod
    def _is_trivial_or_greeting_question(cls, q: Dict[str, Any]) -> bool:
        """
        Detect and discard questions that test greetings, pleasantries, mic checks,
        or other non-academic filler.
        """
        if not isinstance(q, dict):
            return True
        q_text = str(q.get("question") or "").lower()
        explanation = str(q.get("explanation") or "").lower()
        options = [str(opt).lower() for opt in (q.get("options") or [])]
        all_text = " ".join([q_text, explanation] + options)

        banned_phrases = [
            "namaste",
            "introductory greeting",
            "greeting with no mathematical",
            "greeting with no",
            "pleasantry",
            "audio check",
            "mic check",
            "am i audible",
            "can you hear me",
            "screen sharing",
            "attendance check",
            "roll call",
            "welcome the class",
            "welcome the students",
            "opening greeting",
        ]
        for phrase in banned_phrases:
            if phrase in all_text:
                return True

        stem_banned = [
            r'\bat\s+00:00\b',
            r'\bat\s+0:00\b',
            r'\bfirst\s+words?\b',
            r'\bopening\s+statement\b',
            r'\bhow\s+does\s+the\s+lecture\s+begin\b',
            r'\bwhat\s+greeting\b',
        ]
        for sb in stem_banned:
            if re.search(sb, q_text):
                return True

        return False

    @classmethod
    def _balance_and_shuffle_options(cls, options: List[str], correct_idx: int) -> Tuple[List[str], int]:
        """
        Programmatically shuffle options and recalculate correct_index to permanently
        eliminate position bias (e.g. Option A dominance) while preserving validity.
        """
        if not options or len(options) != 4:
            return options, correct_idx
        try:
            c_idx = int(correct_idx)
            if not (0 <= c_idx < len(options)):
                c_idx = 0
        except (ValueError, TypeError):
            c_idx = 0

        correct_opt = str(options[c_idx]).strip()
        shuffled = [str(opt).strip() for opt in options]
        random.shuffle(shuffled)
        try:
            new_c_idx = shuffled.index(correct_opt)
        except ValueError:
            new_c_idx = 0
        return shuffled, new_c_idx

    def generate_lecture_quiz(
        self,
        video_id: str,
        lecture_title: str,
        cues: List[Dict[str, str]],
        num_questions: int = 5
    ) -> Dict[str, Any]:
        """Generate structured interactive quiz questions from lecture transcript with LaTeX formulas."""
        import requests

        clean_vid = str(video_id or "").strip()
        title = lecture_title or "Active Lecture"
        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        target_count = max(3, min(15, int(num_questions or 5)))

        valid_cues = [c for c in (cues or []) if (c.get("text") or "").strip()]
        if not valid_cues:
            valid_cues = [{"time": "00:00", "text": f"Lecture overview and introduction for {title}."}]

        substantive_cues = self._filter_substantive_cues(valid_cues)
        total_sub = len(substantive_cues)
        if total_sub > 150:
            step = max(1, total_sub // 100)
            sampled_cues = substantive_cues[::step]
        else:
            sampled_cues = substantive_cues

        transcript_lines = [f"[{c.get('time', '00:00')}] {c.get('text', '').strip()}" for c in sampled_cues]
        transcript_sample = "\n".join(transcript_lines)[:32000]

        system_prompt = (
            "You are an expert university professor and exam creator.\n"
            f"Your task is to generate a challenging, educational {target_count}-question multiple-choice quiz testing core concepts from this lecture transcript.\n\n"
            "Strict Guidelines:\n"
            f"1. Generate exactly {target_count} multiple-choice questions covering different chronological segments of the lecture.\n"
            "2. Concept-First Framing: Each question must directly test an underlying concept, theorem, definition, mechanism, proof, or practical trade-off. "
            "STRICTLY FORBIDDEN: NEVER use episodic phrasing or mention timestamps or lecture titles in the question stem (e.g. 'When the lecturer mentions...', 'At 41:32...', 'In Lecture 5...', 'According to the lecture...'). "
            "The question must be completely self-contained and conceptual.\n"
            "3. STRICTLY PROHIBITED TOPICS: NEVER test introductory greetings, welcome remarks, speaker introductions, pleasantries, attendance, audio/mic checks, screen sharing checks, or administrative remarks (e.g. 'Namaste', 'Good morning', 'Can you hear me', 'Welcome to the session'). NEVER create questions where an option is a greeting or 'An introductory greeting with no mathematical bearing'. Only test substantive academic theory, equations, algorithms, and practical applications.\n"
            "4. Timestamp as Validation: The 'timestamp' field serves strictly for factual citation/verification so students can review the lecture. Timestamps must NEVER appear inside the 'question' text itself.\n"
            "5. Formulas & Clean Math: Format all math expressions, variables, and equations with standard LaTeX ($...$ for inline or $$...$$ for display) (e.g. $E=mc^2$, $\\alpha\\mathbf{u} + \\beta\\mathbf{v}$, $x$, $y$). NEVER duplicate variable characters (do NOT write 'xx' or 'yy').\n"
            "6. Balanced Answer Distribution: Distribute correct answers evenly across all four options (A, B, C, D) — do NOT bias towards option A.\n"
            "7. Question format:\n"
            "   - 'id': integer (1, 2, 3...)\n"
            "   - 'question': clear, conceptually self-contained question text with LaTeX math where applicable\n"
            "   - 'options': array of exactly 4 strings (A, B, C, D)\n"
            "   - 'correct_index': integer (0, 1, 2, or 3) indicating the single correct option\n"
            "   - 'explanation': thorough pedagogical explanation of why this answer is correct, citing the exact timestamp (e.g. [43:34]) and including LaTeX math where applicable\n"
            "   - 'timestamp': timestamp string (e.g. '43:34' or '01:02:13') from the transcript corresponding to this topic\n"
            "   - 'difficulty': 'easy', 'medium', or 'hard'\n"
            "8. Return ONLY a single valid JSON object matching this schema:\n"
            "{\n"
            '  "questions": [\n'
            '    {\n'
            '      "id": 1,\n'
            '      "question": "Which mathematical property distinguishes...",\n'
            '      "options": ["Option A", "Option B", "Option C", "Option D"],\n'
            '      "correct_index": 1,\n'
            '      "explanation": "...",\n'
            '      "timestamp": "MM:SS",\n'
            '      "difficulty": "medium"\n'
            '    }\n'
            '  ]\n'
            "}"
        )
        user_prompt = f"Lecture Title: {title}\n\nTranscript Excerpt:\n{transcript_sample}"

        def _clean_and_parse_json(raw_text: str) -> Optional[List[Dict[str, Any]]]:
            if not raw_text:
                return None
            t = raw_text.strip()
            if t.startswith("```"):
                lines = t.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                t = "\n".join(lines).strip()
            try:
                data = json.loads(t)
            except Exception:
                match = re.search(r"\{.*\}", t, re.DOTALL)
                if match:
                    try:
                        data = json.loads(match.group(0))
                    except Exception:
                        return None
                else:
                    return None

            raw_qs = data.get("questions") if isinstance(data, dict) else (data if isinstance(data, list) else None)
            if not isinstance(raw_qs, list) or len(raw_qs) == 0:
                return None

            cleaned_qs = []
            for q in raw_qs:
                if not isinstance(q, dict):
                    continue
                if self._is_trivial_or_greeting_question(q):
                    continue
                q_text = self._sanitize_quiz_question_text(str(q.get("question") or ""))
                if not q_text or len(q_text) < 8:
                    continue
                opts = [str(opt).strip() for opt in (q.get("options") or [])]
                if len(opts) != 4 or any(len(opt) == 0 for opt in opts):
                    continue
                raw_correct_idx = q.get("correct_index", 0)
                shuffled_opts, balanced_idx = self._balance_and_shuffle_options(opts, raw_correct_idx)

                ts = str(q.get("timestamp") or "00:00").strip().replace("[", "").replace("]", "")
                explanation = str(q.get("explanation") or f"Discussed at [{ts}].").strip()
                diff = str(q.get("difficulty") or "medium").lower().strip()
                if diff not in ("easy", "medium", "hard"):
                    diff = "medium"

                cleaned_qs.append({
                    "id": len(cleaned_qs) + 1,
                    "question": q_text,
                    "options": shuffled_opts,
                    "correct_index": balanced_idx,
                    "explanation": explanation,
                    "timestamp": ts,
                    "difficulty": diff
                })

            return cleaned_qs[:target_count] if len(cleaned_qs) > 0 else None

        # 1. Groq
        if groq_key:
            for model_name in ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]:
                try:
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.3,
                        "max_tokens": 4096
                    }
                    r = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                        json=payload,
                        timeout=90
                    )
                    if r.status_code == 200:
                        content = r.json()["choices"][0]["message"]["content"]
                        parsed = _clean_and_parse_json(content)
                        if parsed:
                            return {
                                "video_id": clean_vid,
                                "lecture_title": title,
                                "questions": parsed,
                                "total_questions": len(parsed),
                                "model": f"Groq {model_name}",
                                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                            }
                except Exception as e:
                    print(f"⚠️ [Groq Quiz Warning] {e}")

        # 2. Gemini
        if gemini_key:
            for model_name in ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-3.8-flash"]:
                try:
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json", "maxOutputTokens": 4096}
                    }
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=90)
                    if resp.status_code == 200:
                        content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = _clean_and_parse_json(content)
                        if parsed:
                            return {
                                "video_id": clean_vid,
                                "lecture_title": title,
                                "questions": parsed,
                                "total_questions": len(parsed),
                                "model": f"Gemini {model_name}",
                                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                            }
                except Exception as e:
                    print(f"⚠️ [Gemini Quiz Warning] {e}")

        raise RuntimeError(
            f"Unable to generate quiz for lecture '{title}'. All configured AI models failed or returned invalid responses."
        )

    def generate_course_quiz(
        self,
        course_name: str,
        lectures_data: List[Dict[str, Any]],
        num_questions: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Generate comprehensive, multi-lecture practice quiz testing concepts
        across all lectures in the course with LaTeX formulas and lecture attribution.
        """
        import requests

        clean_course = str(course_name or "Course").strip()
        course_slug = re.sub(r'[^a-z0-9]+', '-', clean_course.lower()).strip('-') or "general"
        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")

        valid_lectures = []
        for l in (lectures_data or []):
            vid = str(l.get("video_id") or l.get("videoId") or "").strip()
            ltitle = str(l.get("title") or l.get("video_title") or f"Lecture {vid}").strip()
            cues = [c for c in (l.get("cues") or []) if (c.get("text") or "").strip()]
            if not cues:
                cues = [{"time": "00:00", "text": f"Overview of {ltitle}."}]
            valid_lectures.append({
                "video_id": vid,
                "title": ltitle,
                "cues": cues
            })

        if not valid_lectures:
            valid_lectures = [{
                "video_id": "overview",
                "title": f"{clean_course} Overview",
                "cues": [{"time": "00:00", "text": f"Foundations of {clean_course}."}]
            }]

        num_lectures = len(valid_lectures)
        if num_questions is not None and int(num_questions) > 0:
            target_count = max(3, min(25, int(num_questions)))
        else:
            # Dynamically scale: 1 lecture -> 6, 2 -> 8, 3 -> 10, 4 -> 12, etc., up to 20 max
            target_count = max(5, min(20, max(6, num_lectures * 3)))

        # Build chronological multi-lecture transcript sample using substantive cues
        lecture_summaries = []
        for l_idx, lect in enumerate(valid_lectures):
            raw_cues = lect["cues"]
            substantive_cues = self._filter_substantive_cues(raw_cues)
            step = max(1, len(substantive_cues) // 25)
            sampled = substantive_cues[::step][:25]
            cue_lines = [f"  [{c.get('time', '00:00')}] {c.get('text', '').strip()}" for c in sampled]
            lecture_summaries.append(
                f"=== LECTURE {l_idx + 1}: {lect['title']} (Video ID: {lect['video_id']}) ===\n" + "\n".join(cue_lines)
            )

        transcript_sample = "\n\n".join(lecture_summaries)[:32000]

        system_prompt = (
            "You are an expert university professor and comprehensive exam creator.\n"
            f"Your task is to generate a challenging, educational {target_count}-question multiple-choice course exam testing core concepts across ALL {num_lectures} lectures in the course '{clean_course}'.\n\n"
            "Strict Guidelines:\n"
            f"1. Coverage & Balance: The questions MUST be distributed across all the lectures in this course so far. Ensure every lecture is represented.\n"
            "2. Concept-First Framing: Each question must directly test an underlying concept, theorem, definition, mechanism, proof, or practical trade-off. "
            "STRICTLY FORBIDDEN: NEVER use episodic phrasing, mention timestamps, or reference lecture titles/numbers in the question stem (e.g. 'In Lecture 2...', 'When the lecturer mentions...', 'At 41:32...', 'In session 5...', 'According to the lecture...'). "
            "The question must be completely self-contained and conceptual.\n"
            "3. STRICTLY PROHIBITED TOPICS: NEVER test introductory greetings, welcome remarks, pleasantries, attendance, audio/mic checks, screen sharing checks, or administrative chatter (e.g. 'Namaste', 'Good morning', 'Can you hear me', 'Welcome'). NEVER create questions where an option is a greeting or 'An introductory greeting with no mathematical bearing'. Only test substantive academic theory, equations, algorithms, and practical applications.\n"
            "4. Timestamp as Validation: The 'timestamp', 'lecture_id', and 'lecture_title' fields serve strictly for factual citation/verification so students can review the exact lecture moment. Timestamps and lecture titles must NEVER appear inside the 'question' text itself.\n"
            "5. Formulas & Clean Math: Format all math expressions, variables, and equations with standard LaTeX ($...$ for inline or $$...$$ for display) (e.g. $E=mc^2$, $\\alpha\\mathbf{u} + \\beta\\mathbf{v}$, $x$, $y$). NEVER duplicate variable characters (do NOT write 'xx' or 'yy').\n"
            "6. Balanced Answer Distribution: Distribute correct answers evenly across all four options (A, B, C, D) — do NOT bias towards option A.\n"
            "7. Question format:\n"
            "   - 'id': integer (1, 2, 3...)\n"
            "   - 'question': clear, conceptually self-contained question text with LaTeX math where applicable\n"
            "   - 'options': array of exactly 4 strings (A, B, C, D)\n"
            "   - 'correct_index': integer (0, 1, 2, or 3) indicating the single correct option\n"
            "   - 'explanation': thorough pedagogical explanation citing the lecture title and timestamp, with LaTeX math\n"
            "   - 'lecture_id': exact video_id of the lecture this question tests\n"
            "   - 'lecture_title': title of the lecture this question tests\n"
            "   - 'timestamp': timestamp string (e.g. '43:34') from that lecture\n"
            "   - 'difficulty': 'easy', 'medium', or 'hard'\n"
            "8. Return ONLY a single valid JSON object matching this schema:\n"
            "{\n"
            '  "questions": [\n'
            '    {\n'
            '      "id": 1,\n'
            '      "question": "Which architectural property distinguishes...",\n'
            '      "options": ["Option A", "Option B", "Option C", "Option D"],\n'
            '      "correct_index": 2,\n'
            '      "explanation": "...",\n'
            '      "lecture_id": "...",\n'
            '      "lecture_title": "...",\n'
            '      "timestamp": "MM:SS",\n'
            '      "difficulty": "medium"\n'
            '    }\n'
            '  ]\n'
            "}"
        )
        user_prompt = f"Course: {clean_course}\nTotal Lectures: {num_lectures}\n\nMulti-Lecture Transcripts:\n{transcript_sample}"

        def _clean_and_parse_course_json(raw_text: str) -> Optional[List[Dict[str, Any]]]:
            if not raw_text:
                return None
            t = raw_text.strip()
            if t.startswith("```"):
                lines = t.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                t = "\n".join(lines).strip()
            try:
                data = json.loads(t)
            except Exception:
                match = re.search(r"\{.*\}", t, re.DOTALL)
                if match:
                    try:
                        data = json.loads(match.group(0))
                    except Exception:
                        return None
                else:
                    return None

            raw_qs = data.get("questions") if isinstance(data, dict) else (data if isinstance(data, list) else None)
            if not isinstance(raw_qs, list) or len(raw_qs) == 0:
                return None

            cleaned_qs = []
            for q in raw_qs:
                if not isinstance(q, dict):
                    continue
                if self._is_trivial_or_greeting_question(q):
                    continue
                q_text = self._sanitize_quiz_question_text(str(q.get("question") or ""))
                if not q_text or len(q_text) < 8:
                    continue
                opts = [str(opt).strip() for opt in (q.get("options") or [])]
                if len(opts) != 4 or any(len(opt) == 0 for opt in opts):
                    continue
                raw_correct_idx = q.get("correct_index", 0)
                shuffled_opts, balanced_idx = self._balance_and_shuffle_options(opts, raw_correct_idx)

                ts = str(q.get("timestamp") or "00:00").strip().replace("[", "").replace("]", "")
                lect_id = str(q.get("lecture_id") or "").strip()
                lect_title = str(q.get("lecture_title") or "").strip()

                if not lect_id or not lect_title:
                    fallback_lect = valid_lectures[len(cleaned_qs) % len(valid_lectures)]
                    lect_id = lect_id or fallback_lect["video_id"]
                    lect_title = lect_title or fallback_lect["title"]

                explanation = str(q.get("explanation") or f"Taught in '{lect_title}' at [{ts}].").strip()
                diff = str(q.get("difficulty") or "medium").lower().strip()
                if diff not in ("easy", "medium", "hard"):
                    diff = "medium"

                cleaned_qs.append({
                    "id": len(cleaned_qs) + 1,
                    "question": q_text,
                    "options": shuffled_opts,
                    "correct_index": balanced_idx,
                    "explanation": explanation,
                    "lecture_id": lect_id,
                    "lecture_title": lect_title,
                    "timestamp": ts,
                    "difficulty": diff
                })

            return cleaned_qs[:target_count] if len(cleaned_qs) > 0 else None

        # 1. Groq
        if groq_key:
            for model_name in ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]:
                try:
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.3,
                        "max_tokens": 4096
                    }
                    r = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                        json=payload,
                        timeout=90
                    )
                    if r.status_code == 200:
                        content = r.json()["choices"][0]["message"]["content"]
                        parsed = _clean_and_parse_course_json(content)
                        if parsed:
                            return {
                                "course_name": clean_course,
                                "course_slug": course_slug,
                                "lecture_count": num_lectures,
                                "questions": parsed,
                                "total_questions": len(parsed),
                                "model": f"Groq {model_name}",
                                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                            }
                except Exception as e:
                    print(f"⚠️ [Groq Course Quiz Warning] {e}")

        # 2. Gemini
        if gemini_key:
            for model_name in ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-3.8-flash"]:
                try:
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json", "maxOutputTokens": 4096}
                    }
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=90)
                    if resp.status_code == 200:
                        content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = _clean_and_parse_course_json(content)
                        if parsed:
                            return {
                                "course_name": clean_course,
                                "course_slug": course_slug,
                                "lecture_count": num_lectures,
                                "questions": parsed,
                                "total_questions": len(parsed),
                                "model": f"Gemini {model_name}",
                                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                            }
                except Exception as e:
                    print(f"⚠️ [Gemini Course Quiz Warning] {e}")

        raise RuntimeError(
            f"Unable to generate course quiz for '{clean_course}'. All configured AI models failed or returned invalid responses."
        )

    def generate_detailed_quiz_explanation(
        self,
        video_id: str,
        lecture_title: str,
        question: str,
        options: List[str],
        correct_index: int,
        explanation: str,
        timestamp: str,
        cues: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        Generate comprehensive detailed explanation for a quiz question using RAG.
        Combines lecture transcript context, course-wide search, and web search.
        """
        import requests

        clean_vid = str(video_id or "").strip()
        title = lecture_title or "Active Lecture"
        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")

        # Get lecture cues if not provided
        if not cues:
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(clean_vid)
                cues = saved.get("cues", []) if saved else []
            except Exception:
                cues = []

        # 1. Extract transcript context around the timestamp
        transcript_context = ""
        if cues and timestamp:
            try:
                ts_sec = self._parse_timestamp(timestamp)
                # Get context window: 2 minutes before to 2 minutes after
                window_start = max(0, ts_sec - 120)
                window_end = ts_sec + 120

                window_cues = []
                for c in cues:
                    cue_time = self._parse_timestamp(c.get("time", "00:00"))
                    if window_start <= cue_time <= window_end:
                        window_cues.append(f"[{c.get('time', '00:00')}] {c.get('text', '')}")

                if window_cues:
                    transcript_context = "\n".join(window_cues)
            except Exception as e:
                print(f"⚠️ [Explanation Context Warning] Could not extract transcript context: {e}")

        # 2. Search course lectures for related concepts
        course_context = ""
        try:
            # Extract key terms from the question
            key_terms = re.findall(r'\b[a-zA-Z]{3,}\b', question)
            if key_terms:
                search_query = " ".join(key_terms[:5])
                course_res, _ = self.execute_tool(
                    "search_course_lectures",
                    {"query": search_query, "top_k": 3},
                    clean_vid,
                    title
                )
                if course_res and course_res != "[]":
                    course_context = course_res
        except Exception as e:
            print(f"⚠️ [Course Context Warning] {e}")

        # 3. Search web for academic context
        web_context = ""
        try:
            search_query = f"{question} {options[correct_index] if correct_index < len(options) else ''}"
            web_res, _, web_sources = self.execute_tool(
                "search_web_context",
                {"search_query": search_query},
                clean_vid,
                title
            )
            if web_res and web_res != "[]":
                web_context = web_res
        except Exception as e:
            print(f"⚠️ [Web Context Warning] {e}")

        # Build the system prompt
        system_prompt = (
            f"You are an expert Academic AI Tutor for the lecture: '{title}'.\n"
            "Your task is to generate a comprehensive, detailed explanation for a quiz question that a student got wrong.\n\n"
            "Strict Guidelines:\n"
            "1. Structure: Organize your explanation into clear sections:\n"
            "   - **Question Analysis**: Briefly restate what the question is asking\n"
            "   - **Correct Answer**: Clearly state the correct option and why it's correct\n"
            "   - **Why Other Options Are Wrong**: Explain why each incorrect option is incorrect\n"
            "   - **Lecture Context**: Explain how this concept was taught in the lecture with specific references\n"
            "   - **Key Concepts**: Break down the underlying concepts, formulas, or principles\n"
            "   - **Related Topics**: Mention related concepts from other lectures if applicable\n"
            "2. Use the provided transcript context to ground your explanation in what the professor actually said\n"
            "3. Format all math expressions, variables, and equations with standard LaTeX ($...$ for inline or $$...$$ for display)\n"
            "4. If web sources are provided, cite them as [Source Name](URL)\n"
            "5. Be thorough but clear - explain step-by-step so a student can understand\n"
            "6. Include the exact timestamp from the lecture where this was discussed\n"
        )

        user_prompt = f"""Generate a detailed explanation for this quiz question:

**Question**: {question}

**Options**:
"""
        for i, opt in enumerate(options):
            marker = "✓ (CORRECT)" if i == correct_index else "✗"
            user_prompt += f"- {chr(65+i)}. {opt} {marker}\n"

        user_prompt += f"""
**Brief Explanation**: {explanation}

**Timestamp**: {timestamp}

**Transcript Context Around Timestamp**:
{transcript_context if transcript_context else "No transcript context available"}

**Related Course Lecture Context**:
{course_context if course_context else "No additional course context found"}

**Web Academic Sources**:
{web_context if web_context else "No web sources found"}

Please provide a comprehensive, detailed explanation that helps the student understand this concept deeply."""

        # Try Groq first
        if groq_key:
            for model_name in ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"]:
                try:
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": 0.4,
                        "max_tokens": 2048
                    }
                    r = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                        json=payload,
                        timeout=60
                    )
                    if r.status_code == 200:
                        detailed_explanation = r.json()["choices"][0]["message"]["content"].strip()
                        return {
                            "detailed_explanation": detailed_explanation,
                            "model": f"Groq {model_name}",
                            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        }
                except Exception as e:
                    print(f"⚠️ [Groq Explanation Warning] {e}")

        # Try Gemini as fallback
        if gemini_key:
            for model_name in ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.8-flash"]:
                try:
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2048}
                    }
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                    resp = requests.post(api_url, headers={"Content-Type": "application/json"}, json=payload, timeout=60)
                    if resp.status_code == 200:
                        detailed_explanation = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                        return {
                            "detailed_explanation": detailed_explanation,
                            "model": f"Gemini {model_name}",
                            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        }
                except Exception as e:
                    print(f"⚠️ [Gemini Explanation Warning] {e}")

        # Fallback: enhance the brief explanation
        enhanced_explanation = f"""**Detailed Explanation**

**Question Analysis**
{question}

**Correct Answer**
Option {chr(65 + correct_index)} is correct: {options[correct_index] if correct_index < len(options) else ''}

**Why This Is Correct**
{explanation}

**Lecture Context**
This concept was discussed at timestamp {timestamp} in the lecture "{title}".

**Note**: Enhanced explanation generated - full RAG context unavailable due to LLM errors. Please try regenerating later.
"""
        return {
            "detailed_explanation": enhanced_explanation,
            "model": "Fallback Enhanced",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

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
