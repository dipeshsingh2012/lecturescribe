# Academic Literature Search Pipeline Documentation

## 1. Executive Summary & Objective

The **Academic Literature Search Pipeline** (`search_academic_literature`) is the federated information retrieval (IR) engine in LectureScribe. It enables students and educators across diverse disciplines—Computer Science & Engineering, Medicine & Life Sciences, and Humanities—to discover authoritative, high-impact peer-reviewed literature, conference proceedings, preprints, and foundational monographs.

### Current Evolution (v2.2 Architecture Hardening)
To eliminate regressions identified in production audits:
1. **Domain Exclusion Rules**: Enforces hard exclusion of `Europe PMC` when searching for `STEM_CS` courses (e.g. `Master of Technology`), routing strictly to OpenAlex, Semantic Scholar, Crossref, and Google Books.
2. **Two-Pass OpenAlex Candidate Retrieval**: Queries OpenAlex concurrently with relevance sorting (`sort=relevance_score:desc`) and citation authority sorting (`sort=cited_by_count:desc`), guaranteeing foundational seminal papers (e.g. Vaswani et al., 2017) are surfaced alongside recent breakthroughs.
3. **Strict Lexical & Compound Phrase Scoring**: Penalizes disconnected compound tokens (e.g. "cross-domain" ... "attention") and rewards authentic compound phrases ("cross attention").
4. **Authentic Direct PDF Resolution**: Rejects publisher and DOI HTML landing pages from being falsely categorized as binary PDF streams.
5. **Structured Telemetry**: Transparent HTTP status monitoring across Semantic Scholar and federated providers.

---

## 2. Architecture & Pipeline Stages

```
                        User Search Query + Course Context
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │       Stage 1: Query Transformation & Routing       │
             │ - Compound phrase detection & quoting ("cross-attn") │
             │ - Entity extraction (venues: NeurIPS/CVPR, years)   │
             │ - Academic discipline router (STEM/CS, Biomed, Hum) │
             └──────────────────────────┬──────────────────────────┘
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            │ [STEM / CS / AI]          │ [Medicine / Life Sci]     │ [Humanities / Law]
            ▼                           ▼                           ▼
 ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
 │ • Semantic Scholar   │    │ • Europe PMC         │    │ • OpenAlex           │
 │ • OpenAlex           │    │ • OpenAlex           │    │ • Crossref           │
 │ • arXiv (Preprints)  │    │ • Crossref (Trials)  │    │ • Google Books       │
 │ • Google Books (Text)│    │ • Google Books (Text)│    │   (Monographs)       │
 └──────────┬───────────┘    └──────────┬───────────┘    └──────────┬───────────┘
            │                           │                           │
            └───────────────────────────┼───────────────────────────┘
                                        │ (Async HTTP/2 with Strict 3.2s Timeout)
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │     Stage 2: Sanitization & Metadata Ingestion      │
             │ - Reconstruct inverted abstracts (OpenAlex)         │
             │ - Strip HTML/XML tags & unescape entities           │
             │ - Extract normalized 4-digit publication years      │
             │ - Resolve direct open-access PDFs (Unpaywall/S2/OA) │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │   Stage 3: Multi-Identifier Deduplication & Merging  │
             │ - Primary Key: Normalized DOI                       │
             │ - Secondary Key: Normalized arXiv ID                │
             │ - Tertiary Key: Title Jaccard (≥0.85) + Surnames    │
             │ - Year compatibility guard (±1 year tolerance)      │
             │ - Citation & abstract enrichment across records     │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │         Stage 4: Hybrid Re-Ranking & Scoring        │
             │ - Lexical/BM25 token overlap (Title + Abstract)     │
             │ - Log-normalized citation authority: log10(1 + cit) │
             │ - Intent-adaptive recency decay (Foundational vs SOTA)│
             │ - Direct PDF verification bonus (+0.10)             │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
             ┌─────────────────────────────────────────────────────┐
             │       Stage 5: Intent-Adaptive Slot Allocation      │
             │ - Monograph intent: Up to 60% textbook slots        │
             │ - Citation intent: Single-paper focus               │
             │ - General exploration: Balanced 2 papers : 1 book   │
             └──────────────────────────┬──────────────────────────┘
                                        │
                                        ▼
                          Canonical Schema JSON Output
```

---

## 3. Data Provider Federation & Domain Routing Strategy

### 3.1 Provider Matrix & Operational Characteristics

