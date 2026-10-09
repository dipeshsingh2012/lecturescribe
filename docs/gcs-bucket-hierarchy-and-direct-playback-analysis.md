# LectureScribe Architecture Guide: GCS Bucket Hierarchy & Direct Video Playback

> **Document Version:** 1.0.0  
> **Target Systems:** Google Cloud Storage (`lecturescribe-resources`), FastAPI Backend, React Frontend  
> **Related Files:** `backend/gcs_storage.py`, `backend/main.py`, `backend/database.py`, `frontend/src/components/lecture/LecturePlayer.jsx`, `frontend/src/hooks/useLecturePlayer.js`

---

## 1. Executive Summary

This document details the analysis of the current Google Cloud Storage bucket (`gs://lecturescribe-resources`), explains why each entry exists, establishes the ideal storage hierarchy that matches LectureScribe's course/lecture data model, and outlines the architectural roadmap for playing videos directly from Cloud Storage rather than relying on Vimeo iframes.

---

## 2. Bucket Inventory & Current Root Cause Analysis

A live inspection of `gs://lecturescribe-resources` identifies **14 total objects** split across two disparate folder prefixes:

### A. The `courses/` Namespace (9 Course Study Resources & Slides)

```text
courses/applied-mathemartics-for-data-science-and-ai/general/8624d0f637_Lectures_1_and_2.pdf
courses/applied-mathemartics-for-data-science-and-ai/general/fae0d1c58f_Lectures_1_and_2.pdf
courses/data-science-lab/general/691462f162_data_scienca_lab_assignment.pdf
courses/data-science-lab/general/cfadebf692_assignment1_26MDA017.pdf
courses/introduction-to-ai-in-healthcare/lectures/1227770906/58236c955d_AI_Healthcare_introduction_2026Sep17.pdf
courses/introduction-to-generative-ai/general/ffbadd02a5_Intro_to_GenAI.pdf
courses/introduction-to-research/general/61cccfa074_PPT-1.pdf
courses/machine-learning-paradigms/general/76593f3b66_MLP_Unit_1_Supervised_Learning_Regression__2_.pdf
courses/machine-learning-paradigms/lectures/1230001154/dd66c999cc_01_MLP_Introduction.pdf
```

**Why they are here:**
1. Produced by the **Course Resources & Slides Upload System** (`POST /api/resources/presign-upload` and `POST /api/resources/confirm-upload` in `backend/main.py`).
2. Handled via `GCSStorageService.get_resource_blob_path()`, which formats files into:
   - `courses/<course-slug>/general/<uuid>_<filename>` for course-wide documents (syllabi, lab manuals, general readings).
   - `courses/<course-slug>/lectures/<video-id>/<uuid>_<filename>` for slide decks attached to specific lecture recordings (e.g., lecture `1227770906` and `1230001154`).

---

### B. The `lectures/` Namespace (5 Lecture Bundle Assets)

```text
lectures/1234158181/captions.vtt
lectures/1234158181/download_guide.txt
lectures/1234158181/metadata.json
lectures/1234158181/summary.md
lectures/1234158181/transcript.md
```

**Why they are here:**
1. Produced by the **Browser Extension Bundle Uploader** (`POST /api/cloud/gcs/upload-bundle`).
2. In `backend/main.py`, the bundle uploader defaulted to `folder_prefix: "lectures"`.
3. When video `1234158181` (*"Introduction to AI in Healthcare Live session -3"*) was uploaded from the LMS, the extension only knew the Vimeo `videoId` (and not yet the parent course name), leading to an isolated root folder (`lectures/1234158181/`).
4. In reality, this lecture belongs directly to the course **"Introduction to AI in Healthcare"**, where lecture `1227770906` is already indexed.

---

## 3. Ideal Bucket Hierarchy (Mirroring Project Model)

The database schema (`lecturescribe_user_library`, `lecturescribe_resources`, `lecturescribe_videos`) operates on an entity hierarchy:
$$\text{Course} \longrightarrow \text{Lecture (Video ID)} \longrightarrow \text{Assets (Video, Captions, Notes, Slides)}$$

To make the bucket clean, intuitive, and deterministic, all assets for a given lecture should be unified in the same directory:

```text
gs://lecturescribe-resources/
└── courses/
    ├── <course-slug>/
    │   ├── general/                                  <-- Course-level materials (syllabi, labs)
    │   │   ├── lab_assignment.pdf
    │   │   └── course_syllabus.pdf
    │   │
    │   └── lectures/
    │       └── <video-id>/                           <-- Single source of truth for the lecture!
    │           ├── lecture_<video-id>.mp4            <-- The self-hosted MP4 video!
    │           ├── captions.vtt                      <-- WebVTT subtitles
    │           ├── transcript.md                     <-- Timestamped verbatim text
    │           ├── summary.md                        <-- AI Executive summary
    │           ├── metadata.json                     <-- Video length, parameters, stream data
    │           └── slides/                           <-- Professor's presentation slide decks
    │               └── lecture_slides.pdf
```

