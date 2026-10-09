/**
 * LectureScribe Background Service Worker (Manifest V3)
 * Cross-browser compatible for Chromium (Chrome, Edge, Brave) and Mozilla Firefox.
 * Manages detected videos per tab, extension badge counts, context menus, and navigation.
 */

// Cross-browser namespace support (Firefox `browser` and Chrome `chrome`)
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

// Map of tabId -> Map of videoId -> VideoDetails
const tabVideos = new Map();

// Initialize extension settings and context menus
ext.runtime.onInstalled.addListener(async () => {
  const existing = await ext.storage.sync.get(null);
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await ext.storage.sync.set(toSet);
  }

  // Create context menus
  try {
    ext.contextMenus.create({
      id: "lecturescribe-open-link",
      title: "🎓 Open Vimeo Video in LectureScribe",
      contexts: ["link"],
      targetUrlPatterns: [
        "*://vimeo.com/*",
        "*://*.vimeo.com/*",
        "*://player.vimeo.com/video/*"
      ]
    });
  } catch (err) {
    console.debug("Context menu setup notice:", err);
  }
});

// Helper to extract Vimeo video ID from URL
function extractVimeoId(url) {
  if (!url) return null;
  const match = url.match(/(?:vimeo\.com\/(?:channels\/[^\/]+\/|groups\/[^\/]+\/videos\/|manage\/videos\/|video\/)?|player\.vimeo\.com\/video\/)(\d+)/);
  return match ? match[1] : null;
}

// Handle Context Menu clicks
ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "lecturescribe-open-link" && info.linkUrl) {
    const videoId = extractVimeoId(info.linkUrl);
    if (videoId) {
      const settings = await getSettings();
      const targetUrl = `${settings.webAppUrl.replace(/\/+$/, "")}/lecture/${videoId}`;
      await ext.tabs.create({ url: targetUrl, index: (tab?.index ?? 0) + 1 });
    }
  }
});