| Provider | Primary Disciplines | Strengths | p95 Latency | Auth & Rate Limits | Failure Mode Mitigation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenAlex** *(Tier 1)* | Cross-Disciplinary (All Fields) | 250M+ works, native citation counts, inverted abstracts, full open-access & PDF URLs, concept tagging. | $\sim 250\text{ms} - 400\text{ms}$ | **Polite Pool**: 10 req/s with `mailto:` header. Free. | Inverted abstract index is reconstructed sequentially during ingestion. |
| **Semantic Scholar (S2)** *(Tier 1)* | CS, AI, Biomedicine, Neuroscience | High-precision vector/hybrid search, `citationCount`, `influentialCitationCount`, direct open-access PDF links, arXiv ID indexing. | $\sim 300\text{ms} - 550\text{ms}$ | **Free Public API**: 100 req/5 min unauthenticated; 1 req/s with free key. | Strict IP rate limit: protected by a 60s circuit breaker falling back to OpenAlex. |
| **arXiv API** | Physics, CS, Math, Quantitative Finance | Canonical source for cutting-edge preprints (2017–present); exact abstracts, versions, direct PDF downloads. | $\sim 600\text{ms} - 900\text{ms}$ | 1 req/3s etiquette. | Slower XML responses; lack citation counts. Queried selectively for recent CS/AI queries. |
| **Crossref** | Formal Journal & Conference Publishing | Canonical bibliographic DOI registry, conference proceedings (IEEE, ACM, Springer). | $\sim 400\text{ms} - 800\text{ms}$ | Polite pool via `User-Agent`. | Missing abstracts for $>60\%$ of items, no citation metrics. Enriched via OpenAlex/S2. |
| **Europe PMC** | Biomedicine, Life Sciences, Clinical Medicine | Full-text OA XML, PMCIDs, BioRxiv/MedRxiv ingestion, in-app HTML reader embeds. | $\sim 300\text{ms} - 500\text{ms}$ | Generous public quota. | Bypassed for non-biomedical queries (CS, Physics, Humanities) to avoid zero-hit overhead. |
| **Google Books** | Monographs, Textbooks, Reference Manuals | Curriculum textbooks (Cormen, Bishop, Russell & Norvig), preview pages, cover art. | $\sim 200\text{ms} - 350\text{ms}$ | 1000 req/day unauthenticated; generous with GCP key. | High noise for journal articles; strictly reserved for monograph/textbook slot allocation. |

---

### 3.2 Dynamic Domain Routing Matrix

The routing engine inspects the course discipline context and query terms to determine provider fan-out:

```
                            ┌──────────────────────────────────┐
                            │ Incoming Academic Search Request │
                            │   (query, course, degree_level)  │
                            └─────────────────┬────────────────┘
                                              │
                                   [ Intent & Discipline ]
                                   [    Classification   ]
                                              │
                 ┌────────────────────────────┼────────────────────────────┐
                 ▼                            ▼                            ▼
        [ STEM / CS / AI ]           [ Life Sci / Medicine ]         [ Humanities / Law ]
                 │                            │                            │
      ┌──────────┴──────────┐      ┌──────────┴──────────┐      ┌──────────┴──────────┐
      ▼                     ▼      ▼                     ▼      ▼                     ▼
┌───────────┐         ┌──────────┐ ┌───────────┐   ┌───────────┐ ┌───────────┐   ┌────────────┐
│ Semantic  │         │ OpenAlex │ │ Europe    │   │ OpenAlex  │ │ OpenAlex  │   │ Crossref / │
│  Scholar  │         │          │ │   PMC     │   │           │ │           │   │ Google Bks │
└─────┬─────┘         └────┬─────┘ └─────┬─────┘   └─────┬─────┘ └─────┬─────┘   └─────┬──────┘
      │                    │             │               │             │               │
      └──────────┬─────────┘             └───────┬───────┘             └───────┬───────┘
                 │                               │                             │
                 ▼                               ▼                             ▼
       ┌──────────────────┐            ┌──────────────────┐          ┌──────────────────┐
       │ (Optional arXiV  │            │ (Crossref backup │          │ (Monograph slot  │
       │  for preprints)  │            │   for DOIs)      │          │   if textbook)   │
       └──────────────────┘            └──────────────────┘          └──────────────────┘
```

