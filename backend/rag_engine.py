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
            print(f"[Llama-3.2 RAG Warning] Could not initialize Pinecone: {e}")

    def _generate_embedding(self, text: str) -> List[float]:
        """Generate 768-dim embedding vector for transcript text."""
        words = re.findall(r"\w+", text.lower())
        vec = [0.0] * 768
        for idx, word in enumerate(words):
            word_hash = hash(word) % 768
            vec[word_hash] += 1.0 / (idx + 1)
        
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def ingest_transcript(self, video_id: str, video_title: str, cues: List[Dict[str, str]], window_size: int = 4, overlap: int = 2) -> int:
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
                    "text": chunk_text.strip()[:1000]
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

    def query_rag(self, query: str, top_k: int = 4) -> Dict[str, Any]:
        """Perform Pinecone Vector retrieval + Llama-3.2-3B-Instruct grounded synthesis."""
        query_embedding = self._generate_embedding(query)
        retrieved_metadata = []

        if self.index:
            try:
                res = self.index.query(
                    vector=query_embedding,
                    top_k=top_k,
                    namespace=self.namespace,
                    include_metadata=True
                )
                if res and res.matches:
                    for match in res.matches:
                        if match.metadata:
                            retrieved_metadata.append(match.metadata)
            except Exception as e:
                print(f"[Llama-3.2 RAG Warning] Pinecone vector search error: {e}")

        if not retrieved_metadata:
            return {
                "answer": "No relevant video transcript vector matches found in Pinecone vector database.",
                "citations": [],
                "model": self.model_id,
                "pinecone_vector_matches": 0
            }

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

        answer = self._generate_llama3_response(query, context_str, retrieved_metadata)

        return {
            "answer": answer,
            "citations": citations,
            "model": self.model_id,
            "pinecone_vector_matches": len(retrieved_metadata)
        }

    def _generate_llama3_response(self, query: str, context_str: str, metadata_list: List[Dict[str, Any]]) -> str:
        """Call Llama-3.2-3B-Instruct using HuggingFace Client or OpenAI-compatible endpoint strictly via live API."""
        system_prompt = (
            f"You are LectureScribe AI powered by {self.model_id}. "
            "Answer the user question accurately using ONLY the provided transcript context. "
            "Always cite exact video timestamps in your response like [MM:SS]."
        )
        prompt_content = f"Video Title: {self.video_title}\n\nRetrieved Transcript Context:\n{context_str}\n\nUser Question: {query}"
        hf_token = os.getenv("HUGGINGFACE_TOKEN", os.getenv("HF_TOKEN", ""))

        if HAS_HF and hf_token and context_str:
            try:
                client = InferenceClient(model=self.model_id, token=hf_token)
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt_content}
                ]
                resp = client.chat_completion(messages=messages, max_tokens=512, temperature=0.2)
                if resp and resp.choices and resp.choices[0].message:
                    return resp.choices[0].message.content
            except Exception as e:
                print(f"[Llama-3.2 RAG] HuggingFace inference error: {e}")

        if HAS_OPENAI and os.getenv("LLAMA_OPENAI_BASE", ""):
            try:
                client = OpenAI(
                    base_url=os.getenv("LLAMA_OPENAI_BASE", "http://localhost:11434/v1"),
                    api_key=os.getenv("LLAMA_OPENAI_KEY", "ollama")
                )
                resp = client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt_content}
                    ],
                    max_tokens=512,
                    temperature=0.2
                )
                if resp and resp.choices:
                    return resp.choices[0].message.content
            except Exception as e:
                print(f"[Llama-3.2 RAG] OpenAI API base error: {e}")

        return f"⚠️ Could not execute LLM inference for model '{self.model_id}'. Please configure HUGGINGFACE_TOKEN or LLAMA_OPENAI_BASE in .env."


pinecone_rag_engine = Llama3PineconeRAGStore()
