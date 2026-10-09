/**
 * LectureScribe Popup Controller
 * Cross-browser compatible for Chromium (Chrome, Edge, Brave) and Mozilla Firefox.
 * Coordinates detected videos display, backend health checking, and lecture navigation.
 */

// Cross-browser namespace support
const ext = typeof browser !== "undefined" ? browser : chrome;

const VIMEO_REGEX = /(?:vimeo\.com\/(?:channels\/[^\/]+\/|groups\/[^\/]+\/videos\/|manage\/videos\/|video\/)?|player\.vimeo\.com\/video\/)?(\d+)/i;

let currentSettings = {
  webAppUrl: "http://localhost:5173",
  apiUrl: "http://localhost:8000"
};

// DOM Elements
const backendStatusPill = document.getElementById("backend-status");
const backendStatusText = document.getElementById("backend-status-text");
const detectedCount = document.getElementById("detected-count");
const videosList = document.getElementById("videos-list");
const manualForm = document.getElementById("manual-form");
const manualInput = document.getElementById("manual-url-input");
const manualError = document.getElementById("manual-error");
const openSettingsBtn = document.getElementById("open-settings-btn");
const openHomeBtn = document.getElementById("open-home-btn");

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await loadSettings();
  await checkBackendHealth();
  await loadDetectedVideos();
});

function setupEventListeners() {
  openSettingsBtn.addEventListener("click", () => {
    ext.runtime.openOptionsPage();
  });

  openHomeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const target = currentSettings.webAppUrl || "http://localhost:5173";
    ext.tabs.create({ url: target });
  });

  manualForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleManualSubmit();
  });

  manualInput.addEventListener("input", () => {
    manualError.textContent = "";
  });
}

async function loadSettings() {
  try {
    const resp = await ext.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (resp?.settings) {
      currentSettings = { ...currentSettings, ...resp.settings };
    }
  } catch (err) {
    console.debug("Failed to load settings:", err);
  }
}

async function checkBackendHealth() {
  const apiBase = currentSettings.apiUrl.replace(/\/+$/, "");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${apiBase}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      backendStatusPill.className = "ls-status-pill online";
      backendStatusText.textContent = "API Connected";
      backendStatusPill.title = `Connected to ${apiBase}`;
    } else {
      backendStatusPill.className = "ls-status-pill offline";
      backendStatusText.textContent = "API Error";
      backendStatusPill.title = `Server returned status ${res.status}`;
    }
  } catch (err) {
    backendStatusPill.className = "ls-status-pill offline";
    backendStatusText.textContent = "API Offline";
    backendStatusPill.title = `Could not reach ${apiBase}. Ensure backend is running.`;
  }
}

async function loadDetectedVideos() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      renderEmptyState("Unable to inspect current tab.");
      return;
    }

    const response = await ext.runtime.sendMessage({
      type: "GET_DETECTED_VIDEOS",
      tabId: tab.id
    });

    const videos = response?.videos || [];
    detectedCount.textContent = String(videos.length);

    if (videos.length === 0) {
      renderEmptyState("No Vimeo videos detected on this tab.<br>Navigate to a page with Vimeo embeds or paste an ID below.");
      return;
    }

    renderVideosList(videos);
  } catch (err) {
    console.error("Error loading detected videos:", err);
    renderEmptyState("Error scanning tab for videos.");
  }
}

function renderEmptyState(message) {
  videosList.innerHTML = `
    <div class="ls-empty-state">
      <div class="ls-empty-icon">📺</div>
      <p>${message}</p>
    </div>
  `;
}

