# LectureScribe Project TODOs

## Priority 1: Moodle Source URL & Cloud Storage Deep-Linking

- [ ] **Extension: Auto-Save Moodle Source URL to Database**
  - In `extension/content/content.js`: When a Vimeo video is detected on Moodle (`learning.iiitdwd.ac.in`), capture the current page URL (`window.location.href`) and Moodle breadcrumb course title.
  - Automatically sync this mapping to LectureScribe via a background call to `POST /api/moodle/map-video` (or during `UPLOAD_TO_GCS`).
  - Store `moodle_url` / `source_url` in the PostgreSQL database (`lecturescribe_videos` and `lecturescribe_user_library`).

- [ ] **Backend: Moodle URL Mapping Endpoint**
  - Add `POST /api/moodle/map-video` in `backend/main.py`.
  - Update `lecturescribe_videos` schema/table to ensure `source_url` or `moodle_url` stores the actual Moodle page link (e.g., `https://learning.iiitdwd.ac.in/mod/page/view.php?id=3111`) rather than raw `https://vimeo.com/<id>`.

- [ ] **Frontend: Deep-Link & Broken Video Indicator**
  - In `LecturePlayer.jsx`: Detect when a lecture video only has a broken Vimeo embed and is not yet in GCS.
  - Render an actionable placeholder with the linking strategy below.

### Moodle URL Linking Strategies (Implementation Options)

1. **Strategy A: Native Moodle Course Search (Immediate fallback)**
   - Link format: `https://learning.iiitdwd.ac.in/course/search.php?search={encodeURIComponent(course_name)}`
   - Lands directly on search results for the course on Moodle. Works for all existing lectures without storing Moodle IDs.
   - Include a 1-click `[📋 Copy Session Title]` button (e.g., `Live session -3`) so the user can locate the recording in seconds.

2. **Strategy B: Static Moodle Course ID Table (1-Click to Course Home)**
   - Maintain a course ID lookup dictionary in `backend/database.py` or frontend for the 8 active courses:
     - `Introduction to AI in Healthcare` -> `course/view.php?id=<id>`
     - `Machine Learning Paradigms` -> `course/view.php?id=<id>`
     - `Data Science Lab` -> `course/view.php?id=<id>`
     - etc.
   - Opens the course main page directly on Moodle where all lecture session links reside.

3. **Strategy C: Extension Smart Hash Locator (Automated Seek & Sync)**
   - Link format: `https://learning.iiitdwd.ac.in/my/#ls-locate-course={course}&session={session}&vid={video_id}`
   - Extension content script intercepts the hash on Moodle:
     - Automatically matches and clicks the course card on the user's Moodle dashboard (`/my/`).
     - Scans the course topic page for the matching session link/title.
     - Navigates directly to the sub-page (`mod/page/view.php?id=...`), captures stream tokens, and triggers GCS sync.

4. **Strategy D: Exact Page URL from Extension Capture (Permanent Resolution)**
   - Once the user visits the page or Strategy C runs once, the extension stores the exact `https://learning.iiitdwd.ac.in/mod/page/view.php?id=...` URL in PostgreSQL.
   - Future deep-links go straight to the video sub-page: `mod/page/view.php?id={id}#ls-sync=1`.

- [ ] **Frontend: Native GCS Video Player**
  - In `LecturePlayer.jsx`: If `gcs_video_url` exists in the lecture payload, switch from Vimeo `<iframe>` to native HTML5 `<video>` player with WebVTT subtitle track.
  - Adapt `useLecturePlayer` to sync transcript cues using standard `video.ontimeupdate` and `video.currentTime`.

## Completed
- [x] Adaptive HLS fragmented MP4 downloader & muxer via `yt-dlp` and `imageio-ffmpeg` in `backend/gcs_storage.py`.
- [x] Stream progressive MP4 & adaptive HLS directly into Google Cloud Storage bucket (`gs://lecturescribe-resources`).
- [x] Extension MV3 packaging for Chrome and Firefox in `extension/dist/`.
- [x] Cloud deployment architectural guides for Cloud Run and Cloud Functions Gen 2 (`docs/`).
- [x] GCS bucket hierarchy and direct playback architectural analysis (`docs/`).

