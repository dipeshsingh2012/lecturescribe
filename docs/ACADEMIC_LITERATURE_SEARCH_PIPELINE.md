# Academic Literature Search Pipeline Documentation

## 1. Executive Summary & Objective

The **Academic Literature Search Pipeline** (`search_academic_literature`) is the federated information retrieval engine in LectureScribe that enables students and educators to discover peer-reviewed journal articles, conference papers, and textbooks supporting their courses and lectures.

The pipeline federates across three global academic metadata repositories concurrently:
1. **Crossref**: Global DOI registry covering major publishers including Nature, IEEE, Springer, ACM, Wiley, Elsevier, and JAMA.
2. **Europe PMC / PubMed Central**: Biomedical literature repository providing open-access full texts, PMC identifiers, and embedded reading capabilities.
3. **Google Books**: Repository for published monographs, university textbooks, and Google Books preview embeds.

---

## 2. Architecture & Pipeline Stages

```
                        User Search Query
                               │
                               ▼
               ┌───────────────────────────────┐
               │    Query Preprocessing        │
               │  - Prefix cleanup (regex)     │
               │  - Minimum length validation  │
               │  - Query intent classification│
               └───────────────┬───────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │   Crossref   │   │  Europe PMC  │   │ Google Books │
    │ (Bibliograh) │   │ (Biomedical) │   │ (Monographs) │
    │ Timeout 3.5s │   │ Timeout 3.5s │   │ Timeout 3.5s │
    └───────┬──────┘   └───────┬──────┘   └───────┬──────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │ (Async HTTP/2 or ThreadPool Concurrent Fan-Out)
                               ▼
               ┌───────────────────────────────┐
               │  Data Sanitization & Cleaning │
               │  - Strip HTML / XML markup    │
               │  - Unescape HTML entities     │
               │  - Extract 4-digit pub year   │
               │  - Standardize author names   │
               │  - Separate journal/publisher │
               └───────────────┬───────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Multi-Factor Deduplication &  │
               │ Europe PMC Enrichment         │
               │ - Primary: Case-folded DOI    │
               │ - Short title guard           │
               │ - Subtitle Jaccard similarity │
               │ - Author surname validation   │
               │ - Merge PMC reader & OA links │
               └───────────────┬───────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Intent-Adaptive Interleaving  │
               │ - Monograph query adaptation  │
               │ - Paper citation adaptation   │
               │ - Balanced slot distribution  │
               └───────────────┬───────────────┘
                               │
                               ▼
                   Canonical Schema Output
```

---

## 3. Core Engine Implementation Details

### 3.1 Concurrency & Execution Engine

The pipeline supports two execution profiles: a robust multi-threaded baseline and an asynchronous HTTP/2 client for high-throughput deployments.

#### A. Multi-Threaded Execution (Active Baseline)
* **Concurrency Model**: Implemented using `concurrent.futures.ThreadPoolExecutor(max_workers=3)`.
* **Individual Request Timeout**: Strictly bounded to `3.5s` per provider.
* **Fault Isolation**: Each provider query executes in an isolated `try...except` block. If any single provider experiences a connection failure, timeout, or HTTP 4xx/5xx status, the pipeline logs a debug message and continues assembling results from the remaining providers.
* **Performance Gain**: Wall-clock latency dropped from sequential execution (~11s worst-case) to concurrent execution (~3–3.5s worst-case).

#### B. Asynchronous HTTP/2 Engine (High-Throughput Profile)
* **Client Architecture**: Singleton `httpx.AsyncClient` lifecycle-managed with HTTP/2 multiplexing, connection pooling (`max_connections=200`, `max_keepalive_connections=50`), and keep-alive reuse.
* **Task Management**: Dispatches queries via `asyncio.gather(..., return_exceptions=True)` to prevent individual provider failures from aborting the federated query.
* **Latency Profile**: Eliminates TLS handshake overhead on warm connections (~60–140ms saved per query) and eliminates OS thread creation overhead under high concurrency.

### 3.2 Upstream Filtering (Crossref)
To eliminate non-article artifacts from Crossref (such as component DOIs for figures, supplementary tables, and peer-review transcripts):
* **Query Filter**: Configured with `filter=type:journal-article,type:proceedings-article,type:book,type:book-chapter`.
* **Polite API Protocol**: Supplies a polymorphic User-Agent header with contact email:
  ```http
  User-Agent: LectureScribe/1.0 (mailto:academic-research@lecturescribe.local)
  ```

