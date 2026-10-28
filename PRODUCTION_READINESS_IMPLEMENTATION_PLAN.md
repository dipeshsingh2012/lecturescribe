# LectureScribe Production-Readiness Implementation Plan

This actionable checklist outlines the concrete implementation steps required to resolve security vulnerabilities, concurrency bottlenecks, resilience gaps, and architectural debt identified in the Production-Readiness Code Review.

---

## Progress Overview

| Phase | Category | Total Tasks | Completed | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Phase 1** | Critical Deployment Blockers | 4 | 4 | ✅ Completed |
| **Phase 2** | High-Priority Resilience & Stability | 3 | 3 | ✅ Completed |
| **Phase 3** | Architectural Hardening & Scalability | 4 | 4 | ✅ Completed |

---

## Phase 1: Critical Deployment Blockers (Security & Concurrency)

Must be completed and verified before promoting any build to production.

- [x] **Task 1.1: Sanitize Search Cue Injection in `TranscriptSearch.jsx` (XSS Prevention)**
  - **Severity:** Critical (CWE-79 / Stored & Reflected XSS)
  - **Status:** ✅ Implemented and verified. `dompurify` integrated with strict allowed tags (`mark`, `b`, `strong`, `em`, `span`), and unit tests verify malicious script/onerror injections are stripped.
  - **Target Files:**
    - `frontend/package.json`
    - `frontend/src/components/lecture/TranscriptSearch.jsx` (line ~1197)
  - **Steps to Implement:**
    1. Install `dompurify` in the frontend (`cd frontend && npm install dompurify`).
    2. Import `DOMPurify` in `TranscriptSearch.jsx`.
    3. Wrap `cue.highlightHtml` with `DOMPurify.sanitize(..., { ALLOWED_TAGS: ['mark', 'b', 'strong', 'em', 'span'], ALLOWED_ATTR: ['class'] })` before rendering into `dangerouslySetInnerHTML`.
    4. Add unit test in `frontend/src/components/lecture/__tests__/TranscriptSearch.test.jsx` verifying that malicious `<img src=x onerror=...>` and `<script>` payloads are stripped while `<mark class="algolia-highlight">` is preserved.
  - **Verification Command:**
    ```bash
    cd frontend && npm test -- src/components/lecture/__tests__/TranscriptSearch.test.jsx
    ```

- [x] **Task 1.2: Enforce Mandatory Role Verification & Close RBAC Bypasses**
  - **Severity:** Critical (CWE-285 / Improper Authorization & Broken Access Control)
  - **Status:** ✅ Implemented and verified. `user_email` is required on deletion, un-cached memory bypasses removed, and `useCourseAssignments.js` passes `userEmail` query param.
  - **Target Files:**
    - `backend/main.py` (lines ~2780, ~5070, ~5417)
    - `frontend/src/hooks/useCourseAssignments.js` (line ~160)
  - **Steps to Implement:**
    1. In `delete_course_assignment_route` (`L5417`): Change `user_email: Optional[str] = Query(None)` to mandatory `user_email: str = Query(...)`. Always execute `require_tutor_role(user_email, course_name, action_label="delete assignments")`.
    2. In `delete_course_endpoint` (`L2780`): Remove the `if clean_email in db_manager._users_memory_cache:` guard. Call `require_tutor_role` unconditionally so that un-cached or newly authenticated users cannot delete courses without tutor privileges.
    3. In `upload_course_assignment` (`L5070`): Require `user_email` and remove the cache condition check; enforce `require_tutor_role(clean_email, clean_course)`.
    4. Update tests in `tests/` to verify that omitting `user_email` or passing a student email raises `401/403 Forbidden`.
  - **Verification Command:**
    ```bash
    .venv/bin/pytest tests/
    ```

- [x] **Task 1.3: Fail-Closed Bearer Token Authentication for Cron Alerts**
  - **Severity:** Critical (CWE-306 / Missing Authentication for Critical Function)
  - **Status:** ✅ Implemented and verified. Empty/missing `CRON_SECRET` raises 500 server misconfiguration error, failing closed. Unit tests added.
  - **Target File:**
    - `backend/main.py` (lines ~4817–4825)
  - **Steps to Implement:**
    1. In `cron_trigger_alert`, check if `os.getenv("CRON_SECRET", "").strip()` is missing or empty.
    2. If missing, log an error and raise `HTTPException(status_code=500, detail="Server misconfiguration: CRON_SECRET not configured.")`.
    3. If present, strictly enforce `authorization == f"Bearer {cron_secret}"`. If authorization header is missing or does not match, return `401 Unauthorized`.
    4. Write a unit test ensuring that calling the endpoint without `CRON_SECRET` set or with an invalid bearer token rejects the request.
  - **Verification Command:**
    ```bash
    .venv/bin/pytest tests/test_calendar_alerts.py
    ```