#### Routing Rules:
1. **STEM / Computer Science / AI (`STEM_CS`)**:
   * Dispatches to **Semantic Scholar** + **OpenAlex** in parallel.
   * If query mentions bleeding-edge concepts (`"mamba"`, `"diffusion"`, `"mixture of experts"`, `"rag"`) or years $\ge 2023$, queries **arXiv API**.
   * Bypasses Europe PMC.
2. **Medicine / Health Sciences (`BIOMED`)**:
   * Dispatches to **Europe PMC** + **OpenAlex** in parallel.
   * Queries Crossref for clinical trial journals (*NEJM*, *Lancet*, *JAMA*).
   * Bypasses arXiv.
3. **Humanities / Social Sciences / Law (`GENERAL_HUMANITIES`)**:
   * Dispatches to **OpenAlex** + **Crossref** + **Google Books**.

---

## 4. Upstream Query Transformation & IR Improvements

### 4.1 Exact-Phrase & Compound Term Extraction
Raw queries like `cross attention transformer models` undergo token analysis:
* **Compound Phrases**: Phrases like `"cross attention"`, `"self attention"`, `"reinforcement learning"`, `"mixture of experts"` are detected and wrapped in exact quotes for upstream search engines.
* **Academic Venue Extraction**: Known conference and journal tokens (`neurips`, `icml`, `cvpr`, `iclr`, `aaai`, `jama`, `nejm`, `ieee`, `acm`) are extracted into dedicated venue filters rather than polluting keyword matching.
* **Publication Year Constraints**: 4-digit years (e.g., `2017`, `2024`) are extracted into target year parameters and stripped from the keyword search string.

### 4.2 Inverted Abstract Reconstruction (OpenAlex)
OpenAlex stores abstracts as an inverted index mapping words to integer token positions:
$$\text{abstract\_inverted\_index} = \{\text{"Attention"}: [0], \text{"is"}: [1], \text{"all"}: [2], \dots\}$$

The reconstruction algorithm:
1. Finds $M = \max(\text{positions})$.
2. Allocates an array of size $M + 1$.
3. Assigns each word token to its corresponding indices.
4. Joins the array with whitespace, producing a clean, full-text abstract without extraneous network round-trips.

---

## 5. Metadata Enrichment & Entity Resolution

### 5.1 Multi-Identifier Deduplication
Candidates retrieved across providers are merged into unified records using a three-tier resolution hierarchy:

```
                          ┌───────────────────────────┐
                          │ Incoming Candidate Record │
                          └─────────────┬─────────────┘
                                        │
                         Does Canonical DOI match?
                                       / \
                                 YES  /   \  NO
                                     /     \
                                    ▼       ▼
                            [ MERGE & ENRICH ]  Does arXiv ID match?
                                                       / \
                                                 YES  /   \  NO
                                                     /     \
                                                    ▼       ▼
                                            [ MERGE & ENRICH ]  Title & Author Surnames Match?
                                                                       / \
                                                                 YES  /   \  NO
                                                                     /     \
                                                                    ▼       ▼
                                                            [ MERGE & ENRICH ]  [ RETAIN SEPARATE ]
```

1. **Tier 1 (DOI Match)**: Normalized, case-insensitive string match after stripping `https://doi.org/`, `http://dx.doi.org/`, and `doi:` prefixes.
2. **Tier 2 (arXiv ID Match)**: Normalized identifier match after stripping version suffixes (e.g., `1706.03762v5` matches `1706.03762`).
3. **Tier 3 (Title Jaccard & Surnames)**: Subtitle delimiter splitting (`:`, `-`, `—`, `–`). Primary title token Jaccard similarity $\ge 0.85$ merges records if author surnames intersect and publication years are within $\pm 1$ year.
4. **Year Compatibility Guard**: Records with explicit publication years differing by $> 1$ year are strictly separated to prevent collapsing distinct editions or multi-year studies.

### 5.2 Enrichment Precedence Matrix
When duplicates are detected across providers:
* **Citations**: Retains the highest `citation_count` and `influential_citation_count` (provided by Semantic Scholar and OpenAlex).
* **Abstract**: Retains the longest, most complete abstract.
* **Direct Reading Links**:
  1. Priority 1: `direct_pdf_url` (unpaywall/arXiv direct PDF).
  2. Priority 2: `embed_url` with `reader_type = "pmc_reader"` (Europe PMC interactive viewer).
  3. Priority 3: `embed_url` with `reader_type = "google_embed"` (Google Books interactive viewer).
  4. Priority 4: External DOI link (`preview_url`).

---

## 6. Hybrid Scoring & Re-Ranking