### Concrete Example: Video `1234158181`

Instead of being disconnected in `lectures/1234158181/`, it aligns under:

```text
courses/introduction-to-ai-in-healthcare/lectures/1234158181/
├── lecture_1234158181.mp4
├── captions.vtt
├── transcript.md
├── summary.md
├── metadata.json
└── slides/
    └── 58236c955d_AI_Healthcare_Live_Session_3.pdf
```

---

## 4. Architectural Roadmap: Direct GCS Video Playback

Currently, LectureScribe plays videos via a third-party iframe in `frontend/src/components/lecture/LecturePlayer.jsx`:
```jsx
<iframe src={`https://player.vimeo.com/video/${activeData.videoId}?api=1...`} />
```

Direct playback from GCS replaces the dependency on external Vimeo iframes, bypassing LMS domain restrictions, 403 CDN errors, and cookie blocks.

### Step 1: Backend Video URL Provisioning

When the frontend calls `GET /api/lecture/{video_id}` or `GET /api/course/{course}/lecture/{video_id}`:
1. The backend inspects whether `courses/<course-slug>/lectures/<video-id>/lecture_<video-id>.mp4` (or fallback `lectures/<video-id>/lecture_<video-id>.mp4`) exists in GCS.
2. If the blob exists, generate an inline V4 Signed URL valid for 2–4 hours:
   ```python
   video_url = gcs_storage_service.generate_download_signed_url(
       blob_name=blob_name,
       expires_minutes=180,
       disposition="inline"
   )
   ```
3. Return `gcs_video_url` and `captions_url` in the API payload.

---

### Step 2: Frontend Native Video Player Component

In `frontend/src/components/lecture/LecturePlayer.jsx`, implement a hybrid player:

```jsx
{activeData.gcs_video_url ? (
  <video
    ref={videoRef}
    controls
    playsInline
    className="lecture-native-player"
    src={activeData.gcs_video_url}
  >
    {activeData.captions_url && (
      <track
        kind="subtitles"
        src={activeData.captions_url}
        srcLang="en"
        label="English"
        default
      />
    )}
    Your browser does not support HTML5 video.
  </video>
) : (
  <iframe
    ref={iframeRef}
    src={`https://player.vimeo.com/video/${activeData.videoId}?api=1&autoplay=0`}
    allow="autoplay; fullscreen; picture-in-picture"
  />
)}
```

**Benefits:**
- **Zero Third-Party Dependency:** Completely immune to Vimeo downtime, privacy locks, or embed permissions.
- **Fast Buffering:** GCS directly streams through Google's edge CDN.
- **Graceful Fallback:** Videos not yet uploaded to GCS continue playing through Vimeo until uploaded.

---

### Step 3: Native Transcript Synchronization

Currently, `frontend/src/hooks/useLecturePlayer.js` loads the `@vimeo/player` JavaScript SDK and communicates via `postMessage`.

With an HTML5 `<video>` element, timestamp synchronization uses standard DOM events:
1. **Interactive Cue Highlighting:**
   ```javascript
   videoRef.current.ontimeupdate = () => {
     const currentSeconds = Math.floor(videoRef.current.currentTime);
     syncActiveTranscriptCue(currentSeconds);
   };
   ```
2. **Jump to Timestamp on Transcript Click:**
   ```javascript
   const handleCueClick = (seconds) => {
     if (videoRef.current) {
       videoRef.current.currentTime = seconds;
       videoRef.current.play();
     }
   };
   ```

---

## 5. Migration Strategy for Existing Bucket Objects

When ready to unify existing assets without breaking live database links:

1. **Move Bundle to Course Path in GCS:**
   ```bash
   gcloud storage cp -r \
     gs://lecturescribe-resources/lectures/1234158181/* \
     gs://lecturescribe-resources/courses/introduction-to-ai-in-healthcare/lectures/1234158181/
   ```
2. **Update Database Record in `lecturescribe_resources`:**
   ```sql
   UPDATE lecturescribe_resources
   SET blob_name = REPLACE(blob_name, 'lectures/1234158181/', 'courses/introduction-to-ai-in-healthcare/lectures/1234158181/')
   WHERE video_id = '1234158181';
   ```
3. **Delete Deprecated Prefix:**
   ```bash
   gcloud storage rm -r gs://lecturescribe-resources/lectures/1234158181/
   ```

