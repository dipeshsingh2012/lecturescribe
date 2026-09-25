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

    def query_rag(
        self,
        query: str,
        top_k: int = 4,
        model_id: Optional[str] = None,
        enable_web_search: bool = True
    ) -> Dict[str, Any]:
        """Perform grounded retrieval (Transcript + Free DuckDuckGo Web Search) + Multi-Model Synthesis."""
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
                print(f"[RAG Engine Warning] Vector search error: {e}")

        # Fallback to local chunks if pinecone returned nothing
        if not retrieved_metadata and self.local_chunks:
            retrieved_metadata = self.local_chunks[:top_k]

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
        if enable_web_search:
            try:
                from backend.web_search import search_web_for_context
                search_term = f"{self.video_title} {query}" if self.video_title and len(query.split()) < 5 else query
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
            context_str=context_str,
            web_context_str=web_context_str,
            requested_model=model_id
        )

        return {
            "answer": answer,
            "citations": citations,
            "web_sources": web_sources,
            "model": model_used,
            "pinecone_vector_matches": len(retrieved_metadata)
        }

    def _generate_llm_response(
        self,
        query: str,
        context_str: str,
        web_context_str: str = "",
        requested_model: Optional[str] = None
    ) -> Tuple[str, str]:
        """
        Synthesize answer using selected or best available LLM provider.
        Unchained Socratic tutor prompt: grounds in transcript, enriches with academic knowledge & web context.
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
            "You are an encouraging, articulate Academic AI Tutor helping a student learn from this lecture.\n\n"
            "PEDAGOGICAL INSTRUCTIONS:\n"
            "1. Grounding in Lecture: When the student asks about what was taught in class, anchor your answer in the professor's explanations from the transcript context.\n"
            "2. Conceptual Depth: If the student asks for deeper explanations, step-by-step proofs, intuitive analogies, practical code examples, or concepts only briefly introduced by the professor, use your broad academic knowledge and any supplementary web search results below to explain them thoroughly.\n"
            "3. Format: Structure your explanation with clear paragraphs, bullet points, or code snippets when helpful."
        )

        prompt_content = f"Lecture Title: {self.video_title or 'Video Lecture'}\n\n"
        if context_str:
            prompt_content += f"=== Professor's Lecture Transcript Context ===\n{context_str}\n\n"
        if web_context_str:
            prompt_content += f"=== Supplementary Academic / Web Search Context ===\n{web_context_str}\n\n"
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


pinecone_rag_engine = Llama3PineconeRAGStore()
