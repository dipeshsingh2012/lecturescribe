/**
 * LectureScribe Options Page Logic
 * Cross-browser compatible for Chromium (Chrome, Edge, Brave) and Mozilla Firefox.
 */

// Cross-browser namespace support
const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  webAppUrl: "http://localhost:5173",
  apiUrl: "http://localhost:8000",
  showFloatingBadge: true,
  badgePosition: "top-right",
  defaultTab: "transcript",
  gcsBucketName: "lecturescribe-resources",
  gcsFolderPrefix: "lectures"
};

const form = document.getElementById("settings-form");
const webAppUrlInput = document.getElementById("web-app-url");
const apiUrlInput = document.getElementById("api-url");
const showBadgeCheckbox = document.getElementById("show-floating-badge");
const badgePositionSelect = document.getElementById("badge-position");
const defaultTabSelect = document.getElementById("default-tab");
const gcsBucketInput = document.getElementById("gcs-bucket-name");
const gcsPrefixInput = document.getElementById("gcs-folder-prefix");
const testGcsBtn = document.getElementById("test-gcs-btn");
const gcsStatusMsg = document.getElementById("gcs-status-msg");
const testConnBtn = document.getElementById("test-connection-btn");
const connStatus = document.getElementById("connection-status");
const saveMsg = document.getElementById("save-msg");
const resetBtn = document.getElementById("reset-btn");

document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentSettings();
  setupListeners();
});

async function loadCurrentSettings() {
  const stored = await ext.storage.sync.get(null);
  const current = { ...DEFAULT_SETTINGS, ...stored };

  webAppUrlInput.value = current.webAppUrl;
  apiUrlInput.value = current.apiUrl;
  showBadgeCheckbox.checked = Boolean(current.showFloatingBadge);
  badgePositionSelect.value = current.badgePosition || "top-right";
  defaultTabSelect.value = current.defaultTab || "transcript";
  gcsBucketInput.value = current.gcsBucketName || "lecturescribe-resources";
  gcsPrefixInput.value = current.gcsFolderPrefix || "lectures";
}

function setupListeners() {
  // Preset buttons
  document.querySelectorAll(".ls-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const val = btn.getAttribute("data-val");
      const target = document.getElementById(targetId);
      if (target) {
        target.value = val;
      }
    });
  });

  // Test connection button
  testConnBtn.addEventListener("click", async () => {
    const url = apiUrlInput.value.trim().replace(/\/+$/, "");
    if (!url) {
      showStatus("Please enter an API URL", false);
      return;
    }

    showStatus("Connecting to " + url + "...", null);
    testConnBtn.disabled = true;

    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const ms = Date.now() - start;

      if (res.ok) {
        showStatus(`✓ Connected successfully (${ms}ms) — LectureScribe backend is online`, true);
      } else {
        showStatus(`⚠️ Server responded with HTTP ${res.status}`, false);
      }
    } catch (err) {
      showStatus(`✕ Connection failed: ${err.message || "Failed to fetch"}`, false);
    } finally {
      testConnBtn.disabled = false;
    }
  });

  // Test GCS status button
  testGcsBtn.addEventListener("click", async () => {
    const url = apiUrlInput.value.trim().replace(/\/+$/, "");
    const bucket = gcsBucketInput.value.trim();
    if (!url) {
      showGcsStatus("Please enter an API URL first", false);
      return;
    }

    showGcsStatus("Checking GCS readiness...", null);
    testGcsBtn.disabled = true;

    try {
      const q = bucket ? `?bucket=${encodeURIComponent(bucket)}` : "";
      const res = await fetch(`${url}/api/cloud/gcs/status${q}`);
      const data = await res.json();
      if (res.ok && data.authenticated) {
        showGcsStatus(`✓ GCS Authenticated — Bucket: gs://${data.bucket}/`, true);
      } else if (res.ok) {
        showGcsStatus(`⚠️ Running in emulated mode — Bucket: gs://${data.bucket}/`, null);
      } else {
        showGcsStatus(`✕ Server returned HTTP ${res.status}`, false);
      }
    } catch (err) {
      showGcsStatus(`✕ Could not reach API: ${err.message}`, false);
    } finally {
      testGcsBtn.disabled = false;
    }
  });

  // Save form
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newSettings = {
      webAppUrl: webAppUrlInput.value.trim().replace(/\/+$/, ""),
      apiUrl: apiUrlInput.value.trim().replace(/\/+$/, ""),
      showFloatingBadge: showBadgeCheckbox.checked,
      badgePosition: badgePositionSelect.value,
      defaultTab: defaultTabSelect.value,
      gcsBucketName: gcsBucketInput.value.trim() || "lecturescribe-resources",
      gcsFolderPrefix: gcsPrefixInput.value.trim() || "lectures"
    };

    await ext.storage.sync.set(newSettings);

    saveMsg.textContent = "✓ Preferences saved successfully!";
    setTimeout(() => {
      saveMsg.textContent = "";
    }, 2500);
  });

  // Restore defaults
  resetBtn.addEventListener("click", async () => {
    if (confirm("Reset all settings to default values?")) {
      await ext.storage.sync.set(DEFAULT_SETTINGS);
      await loadCurrentSettings();
      saveMsg.textContent = "Restored default settings";
      setTimeout(() => {
        saveMsg.textContent = "";
      }, 2500);
    }
  });
}

function showStatus(text, success) {
  connStatus.textContent = text;
  if (success === true) {
    connStatus.className = "ls-connection-status success";
  } else if (success === false) {
    connStatus.className = "ls-connection-status error";
  } else {
    connStatus.className = "ls-connection-status";
  }
}

function showGcsStatus(text, success) {
  gcsStatusMsg.textContent = text;
  if (success === true) {
    gcsStatusMsg.className = "ls-connection-status success";
  } else if (success === false) {
    gcsStatusMsg.className = "ls-connection-status error";
  } else {
    gcsStatusMsg.className = "ls-connection-status";
  }
}
