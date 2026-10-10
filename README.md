# 🎓 LectureScribe

> **Vimeo Video Lecture Transcript Extractor, Instant Search & AI RAG Tutor**
>
> **Triad + SLM-Routed Architecture:** **PostgreSQL** (Source of Truth) · **Algolia** (Instant Typo-Tolerant Search) · **Pinecone** (Dense Vector RAG) · **Local Ollama SLM Router** that automatically bifurcates user queries into a full-transcript **SUMMARY** path (hybrid-search / RRF bypassed) or a targeted **CHAT** path (Pinecone + Algolia + Reciprocal Rank Fusion + multi-step agent tool loop).

---

## ✨ Features

- ⚡ **Direct Vimeo Ingestion:** Ingests timestamped captions and video metadata directly from Vimeo API endpoints without headless browser rendering.
- 🔄 **Smart Caching & Deduplication:** Videos transcribed and summarized once are persisted to the database. Pasting the same Vimeo URL reuses existing transcripts and executive summaries with **0ms re-generation**.
- 🧠 **Local SLM Intent Router (Ollama):** A tiny local LLM (default: `qwen2.5:3b`) running on `http://localhost:11434` classifies every incoming message:
  - **SUMMARY intent:** Full, uncut transcript with `[MM:SS]` timestamps is piped straight to the cloud LLM in a single shot. **No Pinecone search, no Algolia search, no RRF fusion, no agent tool loop.** User never sees a truncated or chunked transcript.
  - **CHAT intent:** Existing Pinecone (dense) + Algolia (sparse) hybrid search with custom **Reciprocal Rank Fusion (RRF, k=60)** followed by a 4-step cloud-LLM agent tool loop (lecture outline, transcript search, transcript window, web search, final synthesis).
  - Router fail-safe: If Ollama is unreachable, every query falls back to CHAT (never to SUMMARY, so users never accidentally skip retrieval when they wanted a targeted answer).
- 🔍 **Algolia Instant Search:** Sub-10ms keyword search with full typo-tolerance across thousands of transcript cues. Clicking any cue jumps the Vimeo player directly to that timestamp.
- 🤖 **Pinecone Vector RAG Tutor + Agentic Tool Loop:** Semantic RAG chatbot powered by dense embeddings, an RRF-fused reranker, and a 4-step agent that can fetch the full lecture outline, search the transcript, pull a bounded time window, or ground itself against DuckDuckGo + Wikipedia. All answers carry clickable inline `[MM:SS]` timestamps and a pill-bar of structured citations.
- 📊 **Structured Executive AI Summaries:** Automatically generates structured takeaway sections (Course Structure, Core Concepts, Thrust Areas, Q&A) on every ingest — reused on all future loads.
- 🎬 **Embedded Vimeo Player Integration:** Synchronized video playback using `@vimeo/player` SDK with active cue highlighting during playback.
- 🧩 **Chrome Browser Extension:** 1-click Vimeo video capture from any LMS (Canvas, Blackboard, Coursera, Moodle) or webpage with floating on-player action badges and instant workspace sync.
- 💾 **Relational Database:** Persistent storage powered directly by Cloud PostgreSQL (Neon DB / Supabase / RDS) for multi-user libraries, transcripts, and full chat history with per-message model tags.
- 🚀 **Hosted Redis Query Cache:** Optional Upstash / Redis Cloud / local Redis with configurable 30-day TTL — identical repeat queries return in **<1 ms**.
- 🧾 **Academic Submission Mode:** Every AI answer includes a condensed 100–150 word graduate-tone submission with word-count badge and 1-click copy, so students can paste directly into assignment responses.
- 🌐 **Web Grounding Toggle:** Per-chat switch to enable/disable free DuckDuckGo + Wikipedia grounding (no paid search API required).
- 📥 **Download to Device:**
  - Direct progressive MP4 downloads when available.
  - Multi-bitrate Adaptive HLS stream extraction (`.m3u8`) with 1-click terminal commands (`yt-dlp`, `ffmpeg`, `vlc`).
  - Instant browser downloads for `transcript.md`, `summary.md`, and `captions.vtt`.
