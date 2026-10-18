# Academic PDF & Literature Viewer Architecture & Implementation

## Overview
Academic publishers (e.g., JAMA Network, Elsevier/ScienceDirect, Springer Nature, Wiley, New England Journal of Medicine) return HTTP headers such as `X-Frame-Options: SAMEORIGIN` or `Content-Security-Policy: frame-ancestors 'self'`. When the application attempts to render these papers in an `<iframe>`, the browser blocks the embed, causing a 403 Forbidden or "refused to connect" error. Furthermore, standard DOM security suppresses cross-origin error notifications to the parent frame, resulting in silent failures (an empty canvas).

This document establishes the architectural approach, risk mitigations, implementation roadmap, and real-time execution tracker.

---

## Progress Tracker

- [x] **Step 1: Publisher Restriction Detector Utility**
  - [x] Implement `frontend/src/utils/publisherDetect.js` to detect known commercial publishers, DOI links, and non-embeddable sites.
  - [x] Unit tests for publisher detection in `frontend/src/utils/__tests__/publisherDetect.test.js`.
- [x] **Step 2: Upgrade BookReaderModal for Papers & Restricted Publishers**
  - [x] Add rich Abstract & Metadata Reader UI view in `frontend/src/components/modals/BookReaderModal.jsx`.
  - [x] Support "Open on Publisher Website", "Copy Citation", and "Copy DOI" action buttons.
  - [x] Display publisher framing restriction notice with context badge.
  - [x] Unit & component tests in `frontend/src/components/modals/__tests__/BookReaderModal.test.jsx`.
- [x] **Step 3: Upgrade ResourcePreviewModal for PDF Fallback**
  - [x] Add domain check and timeout detection in `frontend/src/components/modals/ResourcePreviewModal.jsx`.
  - [x] Render graceful fallback UI when iframe fails or cannot be rendered.
  - [x] Update tests in `frontend/src/components/modals/__tests__/ResourcePreviewModal.test.jsx`.
- [x] **Step 4: Secure Open-Access PDF Proxy Endpoint (Backend)**
  - [x] Implement `/api/literature/pdf-proxy` with strict SSRF guardrails and allowlist in `backend/main.py`.
  - [x] Add backend unit tests in `backend/tests/test_pdf_proxy.py`.
- [x] **Step 5: Verification & End-to-End Regression Testing**
  - [x] Run frontend test suite (`npm run test` -> 44 test files, 326 tests passed).
  - [x] Run backend test suite (`pytest backend/tests/test_pdf_proxy.py` -> 8 tests passed).
  - [x] End-to-end verification with Sepsis-3 JAMA paper.

---

## Architectural Options Evaluated

### Option A: Backend Proxy Route
- **Concept:** Proxy the PDF byte stream through the LectureScribe FastAPI backend, stripping `X-Frame-Options` and `Content-Security-Policy`.
- **Pros:** Full in-app reading experience for unobstructed direct PDFs.
- **Cons & Risks:** Commercial publishers (JAMA, Elsevier) deploy Cloudflare/Akamai bot detection and IP blocking on cloud servers; high server egress bandwidth; SSRF vulnerabilities if unconstrained.

### Option B: Local Caching / Pre-storage
- **Concept:** Pre-download and cache landmark papers in local disk or Google Cloud Storage (GCS).
- **Pros:** Fast in-app rendering for specific cached papers.
- **Cons & Risks:** Copyright & redistribution licensing concerns with commercial publishers; does not scale to arbitrary user searches.

### Option C: Graceful Fallback UI (Abstract & External Launch)
- **Concept:** Intercept restricted domains and present a rich bibliographic summary with full abstract, metadata, and 1-click external launch to the official publisher article.
- **Pros:** 100% immune to publisher bot blocks, zero copyright friction, supports institutional library SSO for students, zero backend server load.
- **Cons:** Paper full text is viewed in a companion tab rather than inline.

### Adopted Hybrid Architecture
1. **Commercial / Paywalled Publishers (JAMA, Elsevier, Wiley, etc.):** Routed directly to the **Rich Abstract & Metadata Reader Card** in `BookReaderModal` with 1-click official publisher launch.
2. **Verified Open-Access Direct PDFs (arXiv, Europe PMC, PubMed Central):** Streamed through a secure SSRF-guarded backend proxy or embedded directly.
3. **General Resource Preview:** Protected with publisher detection and timeout fallback in `ResourcePreviewModal`.

---

## Implementation Details

### 1. Publisher Detector Regex & Rules
Identifiers for:
- JAMA Network (`jamanetwork.com`)
- Elsevier / ScienceDirect (`sciencedirect.com`, `elsevier.com`)
- Springer Nature (`springer.com`, `nature.com`)
- Wiley Online Library (`wiley.com`)
- New England Journal of Medicine (`nejm.org`)
- Oxford Academic (`academic.oup.com`)
- DOI URLs (`doi.org`)

### 2. Security (SSRF Protection)
For the backend proxy endpoint:
- Protocol restriction: `https://` only.
- IP restriction: Reject private, loopback, link-local, and reserved IPv4/IPv6 addresses.
- Domain allowlist: Explicitly allow only trusted open-access repositories (`europepmc.org`, `arxiv.org`, `ncbi.nlm.nih.gov`, `pmc.ncbi.nlm.nih.gov`, `openalex.org`).
- Streaming: Chunked streaming with max size limit (25 MB) and 15s timeout.
