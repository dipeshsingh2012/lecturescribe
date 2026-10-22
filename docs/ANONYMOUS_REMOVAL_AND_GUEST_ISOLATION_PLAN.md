# Plan: Removal of "Anonymous" References & Clean Guest State Architecture

**Created:** 2026-10-22  
**Status:** Planned / Documented for Implementation  
**Related Docs:** [`docs/LECTURE_LOAD_OPTIMIZATION_AND_GUEST_ARCHITECTURE.md`](file:///home/dipes/projects/lecturescribe/docs/LECTURE_LOAD_OPTIMIZATION_AND_GUEST_ARCHITECTURE.md)

---

## 1. Executive Summary & Problem Statement

Currently, the literal string `'anonymous'` is used as a hardcoded fallback throughout the frontend and backend whenever `user_email` is `null`, `undefined`, or empty:
1. **Shared State Between Unauthenticated Users:** Multiple guests watching lectures or taking quizzes share the same `'anonymous'` rows in PostgreSQL and in-memory caches, overwriting each other's progress and scores.
2. **Ghost Redis Cache Purging:** Endpoints like `POST /api/progress/lecture` run `redis_cache.invalidate_user("anonymous")` even for logged-in users, causing confusing cache invalidation notices.
3. **Database Schema Constraints:** Tables like `lecturescribe_lecture_progress` and `lecturescribe_quiz_attempts` have `user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous'` and unique compound constraints on `(user_email, ...)` which originally drove the introduction of the non-null string placeholder.

---

## 2. Complete Inventory of Occurrences (29 in Source)

### Backend Database Layer (`backend/database.py` — 15 occurrences)
- **Line 442:** `CREATE TABLE lecturescribe_quiz_attempts` — `user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous'`
- **Line 589:** `CREATE TABLE lecturescribe_lecture_progress` — `user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous'`
- **Line 1359:** `save_lecture_progress()` — `clean_email = user_email.strip().lower() if user_email and user_email.strip() else "anonymous"`
- **Lines 1450, 1454, 1488–1489:** `get_lecture_progress()` — SQL filter `user_email IN (%s, 'anonymous')` and memory cache check `("anonymous", video_id)`
- **Lines 1517–1518, 1524, 1549:** `get_user_progress_map()` — SQL filter `user_email IN (%s, 'anonymous')` and memory cache lookup
- **Line 2032:** `save_quiz_attempt()` — `email = str(user_email or "anonymous").strip().lower()`
- **Line 2079:** `get_quiz_attempt()` — `email = str(user_email or "anonymous").strip().lower()`
- **Line 2127:** `delete_quiz_attempt()` — `email = str(user_email or "anonymous").strip().lower()`
- **Line 4632:** `save_annotation()` — `clean_email = (user_email or "anonymous").strip().lower()`

### Backend API Layer (`backend/main.py` — 7 occurrences)
- **Line 245:** `CreateAnnotationRequest` — `user_email: Optional[str] = Field(default="anonymous", ...)`
- **Line 789, 798:** `POST / DELETE /api/lecture/{video_id}/quiz/answers` — `email = req.user_email or "anonymous"`
- **Line 1536:** `POST /api/lecture/{video_id}/annotations` — `user_email=req.user_email or "anonymous"`
- **Line 2584:** `POST /api/progress/lecture` — `target_email = req.user_email.strip().lower() if req.user_email and req.user_email.strip() else "anonymous"`
- **Line 2886, 2919:** `POST / DELETE /api/course/{course_slug}/quiz/answers` — `email = req.user_email or "anonymous"`

### Frontend Hooks & Components (`frontend/src/` — 10 occurrences)
- **`frontend/src/hooks/useLecturePlayer.js` (Lines 403, 671):**
  `user_email: effectiveUserEmail || 'anonymous'`
- **`frontend/src/hooks/useLectureIngestion.js` (Lines 380, 381):**
  `user_email: userEmail || 'anonymous'`, `email: userEmail || 'anonymous'`
- **`frontend/src/hooks/useLectureQuiz.js` (Line 122):**
  `user_email: email || 'anonymous'`
- **`frontend/src/hooks/useCourseQuiz.js` (Lines 165, 191):**
  `user_email: userEmail || 'anonymous'`
- **`frontend/src/components/lecture/TextSelectionToolbar.jsx` (Lines 47, 85, 180):**
  `user_email: userEmail || 'anonymous'`

### Migrations & Design Docs (2 occurrences)
- `migrations/versions/8b42fca1e321_create_lecture_progress_table.py:27`
- `docs/LECTURE_LOAD_OPTIMIZATION_AND_GUEST_ARCHITECTURE.md:77`

---

## 3. Implementation Steps

### Phase 1: Database Schema & Migration
1. **Make `user_email` Nullable in Database Tables:**
   ```sql
   ALTER TABLE lecturescribe_lecture_progress ALTER COLUMN user_email DROP DEFAULT;
   ALTER TABLE lecturescribe_lecture_progress ALTER COLUMN user_email DROP NOT NULL;

   ALTER TABLE lecturescribe_quiz_attempts ALTER COLUMN user_email DROP DEFAULT;
   ALTER TABLE lecturescribe_quiz_attempts ALTER COLUMN user_email DROP NOT NULL;

   ALTER TABLE lecturescribe_transcript_annotations ALTER COLUMN user_email DROP NOT NULL;
   ```
2. **Update Unique Constraints:**
   - In PostgreSQL, compound unique constraints with NULL can use `COALESCE` index or `NULLS NOT DISTINCT` (PG15+):
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS uq_lecture_progress_user_video_idx 
       ON lecturescribe_lecture_progress (COALESCE(user_email, ''), video_id);
     CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempt_idx 
       ON lecturescribe_quiz_attempts (quiz_type, target_id, COALESCE(user_email, ''));
     ```
3. **Data Cleanup Migration:**
   - Migrate existing legacy `'anonymous'` rows:
     ```sql
     UPDATE lecturescribe_lecture_progress SET user_email = NULL WHERE user_email = 'anonymous';
     UPDATE lecturescribe_quiz_attempts SET user_email = NULL WHERE user_email = 'anonymous';
     UPDATE lecturescribe_transcript_annotations SET user_email = NULL WHERE user_email = 'anonymous';
     ```

### Phase 2: Database Manager Updates (`backend/database.py`)
1. In `save_lecture_progress`:
   - Replace `"anonymous"` fallback with `clean_email = user_email.strip().lower() if user_email and user_email.strip() else None`.
   - Store `NULL` / `clean_email` in DB.
2. In `get_lecture_progress` & `get_user_progress_map`:
   - Remove `IN (%s, 'anonymous')` condition. Only query for `user_email = %s` if email is provided, or `user_email IS NULL` if unauthenticated.
3. In `save_quiz_attempt`, `get_quiz_attempt`, `delete_quiz_attempt`:
   - Replace `"anonymous"` fallback with `None` or `COALESCE(user_email, '')`.
4. In `save_annotation`:
   - Accept `user_email: Optional[str] = None`. Store `None` if unauthenticated.

### Phase 3: Backend API Endpoints (`backend/main.py`)
1. **Request Schemas:**
   - In `CreateAnnotationRequest`, change `default="anonymous"` to `default=None`.
   - In `SaveLectureProgressRequest`, ensure `user_email` defaults to `None`.
2. **Redis Invalidation Guards:**
   - In `save_lecture_progress_endpoint` and quiz answer endpoints, only call `redis_cache.invalidate_user` if `clean_email` is a valid string:
     ```python
     if redis_cache and clean_email:
         redis_cache.invalidate_user(clean_email)
     ```
   - Never pass or invalidate `"anonymous"`.

### Phase 4: Frontend Hook & Component Updates
1. **`useLecturePlayer.js`:**
   - Change `user_email: effectiveUserEmail || 'anonymous'` to `user_email: effectiveUserEmail || null`.
2. **`useLectureIngestion.js`:**
   - Pass `user_email: userEmail || null`.
3. **`useLectureQuiz.js` & `useCourseQuiz.js`:**
   - Pass `user_email: email || null`.
4. **`TextSelectionToolbar.jsx`:**
   - Pass `user_email: userEmail || null`.

### Phase 5: Verification & Automated Tests
1. Run all frontend test suites:
   ```bash
   npm --prefix frontend test -- --run
   ```
2. Run backend test suite:
   ```bash
   .venv/bin/pytest backend/tests/
   ```
3. Validate API contract via manual smoke tests on `/api/progress/lecture` and `/api/lecture/{id}/quiz/answers` without authentication, ensuring:
   - Status 200 OK without errors.
   - Zero Redis log messages referencing `'anonymous'`.
   - No cross-tenant data leaks between guest sessions.