To ensure canonical papers (e.g., Vaswani et al., 2017) outrank low-impact or tangentially related recent preprints, the pipeline applies a hybrid scoring function:

$$\text{Final Score} = w_{\text{lex}} \cdot S_{\text{lex}} + w_{\text{cit}} \cdot S_{\text{cit}} + w_{\text{rec}} \cdot S_{\text{rec}} + w_{\text{oa}} \cdot S_{\text{oa}}$$
$$\text{where } \sum w_i = 1.0 \quad (w_{\text{lex}} = 0.45,\; w_{\text{cit}} = 0.35,\; w_{\text{rec}} = 0.15,\; w_{\text{oa}} = 0.05)$$

| Factor | Weight | Formulation | Mathematical Range | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Lexical Match** ($S_{\text{lex}}$) | `0.45` | $\min\left(1.0,\; 0.5 \cdot \text{overlap}_{\text{title}} + 0.3 \cdot \text{overlap}_{\text{abstract}} + 0.2 \cdot \mathbb{I}(\text{exact\_phrase})\right)$ | $[0.0, 1.0]$ | Clamped query-title-abstract keyword and phrase coverage. |
| **Citation Authority** ($S_{\text{cit}}$) | `0.35` | $\min\left(1.0,\; \frac{\log_{10}(1 + \text{citation\_count})}{4.0}\right)$ | $[0.0, 1.0]$ | Log-normalized seminal authority metric. |
| **Recency Curve** ($S_{\text{rec}}$) | `0.15` | $\max\left(0.25,\; \exp\left(-\frac{\max(0, \Delta y)}{14.0}\right)\right)$ | $[0.25, 1.0]$ | Smooth exponential decay with minimum floor so landmark classics are not penalized solely by age. |
| **Open Access Readability** ($S_{\text{oa}}$) | `0.05` | $1.0 \text{ if (direct\_pdf\_url or is\_open\_access) else } 0.0$ | $\{0.0, 1.0\}$ | Normalized binary indicator for instant one-click readability. |

*Note: Because each sub-score $S_i \in [0.0, 1.0]$ and $\sum w_i = 1.0$, the composite relevance score is mathematically guaranteed to stay bounded within $[0.0, 1.0]$.*

---

## 7. Revised Target Schema Contract