- ☁️ **Download to Cloud (Google Drive Full Bundle):**
  - Asynchronous background export creating a dedicated Google Drive folder: `LectureScribe - <Title> (<VideoId>)`.
  - Packages the **Full Bundle:** `summary.md`, `transcript.md`, `captions.vtt`, `metadata.json`, and `download_guide.txt`.
  - Real-time progress tracking bar and direct clickable Google Drive web link upon completion.
- 📚 **Automated Course Reading & Textbook Extraction (`extract-readings`):**
  - Synthesizes all video lecture transcripts and uploaded slide decks (`.pptx`, `.pdf`) across a course.
  - Employs an LLM extraction cascade (Groq → Gemini → OpenAI/Ollama) to extract textbooks, reference books, ebooks, and journal papers mentioned by the professor.
  - Automatically enriches each reading with covers, ISBNs, and interactive flip-book digital readers via **Internet Archive**, **OpenLibrary**, and **Google Books**.
- 📁 **Course Resources Multi-File Direct Upload:**
  - Direct browser-to-bucket uploading of slides, PDFs, notes, and datasets to Google Cloud Storage via secure V4 signed URLs.
  - Supports multi-file selection, batch drag-and-drop, and real-time upload progress tracking.

---

## 🏗️ System Architecture

### SLM-Routed Execution Flow

```
                     ┌──────────────────────────────┐
                     │  User query (chat message)   │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
                ┌────────────────────────────────────┐
                │  Local Ollama SLM Intent Router    │
                │  (classify_intent: SUMMARY|CHAT)   │  ← localhost:11434, temp=0, max_tokens=3
                └──────────────┬──────────┬─────────┘
                               │          │
              ┌──── SUMMARY ────┘          └──── CHAT ────┐
              ▼                                            ▼
 ┌──────────────────────────────┐    ┌────────────────────────────────────────┐
 │  Full transcript from PG     │    │ Pinecone (dense)  top_k=10             │
 │  ALL cues joined with        │    │ Algolia  (sparse) top_k=10             │
 │  "[MM:SS] Caption text..."   │    │   ↓ Reciprocal Rank Fusion (RRF k=60)  │
 │         │                    │    │   ↓ Top-K selection                    │
 │         ▼                    │    │ 4-step LLM agent tool loop:            │
 │  Single-shot cloud LLM call  │    │  ① get_lecture_outline (PG + DB)       │
 │  (no tools, no loop, no RAG) │    │  ② search_transcript (Pinecone+Algolia)│
 │  System+User prompt with     │    │  ③ get_transcript_window (PG filter)   │
 │  complete timestamped text   │    │  ④ search_web_context (DDG+Wikipedia)  │
 │         │                    │    │  ⑤ Final synthesis → answer            │
 └─────────┼────────────────────┘    └────────────────┬───────────────────────┘
           │                                           │
           └─────────────────┬─────────────────────────┘
                             ▼
            Shared post-processing (identical for both branches):
             • generate_submission_version() → 100–150 word grad submission
             • save_chat_log()               → PostgreSQL chat_history table
             • redis_cache.set_query()       → Hosted Redis 30-day TTL cache
             • HTTP JSON response (same schema for both branches)
```

### Triad Storage Layer

```
                   ┌─────────────────────────┐
                   │    Vimeo Video URL      │
                   └───────────┬─────────────┘
                               │
                               ▼
                   ┌─────────────────────────┐
                   │  LectureScribe Backend  │
                   │      (FastAPI)          │
                   └─────┬───────┬───────┬───┘
                         │       │       │
     ┌───────────────────┘       │       └───────────────────────┐
     ▼                           ▼                               ▼
┌──────────────┐        ┌────────────────┐              ┌────────────────┐
│ Relational DB│        │ Algolia Search │              │  Pinecone RAG  │
│  PostgreSQL  │        │ Instant Keyword│              │ Vector Search  │
│ Source of Truth       │  & Typo-Search │              │ & Grounded Q&A │
│ Cues, Chat,          │ (sparse index)  │              │ (dense index)  │
│ Summaries, Lib       └────────────────┘              └────────────────┘
└──────────────┘
       │
       └────── Hosted Redis (Upstash) → <1ms query-response cache
```

1. **Relational Database (PostgreSQL):**
   - Stores video metadata, transcript cues, executive summaries, and chat history in Cloud PostgreSQL.
   - Also stores per-ingest `summarySections` used by the agent's `get_lecture_outline` tool.
