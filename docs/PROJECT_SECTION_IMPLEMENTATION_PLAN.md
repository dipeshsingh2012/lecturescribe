# Project Section Implementation Plan

## Overview
Add a new "Project" section to LectureScribe that is independent from courses/lectures, allowing users to collect and manage project-related artifacts (PDFs, code, datasets, presentations) with full RAG chat capabilities.

---

## 1. Database Schema (Backend)

### Tables to Add

**`lecturescribe_projects`**
- `id` (SERIAL PRIMARY KEY)
- `project_id` (VARCHAR(128) UNIQUE) - Human-readable ID like "mtech-thesis-2024"
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `user_email` (VARCHAR(255) NOT NULL)
- `status` (VARCHAR(32) DEFAULT 'active')
- `created_at`, `updated_at` (TIMESTAMP)
- Indexes: user_email, status

**`lecturescribe_project_artifacts`**
- `id` (SERIAL PRIMARY KEY)
- `artifact_id` (VARCHAR(128) UNIQUE)
- `project_id` (VARCHAR(128) FK → projects)
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `artifact_type` (VARCHAR(32)) - 'pdf', 'code', 'dataset', 'presentation', 'other'
- `file_name` (VARCHAR(512))
- `file_url` (TEXT) - GCS or local URL
- `file_size_bytes` (BIGINT)
- `blob_name` (VARCHAR(512)) - GCS blob name
- `metadata` (JSONB) - Custom metadata
- `created_at`, `updated_at`
- Indexes: project_id, artifact_type

**`lecturescribe_project_chat_logs`**
- `id` (SERIAL PRIMARY KEY)
- `project_id` (VARCHAR(128) FK → projects)
- `user_prompt` (TEXT NOT NULL)
- `ai_reply` (TEXT NOT NULL)
- `citations_json` (JSONB)
- `user_email` (VARCHAR(255))
- `model` (VARCHAR(128))
- `created_at` (TIMESTAMP)
- Indexes: project_id, user_email

---

## 2. Backend API Endpoints

### Project CRUD
- `POST /api/projects` - Create new project
- `GET /api/projects` - List all projects for user
- `GET /api/projects/{project_id}` - Get project details
- `PUT /api/projects/{project_id}` - Update project metadata
- `DELETE /api/projects/{project_id}` - Delete project (cascade artifacts)

### Artifact Management
- `POST /api/projects/{project_id}/artifacts` - Upload artifact (direct-to-GCS via signed URL)
- `GET /api/projects/{project_id}/artifacts` - List all artifacts
- `GET /api/projects/{project_id}/artifacts/{artifact_id}` - Get artifact details
- `DELETE /api/projects/{project_id}/artifacts/{artifact_id}` - Delete artifact
- `PUT /api/projects/{project_id}/artifacts/{artifact_id}` - Update artifact metadata

### RAG/Chat Integration
- `POST /api/projects/{project_id}/rag/query` - Query project artifacts with RAG
- `GET /api/projects/{project_id}/chat/history` - Get chat history
- `POST /api/projects/{project_id}/chat` - Send chat message

### Artifact Processing
- Need to extend existing RAG pipeline to handle different artifact types:
  - PDFs: Extract text, chunk, embed
  - Code: Parse syntax, extract functions/classes, embed
  - Datasets: Extract schema, sample data, embed metadata
  - Presentations: Extract slide text, embed

---

## 3. Frontend Components

### Routing Updates
**`frontend/src/utils/routing.js`**
- Add project route parsing: `/project/{project_id}`
- Add helper: `getProjectIdFromPath()`

### New Components
**`frontend/src/components/views/ProjectWorkspace.jsx`**
- Main project view with tabs: Artifacts, AI Tutor, Settings
- Artifact grid/list view
- Upload button (triggers signed URL flow)
- AI Tutor chat interface (reuse AITutor component)
- Project metadata editing

**`frontend/src/components/project/ProjectGrid.jsx`**
- Display all projects in card/grid format
- Show project thumbnail, title, artifact count, last updated
- Click to navigate to ProjectWorkspace

