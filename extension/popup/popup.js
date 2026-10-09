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
        <button class="ls-btn ls-btn-secondary btn-copy-import" data-id="${video.videoId}">
          📥 Copy to LectureScribe
        </button>
        <div class="ls-sub-actions">
          <button class="ls-btn ls-btn-sub btn-copy" data-id="${video.videoId}" title="Copy Video ID">
            📋 Copy ID
          </button>
        </div>
        <div class="ls-import-result" id="import-result-${video.videoId}"></div>
      </div>
    `;

    // Hook up buttons
    card.querySelector(".btn-open-main").addEventListener("click", () => {
      openLecture(video.videoId, "transcript");
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

    // Copy to LectureScribe (Import) Handler
    const importBtn = card.querySelector(".btn-copy-import");
    const importResult = card.querySelector(`#import-result-${video.videoId}`);

    importBtn.addEventListener("click", async () => {
      importBtn.disabled = true;
      const originalText = importBtn.innerHTML;
      importBtn.innerHTML = "⏳ Importing to LectureScribe...";
      importResult.innerHTML = '<span class="ls-loading-text">Extracting transcripts & generating AI summary...</span>';

      try {
        const res = await ext.runtime.sendMessage({
          type: "IMPORT_LECTURE",
          videoId: video.videoId,
          title: video.title,
          courseName: video.courseName || null,
          lmsPageUrl: video.lmsPageUrl || video.referer || null,
          playerConfig: video.playerConfig || null
        });

        if (res && res.success) {
          importBtn.innerHTML = "✓ Copied to LectureScribe";
          importBtn.classList.add("ls-btn-success");
          importResult.innerHTML = `<span class="ls-success-text">✓ Saved to ${res.course_name || "LectureScribe"}!</span>`;
          setTimeout(() => {
            ext.runtime.sendMessage({
              type: "OPEN_LECTURE",
              videoId: video.videoId,
              courseSlug: res.course_slug || null,
              tab: "transcript"
            }).catch(() => {});
          }, 400);
        } else {
          importBtn.disabled = false;
          importBtn.innerHTML = originalText;
          importResult.innerHTML = `<span class="ls-error-text">✕ ${res?.error || 'Import failed'}</span>`;
        }
      } catch (err) {
        importBtn.disabled = false;
        importBtn.innerHTML = originalText;
        importResult.innerHTML = `<span class="ls-error-text">✕ Error: ${err.message}</span>`;
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

    if (res && res.success) {
      if (res.cached) {
        statusEl.className = "ls-card-tag cached";
        statusEl.textContent = res.course_name ? `✓ ${res.course_name}` : "✓ In DB";
        statusEl.title = "Transcript and summary are saved in LectureScribe";
      } else {
        statusEl.className = "ls-card-tag";
        statusEl.textContent = "Ready to Import";
        statusEl.title = "Click 'Copy to LectureScribe' to ingest";
      }
    } else {
      statusEl.className = "ls-card-tag";
      statusEl.textContent = "Ready";
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
