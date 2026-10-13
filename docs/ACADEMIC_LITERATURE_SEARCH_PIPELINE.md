# Academic Literature Search Pipeline Documentation

## 1. Executive Summary & Objective

The **Academic Literature Search Pipeline** (`search_academic_literature`) is the federated information retrieval (IR) engine in LectureScribe. It enables students and educators across diverse disciplines—Computer Science & Engineering, Medicine & Life Sciences, and Humanities—to discover authoritative, high-impact peer-reviewed literature, conference proceedings, preprints, and foundational monographs.

### Current Evolution (v2.3 Precision Hardening)
To address semantic precision regressions identified on technical queries (e.g. `"cross attention transformer models"` for `Master of Technology`):
1. **Atomic Multi-Token Matcher**: Treats compound architectural terms (`"cross-attention"`, `"cross attention"`) as atomic phrases. Explicitly checks that words following `"cross"` match `"attention"`, preventing sub-token collisions from inflating scores on irrelevant terms like `"cross-window"` (Swin Transformer), `"cross-domain"`, or `"cross-temporal"`.
2. **Canonical Architecture Foundations & Synonym Matching**: Maps foundational architectural equivalents (e.g., Vaswani et al., 2017 using *"encoder-decoder attention"*) to *"cross-attention"*, both during candidate query expansion and lexical scoring, ensuring seminal papers surface at the top.
3. **Auto-Populate `arxiv_id`**: Added a post-enrichment normalizer that extracts canonical arXiv IDs from resolved `direct_pdf_url`, `preview_url`, `embed_url`, and `doi` strings across all providers.
4. **Hard Domain Exclusion**: Strict routing of `STEM_CS` queries away from biomedical silos (Europe PMC).

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
* **Test File**: [`backend/tests/test_literature_search.py`](file:///home/dipes/projects/lecturescribe/backend/tests/test_literature_search.py) (32 unit/regression tests)
* **Test File**: [`tests/test_readings.py`](file:///home/dipes/projects/lecturescribe/tests/test_readings.py) (9 API & slide parser tests)

```
========================================================================================
Test Name                                                Function Tested                 Status
========================================================================================
test_lexical_scorer_generalized_arbitrary_query          Generalized IR N-Gram Proximity ✅ PASSED
test_lexical_scorer_rejects_subtoken_collision_swin      Atomic Phrase Sub-Token Guard   ✅ PASSED
test_lexical_scorer_canonical_synonym_encoder_decoder    Vaswani 2017 Equivalence       ✅ PASSED
test_arxiv_id_auto_populated_from_resolved_urls          Post-Enrichment arXiv Extraction✅ PASSED
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
Total Backend Tests Passing: 41 / 41 (100%)
```

### Frontend Test Suites (`vitest`)
* **Test Command**: `npm test -- --run` in `frontend/`
* **Coverage**: 41 test files, 300 tests passing (including [`ResearchLiteratureModal.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/__tests__/ResearchLiteratureModal.test.jsx), [`BookReaderModal.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/modals/__tests__/BookReaderModal.test.jsx), and [`CourseLibrary.test.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/__tests__/CourseLibrary.test.jsx)).

---

## 10. Next-Gen Architecture: Two-Stage SLM-Powered Discovery Pipeline (v3.0 Specification)

### 10.1 Motivation & Rationale for Decommissioning Manual NLP Heuristics
The v2.3 architecture relies on Python-side n-gram phrase extraction, minimum span proximity penalties, manual slug registries (`STEM_CS_SLUGS`), and static concept dictionaries (`CONCEPT_SYNONYMS`). While functional, manual NLP exhibits fundamental limitations:
1. **Brittle Edge Cases**: Manual tokenizers suffer from sub-token boundary collisions (e.g., `"cross-window"` vs. `"cross-attention"`).
2. **Thesaurus Blindness**: Manual synonym mapping fails whenever researchers use alternative terminology (e.g. *"inter-attention"*, *"bilateral feature fusion"*, *"encoder-decoder attention"*).
3. **Domain Pollution**: Static interleaving forces off-topic monographs (e.g., 1998 cognitive psychology books on human visual attention) into modern Computer Science courses (*Master of Technology*).

### 10.2 Architectural Topology: The "SLM Sandwich"

To completely eliminate hand-crafted heuristics, the search engine transitions to an **SLM-at-the-Front, SLM-at-the-Back** pipeline:

```
                  [User Input: Query + Course Context]
      (e.g., Query: "cross attention", Course: "Master of Technology")
                                    │
                                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │  STAGE 1: SLM Query Planner & Intent Router (Sub-150ms)       │
    │  • Dynamically classifies academic discipline without regex   │
    │  • Expands queries into canonical foundational terminology    │
    │    - "cross-attention transformer"                            │
    │    - "encoder-decoder attention transformer" (Vaswani 2017)   │
    │  • Defines negative / exclusion concepts:                      │
    │    - Exclude: ["human sensory", "cognitive psychology"]       │
    │  • Selects optimal data providers (OpenAlex, S2)              │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │  STAGE 2: Fast Targeted Candidate Retrieval (Sub-350ms)       │
    │  • Executes parallel HTTP/2 queries with SLM-optimized queries│
    │  • Fetches top 15-20 candidate works across OpenAlex & S2     │
    │  • Zero psychology books retrieved in the first place         │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │  STAGE 3: Deterministic Identifier & PDF Sanitization         │
    │  • Strict canonical arXiv ID extraction (anchored to domain)  │
    │  • Direct binary PDF validation vs. DOI landing pages         │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │  STAGE 4: SLM Semantic Judge & Relevance Reranker (Sub-300ms) │
    │  • Single batched prompt evaluates candidates concurrently:   │
    │    "Rate 0.0-1.0 relevance to Master of Technology curriculum"│
    │  • Drops off-topic candidates (Swin windowing, psychology)    │
    │  • Scores true cross-attention & encoder-decoder models high  │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
    ┌───────────────────────────────────────────────────────────────┐
    │  STAGE 5: Mathematical Blend & Quality Filtering              │
    │  • Final Score = 0.50 * SLM_Score + 0.35 * S_cit + 0.15 * S_rec│
    │  • Eligibility Floor: Discards candidates with SLM_Score < 0.4│
    │  • Monograph Floor: Only interleave books if SLM_Score >= 0.5 │
    └───────────────────────────────┬───────────────────────────────┘
                                    │
                                    ▼
                      Canonical Schema JSON Output
```

### 10.3 Structured SLM Schema Contracts

#### Stage 1: `SLMQueryPlanner` Output Schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["domain", "primary_queries", "providers", "intent", "excluded_concepts"],
  "properties": {
    "domain": { "type": "string", "enum": ["cs_ai", "biomedical", "physics_math", "humanities_social"] },
    "primary_queries": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
    "providers": { "type": "array", "items": { "type": "string" } },
    "intent": { "type": "string", "enum": ["paper", "monograph", "general"] },
    "excluded_concepts": { "type": "array", "items": { "type": "string" } }
  }
}
```

#### Stage 4: `SLMReranker` Output Schema (Latency-Optimized)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["candidate_id", "semantic_score"],
    "properties": {
      "candidate_id": { "type": "integer" },
      "semantic_score": { "type": "number", "minimum": 0.0, "maximum": 1.0 }
    }
  }
}
```

### 10.4 Pipeline Hardening & Production Guarantees (v3.0 Specifications)
1. **Strict arXiv Extraction Sanitization**:
   - Anchors extraction strictly to arXiv-specific URL patterns (`arxiv.org/abs/`, `arxiv.org/pdf/`) or explicit `arxiv:` prefixes.
   - Prevents publisher DOIs containing 4-digit years and sequence numbers (e.g., `10.1109/iccv.2019.00069`) from emitting false `arxiv_id`.
   - Supports both modern format (`YYYY.NNNNN` / `YYYY.NNNNNvX`) and legacy categories (e.g., `hep-th/9901001`).

2. **Bounded SLM Candidate Pool & Pre-Filtering**:
   - Runs a sub-5ms BM25/lexical scoring pass immediately after deduplication.
   - Prunes the candidate pool to the top $N \le 8$ candidates before invoking the SLM reranker.
   - Truncates abstracts in SLM prompt context to a maximum of 600 characters or 120 words per candidate.
   - Uses a compact output schema returning only `{ "candidate_id": int, "semantic_score": float }` for sub-300ms latency.

3. **Rate-Limit & Circuit Breaker Defenses**:
   - Enforces provider query budgets: Semantic Scholar and arXiv receive strictly the primary query string (no combinatorial fan-out).
   - OpenAlex and Europe PMC multi-query concurrency is capped at $\le 3$ requests using polite pool headers (`mailto:`).
   - HTTP 429 on Semantic Scholar trips a 60-second in-memory circuit breaker that instantly falls back to OpenAlex.

4. **Abstract Imputation & Dynamic Weight Compensation**:
   - For works with missing or short abstracts ($<40$ characters), queries OpenAlex by canonical DOI to recover abstracts.
   - If unrecoverable, synthesizes query-context string: `f"Title: {title} | Venue/Journal: {journal} | Year: {year} (Note: Abstract unavailable)"`.
   - In the mathematical blender, missing abstracts dynamically shift weight to citation authority ($w_{\text{cit}} = 0.55, w_{\text{lex}} = 0.25$).

5. **Monograph Relevancy Floor & Semantic Isolation**:
   - Enforces a strict minimum relevance floor (`score >= 0.50`) for monographs/textbooks.
   - If no book meets $\ge 0.50$, the book slot is omitted entirely and backfilled with peer-reviewed papers.