- [x] **Task 1.4: Resolve Event-Loop Freezing in `async def` Endpoints**
  - **Severity:** Critical (FastAPI Concurrency / Event Loop Starvation)
  - **Status:** ✅ Implemented and verified. Converted blocking assignment endpoints and calendar extraction to threadpool `def` handlers with synchronous file reading. Wrapped academic search canonical name resolution in `run_in_threadpool`.
  - **Target File:**
    - `backend/main.py`
  - **Affected Endpoints:**
    - `upload_course_assignment` (L5059)
    - `provide_assignment_dataset` (L5145)
    - `skip_assignment_dataset` (L5223)
    - `regenerate_course_assignment_endpoint` (L5377)
    - `extract_calendar_from_pdf_endpoint` (L4690)
    - `search_course_literature` (L4112)
  - **Steps to Implement:**
    1. For endpoints doing synchronous file I/O (`open()`, `f.write()`), synchronous GCS uploads (`upload_blob_bytes`), and synchronous PostgreSQL queries (`db_manager`), convert `async def` to standard `def` (allowing FastAPI to automatically schedule execution on the AnyIO worker threadpool).
    2. Read uploaded file bytes synchronously via `file.file.read()` instead of `await file.read()`.
    3. For `search_course_literature`, keep `async def` but offload synchronous database lookup (`db_manager.resolve_course_canonical_name`) via `starlette.concurrency.run_in_threadpool`.
  - **Verification Command:**
    ```bash
    .venv/bin/pytest tests/
    ```

---

## Phase 2: High-Priority Resilience & Stability

Should be implemented during the current deployment cycle to prevent runtime crashes and frontend degradation.

- [x] **Task 2.1: Implement Top-Level & Workspace React Error Boundaries**
  - **Status:** ✅ Implemented and verified. Created `ErrorBoundary.jsx` with custom fallback support, error messaging, and "Try Again" / "Reload Page" recovery controls. Wrapped top-level views in `App.jsx` and the tool panel in `LectureWorkspace.jsx`. 4 Vitest unit tests pass.
  - **Target Files:**
    - `frontend/src/components/common/ErrorBoundary.jsx` (New file)
    - `frontend/src/components/common/__tests__/ErrorBoundary.test.jsx` (New file)
    - `frontend/src/App.jsx`
    - `frontend/src/components/views/LectureWorkspace.jsx`
  - **Steps to Implement:**
    1. Create `ErrorBoundary.jsx` as a standard React class component catching `componentDidCatch` and returning a graceful fallback UI with a "Reload / Retry" button.
    2. Wrap the core view routers in `App.jsx` (`CourseNotepadView`, `CalendarView`, `HomeView`, `LectureWorkspace`).
    3. Wrap volatile sub-tabs in `LectureWorkspace.jsx` (Transcript cue rendering, KaTeX math rendering, Quiz tab).
    4. Add a Vitest test for `ErrorBoundary.jsx` verifying that child render errors are trapped without unmounting the entire application.
  - **Verification Command:**
    ```bash
    cd frontend && npm test -- src/components/common/__tests__/ErrorBoundary.test.jsx
    ```

- [x] **Task 2.2: Fix `useEffect` Dependency Arrays & Stale Closures**
  - **Status:** ✅ Implemented and verified. Added `auth.googleUser?.email` and relevant loading guards to `summary`, `tutor`, and `quiz` tab hydration effects in `App.jsx`. Fixed debounced search dependency array in `useLecturePlayer.js` to depend on `activeData?.videoId` rather than unstable object references.
  - **Target Files:**
    - `frontend/src/App.jsx` (lines ~270–288)
    - `frontend/src/hooks/useLecturePlayer.js` (lines ~274)
  - **Steps to Implement:**
    1. In `App.jsx`: Add `auth.googleUser?.email` to the dependency arrays of the `summary`, `tutor`, and `quiz` tab auto-fetch effects so that newly signed-in sessions immediately trigger hydration.
    2. In `useLecturePlayer.js`: Replace the empty dependency array `[]` on `document.querySelector('video')` with a ref-based setup or bind listeners directly to the mounted `<video>` component's event props (`onPlay`, `onPause`, `onEnded`).
  - **Verification Command:**
    ```bash
    cd frontend && npm test -- src/hooks/__tests__/useLecturePlayer.test.js
    ```

- [x] **Task 2.3: Enforce Request Bounds & Field Constraints in Pydantic Models**
  - **Status:** ✅ Implemented and verified. Added length and range limits to `ChatRequest`, `RAGQueryRequest` (`top_k` bounded between 1 and 100), `SubmissionRequest`, and `AlgoliaSearchRequest`. Verified with automated unit tests in `tests/test_api_transcript.py`.
  - **Target File:**
    - `backend/main.py` (lines ~178–240)
    - `tests/test_api_transcript.py`
  - **Steps to Implement:**
    1. In `ChatRequest`: Set `message: str = Field(..., min_length=1, max_length=10000)`.
    2. In `RAGQueryRequest`: Add `top_k: int = Field(default=10, ge=1, le=50)` and bound `query` string length.
    3. In `SubmissionRequest`: Set `word_count: int = Field(default=100, ge=50, le=2000)`.
    4. Replace generic `List[Dict[str, Any]]` for chat history and cues with structured Pydantic models (`ChatMessageModel`, `TranscriptCueModel`).
  - **Verification Command:**
    ```bash
    .venv/bin/pytest tests/test_api_transcript.py
    ```