2. **Algolia Cloud Search Index:**
   - Powers the search drawer with instant filtering across timestamped transcript cues.
   - Acts as the sparse (BM25-style) leg of the hybrid search in the CHAT branch.
3. **Pinecone Vector Database:**
   - Stores dense transcript chunk embeddings (custom 768-dim hash embedding) to enable semantic question answering (the dense leg of hybrid search in CHAT).
4. **Hosted Redis:**
   - Optional query-level cache on `POST /api/rag/query` and `POST /api/chat` with configurable TTL.
5. **Local Ollama SLM:**
   - Binary intent classifier; SUMMARY/CHAT routing. No cloud API calls, local-only, deterministic temperature=0.
6. **Multi-Provider Cloud LLM Cascade (for both SUMMARY & CHAT paths):**
   - Priority: **Groq (Llama 3.3 70B)** → **Hugging Face (Llama 3.1 8B)** → **Gemini 2.0 Flash** → **OpenAI GPT-4o-mini**.
   - Server startup and `/health` proactively probe every configured provider and print reachability + latency, so you never see a 502 at query-time without a warning at boot.

### 📚 Course Reading & Textbook Extraction Pipeline (`/api/course/{course_name}/extract-readings`)

LectureScribe automatically detects, extracts, verifies, and embeds academic reading materials (textbooks, reference volumes, research papers, and syllabi) cited across an entire course curriculum.

```
                  ┌──────────────────────────────────────────────┐
                  │ POST /api/course/{course_name}/extract-readings │
                  └──────────────────────┬───────────────────────┘
                                         │
        ┌────────────────────────────────┴──────────────────────────────┐
        ▼                                                               ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│ 1. Transcripts Aggregation    │               │ 2. Professor Slide Decks      │
│ • First 40 cues (syllabus /   │               │ • Download .pptx / .pdf bytes │
│   recommended readings intro) │               │ • Extract slide titles, text, │
│ • Last 20 cues (assignments)  │               │   and bibliography slides     │
└───────────────┬───────────────┘               └───────────────┬───────────────┘
                │                                               │
                └───────────────────────┬───────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │ 3. LLM Extraction Cascade                           │
             │ Prompt: Extract structured JSON of textbooks & refs │
             │ Priority: Groq → Gemini → OpenAI/Ollama             │
             │ Resilient JSON recovery & sanitization              │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │ 4. Multi-Source Digital Book Reader Resolver        │
             │ ① Internet Archive (unrestricted full-access embed) │
             │ ② OpenLibrary API (covers, metadata, Lending Lib)   │
             │ ③ Google Books API (covers, preview & embed viewer) │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │ 5. Database Persistence & Frontend Presentation     │
             │ • Saves to lecturescribe_course_readings            │
             │ • Deduplicates by normalized title                  │
             │ • Interactive BookReaderModal with embedded reader  │
             │ • Web search fallback for open-access papers/PDFs   │
             └─────────────────────────────────────────────────────┘
```

#### How the Pipeline Works Step-by-Step:

1. **Multimodal Source Aggregation**:
   - **Lecture Transcripts**: Retrieves up to 15 lectures associated with the canonical course name or URL slug. Focuses on the introductory cues (first 40 cues, where professors typically outline course syllabus, required textbooks, and author names) plus closing cues (reading assignments).
   - **Professor Slide Decks**: Gathers uploaded course presentation documents (`.pptx`, `.ppt`, `.pdf`). Uses `python-pptx` and `pypdf` to extract text from slides, specifically targeting course overview, syllabus, reading lists, and bibliography slides.

2. **LLM Extraction with Multi-Model Fallback Cascade**:
   - The compiled context is passed to the LLM extraction cascade with a specialized academic curriculum extraction prompt.
   - **Model Cascade**: **Groq** (`gpt-oss-120b`, `gpt-oss-20b`, `qwen3.8-27b`) → **Gemini** (`gemini-3.5-flash-lite`, `gemini-3.5-flash`) → **OpenAI/Ollama**.
   - **Extracted Fields**:
     - `title`: Full official textbook or paper title.
     - `author`: Primary author(s), editor(s), or research group.
     - `edition`: Edition number, publication year, or volume.
     - `reading_type`: `'book'`, `'ebook'`, `'journal'`, or `'paper'`.
     - `category`: `'primary_textbook'`, `'reference'`, or `'supplementary'`.
     - `source_context`: Timestamp or slide name where the professor mentioned it (e.g. `Lecture 1 [04:15] & Intro.pptx`).
   - **Resilient Parsing**: `_parse_readings_json()` handles raw JSON, markdown-fenced blocks, and regex recovery of individual objects if responses contain trailing commentary.