### 3.3 Data Sanitization & Field Normalization
* **HTML/XML Tag Stripping**: `_clean_html_text` strips XML/HTML tags (e.g., `<jats:p>`, `<h4>`, `<b>`, `<i>`, `<br/>`) and unescapes all HTML entities (`&amp;`, `&lt;`, `&gt;`, `&#39;`).
* **Publication Year**: Extracted as a clean 4-digit string using `_extract_year` (replaces legacy `"edition"` field).
* **Author Formatting**:
  * Crossref author lists parsed to `"Given Family"`.
  * Google Books arrays joined with commas.
  * Europe PMC author strings stripped of trailing punctuation.
* **Journal vs. Publisher Disambiguation**: Container title is assigned strictly to `journal`. If missing, `journal` remains empty (`""`) and does not inherit the publisher name.

---

## 4. Multi-Factor Deduplication & Entity Resolution

Federated queries frequently return duplicate entries across Crossref and Europe PMC. To prevent generic title collisions while handling subtitle truncations, the pipeline applies a multi-factor matching engine:

```
                      Incoming Candidate Record
                                  │
                                  ▼
                     Has Normalized Canonical DOI?
                                 / \
                         [Yes]  /   \  [No]
                               ▼     ▼
                Match against DOI    Is Alphanumeric Title
                Index (Case-folded)  an Exact Match?
                       │             / \
                   [Matched] [Yes]  /   \  [No]
                       │           ▼     ▼
                       │    Is Title Length  Token Jaccard on Main
                       │    < 15 chars or    Title >= 0.85 AND
                       │    Generic Name?    Author Surnames Match?
                       │         / \                 / \
                       │ [Yes]  /   \ [No]   [Yes]  /   \ [No]
                       │       ▼     ▼             ▼     ▼
                       │  Do Surnames Match?    MERGE   NEW RECORD
                       │       / \
                       │ [Yes]/   \[No]
                       ▼     ▼     ▼
                     MERGE RECORD  NEW RECORD
```

### Deduplication Factors
1. **Primary Strict Key (DOI)**: Normalized, case-insensitive string matching after removing prefixes (`https://doi.org/`, `http://dx.doi.org/`, `doi:`).
2. **Short/Generic Title Guard**: Generic titles (e.g., *"Introduction"*, *"Editorial"*, *"Review"*, or any title $< 15$ characters) are blocked from title-only matching unless at least one author surname and publication year ($\pm 1$ year) match.
3. **Subtitle Splitting & Token Jaccard**: Titles split on delimiters (`:`, `-`, `—`). Token Jaccard similarity $\ge 0.85$ on primary title tokens merges subtitle variations (e.g., cataloger additions).
4. **Author Surname Multi-Set Intersection**: Matches family names extracted from author strings across Western and East Asian formatting conventions.

### Europe PMC Metadata Enrichment
When an incoming Europe PMC result matches an existing Crossref record:
* Ingests PMC identifier (`pmcid`).
* Upgrades reader link to Europe PMC reader (`https://europepmc.org/articles/{pmcid}`) with `reader_type = "pmc_reader"`.
* Sets `is_open_access = True` if open access is verified.
* Replaces empty abstracts with Europe PMC's clean abstract.
* Fills missing metadata (e.g., journal title, DOI).

---

## 5. Intent-Adaptive Interleaving Strategy

Static interleaving (`2 papers : 1 book`) fails when a query explicitly targets a textbook or a specific journal citation. The pipeline dynamically adjusts slot allocation based on detected user intent:

| Detected Query Intent | Indicator Keywords | Book Slot Target | Paper Slot Target | Interleaving Pattern |
| :--- | :--- | :--- | :--- | :--- |
| **Monograph / Textbook** | `textbook`, `handbook`, `guide`, `introduction to`, `principles of`, `volume`, `edition` | Up to 60% of `limit` | Remainder of `limit` | Books lead; alternating papers |
| **Specific Paper / Citation** | `et al`, `jama`, `nejm`, `nature`, `ieee`, `arxiv`, `doi`, `proceedings`, `trial` | Max 1 book (if `limit >= 5`) | Remainder of `limit` | Papers lead; monograph appended |
| **General Exploration** | Default / open topic searches | 1–2 books (guaranteed if available) | Remainder of `limit` | Balanced `2 papers : 1 book` |

---

## 6. Target Output Schema Contract

Every dictionary emitted by `search_academic_literature` strictly conforms to the following schema:

