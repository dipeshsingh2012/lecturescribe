# Transcript Correction, Academic Notation & Interactive Reader Architecture

Last updated: 2026-10-09

## Overview & Vision

This document details the comprehensive evolution of LectureScribe's transcript system from a passive subtitle log into an **interactive academic textbook and study notebook**.

The system unites four tightly coupled pillars:
1. **First-Class Manual Cue Editing**: The foundational primitive. Users can edit any cue directly in the transcript at any time, even without AI review or when audio is unavailable.
2. **Audio-Grounded AI Review**: An advisory multimodal review (using Google Gemini 2.0 / 1.5 Flash Audio) that compares spoken audio with transcribed text to propose localized corrections without altering canonical transcripts automatically.
3. **Spoken Math to LaTeX/KaTeX Conversion**: Automated transformation of phonetic mathematical speech (e.g., *"y equals mx plus c"*) into standard LaTeX notation (`$y = mx + c$`) rendered natively via KaTeX.
4. **Interactive "Book Line" Reader & Contextual AI**: Treating transcript lines like paragraphs in a textbook, supporting multi-color highlighting, Google Docs-style margin comments/notes, and inline embedded AI explanations directly anchored to selected text.
5. **Summary Invalidation & Staleness Markers**: Automated detection when transcript cues are edited, flagging existing summaries as outdated across the UI until regenerated.

---

## Architectural Principles

### 1. Manual Cue Editing as the Core Primitive
Manual editing is the foundation upon which all automated suggestions operate. An accepted AI correction executes the exact same underlying `update_cue` operation as a manual edit:

```
  ┌────────────────────────────┐      ┌────────────────────────────┐
  │   Manual User Edit         │      │   AI Review Suggestion     │
  │  (Pencil icon on cue row)  │      │     ("Accept" click)       │
  └──────────────┬─────────────┘      └─────────────┬──────────────┘
                 │                                  │
                 └────────────────┬─────────────────┘
                                  ▼
                     `update_cue(video_id, cue)`
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
[PostgreSQL Cues]       [Algolia Search Index]     [Pinecone RAG Vectors]
  Updated in DB           `ingest_cues(...)`         `ingest_transcript(...)`
                                  │
                                  ├───────────────────────────┐
                                  ▼                           ▼
                         [Redis Cache Flush]       [Summary Outdated Marker]
                        `invalidate_video(...)`     `is_outdated = TRUE`
```

