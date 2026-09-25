"""
Pinecone + Llama-3.2-3B-Instruct RAG Engine for LectureScribe
--------------------------------------------------------------
Strictly loads model & database parameters from environment variables - NO HARDCODING.
Combines Pinecone Vector Database retrieval with grounded Llama-3.2 inference.
"""
from __future__ import annotations

import os
import re
import math
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
    load_dotenv(override=True)
except ImportError:
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
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

    def _is_summary_query(self, query: str) -> bool:
        """Detect if the student's question is requesting a whole-lecture summary, recap, or overview."""
        if not query:
            return False
        q = query.lower().strip()
        summary_patterns = [
            r"\bsummar(y|ies|ize|ise|izing|ising|ization|isation)\b",
            r"\boverview\b",
            r"\brecap\b",
            r"\breview\b",
            r"\b10\s*min(ute)?\s*(read|summary)?\b",
            r"\b5\s*min(ute)?\s*(read|summary)?\b",
            r"\bkey\s+takeaways?\b",
            r"\bmain\s+takeaways?\b",
            r"\bcore\s+takeaways?\b",
            r"\bwhat\s+did\s+the\s+professor\s+cover\b",
            r"\bwhat\s+was\s+covered\b",
            r"\bwhat\s+is\s+this\s+lecture\s+about\b",
            r"\bexplain\s+(?:the\s+)?(?:whole|entire)\s+lecture\b",
            r"\bwalkthrough\s+of\s+(?:the\s+)?lecture\b",
            r"\bexecutive\s+summary\b",
            r"\blecture\s+outline\b",
            r"\btopics\s+covered\b"
        ]
        return any(re.search(pat, q) for pat in summary_patterns)

    def _sample_chronological_cues(
        self,
        cues: List[Dict[str, str]],
        video_id: str,
        video_title: str,
        num_samples: int = 15,
        window_size: int = 3
    ) -> List[Dict[str, Any]]:
        """Sample evenly spaced chronological windows across the entire lecture cues."""
        if not cues:
            return []
        total = len(cues)
        if total <= num_samples:
            samples = []
            for c in cues:
                samples.append({
                    "video_id": video_id,
                    "video_title": video_title,
                    "start_time": c.get("time", "00:00"),
                    "end_time": c.get("time", "00:00"),
                    "text": c.get("text", "")
                })
            return samples

        step = max(1, total // num_samples)
        samples = []
        for i in range(0, total, step):
            window = cues[i : min(i + window_size, total)]
            if not window:
                continue
            start_t = window[0].get("time", "00:00")
            end_t = window[-1].get("time", start_t)
            w_text = " ".join([c.get("text", "") for c in window if c.get("text")])
            if w_text.strip():
                samples.append({
                    "video_id": video_id,
                    "video_title": video_title,
                    "start_time": start_t,
                    "end_time": end_t,
                    "text": w_text[:600]
                })
            if len(samples) >= num_samples:
                break
        return samples

    def _build_summary_sections_metadata(
        self,
        sections: List[Dict[str, Any]],
        video_id: str,
        video_title: str
    ) -> List[Dict[str, Any]]:
        """Convert stored executive summary sections into RAG metadata items."""
        meta_items = []
        for sec in sections:
            title = sec.get("title", "")
            ts_match = re.search(r"\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]", title)
            start_t = ts_match.group(1) if ts_match else "00:00"
            end_t = ts_match.group(2) if (ts_match and ts_match.group(2)) else start_t

            clean_title = re.sub(r"\[.*?\]", "", title).strip()
            clean_title = re.sub(r"^[^\w\s]+\s*", "", clean_title).strip()

            points = sec.get("points", [])
            clean_points = []
            for p in points:
                if isinstance(p, str):
                    clean_points.append(p.strip())
                elif isinstance(p, dict):
                    clean_points.append(p.get("text", "").strip())

            txt = f"Topic: {clean_title}. " + " ".join(clean_points)
            meta_items.append({
                "video_id": video_id,
                "video_title": video_title,
                "start_time": start_t,
                "end_time": end_t,
                "text": txt[:1200]
            })
        return meta_items

    def query_rag(
        self,
        query: str,
        video_id: Optional[str] = None,
        video_title: Optional[str] = None,
        cues: Optional[List[Dict[str, str]]] = None,
        top_k: int = 10,
        model_id: Optional[str] = None,
        enable_web_search: bool = True
    ) -> Dict[str, Any]:
        """Perform grounded retrieval strictly tied to the current lecture + Multi-Model Synthesis."""
        target_video_id = str(video_id).strip() if video_id else ""
        lecture_title = video_title or ""
        lecture_cues = cues or []
        summary_sections = []

        # Resolve lecture metadata, cues & summaries from PostgreSQL if not passed
        if target_video_id:
            try:
                from backend.database import db_manager
                saved = db_manager.get_saved_video(target_video_id)
                if saved:
                    if not lecture_title:
                        lecture_title = saved.get("title", "")
                    if not lecture_cues:
                        lecture_cues = saved.get("cues", [])
                    summary_sections = saved.get("summarySections") or saved.get("summary_sections") or []
            except Exception as e:
                print(f"[RAG Engine Warning] Could not fetch lecture {target_video_id} from DB: {e}")

        if not lecture_title:
            lecture_title = self.video_title or "Active Lecture"

        is_summary = self._is_summary_query(query)
        retrieved_metadata = []

        if is_summary:
            # 1. Whole Lecture Summarization Strategy
            # Feed structured chapter summaries and evenly spaced timeline milestones
            if summary_sections:
                sec_meta = self._build_summary_sections_metadata(summary_sections, target_video_id, lecture_title)
                retrieved_metadata.extend(sec_meta)

            if lecture_cues:
                sampled_cues = self._sample_chronological_cues(lecture_cues, target_video_id, lecture_title, num_samples=15)
                retrieved_metadata.extend(sampled_cues)

            # If still empty (e.g. video not yet in DB), fallback to vector search with lecture title
            if not retrieved_metadata and self.index:
                try:
                    query_kwargs = {
                        "vector": self._generate_embedding(lecture_title or "lecture summary"),
                        "top_k": top_k,
                        "namespace": self.namespace,
                        "include_metadata": True
                    }
                    if target_video_id:
                        query_kwargs["filter"] = {"video_id": {"$eq": target_video_id}}
                    res = self.index.query(**query_kwargs)
                    if res and res.matches:
                        for match in res.matches:
                            if match.metadata and (not target_video_id or str(match.metadata.get("video_id", "")) == target_video_id):
                                retrieved_metadata.append(match.metadata)
                except Exception as e:
                    print(f"[RAG Engine Warning] Summary vector fallback error: {e}")
        else:
            # 2. Targeted Concept Retrieval (Hybrid: Pinecone Vector + Algolia Keyword + DB Sliding-Window)
            pinecone_matches = []
            if self.index:
                try:
                    query_embedding = self._generate_embedding(query)
                    query_kwargs = {
                        "vector": query_embedding,
                        "top_k": top_k,
                        "namespace": self.namespace,
                        "include_metadata": True
                    }
                    if target_video_id:
                        query_kwargs["filter"] = {"video_id": {"$eq": target_video_id}}

                    res = self.index.query(**query_kwargs)
                    if res and res.matches:
                        for match in res.matches:
                            if match.metadata:
                                m_vid = str(match.metadata.get("video_id", ""))
                                if not target_video_id or m_vid == target_video_id:
                                    pinecone_matches.append(match.metadata)
                except Exception as e:
                    print(f"[RAG Engine Warning] Vector search error: {e}")

            # Algolia Keyword Search
            algolia_chunks = []
            try:
                from backend.algolia_service import algolia_service
                algolia_hits = algolia_service.search(query, video_id=target_video_id, limit=top_k * 2)
                for h in algolia_hits:
                    algolia_chunks.append({
                        "video_id": target_video_id,
                        "video_title": lecture_title,
                        "start_time": h.get("timestamp", "00:00"),
                        "end_time": h.get("timestamp", "00:00"),
                        "text": h.get("text", "")
                    })
            except Exception as e:
                print(f"[RAG Engine Warning] Algolia search error: {e}")

            # Postgres Transcript Sliding-Window Search
            cue_matches = []
            if lecture_cues:
                cue_matches = self._retrieve_relevant_lecture_cues(
                    query=query,
                    cues=lecture_cues,
                    video_id=target_video_id,
                    video_title=lecture_title,
                    top_k=top_k
                )

            # Combine candidates using Reciprocal Rank Fusion
            ranked_sources = []
            if pinecone_matches:
                ranked_sources.append(pinecone_matches)
            if algolia_chunks:
                ranked_sources.append(algolia_chunks)
            if cue_matches:
                ranked_sources.append(cue_matches)

            if ranked_sources:
                retrieved_metadata = self.reciprocal_rank_fusion(ranked_sources, k=60)[:top_k]
            elif self.local_chunks:
                matched_local = [
                    c["metadata"] for c in self.local_chunks
                    if not target_video_id or str(c.get("metadata", {}).get("video_id", "")) == target_video_id
                ]
                if matched_local:
                    retrieved_metadata = matched_local[:top_k]

            # If still empty, sample milestone cues so context is never blank
            if not retrieved_metadata and lecture_cues:
                retrieved_metadata = self._sample_chronological_cues(lecture_cues, target_video_id, lecture_title, num_samples=top_k)

        # 3. Chronological Sorting: Sort chunks by start_time before feeding into context_str
        retrieved_metadata.sort(key=lambda x: self._parse_timestamp(x.get("start_time", "00:00")))

        context_str = ""
        citations = []
        for meta in retrieved_metadata:
            start_t = meta.get("start_time", "00:00")
            end_t = meta.get("end_time", start_t)
            txt = meta.get("text", "")
            context_str += f"[{start_t} - {end_t}] {txt}\n"
            citations.append({
                "timestamp": start_t,
                "end_time": end_t,
                "text": txt[:120] + "..."
            })

        # Grounded Web Search (DuckDuckGo + Wikipedia, Free)
        web_sources = []
        web_context_str = ""
        if enable_web_search and not is_summary:
            try:
                from backend.web_search import search_web_for_context
                search_term = f"{lecture_title} {query}" if lecture_title and len(query.split()) < 5 else query
                web_sources = search_web_for_context(search_term, max_results=3)
                if web_sources:
                    web_context_str = "\n".join([
                        f"• Source: {s.get('title')} ({s.get('url')})\n  Snippet: {s.get('snippet')}"
                        for s in web_sources
                    ])
            except Exception as e:
                print(f"[Web Search Warning]: {e}")

        # Choose model & synthesize with unchained Socratic tutor prompt
        answer, model_used = self._generate_llm_response(
            query=query,
            lecture_title=lecture_title,
            context_str=context_str,
            web_context_str=web_context_str,
            requested_model=model_id,
            is_summary_query=is_summary
        )

        return {
            "answer": answer,
            "citations": citations,
            "web_sources": web_sources,
            "model": model_used,
            "pinecone_vector_matches": len(retrieved_metadata),
            "lecture_title": lecture_title,
            "video_id": target_video_id
        }

    def _generate_llm_response(
        self,
        query: str,
        lecture_title: str,
        context_str: str,
        web_context_str: str = "",
        requested_model: Optional[str] = None,
        is_summary_query: bool = False
    ) -> Tuple[str, str]:
        """
        Synthesize answer using selected or best available LLM provider.
        Unchained Socratic tutor prompt: grounds strictly in current lecture transcript, enriches with academic knowledge & web context.
        """
        import requests

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))

        target_model = requested_model or "gemini-2.0-flash" if gemini_key else ("llama-3.3-70b-versatile" if groq_key else "meta-llama/Llama-3.1-8B-Instruct")

        # Fallback if selected model lacks key
        if target_model.startswith("gemini") and not gemini_key:
            if groq_key:
                target_model = "llama-3.3-70b-versatile"
            elif hf_token:
                target_model = "meta-llama/Llama-3.1-8B-Instruct"
        elif target_model.startswith("llama-3.3") and not groq_key:
            if gemini_key:
                target_model = "gemini-2.0-flash"
            elif hf_token:
                target_model = "meta-llama/Llama-3.1-8B-Instruct"

        system_prompt = (
            f"You are an encouraging, articulate Academic AI Tutor helping a student learn from the lecture: '{lecture_title}'.\n\n"
            "PEDAGOGICAL INSTRUCTIONS:\n"
            "1. Grounding in Lecture: Anchor your answer strictly in the professor's explanations from this lecture's transcript context.\n"
            "2. Mandatory Inline Timestamp Citations: Whenever referencing, summarizing, or attributing facts, concepts, or statements to the professor, you MUST append the exact timestamp from the transcript context in brackets, e.g. [14:25] or [01:12:40]. Every key point about the lecture MUST include its timestamp tag [MM:SS] so the student can jump to that exact moment in the video.\n"
            "3. Conceptual Depth & Distinction: If the student asks for deeper explanations, step-by-step proofs, intuitive analogies, practical code examples, or concepts only briefly introduced by the professor, use your broad academic knowledge and any supplementary web search results below to explain them thoroughly. Clearly differentiate what the professor stated vs. supplementary knowledge, and do NOT redundantly repeat items.\n"
            "4. Format: Structure your explanation with clear paragraphs, bullet points, or code snippets when helpful."
        )

        if is_summary_query:
            system_prompt += (
                "\n\n5. SUMMARY MODE MANDATE: The student explicitly requested an overall summary, overview, or recap of this lecture. "
                "Directly provide an authentic, comprehensive, and well-structured technical summary of the actual topics, concepts, mathematical foundations, and methodologies taught by the professor across the lecture timeline. "
                "Synthesize the lecture progression chronologically using the provided transcript context and summary chapters. "
                "MANDATORY: You MUST include inline timestamp citations [MM:SS] for each major section or concept so the student can jump to that part of the video. "
                "ABSOLUTE PROHIBITION: Do NOT provide instructional guidance or a meta-tutorial on HOW to write a summary (e.g. NEVER say 'Here is how to create a summary', 'discretize into manageable chunks', 'concentrate on key regions', etc.). Output the substantive lecture summary itself!"
            )

        prompt_content = f"--- CURRENT LECTURE: {lecture_title} ---\n\n"
        if context_str:
            prompt_content += f"=== Lecture Topics & Chronological Transcript Context ===\n{context_str}\n\n"
        if web_context_str:
            prompt_content += f"=== Supplementary Academic / Web Search Context ===\n{web_context_str}\n\n"
        if is_summary_query:
            prompt_content += f"Student Request: {query}\n\nDeliver the comprehensive technical summary of this lecture with inline timestamps [MM:SS]:"
        else:
            prompt_content += f"Student Question: {query}"

        # 1. Google Gemini (100% Free Developer Tier)
        if (target_model.startswith("gemini") or "flash" in target_model) and gemini_key:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": prompt_content}]}],
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": {"temperature": 0.25, "maxOutputTokens": 1024}
                }
                r = requests.post(url, json=payload, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    candidates = data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            return parts[0].get("text", "").strip(), "Gemini 2.0 Flash"
            except Exception as e:
                print(f"[Gemini Inference Error]: {e}")

        # 2. Groq Cloud (Llama 3.3 70B - 100% Free Developer Tier)
        if (target_model.startswith("llama-3.3") or "groq" in target_model.lower()) and groq_key:
            try:
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt_content}
                    ],
                    "temperature": 0.25,
                    "max_tokens": 1024
                }
                r = requests.post(url, headers=headers, json=payload, timeout=12)
                if r.status_code == 200:
                    data = r.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        return choices[0]["message"].get("content", "").strip(), "Groq Llama 3.3 70B"
            except Exception as e:
                print(f"[Groq Inference Error]: {e}")

        # 3. Hugging Face InferenceClient (Active Serverless Free)
        if hf_token:
            try:
                from huggingface_hub import InferenceClient
                client = InferenceClient(api_key=hf_token)
                resp = client.chat.completions.create(
                    model="meta-llama/Llama-3.1-8B-Instruct",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt_content}
                    ],
                    max_tokens=800,
                    temperature=0.25
                )
                if resp and resp.choices and resp.choices[0].message:
                    return resp.choices[0].message.content.strip(), "Hugging Face Llama 3.1 8B"
            except Exception as e:
                print(f"[HuggingFace InferenceClient Error]: {e}")

        # 5. Informative setup tip if no cloud LLM key is configured
        tip = (
            "💡 **AI Tutor Connected**\n\n"
            f"Here is what was found in the lecture for your question: *\"{query}\"*\n\n"
            f"{context_str[:600] if context_str else 'No direct transcript cues matched, but web search was performed.'}\n\n"
            "*(Tip: To enable full intelligent conversational explanations, add a free API key to `.env` from [Google AI Studio](https://aistudio.google.com) `GEMINI_API_KEY=` or [Groq Console](https://console.groq.com) `GROQ_API_KEY=`)*"
        )
        return tip, "Transcript Retrieval"

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

        clean_base = self._clean_for_submission(original_text, target_words=word_count * 2)
        keywords = self.extract_lecture_keywords(video_id=video_id or "", top_n=6)
        kw_str = ", ".join(keywords) if keywords else "the core lecture topics"

        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))

        target_model = model_id or "gemini-2.0-flash" if gemini_key else ("llama-3.3-70b-versatile" if groq_key else "meta-llama/Llama-3.1-8B-Instruct")
        if target_model.startswith("gemini") and not gemini_key:
            target_model = "llama-3.3-70b-versatile" if groq_key else "meta-llama/Llama-3.1-8B-Instruct"
        elif target_model.startswith("llama-3.3") and not groq_key:
            target_model = "gemini-2.0-flash" if gemini_key else "meta-llama/Llama-3.1-8B-Instruct"

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

        # 1. Gemini
        if (target_model.startswith("gemini") or "flash" in target_model) and gemini_key:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": user_content}]}],
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300}
                }
                r = requests.post(url, json=payload, timeout=12)
                if r.status_code == 200:
                    data = r.json()
                    candidates = data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            raw_output = parts[0].get("text", "").strip()
                            model_used = "Gemini 2.0 Flash"
            except Exception as e:
                print(f"[Gemini Submission Inference Error]: {e}")

        # 2. Groq
        if not raw_output and (target_model.startswith("llama-3.3") or "groq" in target_model.lower()) and groq_key:
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
                r = requests.post(url, headers=headers, json=payload, timeout=10)
                if r.status_code == 200:
                    data = r.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        raw_output = choices[0]["message"].get("content", "").strip()
                        model_used = "Groq Llama 3.3 70B"
            except Exception as e:
                print(f"[Groq Submission Inference Error]: {e}")

        # 3. Hugging Face
        if not raw_output and hf_token:
            try:
                from huggingface_hub import InferenceClient
                client = InferenceClient(api_key=hf_token)
                resp = client.chat.completions.create(
                    model="meta-llama/Llama-3.1-8B-Instruct",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content}
                    ],
                    max_tokens=300,
                    temperature=0.3
                )
                if resp and resp.choices and resp.choices[0].message:
                    raw_output = resp.choices[0].message.content.strip()
                    model_used = "Hugging Face Llama 3.1 8B"
            except Exception as e:
                print(f"[HF Submission Inference Error]: {e}")

        # 4. Fallback if no LLM responded or keys are missing
        if not raw_output:
            raw_output = clean_base
            model_used = "Rule-based Student Formatter"

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

