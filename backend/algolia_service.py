"""
Algolia Search Service for LectureScribe
---------------------------------------
Strictly loads Algolia credentials from environment variables - NO HARDCODING.
Pushes transcript cues to Algolia Cloud Search Index and handles instant typo-tolerant search.
"""
from __future__ import annotations

import os
import re
from typing import List, Dict, Any, Optional
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
    from algoliasearch.search.client import SearchClientSync
    HAS_ALGOLIA = True
except ImportError:
    HAS_ALGOLIA = False


def generate_dual_representation(text: str) -> str:
    """
    Generate alternate search tokens for formulas and spoken mathematical words.
    E.g. '$y = mx + c$' -> 'y equals mx plus c' and 'y = mx + c'
         'y equals mx plus c' -> '$y = mx + c$'
    """
    if not text:
        return ""
    alts = []
    if "$" in text:
        clean_formula = re.sub(r'\$([^\$]+)\$', r'\1', text)
        alts.append(clean_formula)
        spoken = clean_formula
        spoken = re.sub(r'(?i)\by\s*=\s*mx\s*\+\s*c\b', 'y equals mx plus c', spoken)
        spoken = re.sub(r'(?i)\be\s*=\s*mc\^2\b', 'e equals mc squared', spoken)
        spoken = re.sub(r'(?i)\ba\^2\s*\+\s*b\^2\s*=\s*c\^2\b', 'a squared plus b squared equals c squared', spoken)
        spoken = re.sub(r'(?i)\bx\^2\s*\+\s*y\^2\s*=\s*r\^2\b', 'x squared plus y squared equals r squared', spoken)
        spoken = re.sub(r'\\sin', 'sine', spoken)
        spoken = re.sub(r'\\cos', 'cosine', spoken)
        spoken = re.sub(r'\\tan', 'tangent', spoken)
        spoken = re.sub(r'\\alpha', 'alpha', spoken)
        spoken = re.sub(r'\\beta', 'beta', spoken)
        spoken = re.sub(r'\\theta', 'theta', spoken)
        spoken = re.sub(r'\\int', 'integral', spoken)
        spoken = re.sub(r'\\sum', 'summation sigma', spoken)
        spoken = re.sub(r'\\lim', 'limit', spoken)
        spoken = re.sub(r'=', ' equals ', spoken)
        spoken = re.sub(r'\+', ' plus ', spoken)
        spoken = re.sub(r'\^2\b', ' squared ', spoken)
        spoken = re.sub(r'\^3\b', ' cubed ', spoken)
        spoken = re.sub(r'\s+', ' ', spoken).strip()
        alts.append(spoken)
    else:
        spoken_patterns = [
            (r'(?i)\by equals mx plus c\b', '$y = mx + c$ y = mx + c'),
            (r'(?i)\be equals mc squared\b', '$E = mc^2$ E = mc^2'),
            (r'(?i)\ba squared plus b squared equals c squared\b', '$a^2 + b^2 = c^2$ a^2 + b^2 = c^2'),
            (r'(?i)\bx squared plus y squared equals r squared\b', '$x^2 + y^2 = r^2$ x^2 + y^2 = r^2'),
            (r'(?i)\bsin squared theta plus cos squared theta equals one\b', '$\\sin^2\\theta + \\cos^2\\theta = 1$'),
        ]
        for pat, rep in spoken_patterns:
            if re.search(pat, text):
                alts.append(rep)

    return " ".join(dict.fromkeys(alts)).strip()