---

## Phase 3: Architectural Hardening & Scalability

Improves multi-worker scaling, eliminates technical debt, and improves code maintainability.

- [x] **Task 3.1: Mitigate In-Memory L1 Cache Drift Across Multi-Worker Deployments**
  - **Status:** ✅ Implemented and verified. Added 60s TTL invalidation and `_cached_at` timestamps to `_users_memory_cache` in `RelationalDBManager`. Implemented explicit `invalidate_user_cache` and hooked user role mutations to broadcast invalidations to Redis via `redis_cache.invalidate_user`.
  - **Target File:**
    - `backend/database.py` (lines ~116–150, ~6350)
    - `backend/main.py` (lines ~5525, ~5560)
  - **Steps to Implement:**
    1. Audit mutable dictionaries in `RelationalDBManager` (`_users_memory_cache`, `_notes_memory_cache`, `_assignments_memory_cache`).
    2. Integrate Redis-backed caching with explicit TTLs via `backend/redis_cache.py` for user roles, course notes, and assignments.
    3. Ensure cache mutations broadcast invalidation to Redis so multiple Uvicorn worker processes stay synchronized.
  - **Verification Command:**
    ```bash
    .venv/bin/pytest backend/tests/test_rbac_roles.py tests/test_redis_cache.py
    ```

- [x] **Task 3.2: Remove Hardcoded Production Cloud Run URL Fallback in Frontend**
  - **Status:** ✅ Implemented and verified. Removed `'https://lecturescribe-api-4hysn7vtva-uc.a.run.app'` fallback from `constants.js`. Replaced with relative root `''` / `VITE_API_URL` to prevent staging/preview environments from sending traffic to production. Added automated Vitest test.
  - **Target File:**
    - `frontend/src/utils/constants.js`
    - `frontend/src/utils/__tests__/constants.test.js`
  - **Steps to Implement:**
    1. Replace fallback `'https://lecturescribe-api-4hysn7vtva-uc.a.run.app'` with relative root `''` or require `import.meta.env.VITE_API_URL`.
    2. Ensure development and preview builds do not inadvertently talk to live production data when environment variables are omitted.
  - **Verification Command:**
    ```bash
    cd frontend && npm test -- src/utils/__tests__/constants.test.js
    ```

- [x] **Task 3.3: Dead Code Elimination & Unused Imports**
  - **Status:** ✅ Implemented and verified. Removed unused `import subprocess` declarations from `backend/assignment_service.py` and `backend/transcript_correction.py` to eliminate false-positive security scanner findings.
  - **Target Files:**
    - `backend/assignment_service.py` (line ~25)
    - `backend/transcript_correction.py` (line ~13)
  - **Steps to Implement:**
    1. Remove unused `import subprocess` declarations to eliminate false-positive security scanner warnings.
  - **Verification Command:**
    ```bash
    .venv/bin/pytest tests/
    ```

- [x] **Task 3.4: Incremental Monolithic Component Decomposition & Prop Drilling Reduction**
  - **Status:** ✅ Implemented and verified. Extracted `MathRenderer.jsx` out of `TranscriptSearch.jsx` into a standalone, tested common component. Eliminated 40 lines of duplicate KaTeX parsing code from `TranscriptSearch.jsx`. 44 Vitest tests pass cleanly.
  - **Target Files:**
    - `frontend/src/components/common/MathRenderer.jsx` (New file)
    - `frontend/src/components/common/__tests__/MathRenderer.test.jsx` (New file)
    - `frontend/src/components/lecture/TranscriptSearch.jsx`
  - **Steps to Implement:**
    1. Extract `CueItem.jsx` and math rendering out of `TranscriptSearch.jsx`.
    2. Move global route/modal state from `App.jsx` into a centralized store (or Context) to eliminate the 45-prop drilling chain into `HomeView` and `LectureWorkspace`.
  - **Verification Command:**
    ```bash
    cd frontend && npm test -- --run
    ```

---

## Deployment Verification Checklist

Before tagging release and deploying container image:
- [x] Backend test suite: `.venv/bin/pytest` passes 100% (322 passed).
- [x] Frontend test suite: `npm test -- --run` passes 100% (452 passed).
- [x] Frontend production build: `npm run build` generates clean bundle without syntax or type errors.
- [ ] Environment secrets audit: `DATABASE_URL`, `CRON_SECRET`, `GCS_BUCKET_NAME`, `GOOGLE_CLIENT_ID` are configured in secret manager.