```python
{
    "title": str,            # Clean plain-text title (tags stripped, entities unescaped)
    "author": str,           # Comma-separated full author names ("John Doe, Jane Smith")
    "publication_year": str, # 4-digit year string (e.g., "2021") or ""
    "reading_type": str,     # "paper", "journal", or "book"
    "category": str,         # "reference" or "primary_textbook"
    "publisher": str,        # Publisher organization name or ""
    "journal": str,          # Academic journal / proceedings title or ""
    "doi": str,              # Canonical normalized DOI or ""
    "pmcid": str,            # PubMed Central identifier (e.g., "PMC4968574") or ""
    "isbn": str,             # Standard ISBN_13 or ISBN_10 or ""
    "cover_url": str,        # HTTPS book cover thumbnail or ""
    "preview_url": str,      # Primary external URL or DOI link
    "embed_url": str,        # Embedded digital reader link (PMC / Google Books) or ""
    "reader_type": str,      # "web", "pmc_reader", or "google_embed"
    "abstract": str,         # Plain-text abstract (zero HTML/XML tags)
    "source_provider": str,  # e.g., "Crossref (JAMA)", "Europe PMC / PubMed", "Google Books"
    "is_open_access": bool,  # Verified open access flag
    "match_reason": str      # Optional 1-sentence relevance justification or ""
}
```

---

## 7. SLM Integration Architecture (Roadmap)

To optimize precision under a strict end-to-end latency budget ($p95 < 1.20\text{s}$), a lightweight Small Language Model (SLM, 1B–3B parameters) can be integrated as a speculative pre-routing and post-retrieval re-ranker.

### Latency Budget Breakdown
```
[Pre-Retrieval Routing]  [Parallel HTTP Fan-Out]   [Deduplication]  [Post-Retrieval Re-Ranking]
     ~80 - 130ms                ~320 - 580ms            ~2 - 5ms            ~180 - 340ms
────────────┴──────────────────────────┴────────────────────┴─────────────────────┴─────────────
                               Total p95: ~1,107ms (< 1.20s Budget)
```

* **Recommended SLM**: `Qwen2.5-1.5B-Instruct` (or `Qwen2.5-3B-Instruct`) served via **vLLM** (`--dtype bfloat16 --quantization fp8 --enforce-eager`).
* **Pre-Retrieval Function**: Selectively gates Europe PMC for non-biomedical queries and constructs targeted Boolean Lucene syntax.
* **Post-Retrieval Function**: Single listwise prompt performing cross-attention scoring on the top 10 candidate titles and abstracts, emitting structured JSON rankings via constrained grammar decoding (`outlines`).
* **Circuit Breakers**: If the pre-routing SLM call exceeds 150ms or fails, the pipeline immediately falls back to heuristic keyword routing without failing the user search.

---

## 8. API Endpoints & Client Integration

### Search Endpoint
* **Route**: `POST /api/course/{course_name}/search-literature`
* **Request Body**:
  ```json
  {
    "query": "Singer et al. (2016) Sepsis-3 JAMA",
    "limit": 6
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "course_name": "critical_care_medicine",
    "query": "Singer et al. (2016) Sepsis-3 JAMA",
    "results": [ ... ],
    "count": 6
  }
  ```

### Library Addition Endpoint
* **Route**: `POST /api/course/{course_name}/add-reading`
* **Payload**: Accepts `AddCourseReadingRequest`. The backend synchronizes both `publication_year` and legacy `edition` fields for full forward and backward compatibility.

### Client Components
* **Frontend Hook**: [`frontend/src/hooks/useResources.js`](file:///home/dipes/projects/lecturescribe/frontend/src/hooks/useResources.js) (`searchLiterature`, `addCourseReading`)
* **Modal Component**: [`frontend/src/components/modals/ResearchLiteratureModal.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/ResearchLiteratureModal.jsx) (interactive search UI, chip filters, preview reader launcher, course library bookmarking)

---

## 9. Test Suite & Verification

The pipeline is verified across unit, integration, and UI test layers:

1. **Backend Unit & Integration Tests**:
   - Location: [`backend/tests/test_literature_search.py`](file:///home/dipes/projects/lecturescribe/backend/tests/test_literature_search.py)
   - Scope:
     * HTML tag stripping and entity unescaping (`test_clean_html_text`)
     * 4-digit calendar year extraction (`test_extract_year`)
     * Canonical DOI normalization (`test_normalize_doi`)
     * Alphanumeric title hashing (`test_normalize_title`)
     * Slot reservation and book interleaving constraints (`test_interleaving_logic`)
     * Concurrent multi-provider retrieval, PMC duplicate enrichment, and schema adherence (`test_search_academic_literature_parallel_and_merged`)
     * Individual provider fault isolation and graceful degradation (`test_search_academic_literature_graceful_failure`)

2. **API Endpoint Tests**:
   - Location: [`tests/test_readings.py`](file:///home/dipes/projects/lecturescribe/tests/test_readings.py)
   - Scope: Verifies FastAPI route resolution, course canonical slug matching, and reading persistence.

3. **Frontend Component Tests**:
   - Location: [`frontend/src/components/modals/__tests__/ResearchLiteratureModal.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/__tests__/ResearchLiteratureModal.test.jsx)
   - Scope: Verifies dialog rendering, search triggering, open access badge display, and library addition.
