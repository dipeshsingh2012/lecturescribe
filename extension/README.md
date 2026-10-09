# 🎓 LectureScribe - Browser Extension (Chrome & Firefox)

> **Vimeo Video Capture & AI Tutor Companion for LectureScribe**
> Universal Manifest V3 extension compatible with **Google Chrome, Mozilla Firefox, Brave, Microsoft Edge, and Arc**.
> Automatically detects Vimeo lectures and embedded players on any webpage or LMS (Canvas, Blackboard, Coursera, Moodle, etc.) and connects them directly to your LectureScribe workspace.

---

## 🚀 Key Features

1. **Cross-Browser Manifest V3 Architecture:**
   - Universal `browser` / `chrome` API polyfill wrapper for 100% interoperability.
   - Includes official `browser_specific_settings.gecko` configuration for Firefox Add-ons.
   - Native async/await operations throughout background, content, popup, and options scripts.

2. **Universal Vimeo Detection:**
   - Detects Vimeo video pages (`vimeo.com/*`).
   - Detects embedded Vimeo players (`player.vimeo.com/video/*`).
   - Detects nested iframes and LMS video embeds (`all_frames: true`).
   - Dynamic scanning via `MutationObserver` for single-page applications (Canvas, Moodle, Coursera).

3. **On-Page Floating Action Badge:**
   - Injects a sleek, non-intrusive floating pill directly over detected Vimeo players.
   - Quick 1-click options:
     - 🚀 **Open Workspace**: Launches `/lecture/{videoId}`.
     - 📝 **AI Summary**: Launches `/lecture/{videoId}?tab=summary`.
     - 🤖 **AI Tutor**: Launches `/lecture/{videoId}?tab=tutor`.
     - ☁️ **Upload to GCS**: 1-click export of the lecture bundle directly to Google Cloud Storage.
     - 📋 **Copy Video ID**: Copies clean numeric ID to clipboard.

4. **1-Click Google Cloud Storage (GCS) Export:**
   - Dedicated **"☁️ Upload to Google Cloud Storage"** button in both the popup and floating player badge.
   - Automatically packages and uploads to `gs://[bucket]/lectures/[videoId]/`:
     - `summary.md`: AI Executive Summary & Core Takeaways
     - `transcript.md`: Verbatim timestamped transcript
     - `captions.vtt`: WebVTT subtitle track
     - `metadata.json`: Video specifications, durations, and streaming endpoints
     - `download_guide.txt`: Offline CLI commands (`ffmpeg`, `yt-dlp`, `vlc`)
   - Direct clickable link to the folder in the Google Cloud Console.

5. **Extension Action Popup:**
   - Displays real-time count of detected videos on the active browser tab.
   - Live backend status indicator (`http://localhost:8000` or production Cloud Run API).
   - Instant DB cache check (highlights lectures already summarized and stored).
   - Manual ingest form to paste any Vimeo URL or ID on demand.

6. **Context Menu & Deep Linking:**
   - Right-click any Vimeo link: **"🎓 Open Vimeo Video in LectureScribe"**.
   - Configurable host endpoints for local development (`localhost:5173`) and production deployment.

---

## 🛠️ How to Install

### 🦊 Mozilla Firefox

1. Open Firefox and navigate to:
   ```
   about:debugging#/runtime/this-firefox
   ```
2. Click the **Load Temporary Add-on...** button.
3. Browse to the `extension` directory and select [`manifest.json`](file:///home/dipes/projects/lecturescribe/extension/manifest.json) (or select the packaged ZIP in `extension/dist/`).
4. The extension will load immediately with the ID `lecturescribe-vimeo-capture@lecturescribe.local`.
5. Pin the extension to your Firefox toolbar.

### 🌐 Google Chrome / Brave / Edge / Arc

1. Open your Chromium browser and navigate to:
   - Chrome / Brave / Arc: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click the **Load unpacked** button.
4. Select the `extension` folder inside this repository:
   ```
   /home/dipes/projects/lecturescribe/extension
   ```
5. Pin the **LectureScribe** icon to your toolbar.

---

## 📦 Building Distribution Packages

Run the packaging script to generate production-ready ZIP files for both Chrome Web Store and Firefox Add-ons (AMO):

```bash
python3 scripts/package_extension.py
```

Generated packages will be saved to:
- `extension/dist/lecturescribe-v1.0.0-chrome.zip`
- `extension/dist/lecturescribe-v1.0.0-firefox.zip`

---

## ⚙️ Configuration & Options

Click the extension icon and select the **⚙️ Settings** gear, or right-click the icon and choose **Options**:
- **LectureScribe Web App URL**: Set to `http://localhost:5173` (default) or your production frontend.
- **LectureScribe Backend API URL**: Set to `http://localhost:8000` (default) or your Cloud Run API. Includes a **Test Connection** button.
- **Floating Badge**: Toggle on/off or configure position (Top-Right, Top-Left, Bottom-Right, Bottom-Left).
- **Default Workspace Tab**: Choose whether to open in Transcript, AI Summary, or AI Tutor by default.

---

## 🧪 Testing the Extension

1. Ensure your LectureScribe dev servers are running:
   ```bash
   # Terminal 1 - Backend
   uvicorn backend.main:app --reload --port 8000

   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```
2. In Firefox or Chrome, navigate to any page with Vimeo videos, e.g.:
   - Any Vimeo video page: `https://vimeo.com/76979871`
   - Any LMS page (Canvas, Blackboard, Coursera, Moodle) with embedded lecture videos.
3. Observe:
   - Floating `🎓 LectureScribe` pill on the video embed.
   - Extension badge showing the count of detected videos.
   - Popup listing the lecture with 1-click launch to your LectureScribe workspace.