function renderVideosList(videos) {
  videosList.innerHTML = "";

  for (const video of videos) {
    const card = document.createElement("div");
    card.className = "ls-video-card";
    card.dataset.videoId = video.videoId;

    const typeLabel = video.type === "player_embed" ? "Player Embed" :
                      video.type === "embedded_iframe" ? "Embedded Iframe" :
                      video.type === "direct_page" ? "Vimeo Page" : "Page Link";

    card.innerHTML = `
      <div class="ls-card-header">
        <div class="ls-card-info">
          <div class="ls-card-title" title="${escapeHtml(video.title || `Vimeo Video ${video.videoId}`)}">
            ${escapeHtml(video.title || `Vimeo Video ${video.videoId}`)}
          </div>
          <div class="ls-card-meta">
            <span class="ls-id-badge">ID: ${video.videoId}</span>
            <span class="ls-card-tag">${typeLabel}</span>
            <span class="ls-card-tag status-tag" id="status-tag-${video.videoId}">Checking cache...</span>
          </div>
        </div>
      </div>
      <div class="ls-card-actions">
        <button class="ls-btn ls-btn-primary btn-open-main" data-id="${video.videoId}">
          🚀 Open in LectureScribe
        </button>
        <div class="ls-sub-actions">
          <button class="ls-btn ls-btn-sub btn-summary" data-id="${video.videoId}" title="Open AI Executive Summary">
            📝 Summary
          </button>
          <button class="ls-btn ls-btn-sub btn-tutor" data-id="${video.videoId}" title="Open AI RAG Tutor Chat">
            🤖 AI Tutor
          </button>
          <button class="ls-btn ls-btn-sub btn-copy" data-id="${video.videoId}" title="Copy Video ID">
            📋 Copy ID
          </button>
        </div>
        <div class="ls-gcs-row">
          <button class="ls-btn ls-btn-gcs btn-gcs-upload" data-id="${video.videoId}" title="Upload full lecture bundle (summary, transcript, captions, metadata) to GCS">
            ☁️ Upload to Google Cloud Storage
          </button>
        </div>
        <div class="ls-gcs-result" id="gcs-result-${video.videoId}"></div>
      </div>
    `;

    // Hook up buttons
    card.querySelector(".btn-open-main").addEventListener("click", () => {
      openLecture(video.videoId, "transcript");
    });
    card.querySelector(".btn-summary").addEventListener("click", () => {
      openLecture(video.videoId, "summary");
    });
    card.querySelector(".btn-tutor").addEventListener("click", () => {
      openLecture(video.videoId, "tutor");
    });
    card.querySelector(".btn-copy").addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(video.videoId);
        const originalText = e.target.textContent;
        e.target.textContent = "✓ Copied";
        setTimeout(() => { e.target.textContent = originalText; }, 1500);
      } catch (err) {
        // Fallback
      }
    });

    // GCS Upload Handler
    const gcsBtn = card.querySelector(".btn-gcs-upload");
    const gcsResult = card.querySelector(`#gcs-result-${video.videoId}`);

    // Check if previously uploaded
    ext.storage.local.get([`gcs_upload_${video.videoId}`]).then((data) => {
      const savedUpload = data?.[`gcs_upload_${video.videoId}`];
      if (savedUpload) {
        gcsBtn.innerHTML = "✓ Uploaded to GCS";
        gcsBtn.classList.add("ls-btn-success");
        const videoStatus = savedUpload.video_uploaded
          ? `<div style="color: #34d399; font-weight: 600;">🎬 Video MP4 in bucket (${savedUpload.video_details?.size_mb || 0} MB)</div>`
          : `<div style="color: #94a3b8;">📄 Lecture text bundle uploaded</div>`;
        gcsResult.innerHTML = `
          <div class="ls-gcs-success-box">
            ${videoStatus}
            <span>Bucket: <code>${savedUpload.gcs_uri || savedUpload.folder}</code></span>
            ${savedUpload.console_url ? `<a href="${savedUpload.console_url}" target="_blank" class="ls-gcs-link">Open in Google Cloud Console ↗</a>` : ''}
          </div>
        `;
      }
    }).catch(() => {});

    gcsBtn.addEventListener("click", async () => {
      gcsBtn.disabled = true;
      const originalText = gcsBtn.innerHTML;
      gcsBtn.innerHTML = "⏳ Uploading to GCS...";
      gcsResult.innerHTML = '<span class="ls-loading-text">Downloading video stream, transcripts & uploading to GCS... (live logs in terminal)</span>';

      try {
        const res = await ext.runtime.sendMessage({
          type: "UPLOAD_TO_GCS",
          videoId: video.videoId,
          title: video.title,
          hHash: video.hHash || null,
          referer: video.referer || null,
          playerConfig: video.playerConfig || null
        });

        if (res && res.success) {
          gcsBtn.innerHTML = "✓ Uploaded to GCS";
          gcsBtn.classList.add("ls-btn-success");
          const videoStatus = res.video_uploaded
            ? `<div style="color: #34d399; font-weight: 600;">🎬 Video MP4 uploaded (${res.video_details?.size_mb || 0} MB)</div>`
            : `<div style="color: #f59e0b; font-weight: 600;">⚠️ Video stream skipped (${res.video_details?.error || 'Only text files uploaded'})</div>`;
          gcsResult.innerHTML = `
            <div class="ls-gcs-success-box">
              ${videoStatus}
              <span>Bucket: <code>${res.gcs_uri || res.folder}</code></span>
              ${res.console_url ? `<a href="${res.console_url}" target="_blank" class="ls-gcs-link">Open in Google Cloud Console ↗</a>` : ''}
            </div>
          `;
          ext.storage.local.set({ [`gcs_upload_${video.videoId}`]: res }).catch(() => {});
        } else {
          gcsBtn.disabled = false;
          gcsBtn.innerHTML = originalText;
          gcsResult.innerHTML = `<span class="ls-error-text">✕ ${res?.error || 'Upload failed'}</span>`;
        }
      } catch (err) {
        gcsBtn.disabled = false;
        gcsBtn.innerHTML = originalText;
        gcsResult.innerHTML = `<span class="ls-error-text">✕ Error: ${err.message}</span>`;
      }
    });

    videosList.appendChild(card);

    // Asynchronously check backend cache status
    checkVideoCacheStatus(video.videoId);
  }
}

async function checkVideoCacheStatus(videoId) {
  const statusEl = document.getElementById(`status-tag-${videoId}`);
  if (!statusEl) return;

  try {
    const res = await ext.runtime.sendMessage({
      type: "CHECK_LECTURE_STATUS",
      videoId: videoId
    });

    if (res && res.success && res.cached) {
      statusEl.className = "ls-card-tag cached";
      statusEl.textContent = "✓ Cached in DB";
      statusEl.title = "Transcript and summary are already cached with 0ms ingest time";
    } else {
      statusEl.className = "ls-card-tag";
      statusEl.textContent = "Ready to Ingest";
      statusEl.title = "Video will be transcribed upon opening in LectureScribe";
    }
  } catch (e) {
    statusEl.textContent = "Ready";
  }
}

function handleManualSubmit() {
  const raw = manualInput.value.trim();
  if (!raw) {
    manualError.textContent = "Please enter a Vimeo URL or Video ID";
    return;
  }

  const match = raw.match(VIMEO_REGEX);
  const videoId = match ? match[1] : null;

  if (!videoId) {
    manualError.textContent = "Invalid Vimeo URL or ID. Example: 76979871";
    return;
  }

  openLecture(videoId, "transcript");
}

function openLecture(videoId, tab = "transcript") {
  ext.runtime.sendMessage({
    type: "OPEN_LECTURE",
    videoId: videoId,
    tab: tab
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
