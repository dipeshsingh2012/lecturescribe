# LectureScribe - Optimization & Architecture Discussion Summary
**Date:** 2026-10-14  
**Topic:** Reducing Lecture Load Time, Fixing Root Causes (#2 User Library Auto-Mapping & #3 GCS Blob Lookup), and Guest-to-User Data Migration Mechanics.

---

## 1. Initial Request & Problem Breakdown
**Log Sequence Analyzed:**
```text
[DB Cache Hit] Video '1233856717' found in database. Skipping transcript and summary re-generation.
🗑️ [Redis Cache] Invalidated user cache for 'dipesh.singh2012@gmail.com' (2 keys removed).
INFO: 127.0.0.1:56224 - "GET /api/transcript?url=https%3A%2F%2Fvimeo.com%2F1233856717&email=dipesh.singh2012%40gmail.com&course_name=1-3-introduction-to-speech-and-natural-language-processing HTTP/1.1" 200 OK
INFO: 127.0.0.1:49726 - "GET /api/lecture/1233856717/annotations HTTP/1.1" 200 OK
INFO: 127.0.0.1:49730 - "GET /api/lecture/1233856717/resources?course_name=1.3%20Introduction%20to%20Speech%20and%20Natural%20Language%20Processing HTTP/1.1" 200 OK
```

### Initial Profiling (Cold/Fresh Connection to Remote Neon Postgres in AWS us-east-1):
- `_get_connection` bare TLS handshake & auth: **~2,475 ms** per connection!
- Every single DB helper in `database.py` was doing:
  ```python
  conn = self._get_connection()
  try: ...
  finally: conn.close()
  ```
- Because a typical request invoked 3-5 helper calls sequentially, each request spent **~10-15 seconds** just re-establishing SSL/TLS TCP connections to Postgres.
- `auto_map_videos_to_user`: **~3,824 ms** (ran full table updates & inserts every time a lecture was opened).
- `find_lecture_video`: **~1,134 ms** (scanned GCS prefixes and fell back to listing `courses/` blobs).
- `get_annotations`: **~5,237 ms**
- `get_lecture_resources`: **~2,403 ms**

---

## 2. Changes Made So Far

### 1. Transparent Connection Pooling (`backend/database.py`)
- Subclassed `psycopg2.extensions.connection` (`_PooledConnection`) so existing `conn.close()` calls return connections to an idle pool rather than terminating the socket.
- Added idle pool management (`_pg_pool_idle`), keepalive parameters, fork-safety checks (PID mismatch detection), and pre-ping validation for connections idle >30 seconds.
- **Result:** After pool warmup, connection acquisition dropped from **2,475 ms to < 1 ms**.

### 2. Request-Path Concurrency (`backend/main.py`)
- Independent network calls on the lecture import / cache-hit path (Neon Postgres queries vs. GCS lookup) now run concurrently via `_lecture_io_executor` (`ThreadPoolExecutor(max_workers=16)`).

---

## 3. Addressing the Critique on Points #2 and #3 (Defensive Workarounds vs. Root Cause)

The user correctly pushed back:
> *"point no 2 and point 3 sound not very convincing, did you code defensively instead of fixing the underlying root cause"*

### Point #2 Root Cause:
- `auto_map_videos_to_user` was an old migration/backfill hack that was accidentally left in the request execution path (`record_user_lecture`).
- It tried to assign unassigned videos to whichever user happened to load a lecture, copying every video into that user's library.
- **Root Cause Fix:** 
  - Delete `auto_map_videos_to_user` entirely from the request path.
  - User libraries should strictly record only the lectures that the user explicitly opens or imports (`record_user_lecture`).

### Point #3 Root Cause:
- Video upload workers (`_async_upload_video_to_gcs_worker`) uploaded the MP4 to GCS, but **never saved the resulting GCS blob name / URI into PostgreSQL (`lecturescribe_videos`)**.
- As a consequence, every lecture visit had to blindly guess folder prefixes or list GCS buckets to see if the video existed.
- **Root Cause Fix:**
  - Add a `gcs_video_blob` column to `lecturescribe_videos`.
  - When background upload finishes, write `blob_name` into `lecturescribe_videos`.
  - On read, `get_saved_video` returns `gcs_video_blob` directly. Creating signed URLs locally takes **~1 ms** without querying GCS.

---

## 4. User Inquiries on Guest Users & "Claim on Login"

### User Questions:
1. *"The libraries are personal, every resource should be mapped to an user, but resources can also exist for non-logged-in users. Suggest fixes."*
2. *"Claim on login: should a guest's library, notes and progress move into their account when they log in, or start fresh? How to move the data? How will we ever know?"*

### Detailed Explanation: How Does "Claim on Login" Actually Work? How Do We Know?

#### Why We Need a Guest Identity (e.g. `guest_id`)
Currently, non-logged-in users have no distinct identity:
- Some tables use `NULL`, some use `''`, and some store the literal string `'anonymous'`.
- This causes **all guests to share the exact same state** (e.g. quiz attempts, progress). If Guest A marks progress, Guest B sees it.
- **Fix:** Assign every guest a persistent client-side identifier.

#### Step-by-Step Architecture for Claiming Data:
1. **Frontend Generates a UUID on First Visit:**
   - In browser `localStorage`, check for `lecturescribe_guest_id`.
   - If not found, generate one: `crypto.randomUUID()` (e.g., `guest_9a7f2c81-4b3e-49b0-91c2-3e4a2e5d1b7f`).
   - All unauthenticated API requests send this ID (e.g. `X-Guest-Id: guest_...` or query param `guest_id=...`).

2. **Backend Associates Guest Actions with `guest_id`:**
   - When a non-logged-in user watches a lecture, creates a note, saves a resource, or does a quiz, the row is saved with `owner_id = "guest:9a7f2c81..."` (or `user_email = NULL, guest_id = "..."`).

3. **How Does the Backend "Know" When They Log In?**
   - When the user signs in with Google (OAuth / ID token), the frontend has **both**:
     - The existing `guest_id` from `localStorage`
     - The authenticated `user_email` from Google auth
   - Right after successful login, the frontend calls a migration endpoint:
     ```http
     POST /api/auth/claim-guest-data
     Content-Type: application/json

     {
       "guest_id": "guest_9a7f2c81-4b3e-49b0-91c2-3e4a2e5d1b7f",
       "user_email": "dipesh.singh2012@gmail.com"
     }
     ```

4. **Atomic Database Transfer (Claim Transaction):**
   - The backend runs a single atomic transaction:
     ```sql
     -- Transfer notes
     UPDATE lecturescribe_transcript_annotations 
     SET user_email = 'dipesh.singh2012@gmail.com', guest_id = NULL
     WHERE guest_id = 'guest_9a7f2c81...';

     -- Transfer custom uploaded resources
     UPDATE lecturescribe_resources
     SET user_email = 'dipesh.singh2012@gmail.com', guest_id = NULL
     WHERE guest_id = 'guest_9a7f2c81...';

     -- Transfer library items (merge with existing if conflict)
     INSERT INTO lecturescribe_user_library (user_email, video_id, title, duration, source_url, course_name, last_viewed_at)
     SELECT 'dipesh.singh2012@gmail.com', video_id, title, duration, source_url, course_name, last_viewed_at
     FROM lecturescribe_guest_library
     WHERE guest_id = 'guest_9a7f2c81...'
     ON CONFLICT (user_email, video_id) DO UPDATE 
     SET last_viewed_at = GREATEST(lecturescribe_user_library.last_viewed_at, EXCLUDED.last_viewed_at);

     -- Clean up guest records
     DELETE FROM lecturescribe_guest_library WHERE guest_id = 'guest_9a7f2c81...';
     ```

5. **Client-Side Finalization:**
   - Once the claim API returns `200 OK`, the frontend deletes `lecturescribe_guest_id` from `localStorage`.
   - The user seamlessly sees all lectures they watched, notes they wrote, and resources they created as a guest now preserved in their personal account.

---

## 5. Next Steps Roadmap
1. **Immediate Root-Cause Fixes:**
   - Remove `auto_map_videos_to_user` and the throttling patch from `backend/database.py`.
   - Add `gcs_video_blob` column to `lecturescribe_videos`.
   - Update `_async_upload_video_to_gcs_worker` to persist the blob name into Postgres upon upload completion.
   - Update `get_saved_video` and `find_lecture_video` to use the stored blob name directly.
2. **Guest Identity & Data Claim System:**
   - Implement `guest_id` generation in frontend.
   - Implement `/api/auth/claim-guest-data` endpoint and data transfer logic.

---

## 6. Open Questions & Decisions for the User

1. **Claim on Login Strategy:**
   - Should a guest's library, notes, resources, and progress automatically merge into their account upon login, or should guests start completely fresh? (Recommended: Automatic merge via `/api/auth/claim-guest-data`).
2. **Storage Location for `guest_id`:**
   - `localStorage` vs. `httpOnly` cookie:
     - `localStorage` is accessible by both the web app and the Chrome extension easily.
     - `httpOnly` cookie is more tamper-resistant, but more cumbersome across subdomains/extensions.
3. **Retention Policy for Unclaimed Guest Data:**
   - If a guest never logs in, how long should their abandoned records (notes, progress, library items) be kept? (e.g., auto-purge after 30/60/90 days of inactivity via a cleanup cron job, or keep indefinitely?).
4. **Historical Auto-Mapped Data Cleanup:**
   - How should existing library rows previously created by `auto_map_videos_to_user` be handled?
   - Option A: Delete library rows where `last_viewed_at == videos.created_at` and the user has 0 progress, 0 chat logs, and 0 notes for that video.
   - Option B: Run a dry-run report first to inspect which rows would be pruned before executing any DELETE.
5. **Implementation Phasing:**
   - **Phase 1:** Fix the database bottleneck and GCS blob storage root causes (remove `auto_map`, add `gcs_video_blob` column, eliminate redundant lookups).
   - **Phase 2:** Implement guest identity token (`guest_id`) and the login claiming/migration endpoint.

