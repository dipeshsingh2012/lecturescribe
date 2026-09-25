# Agent Handoff: RRF Hybrid Retrieval & RAG Context Optimization

## Objective
Implement Reciprocal Rank Fusion (RRF) hybrid retrieval combining Pinecone (dense vector) and Algolia (keyword search), optimize chunking window sizes for the LLM, and eliminate redundant `cues` transmission from the frontend in LectureScribe.

---

## Workspace & Environment Context
- **Workspace Path**: `/home/dipes/projects/lecturescribe`
- **Virtual Environment**: `/home/dipes/projects/lecturescribe/.venv/bin/python`
- **Unit Tests Command**: `.venv/bin/python -m unittest discover tests`
- **Frontend Build Command**: `npm --prefix frontend run build` (Note: Run with `BypassSandbox: true` if resolving external symlinks like `proton`)
- **Important**: Sibling repos live in `/home/dipes/projects/` (`proton`, `shared-workflows`, `commerce-ui`). Do NOT attempt remote git clones or lookups.

---

## Detailed Implementation Tasks

### 1. Frontend: Remove Redundant `cues` from AI Tutor Query
**Target File**: `frontend/src/App.jsx`
- **Lines ~586–600 (`handleSendMessage`)**:
  - Currently sends:
    ```javascript
    const res = await fetch('/api/rag/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: textToSend,
        video_id: activeData.videoId,
        video_title: activeData.title,
        cues: activeData.cues || [], // <-- REMOVE THIS LINE
        top_k: 10,                   // <-- Change default top_k from 4 to 10
        user_email: googleUser?.email || null,
        model_id: selectedModel,
        enable_web_search: webSearchEnabled
      })
    });
    ```
  - **Rationale**: The backend already stores transcripts in PostgreSQL, Pinecone, and Algolia during initial video ingestion (`/api/vimeo/transcript`). Serializing thousands of cue objects on every chat prompt is completely redundant.

---

### 2. Backend RAG Engine: Reciprocal Rank Fusion & Chunk Tuning
**Target File**: `backend/rag_engine.py`

#### A. Chunk Window Tuning (`ingest_transcript`)
- **Lines ~143–180**:
  - Currently uses: `window_size: int = 4, overlap: int = 2`.
  - Subtitle cues typically contain only 4–7 words. A window of 4 cues produces only 20–30 words, which lacks semantic coherence and starves the LLM.
  - Update defaults to: `window_size: int = 8, overlap: int = 3`.
  - Ensure `metadata["text"]` holds the full chunk text (raise limit from `[:1000]` to `[:2000]` or remove arbitrary truncations if under Pinecone's 40KB metadata limit).

#### B. Implement RRF Algorithm Helper
- Add an RRF fusion function:
  ```python
  def reciprocal_rank_fusion(
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
  ```

#### C. Hybrid Retrieval in `query_rag`
- **Lines ~303–380**:
  1. Default `top_k` should be `10` (instead of 4).
  2. If `cues` is not passed:
     - Check Pinecone for vector matches filtered by `video_id`.
     - Fetch Algolia hits for keyword matches:
       ```python
       from backend.algolia_service import algolia_service
       algolia_hits = algolia_service.search(query, video_id=target_video_id, limit=top_k * 2)
       ```
     - Map Algolia hits (which are individual cues) to chunk structures:
       ```python
       algolia_chunks = []
       for h in algolia_hits:
           algolia_chunks.append({
               "video_id": target_video_id,
               "video_title": lecture_title,
               "start_time": h.get("timestamp", "00:00"),
               "end_time": h.get("timestamp", "00:00"),
               "text": h.get("text", "")
           })
       ```
     - Combine `pinecone_matches` and `algolia_chunks` using `reciprocal_rank_fusion([pinecone_matches, algolia_chunks], k=60)`.
     - Fallback: If both Pinecone and Algolia are empty/offline, load transcript from Postgres (`db_manager.get_saved_video(target_video_id)`) and score via sliding window.
  3. **Chronological Sorting**:
     - Before feeding into `context_str`, sort the top-$K$ fused chunks chronologically by `start_time` so the LLM reads the lecture chronologically.

---

### 3. Backend API Compatibility
**Target File**: `backend/main.py`
- **`RAGQueryRequest` and `ChatRequest`**:
  - Ensure `cues: Optional[List[Dict[str, str]]] = None` remains optional and defaults to `None`.
  - Update default `top_k: Optional[int] = 10` in `RAGQueryRequest` and in `/api/chat` route (`top_k=10`).
  - In `chat_with_transcript`: do not call `pinecone_rag_engine.ingest_transcript` if cues are not provided; allow `query_rag` to resolve data from DB/Pinecone/Algolia.

---

### 4. Verification & Testing
1. Run backend unit tests:
   ```bash
   .venv/bin/python -m unittest discover tests
   ```
2. Update/add a unit test in `tests/test_services.py`:
   - Test `reciprocal_rank_fusion` merging two ranked lists.
   - Verify `query_rag` executes successfully without `cues` passed in request payload.
3. Verify frontend build:
   ```bash
   npm --prefix frontend run build
   ```
4. Commit and push when complete:
   ```bash
   git add backend/ frontend/ tests/
   git commit -m "feat(rag): implement RRF hybrid retrieval and optimize client chat payloads"
   git push origin main
   ```