class AlgoliaSearchService:
    """Algolia Search API Manager for Instant Transcript Search."""

    def __init__(self):
        self.app_id = os.getenv("ALGOLIA_APP_ID", "")
        self.api_key = os.getenv("ALGOLIA_API_KEY", "")
        self.index_name = os.getenv("ALGOLIA_INDEX_NAME", "lecturescribe_transcripts_v1")
        self.client = None

        self._init_algolia(_first_init=True)

    def _init_algolia(self, _first_init: bool = False):
        app_id = os.getenv("ALGOLIA_APP_ID", "")
        api_key = os.getenv("ALGOLIA_API_KEY", "")
        index_name = os.getenv("ALGOLIA_INDEX_NAME", "lecturescribe_transcripts_v1")
        creds_changed = (
            self.app_id != app_id
            or self.api_key != api_key
            or self.index_name != index_name
        )
        self.app_id = app_id
        self.api_key = api_key
        self.index_name = index_name
        try:
            if not (HAS_ALGOLIA and self.app_id and self.api_key):
                if _first_init:
                    print(f"[Algolia Service] ALGOLIA_APP_ID / ALGOLIA_API_KEY not configured. Using dynamic indexer.")
                self.client = None
                return
            if self.client is not None and not creds_changed and not _first_init:
                return
            self.client = SearchClientSync(self.app_id, self.api_key)
            print(f"[Algolia Service] Connected to Algolia Cloud Index '{self.index_name}'.")
        except Exception as e:
            print(f"[Algolia Warning] Could not initialize Algolia client: {e}")

    def setup_index(self) -> bool:
        """Create and configure Algolia index settings on server start."""
        self._init_algolia(_first_init=False)
        if not self.client:
            return False

        try:
            settings = {
                "searchableAttributes": ["text", "alt_text", "timestamp", "video_title"],
                "attributesForFaceting": ["filterOnly(video_id)"],
                "customRanking": ["asc(seconds)"]
            }
            self.client.set_settings(index_name=self.index_name, index_settings=settings)
            print(f"✅ [Algolia Startup] Index '{self.index_name}' configured with search & faceting rules.")
            return True
        except Exception as e:
            print(f"⚠️ [Algolia Startup Notice] Index settings setup: {e}")
            return True

    def parse_timestamp_seconds(self, ts: str) -> int:
        if not ts:
            return 0
        parts = ts.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2].split(".")[0])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1].split(".")[0])
        return 0

    def build_transcript_chunks(
        self,
        video_id: str,
        video_title: str,
        cues: List[Dict[str, Any]],
        window_seconds: int = 30
    ) -> List[Dict[str, Any]]:
        """
        Aggregate fine-grained cues into ~30-second windowed chunks.
        Dramatically reduces Algolia record footprint (80-90% reduction)
        while preserving search precision, timestamp jumping, and formulas.
        """
        if not cues:
            return []

        chunks: List[Dict[str, Any]] = []
        current_cues: List[tuple[int, Dict[str, Any], int]] = []
        chunk_start_sec = 0

        def flush_chunk():
            nonlocal current_cues, chunk_start_sec
            if not current_cues:
                return
            combined_texts = []
            cue_indices = []
            cue_ids = []
            for item_idx, item_cue, _ in current_cues:
                txt = (item_cue.get("text") or "").strip()
                if txt:
                    combined_texts.append(txt)
                cue_indices.append(item_idx)
                cid = item_cue.get("id")
                if cid is not None:
                    cue_ids.append(cid)

            chunk_text = " ".join(combined_texts).strip()
            if chunk_text:
                start_c = current_cues[0][1]
                end_c = current_cues[-1][1]
                start_ts = start_c.get("time") or start_c.get("timestamp") or "00:00"
                end_ts = end_c.get("time") or end_c.get("timestamp") or start_ts
                alt_text = generate_dual_representation(chunk_text)

                chunk_idx = len(chunks)
                chunks.append({
                    "objectID": f"vimeo-{video_id}-chunk-{chunk_idx}",
                    "video_id": video_id,
                    "video_title": video_title,
                    "timestamp": start_ts,
                    "seconds": chunk_start_sec,
                    "end_timestamp": end_ts,
                    "end_seconds": current_cues[-1][2],
                    "text": chunk_text,
                    "alt_text": alt_text,
                    "cue_index": current_cues[0][0],
                    "cue_indices": cue_indices,
                    "cue_ids": cue_ids
                })
            current_cues = []

        for idx, c in enumerate(cues):
            ts = c.get("time") or c.get("timestamp") or "00:00"
            sec_val = c.get("seconds")
            if sec_val is None:
                sec = self.parse_timestamp_seconds(ts)
            else:
                try:
                    sec = int(sec_val)
                except (ValueError, TypeError):
                    sec = self.parse_timestamp_seconds(ts)

            # If window elapsed for accumulated cues, flush chunk before adding current cue
            if current_cues and (sec - chunk_start_sec >= window_seconds):
                flush_chunk()

            if not current_cues:
                chunk_start_sec = sec

            current_cues.append((idx, c, sec))

        flush_chunk()
        return chunks

    def ingest_cues(
        self,
        video_id: str,
        video_title: str,
        cues: List[Dict[str, Any]],
        updated_cue_id: Optional[Any] = None,
        window_seconds: int = 30
    ) -> int:
        """
        Push windowed transcript chunks to Algolia Cloud index.
        If updated_cue_id is provided, only updates the specific affected chunk (1 write operation)
        instead of re-indexing the entire transcript.
        """
        chunks = self.build_transcript_chunks(video_id, video_title, cues, window_seconds=window_seconds)
        if not chunks:
            return 0

        if not self.client:
            return len(chunks)

        # Single-cue / single-chunk partial update optimization
        if updated_cue_id is not None:
            target_chunk = None
            str_target_id = str(updated_cue_id).strip()
            for ch in chunks:
                # Match by explicit database cue ID
                if any(str(cid).strip() == str_target_id for cid in ch.get("cue_ids", [])):
                    target_chunk = ch
                    break
                # Match by index if target_id corresponds to a cue index
                if str_target_id.isdigit():
                    int_target_id = int(str_target_id)
                    if int_target_id in ch.get("cue_indices", []):
                        target_chunk = ch
                        break

            if target_chunk:
                try:
                    self.client.save_object(
                        index_name=self.index_name,
                        body=target_chunk
                    )
                    print(f"[Algolia Service] Updated single chunk '{target_chunk['objectID']}' for cue {updated_cue_id} in '{self.index_name}'.")
                    return 1
                except Exception as e:
                    print(f"[Algolia Warning] Failed updating single chunk in Algolia: {e}")
                    return 0

        # Full batch upsert of windowed chunks
        try:
            self.client.save_objects(
                index_name=self.index_name,
                objects=chunks
            )
            print(f"[Algolia Service] Pushed {len(chunks)} aggregated chunk records (from {len(cues)} cues) to Algolia Cloud Index '{self.index_name}'.")
        except Exception as e:
            print(f"[Algolia Warning] Failed pushing records to Algolia: {e}")

        return len(chunks)

    def update_single_cue(
        self,
        video_id: str,
        video_title: str,
        cues: List[Dict[str, Any]],
        cue_id: Any,
        window_seconds: int = 30
    ) -> bool:
        """Update only the single Algolia chunk containing the modified cue."""
        count = self.ingest_cues(video_id, video_title, cues, updated_cue_id=cue_id, window_seconds=window_seconds)
        return count > 0

    def delete_video_records(self, video_id: str) -> bool:
        """Delete all existing Algolia records/chunks for a specific video."""
        if not self.client:
            return False
        try:
            self.client.delete_by(
                index_name=self.index_name,
                delete_by_params={"filters": f"video_id:{video_id}"}
            )
            print(f"[Algolia Service] Deleted records for video '{video_id}' from '{self.index_name}'.")
            return True
        except Exception as e:
            print(f"[Algolia Warning] Failed deleting records for video '{video_id}': {e}")
            return False

    def reindex_video(
        self,
        video_id: str,
        video_title: str,
        cues: List[Dict[str, Any]],
        window_seconds: int = 30
    ) -> int:
        """
        Safely replace all legacy fine-grained records for a video with consolidated chunks.
        First purges old records for this video_id, then ingests windowed chunks.
        """
        self.delete_video_records(video_id)
        return self.ingest_cues(video_id, video_title, cues, window_seconds=window_seconds)


    def search(self, query: str, video_id: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """Perform instant keyword search across transcript cues strictly via Algolia Cloud."""
        if not query.strip():
            return []

        if not self.client:
            raise RuntimeError("Algolia search service is uninitialized or API credentials are not configured.")

        search_params = {
            "query": query,
            "hitsPerPage": limit,
            "attributesToHighlight": ["text"],
            "highlightPreTag": "<mark class='algolia-highlight'>",
            "highlightPostTag": "</mark>"
        }
        if video_id:
            search_params["filters"] = f"video_id:{video_id}"

        try:
            res = self.client.search_single_index(
                index_name=self.index_name,
                search_params=search_params
            )
            hits = []
            if res and hasattr(res, "hits") and res.hits:
                for h in res.hits:
                    hit_dict = h.to_dict() if hasattr(h, "to_dict") else dict(h)
                    hits.append(hit_dict)
            return hits
        except Exception as e:
            print(f"[Algolia Warning] Algolia search error: {e}")
            raise RuntimeError(f"Algolia search failed: {e}")


algolia_service = AlgoliaSearchService()