// Clean up tab tracking when tabs are closed or navigated
ext.tabs.onRemoved.addListener((tabId) => {
  tabVideos.delete(tabId);
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabVideos.delete(tabId);
    ext.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

// Get merged settings
async function getSettings() {
  const stored = await ext.storage.sync.get(null);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// Update extension icon badge
async function updateBadge(tabId) {
  try {
    const videos = tabVideos.get(tabId);
    const count = videos ? videos.size : 0;
    if (count > 0) {
      await ext.action.setBadgeText({ tabId, text: String(count) });
      await ext.action.setBadgeBackgroundColor({ tabId, color: "#6366f1" });
    } else {
      await ext.action.setBadgeText({ tabId, text: "" });
    }
  } catch (err) {
    // Tab might be closed or inactive
  }
}

// Message Listener
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (message.type === "VIMEO_VIDEOS_DETECTED" && tabId) {
    let currentMap = tabVideos.get(tabId);
    if (!currentMap) {
      currentMap = new Map();
      tabVideos.set(tabId, currentMap);
    }

    if (Array.isArray(message.videos)) {
      for (const video of message.videos) {
        if (video && video.videoId) {
          const existing = currentMap.get(video.videoId) || {};
          currentMap.set(video.videoId, {
            ...existing,
            ...video,
            lastDetected: Date.now()
          });
        }
      }
    }

    updateBadge(tabId);
    sendResponse({ success: true, total: currentMap.size });
    return true;
  }

  if (message.type === "GET_DETECTED_VIDEOS") {
    (async () => {
      const targetTabId = message.tabId || tabId;
      const videosMap = tabVideos.get(targetTabId);
      const list = videosMap ? Array.from(videosMap.values()) : [];
      const settings = await getSettings();
      sendResponse({ success: true, videos: list, settings });
    })();
    return true; // Keep message channel open for async response
  }

  if (message.type === "GET_SETTINGS") {
    (async () => {
      const settings = await getSettings();
      sendResponse({ success: true, settings });
    })();
    return true;
  }

  if (message.type === "OPEN_LECTURE") {
    (async () => {
      const settings = await getSettings();
      const videoId = message.videoId;
      const courseSlug = message.courseSlug;
      const tabParam = message.tab ? `?tab=${encodeURIComponent(message.tab)}` : "";
      const base = settings.webAppUrl.replace(/\/+$/, "");
      const fullUrl = courseSlug
        ? `${base}/course/${courseSlug}/lecture/${videoId}${tabParam}`
        : `${base}/lecture/${videoId}${tabParam}`;

      const createdTab = await ext.tabs.create({
        url: fullUrl,
        index: (sender?.tab?.index ?? 0) + 1
      });
      sendResponse({ success: true, url: fullUrl, tabId: createdTab.id });
    })();
    return true;
  }

  if (message.type === "IMPORT_LECTURE") {
    (async () => {
      const settings = await getSettings();
      const videoId = message.videoId;
      const apiBase = settings.apiUrl.replace(/\/+$/, "");

      // Look up cached video details across tabs
      let targetVideo = null;
      for (const map of tabVideos.values()) {
        if (map.has(videoId)) {
          targetVideo = map.get(videoId);
          break;
        }
      }

      const playerConfig = message.playerConfig || targetVideo?.playerConfig || null;
      const videoDetails = message.videoDetails || (targetVideo?.title ? { title: targetVideo.title } : null);
      const courseName = message.courseName || targetVideo?.courseName || null;
      const lmsPageUrl = message.lmsPageUrl || targetVideo?.referer || null;

      try {
        const resp = await fetch(`${apiBase}/api/extension/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_id: videoId,
            player_config: playerConfig,
            video_details: videoDetails,
            course_name: courseName,
            lms_page_url: lmsPageUrl,
            email: settings.userEmail || null
          })
        });

        const data = await resp.json();
        if (!resp.ok) {
          sendResponse({
            success: false,
            error: data.detail || `Import failed with status HTTP ${resp.status}`
          });
          return;
        }

        sendResponse({
          success: true,
          ...data
        });
      } catch (err) {
        sendResponse({
          success: false,
          error: err.message || "Failed to reach LectureScribe API for import"
        });
      }
    })();
    return true;
  }

  if (message.type === "CHECK_LECTURE_STATUS") {
    (async () => {
      const settings = await getSettings();
      const videoId = message.videoId;
      const apiBase = settings.apiUrl.replace(/\/+$/, "");

      try {
        // 1. Try lightweight status endpoint first
        const resp = await fetch(`${apiBase}/api/videos/${videoId}/status`);
        if (resp.ok) {
          const data = await resp.json();
          sendResponse({
            success: true,
            videoId: data.videoId,
            cached: Boolean(data.cached_in_db),
            synced_to_gcs: Boolean(data.synced_to_gcs),
            video_source: data.video_source || "vimeo",
            blob_name: data.blob_name || null,
            gcs_uri: data.gcs_uri || null,
            size_mb: data.size_mb || null,
            title: data.title || null,
            course_name: data.course_name || null,
            tracking_status: data.tracking_status || null
          });
          return;
        }

        // 2. Fallback to standard lecture endpoint
        const legResp = await fetch(`${apiBase}/api/lecture/${videoId}`);
        if (legResp.ok) {
          const data = await legResp.json();
          sendResponse({
            success: true,
            cached: Boolean(data.cached),
            synced_to_gcs: Boolean(data.gcs_video_url || data.video_source === "gcs"),
            video_source: data.video_source || (data.gcs_video_url ? "gcs" : "vimeo"),
            title: data.title || null,
            duration: data.duration || null,
            transcript_available: Boolean(data.transcript_available),
            has_summary: Boolean(data.summary_sections && data.summary_sections.length > 0)
          });
          return;
        }

        sendResponse({
          success: false,
          cached: false,
          synced_to_gcs: false,
          detail: `HTTP ${resp.status}`
        });
      } catch (err) {
        sendResponse({
          success: false,
          cached: false,
          synced_to_gcs: false,
          error: err.message || "Failed to connect to LectureScribe API"
        });
      }
    })();
    return true;
  }

  if (message.type === "GET_SYNC_STATUS") {
    (async () => {
      const settings = await getSettings();
      const apiBase = settings.apiUrl.replace(/\/+$/, "");
      try {
        const resp = await fetch(`${apiBase}/api/videos/sync-status`);
        if (resp.ok) {
          const data = await resp.json();
          sendResponse({ success: true, ...data });
          return;
        }
        sendResponse({ success: false, error: `HTTP ${resp.status}` });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