3. **Multi-Source Digital Book & Reader Resolution**:
   - Extracted items are cross-referenced across three public digital library providers:
     - **Internet Archive (Full Access)**: Searches for unrestricted public-domain and open-access books, producing an embedded in-page reader (`embed_url`) with virtual page flipping.
     - **Internet Archive (Controlled Digital Lending)**: Identifies 1-hour borrowable library loans with direct reader previews.
     - **OpenLibrary API**: Retrieves verified ISBNs and high-resolution book covers (`https://covers.openlibrary.org/b/id/...`).
     - **Google Books API**: Fallback provider for official book cover art, preview links, and embeddable front-cover viewers.

4. **Persistence & Incremental vs. Full Regeneration**:
   - Verified readings are saved to the `lecturescribe_course_readings` table.
   - By default (`regenerate=false`), extraction is incremental: newly identified readings are added without duplicating existing entries.
   - Supplying `?regenerate=true` clears prior course readings and re-extracts the entire reading list from scratch.

5. **In-App Digital Reader & Web Discovery**:
   - Clicking **Read Book** opens the integrated **BookReaderModal** with full-screen, page-flipper, and print previews.
   - Clicking **Search Web** triggers DuckDuckGo queries for open-access textbook PDFs and university repository preprints.

---

## 🚀 How to Run the Project

### 0. Prerequisites

| Component | Minimum Version | Required? |
|---|---|---|
| Python | 3.10+ | ✅ Required |
| Node.js | 18+ (LTS recommended) | ✅ Required |
| npm | 9+ (bundled with Node) | ✅ Required |
| PostgreSQL | 13+ (Neon / Supabase / RDS / local) | ✅ Required |
| Ollama | 0.3+ | ⚠️ Recommended (SLM router; without it everything defaults to CHAT) |
| Algolia account + app + index | — | ⚠️ Recommended; without it CHAT falls back to Pinecone only |
| Pinecone account + index | — | ⚠️ Recommended; without it CHAT falls back to Algolia + local chunks |
| Redis (local or Upstash / Redis Cloud) | — | Optional; caching is silently bypassed when missing |
| Google Cloud OAuth client ID (for Drive export) | — | Optional |

---

### 1. Clone & Environment Setup

```bash
# 1. Clone the repository
git clone git@github.com:<your-org>/lecturescribe.git
cd lecturescribe

# 2. Copy the environment template and EDIT the file
cp .env.example .env
# ← Open .env in an editor and fill in at least:
#     DATABASE_URL
#     At least ONE cloud LLM key: GROQ_API_KEY (preferred) or HUGGINGFACE_TOKEN or GEMINI_API_KEY or OPENAI_API_KEY
#     (Optional but strongly recommended) PINECONE_API_KEY, ALGOLIA_APP_ID + ALGOLIA_API_KEY
```

See **Appendix A — Environment Variables Reference** at the bottom for the complete list.

---

### 2. (Recommended) Start the Local Ollama SLM Router

Without Ollama, the SLM router function still runs but always returns `CHAT` (safe fallback, never breaks, no exceptions). For SUMMARY-vs-CHAT auto-routing to actually engage:

```bash
# 1. Install Ollama → https://ollama.com/download  (macOS, Linux, Windows all supported)

# 2. Pull the default model used by the router (3B params, tiny ~1.6GB, fast on CPU):
ollama pull qwen2.5:3b

# 3. Start the Ollama server in the background (or launch the GUI app on mac/windows):
#    (it listens on http://localhost:11434 by default — the backend expects this URL)
ollama serve

# 4. Verify:
curl -s http://localhost:11434/api/tags | head -c 400
# → you should see JSON listing qwen2.5:3b
```

To use a *different* local model (e.g. `llama3.2:3b`):
```bash
ollama pull llama3.2:3b
# Then add to .env:
echo "OLLAMA_MODEL=llama3.2:3b" >> .env
```

---

### 3. Start the Backend (FastAPI, Python)