Every item returned by `search_academic_literature` strictly conforms to the following contract. Missing string values are represented as `null` (or clean empty strings where backward compatibility requires):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AcademicDiscoveryItem",
  "type": "object",
  "required": [
    "title",
    "author",
    "publication_year",
    "reading_type",
    "category",
    "publisher",
    "journal",
    "doi",
    "direct_pdf_url",
    "citation_count",
    "relevance_score",
    "source_provider",
    "is_open_access"
  ],
  "properties": {
    "title": { "type": "string" },
    "author": { "type": "string" },
    "publication_year": { "type": "string" },
    "reading_type": { "type": "string", "enum": ["paper", "book", "journal", "preprint"] },
    "category": { "type": "string", "enum": ["primary_textbook", "reference", "supplementary"] },
    "publisher": { "type": ["string", "null"] },
    "journal": { "type": ["string", "null"] },
    "doi": { "type": ["string", "null"] },
    "arxiv_id": { "type": ["string", "null"] },
    "pmcid": { "type": ["string", "null"] },
    "isbn": { "type": ["string", "null"] },
    "cover_url": { "type": ["string", "null"] },
    "preview_url": { "type": ["string", "null"] },
    "direct_pdf_url": { "type": ["string", "null"] },
    "embed_url": { "type": ["string", "null"] },
    "reader_type": { "type": "string", "enum": ["pdf_direct", "pmc_reader", "google_embed", "web"] },
    "abstract": { "type": ["string", "null"] },
    "citation_count": { "type": "integer", "minimum": 0 },
    "influential_citation_count": { "type": "integer", "minimum": 0 },
    "relevance_score": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
    "source_provider": { "type": "string" },
    "is_open_access": { "type": "boolean" }
  }
}
```

---

## 8. API Endpoints & Client Integration

### Search Endpoint
* **Route**: `POST /api/course/{course_name}/search-literature`
* **Request Body**:
  ```json
  {
    "query": "cross attention transformer models",
    "limit": 6
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "course_name": "master_of_technology",
    "query": "cross attention transformer models",
    "results": [
      {
        "title": "Attention Is All You Need",
        "author": "Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit",
        "publication_year": "2017",
        "reading_type": "paper",
        "category": "reference",
        "publisher": "NeurIPS",
        "journal": "Advances in Neural Information Processing Systems",
        "doi": "10.5555/3295222.3295349",
        "arxiv_id": "1706.03762",
        "direct_pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
        "reader_type": "pdf_direct",
        "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
        "citation_count": 138500,
        "influential_citation_count": 14200,
        "relevance_score": 0.942,
        "source_provider": "Semantic Scholar / OpenAlex",
        "is_open_access": true
      }
    ],
    "count": 6
  }
  ```

### Library Addition Endpoint
* **Route**: `POST /api/course/{course_name}/add-reading`
* **Payload**: Accepts `AddCourseReadingRequest`. Synchronizes both `publication_year` and legacy `edition` fields for backward compatibility.

---

## 9. Test Suite & Verification Matrix

The pipeline is verified through automated test suites in both backend and frontend environments:

### Backend Test Suites (`pytest`)
* **Test File**: [`backend/tests/test_literature_search.py`](file:///home/dipes/projects/lecturescribe/backend/tests/test_literature_search.py) (28 unit/regression tests)
* **Test File**: [`tests/test_readings.py`](file:///home/dipes/projects/lecturescribe/tests/test_readings.py) (9 API & slide parser tests)

```
========================================================================================
Test Name                                                Function Tested                 Status
========================================================================================
test_domain_router_excludes_europe_pmc_for_mtech         Hard Exclusion for STEM_CS      ✅ PASSED
test_two_pass_fetch_surfaces_foundational_papers         2-Pass OpenAlex Relevance/Cits  ✅ PASSED
test_lexical_scorer_penalizes_disconnected_cross_tokens  Compound Strictness vs Disconn  ✅ PASSED
test_direct_pdf_url_rejects_doi_landing_page             DirectPdfResolver Authentication✅ PASSED
test_hybrid_scoring_mathematical_boundaries              [0.0, 1.0] Score Invariance     ✅ PASSED
test_reconstruct_inverted_abstract                       OpenAlex Inverted Rebuilding    ✅ PASSED
test_extract_canonical_arxiv_id                          arXiv Canonical ID Extraction   ✅ PASSED
test_semantic_scholar_rate_limiter_and_circuit           S2 1 QPS Limiter & 429 Trip     ✅ PASSED
test_openalex_tier1_primary_and_s2_fallback              OpenAlex Tier 1 + S2 Fallback   ✅ PASSED
test_fastapi_search_endpoint_e2e                         FastAPI POST Endpoint E2E       ✅ PASSED
test_search_academic_literature_async_provider_errors   Async HTTP Provider Isolation   ✅ PASSED
test_consolidate_and_merge_metadata_enrichment          Crossref + PMC Metadata Merge   ✅ PASSED
test_year_tolerance_in_record_equivalence               ±1 Year Match vs Multi-Year Gap ✅ PASSED
test_extract_author_surnames_and_formats                Western, PubMed, Single Author  ✅ PASSED
test_primary_title_extraction_and_jaccard               Subtitle Delimiters & Jaccard   ✅ PASSED
test_empty_and_boundary_queries                         Sync Query Boundary Checks      ✅ PASSED
test_empty_and_boundary_queries_async                   Async Query Boundary Checks     ✅ PASSED
test_are_records_equivalent_generic_title_guard         Generic Title Collision Defense ✅ PASSED
test_are_records_equivalent_subtitle_jaccard            Subtitle Truncation Overlap     ✅ PASSED
test_intent_adaptive_interleaving                       Monograph vs Paper Interleaving ✅ PASSED
test_clean_html_text                                    HTML/XML Tag Stripping          ✅ PASSED
test_extract_year                                       4-Digit Year Extraction         ✅ PASSED
test_normalize_doi                                      Canonical DOI Formatting        ✅ PASSED
test_normalize_title                                    Alphanumeric Title Normalization✅ PASSED
========================================================================================
Total Backend Tests Passing: 37 / 37 (100%)
```

### Frontend Test Suites (`vitest`)
* **Test Command**: `npm test -- --run` in `frontend/`
* **Coverage**: 41 test files, 300 tests passing (including [`ResearchLiteratureModal.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/__tests__/ResearchLiteratureModal.test.jsx), [`BookReaderModal.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/__tests__/BookReaderModal.test.jsx), and [`CourseLibrary.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/__tests__/CourseLibrary.test.jsx)).