**`frontend/src/components/project/ArtifactCard.jsx`**
- Display individual artifact
- Show file type icon, name, size, upload date
- Actions: Download, Delete, View (if previewable)

**`frontend/src/components/project/UploadArtifactModal.jsx`**
- Modal for uploading new artifacts
- File selection with drag-drop
- Artifact type selection
- Title/description input
- Progress indicator during upload

### Hooks
**`frontend/src/hooks/useProjects.js`**
- Fetch user's projects
- Create/update/delete projects
- Manage project state

**`frontend/src/hooks/useProjectArtifacts.js`**
- Fetch artifacts for a project
- Upload/delete artifacts
- Manage artifact state

**`frontend/src/hooks/useProjectTutor.js`**
- Chat functionality for projects
- Query project artifacts with RAG
- Chat history management

---

## 4. Navigation Updates

**`frontend/src/components/layout/Header.jsx`**
- Add "Projects" link in navigation (next to existing nav items)
- Maybe add a dropdown or direct link to `/projects`

**`frontend/src/App.jsx`**
- Add project route handling
- Integrate project hooks
- Add ProjectWorkspace view rendering

**`frontend/src/components/views/HomeView.jsx`**
- Add ProjectGrid section (below or alongside CourseGrid)
- "Create New Project" button

---

## 5. Pinecone Integration

### New Namespace Strategy
- Use separate Pinecone namespace: `lecturescribe_projects_v1`
- Embedding format: `{project_id}_{artifact_id}_{chunk_index}`
- Store artifact metadata in Pinecone vector metadata

### Ingestion Pipeline
1. When artifact uploaded → trigger async processing
2. Extract content based on type:
   - PDF: PyPDF2/pypdf → text extraction
   - Code: Parse source → extract functions, classes, comments
   - Dataset: Pandas → schema, stats, sample rows
   - PPTX: python-pptx → slide text extraction
3. Chunk content (similar to transcript cues)
4. Generate embeddings (use existing embedding model)
5. Upsert to Pinecone with metadata
6. Update artifact status in DB

### Query Pipeline
- Similar to lecture RAG:
  - Query Pinecone with namespace filter for project_id
  - Hybrid search (if we add Algolia for projects)
  - RRF fusion (if using multiple retrieval sources)
  - 4-step agent tool loop

---

## 6. Storage Strategy

### Google Cloud Storage
- New bucket: `lecturescribe-project-artifacts` (or reuse existing with prefix)
- Path structure: `{user_email}/{project_id}/{artifact_id}/{filename}`
- Use existing V4 signed URL flow

### Alternative: Local Storage
- Option to store locally if GCS not configured
- Path: `uploads/projects/{project_id}/{artifact_id}/`

---

## 7. Implementation Order

### Phase 1: Core Infrastructure
1. Database schema additions
2. Backend project CRUD endpoints
3. Frontend routing updates
4. ProjectGrid component
5. useProjects hook
6. Header navigation updates

### Phase 2: Artifact Management
1. Backend artifact endpoints
2. UploadArtifactModal component
3. ArtifactCard component
4. ProjectWorkspace layout
5. useProjectArtifacts hook
6. GCS signed URL integration

### Phase 3: RAG Integration
1. Artifact content extraction functions
2. Pinecone namespace setup
3. Ingestion pipeline for artifacts
4. Backend RAG query endpoint for projects
5. Project AI Tutor integration
6. useProjectTutor hook

### Phase 4: Polish & Testing
1. UI refinements
2. Error handling
3. Loading states
4. End-to-end testing
5. Documentation

---

## 8. Key Decisions Needed

1. **Artifact Content Extraction**: Which libraries to use for each type?
   - PDF: pypdf, pdfplumber, or PyPDF2?
   - Code: AST parsing or simple regex?
   - Datasets: How deep to analyze?

2. **Embedding Strategy**: Same model as lectures or different?
   - 768-dim hash embedding (current) or larger for code/data?

3. **Storage**: Dedicated GCS bucket or reuse existing with prefix?

4. **UI Placement**: Projects as main nav item or in user menu?

5. **Project-Artifact Limits**: Max file size? Max artifacts per project?