```bash
cd lecturescribe   # repo root

# 3a. Create & activate a virtual environment
python3 -m venv .venv
# Linux / macOS:
source .venv/bin/activate
# Windows PowerShell:
#   .venv\Scripts\Activate.ps1
# Windows CMD:
#   .venv\Scripts\activate.bat

# 3b. Install Python dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt

# 3c. Start the FastAPI server with hot reload on port 8000
uvicorn backend.main:app --reload --port 8000
```

#### What you should see in the terminal at boot:

```
============================================================
🚀 LectureScribe Triad Server Starting Up...
============================================================
📦 [1/4] Verifying Relational DB (PostgreSQL)...
✅ [Database Startup] PostgreSQL database ready.
🌲 [2/4] Verifying/Creating Pinecone Vector Index...
🔍 [3/4] Verifying/Configuring Algolia Search Index...
🤖 [4/4] Probing Cloud LLM Providers & Local Ollama SLM...
   Active cloud provider: groq
   Cloud LLMs reachable:  2/3
   ✅ [        groq] Groq Llama 3.3 70B              108ms
   ⚠️ [ huggingface] Hugging Face Llama 3.1 8B       4002ms  — ConnectTimeout
   ✅ [      gemini] Gemini 2.0 Flash                 215ms
   ✅ [ollama-slm  ] Ollama Local SLM (qwen2.5:3b)    11ms
============================================================
✨ All Engines, Indexes & LLM Providers Ready!
============================================================
```

If any LLM provider line shows `⚠️`, click the printed error message (usually a timeout or missing key) and correct it — the boot **does not abort** on probe failures (fail-soft: the agent fall-through cascade will try the next provider at query time).

#### Verify backend health:

```bash
# In a second terminal:
curl -s http://localhost:8000/health | python3 -m json.tool
# → observe the new "llm_providers" section with every provider's configured/reachable/latency status
```

- **Swagger UI (interactive API docs):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Redoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

### 4. Start the Frontend (React + Vite)

```bash
# New terminal, in repo root:
cd frontend

# 4a. Install Node dependencies
npm install

# 4b. (Optional) Copy frontend env template if needed:
# cp .env.example .env.production   # only edit if deploying to a custom API URL

# 4c. Start the Vite dev server on port 5173
npm run dev
```

Vite automatically proxies `/api/*` requests to `http://localhost:8000` (see `frontend/vite.config.js`). If you run the backend on a different host/port, edit `frontend/.env.production` and set `VITE_API_BASE`.