### 2. Audio-Grounded Multimodal Model Recommendation
Use an audio-capable multimodal model, not a text-only LLM, for speech verification:
- Send aligned audio and transcript text together to request structured, timestamped candidate corrections.
- A text-only pass can flag unusual wording or grammar but cannot acoustically confirm what was spoken.
- **Google Gemini API (Gemini 2.0 / 1.5 Flash)** is the primary recommendation:
  - LectureScribe's cloud infrastructure is already hosted on Google Cloud (Cloud Storage, Cloud Tasks, Cloud Run).
  - Gemini provides native audio multimodal inputs with token counting, high duration capacity, low latency, and structured JSON schema output (`response_schema`).
  - See [Audio understanding](https://ai.google.dev/gemini-api/docs/audio), [Files API](https://ai.google.dev/gemini-api/docs/files), and [token counting](https://ai.google.dev/gemini-api/docs/tokens).
- **OpenAI GPT-Audio-1.5** serves as an alternative candidate. See [model details](https://developers.openai.com/api/docs/models/gpt-audio-1.5) and [audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions).

---

## Feature Specifications

### 1. First-Class Manual Cue Editing

Even when AI review is not used, audio is missing, or third-party APIs fail:
- **UI Trigger**: Hovering over any cue row (or when active during playback) displays an edit pencil icon (✏️).
- **Inline Editing**:
  - Clicking the pencil switches that cue row to an inline text input/textarea populated with the current cue text.
  - Clicking within the edit field prevents video seek jumps (`onCueClick`).
  - Pressing <kbd>Enter</kbd> (or clicking ✓) saves the edit.
  - Pressing <kbd>Esc</kbd> (or clicking ✕) cancels without changes.
- **Backend Mutation**: Dispatches `PATCH /api/lecture/{video_id}/cues/{cue_id}` to update `lecturescribe_transcript_cues`.
- **Downstream Synchronization**:
  - Updates PostgreSQL database record.
  - Re-indexes Algolia search.
  - Re-indexes Pinecone RAG vectors for the lecture.
  - Invalidates Redis cache.
  - Sets `lecturescribe_summaries.is_outdated = TRUE`.
- **Optimistic UI**: Immediately updates `activeData.cues` and sets local `summaryOutdated = true` in React state.

---

### 2. Spoken Math to LaTeX/KaTeX Conversion

In STEM and engineering lectures, speech recognition phonetically transcribes mathematical equations. The system provides automated conversion of spoken equations into publication-quality LaTeX expressions.

#### A. Conversion Examples
- *"y equals mx plus c"* $\to$ `$y = mx + c$`
- *"integral from zero to infinity of e to the minus x squared dx"* $\to$ `$\int_{0}^{\infty} e^{-x^2}\,dx$`
- *"partial of u with respect to t equals alpha times del squared u"* $\to$ `$\frac{\partial u}{\partial t} = \alpha \nabla^2 u$`
- *"sigma i equals one to n of x sub i squared"* $\to$ `$\sum_{i=1}^{n} x_i^2$`
- *"limit as x approaches zero of sine x over x equals one"* $\to$ `$\lim_{x \to 0} \frac{\sin x}{x} = 1$`

#### B. Rendering Engine
The frontend already contains `katex`, `remark-math`, and `rehype-katex` in `frontend/package.json`.
- Cues containing LaTeX delimiters (`$...$` for inline, `$$...$$` for block display) are rendered through KaTeX typography in `TranscriptSearch.jsx`.
- When in manual editing mode, the user sees raw LaTeX in the input box, with an instant rendered preview beneath it.

#### C. Search Indexing Dual-Representation
In `backend/algolia_service.py`, index both:
1. The formatted LaTeX string (`"y = mx + c"`).
2. The spoken plain English tokens (`"y equals mx plus c"`).
This guarantees that searching either the visual formula or spoken words matches the cue.

---

### 3. Interactive "Book Line" Reader (Highlights, Margin Notes & Embedded AI)

Transform transcript cues into interactive lines of a book:

#### A. Floating Selection Toolbar (Google Docs / Kindle Style)
Selecting any text across one or more cue lines brings up a floating context toolbar:
```
┌────────────────────────────────────────────────────────┐
│  🟡 🟢 🔵 🌸 Highlight  │  💬 Add Note  │  ✨ Ask AI   │
└────────────────────────────────────────────────────────┘
```

#### B. Multi-Color Highlighting
- Available colors: Yellow (`#fef08a`), Green (`#bbf7d0`), Blue (`#bfdbfe`), Pink (`#fbcfe8`).
- Selected words/phrases are wrapped in a persistent highlight tag.
- Highlights persist per user in PostgreSQL.

#### C. Margin Notes & Comments (Google Docs Style)
- Clicking **Add Note** opens an anchored comment bubble in a side drawer or collapsible right margin.
- Clicking any note jumps video playback directly to that timestamp and highlights the passage.
- Notes support editing, resolving, and deleting.

#### D. Embedded Contextual AI (Gemini / Notion AI Style)
- Selecting difficult text, complex proofs, or definitions and clicking **Ask AI**:
  - Quick action chips:
    - *"Explain this in simpler terms"*
    - *"Derive this math step-by-step"*
    - *"Give a real-world intuitive analogy"*
    - *"Write a practice question on this concept"*
  - The model generates an inline contextual explanation directly beneath the selected cue.
  - Buttons: **"Pin as Margin Note"**, **"Send to AI Tutor"**, or **"Copy Explanation"**.

---

### 4. Summary Invalidation & Outdated Markers

Because lecture summaries (study notes and academic assignment submissions) are generated from transcript cues, any cue modification marks the summary as outdated:

- **Database Tracking**:
  - `is_outdated BOOLEAN NOT NULL DEFAULT FALSE` on `lecturescribe_summaries`.
  - On any cue update: `UPDATE lecturescribe_summaries SET is_outdated = TRUE WHERE video_id = %s;`.
  - On regeneration (`/api/summary/regenerate`): `is_outdated` resets to `FALSE`.
- **Navigation Tab Indicators**:
  - Header and mobile tab buttons display an amber dot/badge: `Summary ●` / `Summary ⚠️`.
  - Tooltip: *"Transcript cues were edited; summary may be outdated."*
- **In-Tab Alert Banner in `LectureSummary.jsx`**:
  ```
  ┌────────────────────────────────────────────────────────────────────────┐
  │ ⚠️  Transcript Modified — Summary May Be Outdated                      │
  │ Cues in this lecture were edited after this summary was generated.     │
  │ [ 🔄 Regenerate Summary Now ]                                          │
  └────────────────────────────────────────────────────────────────────────┘
  ```
  - Clicking **Regenerate Summary Now** updates the summary from the latest cues and clears the banner immediately.

---

### 5. Audio-Grounded AI Review Workflow

1. User clicks **Review transcript** in the transcript header.
2. Backend checks audio sources:
   - Google Cloud Storage (`courses/<course_slug>/lectures/<video_id>/...`).
   - Authorized Vimeo HLS extraction.
   - If audio is inaccessible, returns actionable error with optional text-only proofreading fallback.
3. Backend segments audio into 5–10 minute chunks with 15–20s overlap and aligns matching cues.
4. Gemini Multimodal Audio generates candidate suggestions:
   ```json
   {
     "suggestions": [
       {
         "start_seconds": 82.4,
         "end_seconds": 83.1,
         "original_text": "Tata",
         "suggested_text": "data",
         "confidence": "medium",
         "reason": "The speaker audibly says 'data' in context."
       },
       {
         "start_seconds": 140.2,
         "end_seconds": 143.5,
         "original_text": "y equals mx plus c",
         "suggested_text": "$y = mx + c$",
         "confidence": "high",
         "reason": "Spoken mathematical formula converted to LaTeX."
       }
     ]
   }
   ```
5. Review drawer renders candidate cards:
   - **Play Audio**: Seeks video to `start_seconds - 2s` for acoustic verification.
   - **Diff View**: Strike-through original text (`<del>`), green replacement (`<ins>`).
   - **Accept / Dismiss / Undo**: One-click actions. Accepting invokes the canonical `update_cue` pipeline.

---

## Complete Database Schema Extensions

Add to `RelationalDBManager._init_postgres_schema` in `backend/database.py`:

```sql
-- 1. Track outdated status on summaries
ALTER TABLE lecturescribe_summaries 
ADD COLUMN IF NOT EXISTS is_outdated BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. AI Review Jobs tracking
CREATE TABLE IF NOT EXISTS lecturescribe_transcript_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
    review_mode VARCHAR(32) NOT NULL DEFAULT 'audio_grounded', -- 'audio_grounded' | 'text_only'
    status VARCHAR(32) NOT NULL, -- 'queued', 'processing', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Granular review suggestion candidates
CREATE TABLE IF NOT EXISTS lecturescribe_transcript_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES lecturescribe_transcript_reviews(id) ON DELETE CASCADE,
    video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
    cue_id INT REFERENCES lecturescribe_transcript_cues(id) ON DELETE CASCADE,
    start_seconds NUMERIC(10, 2) NOT NULL,
    end_seconds NUMERIC(10, 2) NOT NULL,
    original_text TEXT NOT NULL,
    suggested_text TEXT NOT NULL,
    suggestion_type VARCHAR(32) NOT NULL DEFAULT 'correction', -- 'correction' | 'math_latex'
    confidence VARCHAR(16) NOT NULL, -- 'high', 'medium', 'low'
    reason TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected'
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Interactive Book Annotations (Highlights, Margin Notes, Embedded AI)
CREATE TABLE IF NOT EXISTS lecturescribe_transcript_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    cue_id INT REFERENCES lecturescribe_transcript_cues(id) ON DELETE CASCADE,
    start_seconds NUMERIC(10, 2) NOT NULL,
    end_seconds NUMERIC(10, 2) NOT NULL,
    selected_text TEXT NOT NULL,
    annotation_type VARCHAR(32) NOT NULL, -- 'highlight', 'note', 'ai_explanation'
    color VARCHAR(16),                    -- 'yellow', 'green', 'blue', 'pink'
    note_text TEXT,                       -- User comment
    ai_prompt TEXT,                       -- If triggered by "Ask AI"
    ai_response TEXT,                     -- Model explanation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_user_vid 
    ON lecturescribe_transcript_annotations(user_email, video_id);
```

---

## Phased Implementation Roadmap

### Phase 1: Manual Cue Editing, Math Rendering & Summary Invalidation
1. **Database & API**:
   - Add `is_outdated` to `lecturescribe_summaries`.
   - Update `get_saved_video` in `backend/database.py` to return `id` and `seconds` on cue objects.
   - Add `db_manager.update_transcript_cue(video_id, cue_id, new_text)`.
   - Add `PATCH /api/lecture/{video_id}/cues/{cue_id}` in `backend/main.py` with Algolia, Pinecone, and Redis sync.
2. **Frontend Transcript UI**:
   - In `TranscriptSearch.jsx`: Render cue lines with inline KaTeX support (formulas like `$y = mx + c$` render automatically).
   - Add hover edit pencil icon, inline input/textarea, Save (Enter/✓), and Cancel (Esc/✕).
3. **Outdated Summary UI**:
   - In `Header.jsx` and `LectureWorkspace.jsx`: Display amber indicator on the Summary tab (`Summary ●`).
   - In `LectureSummary.jsx`: Display amber alert banner with one-click **"Regenerate Summary Now"**.

### Phase 2: Interactive Reader (Highlights, Margin Notes & Embedded AI)
1. **Annotation Storage & Endpoints**:
   - Implement `lecturescribe_transcript_annotations` in PostgreSQL.
   - Endpoints: `GET /api/lecture/{video_id}/annotations`, `POST /api/lecture/{video_id}/annotations`, `DELETE /api/lecture/{video_id}/annotations/{id}`.
2. **Text Selection Toolbar**:
   - Floating popover on cue text selection: Multi-color highlighter, Add Note, Ask AI.
3. **Margin Notes Drawer**:
   - Collapsible margin view displaying user notes with timestamp click-to-seek.
4. **Embedded Contextual AI**:
   - Endpoint: `POST /api/lecture/{video_id}/explain-selection` (Gemini Flash).
   - Inline expansion card with "Pin as Note" action.

### Phase 3: Audio-Grounded AI Review & Math Conversion Engine
1. **Audio Resolver & Chunking**:
   - Resolve audio from GCS or Vimeo HLS stream; chunk with `ffmpeg` (5–10 min with 15s overlap).
2. **Gemini Multimodal Audio Integration**:
   - Structured JSON schema prompt for both speech recognition corrections and spoken math $\to$ LaTeX formatting.
3. **Review Drawer UI**:
   - Review panel with audio seek jump, diff view, confidence tags, and one-click Accept/Dismiss/Undo.
   - Accepting an item calls the canonical Phase 1 `update_transcript_cue` pipeline.

---

## References

- [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini Files API](https://ai.google.dev/gemini-api/docs/files)
- [Gemini token counting](https://ai.google.dev/gemini-api/docs/tokens)
- [KaTeX documentation](https://katex.org/docs/supported.html)
- [OpenAI GPT-Audio-1.5 model details](https://developers.openai.com/api/docs/models/gpt-audio-1.5)
- [OpenAI audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions)
- [LectureScribe transcription service](../services/transcription/README.md)
