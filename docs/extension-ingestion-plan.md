# Extension Lecture Ingestion Plan

## Current gap

The web URL input calls `/api/transcript`, which saves the lecture and indexes
available captions. The extension's GCS action calls a separate upload route.
It can extract captions, but it does not run the same import, persistence, and
indexing flow. The extension also does not currently send LMS course or page
details.

## Plan

1. **Preserve the existing URL import behavior.** Extract the shared import work
   so both the current URL input and the extension use the same code path,
   keeping existing URL behavior intact.

2. **Add an extension import request.** Accept the captured Vimeo player config
   plus video details, LMS page URL, and course name. Run the same save,
   summary, search-index, and course-association steps as URL import. Return
   import errors explicitly.

3. **Capture LMS context in the extension.** Update `extension/content/content.js`
   to include the current LMS page URL and course breadcrumb when available.
   Use the detected video details already tracked by
   `extension/background/background.js` to supply player config when the badge
   is on the LMS page. If course metadata is unavailable, fall back to the
   existing import behavior and let the user assign the course in LectureScribe.

4. **Make the badge offer exactly two actions.**
   - **Open LectureScribe**: keep the current open-workspace behavior.
   - **Copy to LectureScribe**: run the shared import, then open the imported
     lecture in its course context when known.

5. **Remove the extension's GCS upload controls and caller.** Remove the GCS
   action from the badge and extension popup so it cannot be triggered from the
   extension. Leave the backend GCS route available.

6. **Update extension documentation and verify.** Document the two actions in
   `extension/README.md`. Add focused backend coverage alongside
   `tests/test_api_transcript.py` and validate that the existing URL import
   still behaves as before.

## Scope

This document records the agreed implementation plan only. No implementation
changes are included.