Open the app: [http://localhost:5173](http://localhost:5173)

#### Quick smoke test:
1. In the AI Tutor, click the preset quick prompt **"Generate Summary for 30 mins read"**.
2. In the backend terminal you should see:
   ```
   🧭 [SLM Router /api/rag/query] Intent classified as: SUMMARY
   📜 [Full-Transcript Summary Engine] Initializing … Target Video: '…'
   ✅ [Full-Transcript Summary Engine] Completed in X.XXs
   ```
3. Ask a specific question (e.g. *"What is backpropagation?"*). Log should show:
   ```
   🧭 [SLM Router /api/rag/query] Intent classified as: CHAT
   …followed by the Pinecone / Algolia / RRF / 4-step agent lines…
   ```

---

### 5. Run the Test Suites

```bash
# ----- Python backend tests (pytest, repo root) -----
#   Activate venv first, then:
pytest tests/ -v
#   Single-file: pytest tests/test_api_health.py -v
#   Includes: health endpoint, transcript ingest, RAG, caching, submission generation, summary generator, Vimeo client.

# ----- Frontend tests (Vitest, ./frontend/) -----
cd frontend && npm run test
#   Components: HeroBanner, AITutor, LecturePlayer, CourseGrid, MarkdownWithTimestamps, etc.
#   Hooks: useAITutor, useGoogleAuth, useLectureIngestion, useUserLibrary, etc.
#   Utils: formatters, routing.
```

---

### 6. Run Everything with Docker (Optional)

```bash
# Build & run the production FastAPI container (repo root Dockerfile):
docker build -t lecturescribe-backend .
docker run --rm -p 8000:8000 --env-file .env lecturescribe-backend

# The frontend can be deployed to any static host or served with:
cd frontend && npm run build && npx serve -s dist -l 5173
```

Backend-specific containerfile also lives at `backend/Dockerfile` for deploys that push the backend subdir only.

---

## 📂 Project Structure

```
lecturescribe/
├── backend/
│   ├── main.py                   # FastAPI: /health, transcript endpoints, /api/rag/query, /api/chat, download, Drive export
│   │                             #   · LIFESPAN: boot-checks Postgres + Pinecone + Algolia + **LLM providers + Ollama**
│   │                             #   · SLM router wrapper: if SUMMARY → full-transcript cloud call, else → CHAT agent loop
│   ├── rag_engine.py             # Pinecone ingest + embedding, Reciprocal Rank Fusion (RRF k=60), 4-step LLM agent tool loop
│   │                             #   · generate_full_transcript_summary()  (NEW — SUMMARY branch, single-shot, no retrieval)
│   │                             #   · check_llm_connectivity()           (NEW — boot + /health LLM/Ollama probe)
│   ├── slm_router.py             # NEW — Local Ollama binary classifier: slm_classify_intent() → SUMMARY | CHAT
│   ├── database.py               # PostgreSQL manager, cues/chat/summaries tables, L1 cache, course library
│   ├── summary_generator.py      # Per-ingest structured summary + summarySections generator
│   ├── algolia_service.py        # Algolia sparse index ingest + search (CHAT branch sparse leg, transcript drawer)
│   ├── redis_service.py          # Hosted Redis query cache client, ping / status, TTL config
│   ├── reading_extractor.py      # Extract course textbooks/readings from transcripts & slides, digital reader resolver
│   ├── gcs_storage.py            # Google Cloud Storage resources bucket upload (V4 signed URLs)
│   ├── google_drive_service.py   # Google Drive 1-click full-bundle background export
│   ├── vimeo_client.py           # Vimeo player config, manifest, WebVTT caption + stream extractor
│   ├── web_search.py             # Free DuckDuckGo + Wikipedia grounding (no paid key)
│   └── Dockerfile                # Backend-only container
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/           # MarkdownWithTimestamps (parses inline [MM:SS] → clickable chips), GoogleIcon
│   │   │   ├── lecture/          # AITutor (chat UI, citations pill-bar, submission mode, web refs), LecturePlayer, TranscriptSearch, LectureResourcesShelf
│   │   │   ├── views/            # HomeView, LectureWorkspace, LoadingView
│   │   │   ├── course/           # CourseGrid, CourseLectures, CourseMaterials, CourseLibrary, CourseTutor
│   │   │   ├── home/             # HeroBanner, QuickAddBar
│   │   │   ├── layout/           # Header
│   │   │   └── modals/           # DownloadModal, UploadResourceModal, BookReaderModal, ResourcePreviewModal
│   │   ├── hooks/
│   │   │   └── useAITutor.js     # handleSendMessage → POST /api/rag/query, response → botMsg schema
│   │   ├── store/themeStore.js   # Zustand theme store (light/dark)
│   │   ├── utils/                # formatters (cleanSubmissionFallback, timestamps, sizes, routing)
│   │   ├── App.jsx               # Top-level routing, Google OAuth, workspace layout
│   │   └── main.jsx / index.css
│   ├── package.json              # React 18, Vite 5, @vimeo/player, react-markdown, lucide-react, zustand, vitest
│   ├── vite.config.js            # /api proxy to http://localhost:8000
│   └── vitest.config.js          # JSDOM test runner
├── tests/                        # pytest suite (api health, transcript, caching, submission, services)
├── docs/
│   ├── AGENT_HANDOFF_RRF_RAG.md  # RRF hybrid-search design document
│   └── REDIS_CACHING_STRATEGY.md # Caching layer design document
├── .github/workflows/            # CI + backend deploy YAMLs
├── .env.example                  # Environment variables template
├── requirements.txt              # Python deps (FastAPI, Uvicorn, OpenAI-compatible LLM clients, Pinecone, Algolia, psycopg2, redis, yt-dlp, static-ffmpeg…)
├── pytest.ini                    # pytest discovery config
├── Dockerfile                    # Repo-root Dockerfile (backend)
├── vercel.json                   # Deployment configs
├── cors.json                     # Cloud storage CORS template
└── README.md
```

---

## 📋 Reference — Scripts & Commands

| Action | Command | From dir |
|---|---|---|
| Start FastAPI backend with reload | `uvicorn backend.main:app --reload --port 8000` | repo root (venv active) |
| Start Vite frontend | `npm run dev` | `frontend/` |
| Production build frontend | `npm run build` | `frontend/` |
| Run all Python tests | `pytest tests/ -v` | repo root (venv active) |
| Run all frontend tests | `npm run test` | `frontend/` |
| Check server health + LLM probe | `curl -s http://localhost:8000/health \| python3 -m json.tool` | any shell |
| Pull + serve default SLM router | `ollama pull qwen2.5:3b && ollama serve` | any shell |
| Trigger course reading extraction | `curl -X POST "http://localhost:8000/api/course/<course_slug>/extract-readings?regenerate=false"` | any shell |
| Fetch course readings | `curl -s "http://localhost:8000/api/course/<course_slug>/readings" \| python3 -m json.tool` | any shell |
| Build backend docker image | `docker build -t lecturescribe-backend .` | repo root |

---

## Appendix A — Environment Variables Reference

Copy `.env.example` to `.env` and set the values below. Only **bolded** variables are required to boot; everything else fails gracefully with a `⚠️` warning at startup but keeps the server usable.

### Required

| Variable | Example | Description |
|---|---|---|
| **`DATABASE_URL`** | `postgresql://user:pw@host/db?sslmode=require` | PostgreSQL (Neon / Supabase / RDS / local). Source of truth for all cues, chats, summaries, libraries. |

### Cloud LLMs (at least one required for CHAT and SUMMARY to return answers)

Priority order the agent uses is: **Groq → Hugging Face → Gemini → OpenAI**. Set whichever keys you have; the cascade tries them in order.

| Variable | Example | Notes |
|---|---|---|
| `GROQ_API_KEY` | `gsk_…` | Fastest path. Recommended default. |
| `HUGGINGFACE_TOKEN` (or `HF_TOKEN`) | `hf_…` | Used for Llama 3.1 via HF Router or InferenceClient. |
| `GEMINI_API_KEY` | `AIza…` | Gemini 2.0 Flash (Google). |
| `OPENAI_API_KEY` | `sk-…` | GPT-4o-mini fallback. |

### Local SLM Router (Ollama)

| Variable | Default | Notes |
|---|---|---|
| `OLLAMA_API_BASE` | `http://localhost:11434/v1` | OpenAI-compatible Ollama endpoint. |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Small model pulled via `ollama pull <name>`. Any local Ollama model works. |
| `OLLAMA_API_KEY` | `ollama` | Dummy key used for the OpenAI client handshake; no auth unless you configured Ollama to use one. |

### Triad Storage Layer

| Variable | Recommended | Notes |
|---|---|---|
| `PINECONE_API_KEY` | Yes | Pinecone dense embeddings. |
| `PINECONE_INDEX` | `lecturescribe-rag-index` | Pinecone index name. Created if it doesn't exist at boot. |
| `PINECONE_NAMESPACE` | `lecturescribe_v1` | Pinecone namespace. |
| `ALGOLIA_APP_ID` | Yes | Algolia sparse search app ID. |
| `ALGOLIA_API_KEY` | Yes | Algolia admin API key (used to ingest + search). |
| `ALGOLIA_INDEX_NAME` | `lecturescribe_transcripts_v1` | Algolia index name. Settings + schema applied at boot. |

### Cache & Storage

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | (unset = cache bypassed) | `redis://user:pw@host:port`. Supports Upstash, Redis Cloud, Memorystore, local. |
| `REDIS_CACHE_ENABLED` | `true` | Set `false` to skip caching even when `REDIS_URL` is set. |
| `REDIS_CACHE_TTL_DAYS` | `30` | How long query responses stay cached. |
| `GCS_RESOURCES_BUCKET` | `lecturescribe-resources` | GCS bucket for user-uploaded lecture resources (PDFs, slides, links). |

### Google Drive Export

| Variable | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` | Web client ID from Google Cloud Console OAuth 2.0 → Web Application. Required authorized origin: `http://localhost:5173`. |

### Misc / Ops

| Variable | Default | Notes |
|---|---|---|
| `WARMUP_VIDEO_ID` | (unset) | Optional. If set, the server ingests cues + embeds this video ID into Pinecone + Algolia during boot (useful on deployments to avoid cold-start on a popular lecture). |
| `VIMEO_TOKEN` | (unset) | Optional. Adds higher rate limits / private-video caption access when reading from Vimeo. |

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
