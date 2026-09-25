# 🎓 LectureScribe

> **Vimeo Video Lecture Transcript Extractor, Instant Search & AI RAG Tutor**  
> Powered by a Triad Architecture: **PostgreSQL/SQLite** + **Algolia Instant Search** + **Pinecone Vector RAG**.

---

## ✨ Features

- ⚡ **Direct Vimeo Ingestion**: Ingests timestamped captions and video metadata directly from Vimeo API endpoints without headless browser rendering.
- 🔄 **Smart Caching & Deduplication**: Videos transcribed and summarized once are persisted to the database. Pasting the same Vimeo URL reuses existing transcripts and executive summaries with **0ms re-generation**.
- 🔍 **Algolia Instant Search**: Sub-10ms keyword search with full typo-tolerance across thousands of transcript cues. Clicking any cue jumps the Vimeo player directly to that timestamp.
- 🤖 **Pinecone Vector RAG Tutor**: Semantic RAG chatbot powered by dense embeddings and Llama-3.2, providing grounded answers with clickable timestamp citations.
- 📊 **Structured Executive AI Summaries**: Automatically generates structured takeaway sections (Course Structure, Core Concepts, Thrust Areas, Q&A).
- 🎬 **Embedded Vimeo Player Integration**: Synchronized video playback using `@vimeo/player` SDK with active cue highlighting during playback.
- 💾 **Dual-Layer Database**: Seamless persistence using local SQLite (`lecturescribe.db`) with automatic remote Cloud PostgreSQL (Neon DB) synchronization when configured.
- 📥 **Option 1: Download to Device**:
  - Direct progressive MP4 downloads when available.
  - Multi-bitrate Adaptive HLS stream extraction (`.m3u8`) with 1-click terminal commands (`yt-dlp`, `ffmpeg`, `vlc`).
  - Instant browser downloads for `transcript.md`, `summary.md`, and `captions.vtt`.
- ☁️ **Option 2: Download to Cloud (Google Drive Full Bundle)**:
  - Asynchronous background export creating a dedicated Google Drive folder: `LectureScribe - <Title> (<VideoId>)`.
  - Packages the **Full Bundle**: `summary.md`, `transcript.md`, `captions.vtt`, `metadata.json`, and `download_guide.txt`.
  - Real-time progress tracking bar and direct clickable Google Drive web link upon completion.


---

## 🏗️ Triad Architecture

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
       ┌──────────────────┘       │       └──────────────────┐
       ▼                          ▼                          ▼
┌──────────────┐         ┌────────────────┐         ┌────────────────┐
│ Relational DB│         │ Algolia Search │         │  Pinecone RAG  │
│Postgres/SQLite         │ Instant Keyword│         │ Vector Search  │
│Source of Truth         │  & Typo-Search │         │ & Grounded Q&A │
└──────────────┘         └────────────────┘         └────────────────┘
```

1. **Relational Database (PostgreSQL / SQLite)**:
   - Stores video metadata, transcript cues, executive summaries, and chat history.
   - Uses local SQLite (`lecturescribe.db`) by default with zero setup, falling back or syncing with Cloud PostgreSQL.
2. **Algolia Cloud Search Index**:
   - Powers the search drawer with instant filtering across timestamped transcript cues.
3. **Pinecone Vector Database**:
   - Stores dense transcript chunk embeddings to enable semantic question answering.

---

## 🚀 Quick Start

### 1. Prerequisites & Environment Setup

Copy the example environment configuration:

```bash
cp .env.example .env
```

Edit `.env` to configure your API keys (Algolia, Pinecone, HuggingFace/Llama, PostgreSQL). If PostgreSQL credentials are omitted, LectureScribe automatically defaults to local SQLite (`lecturescribe.db`).

### 2. Backend Setup (Python venv & FastAPI)

Create and activate an isolated Python virtual environment:

```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
# On Linux/macOS:
source .venv/bin/activate
# On Windows (Command Prompt / PowerShell):
# .venv\Scripts\activate

# Upgrade pip and install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start the API server on port 8000
uvicorn backend.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000` (Swagger docs at `http://localhost:8000/docs`).

### 3. Frontend Setup (React + Vite)

```bash
cd frontend

# Install Node dependencies
npm install

# Start Vite dev server on port 5173
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 📂 Project Structure

```
lecturescribe/
├── backend/
│   ├── main.py                 # FastAPI endpoints (Transcripts, Search, RAG, Downloads, Cloud Export)
│   ├── database.py             # Unified SQLite & PostgreSQL database manager + L1 cache
│   ├── summary_generator.py    # Dynamic transcript-driven summarizer & topic segmenter
│   ├── algolia_service.py      # Algolia instant search indexing & query service
│   ├── rag_engine.py           # Pinecone vector retrieval & Llama-3.2 inference engine
│   ├── vimeo_client.py         # Vimeo player config, stream manifest & caption extractor
│   └── google_drive_service.py # Google Drive client, folder generator & background bundle uploader
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # React app (Player, Algolia Search, Summary, RAG, Export Modal)
│   │   ├── main.jsx            # React root entry
│   │   └── index.css           # Dark theme styling & Vimeo branding
│   ├── package.json            # Node dependencies (@vimeo/player, lucide-react, etc.)
│   └── vite.config.js          # Vite configuration with /api proxy to backend
├── .env.example                # Environment variables template
├── .gitignore                  # Ignored dependencies, caches, and secrets
├── requirements.txt            # Python dependencies
└── README.md                   # Project documentation
```

---

## 📄 License

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
