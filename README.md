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

---

## 🏛️ Triad Architecture

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
│   ├── main.py              # FastAPI endpoints (/api/transcript, /api/search, /api/rag/query)
│   ├── database.py          # Unified SQLite & PostgreSQL database manager + L1 cache
│   ├── algolia_service.py   # Algolia instant search indexing & query service
│   ├── rag_engine.py        # Pinecone vector retrieval & Llama-3.2 inference engine
│   └── vimeo_client.py      # Vimeo player config & caption extraction client
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # React app (Player, Algolia Search, Summary, RAG Chatbot)
│   │   ├── main.jsx         # React root entry
│   │   └── index.css        # Dark theme styling & Vimeo branding
│   ├── package.json         # Node dependencies (@vimeo/player, lucide-react, etc.)
│   └── vite.config.js       # Vite configuration with /api proxy to backend
├── .env.example             # Environment variables template
├── .gitignore               # Ignored dependencies, caches, and secrets
├── requirements.txt         # Python dependencies
└── README.md                # Project documentation
```

---

## 📄 License

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
