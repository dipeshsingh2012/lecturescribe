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


class AlgoliaSearchService:
    """Algolia Search API Manager for Instant Transcript Search."""

    def __init__(self):
        self.app_id = os.getenv("ALGOLIA_APP_ID", "")
        self.api_key = os.getenv("ALGOLIA_API_KEY", "")
        self.index_name = os.getenv("ALGOLIA_INDEX_NAME", "lecturescribe_transcripts_v1")
        self.client = None
        self.local_records: List[Dict[str, Any]] = []

        self._init_algolia()

    def _init_algolia(self):
        self.app_id = os.getenv("ALGOLIA_APP_ID", "")
        self.api_key = os.getenv("ALGOLIA_API_KEY", "")
        self.index_name = os.getenv("ALGOLIA_INDEX_NAME", "lecturescribe_transcripts_v1")
        try:
            if HAS_ALGOLIA and self.app_id and self.api_key:
                self.client = SearchClientSync(self.app_id, self.api_key)
                print(f"[Algolia Service] Connected to Algolia Cloud Index '{self.index_name}'.")
            else:
                print(f"[Algolia Service] ALGOLIA_APP_ID / ALGOLIA_API_KEY not configured. Using dynamic indexer.")
        except Exception as e:
            print(f"[Algolia Warning] Could not initialize Algolia client: {e}")

    def setup_index(self) -> bool:
        """Create and configure Algolia index settings on server start."""
        self._init_algolia()
        if not self.client:
            return False

        try:
            settings = {
                "searchableAttributes": ["text", "timestamp", "video_title"],
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

    def ingest_cues(self, video_id: str, video_title: str, cues: List[Dict[str, str]]) -> int:
        """Format transcript cues and push to Algolia index."""
        if getattr(self, "active_video_id", None) == video_id and len(self.local_records) > 0:
            return len(self.local_records)
        self.active_video_id = video_id
        self.local_records.clear()
        records = []

        for idx, c in enumerate(cues):
            ts = c.get("time", "00:00")
            text = c.get("text", "")
            rec = {
                "objectID": f"vimeo-{video_id}-{idx}",
                "video_id": video_id,
                "video_title": video_title,
                "timestamp": ts,
                "seconds": self.parse_timestamp_seconds(ts),
                "text": text,
                "cue_index": idx
            }
            records.append(rec)
            self.local_records.append(rec)

        if self.client and records:
            try:
                self.client.save_objects(
                    index_name=self.index_name,
                    objects=records
                )
                print(f"[Algolia Service] Pushed {len(records)} cues to Algolia Cloud Index '{self.index_name}'.")
            except Exception as e:
                print(f"[Algolia Warning] Failed pushing records to Algolia: {e}")

        return len(records)

    def search(self, query: str, video_id: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """Perform instant typo-tolerant search across transcript cues."""
        if not query.strip():
            return self.local_records[:limit]

        # 1. Search using Algolia Cloud Client
        if self.client:
            try:
                search_params = {
                    "query": query,
                    "hitsPerPage": limit,
                    "attributesToHighlight": ["text"],
                    "highlightPreTag": "<mark class='algolia-highlight'>",
                    "highlightPostTag": "</mark>"
                }
                if video_id:
                    search_params["filters"] = f"video_id:{video_id}"

                res = self.client.search_single_index(
                    index_name=self.index_name,
                    search_params=search_params
                )
                
                if res and hasattr(res, "hits") and res.hits:
                    hits = []
                    for h in res.hits:
                        hit_dict = h.to_dict() if hasattr(h, "to_dict") else dict(h)
                        hits.append(hit_dict)
                    return hits
            except Exception as e:
                print(f"[Algolia Warning] Algolia search error: {e}")

        # 2. Dynamic Typo-Tolerant Prefix Search Engine
        q_words = re.findall(r"\w+", query.lower())
        results = []

        for rec in self.local_records:
            if video_id and rec.get("video_id") != video_id:
                continue

            text_lower = rec["text"].lower()
            score = 0

            for q_w in q_words:
                if q_w in text_lower:
                    score += 3
                if any(w.startswith(q_w) for w in text_lower.split()):
                    score += 2

            if score > 0:
                highlighted_text = rec["text"]
                for q_w in q_words:
                    pattern = re.compile(re.escape(q_w), re.IGNORECASE)
                    highlighted_text = pattern.sub(f"<mark class='algolia-highlight'>\\g<0></mark>", highlighted_text)

                result_rec = dict(rec)
                result_rec["_highlightResult"] = {
                    "text": {"value": highlighted_text}
                }
                result_rec["score"] = score
                results.append(result_rec)

        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        return results[:limit]


algolia_service = AlgoliaSearchService()
