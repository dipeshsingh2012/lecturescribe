/**
 * LectureScribe Content Script
 * Cross-browser compatible for Chromium (Chrome, Edge, Brave) and Mozilla Firefox.
 * Detects Vimeo videos across any webpage, LMS, or direct player embed,
 * and attaches floating LectureScribe action badges.
 */

(function () {
  // Avoid multiple initializations in the same frame
  if (window.__lecturescribeInitialized) return;
  window.__lecturescribeInitialized = true;

  // Cross-browser namespace support
  const ext = typeof browser !== "undefined" ? browser : chrome;

  const VIMEO_REGEX = /(?:vimeo\.com\/(?:channels\/[^\/]+\/|groups\/[^\/]+\/videos\/|manage\/videos\/|video\/)?|player\.vimeo\.com\/video\/)(\d+)/i;

  let currentSettings = {
    webAppUrl: "http://localhost:5173",
    apiUrl: "http://localhost:8000",
    showFloatingBadge: true,
    badgePosition: "top-right"
  };

  // Keep track of detected videos in this frame
  const detectedVideos = new Map();

  // Load initial settings using async/await
  (async () => {
    try {
      const data = await ext.storage.sync.get(["webAppUrl", "apiUrl", "showFloatingBadge", "badgePosition"]);
      if (data) {
        currentSettings = { ...currentSettings, ...data };
      }
    } catch (e) {
      console.debug("Could not read settings from storage:", e);
    }
    scanForVideos();
  })();

  // Listen for storage changes
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      for (const [key, change] of Object.entries(changes)) {
        currentSettings[key] = change.newValue;
      }
      // Re-evaluate badges if settings changed
      if (changes.showFloatingBadge || changes.badgePosition) {
        document.querySelectorAll(".ls-badge-container").forEach(el => el.remove());
        scanForVideos();
      }
    }
  });

  function extractVimeoId(url) {
    if (!url) return null;
    const match = String(url).match(VIMEO_REGEX);
    return match ? match[1] : null;
  }

  function extractHHash(url) {
    if (!url) return null;
    const match = String(url).match(/[?&]h=([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  function extractHHashFromDOM() {
    try {
      // 1. Check current URL
      const urlHash = extractHHash(window.location.href);
      if (urlHash) return urlHash;

      // 2. Check JSON-LD
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const ls of ldScripts) {
        try {
          const data = JSON.parse(ls.textContent || "{}");
          if (data.embedUrl) {
            const m = String(data.embedUrl).match(/[?&]h=([a-zA-Z0-9]+)/);
            if (m) return m[1];
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function extractPlayerConfigFromDOM() {
    try {
      if (typeof window !== "undefined" && window.playerConfig && typeof window.playerConfig === "object") {
        return window.playerConfig;
      }
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        const text = s.textContent || "";
        if (text.includes("var config =") || text.includes("window.playerConfig =")) {
          const match = text.match(/(?:var config\s*=\s*|window\.playerConfig\s*=\s*)({[\s\S]*?})(?:;|\s*<\/script>|\s*$)/);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch (jsonErr) {
              console.debug("Config JSON parse notice:", jsonErr);
            }
          }
        }
      }
    } catch (e) {
      console.debug("Config DOM parse notice:", e);
    }
    return null;
  }

  async function fetchInBrowserConfig(videoId, hHash) {
    try {
      const q = hHash ? `?h=${hHash}` : window.location.search;
      const res = await fetch(`https://player.vimeo.com/video/${videoId}/config${q}`, {
        headers: { "Accept": "application/json" }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.debug("In-browser fetch config notice:", e);
    }
    return null;
  }

  function getPageTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (ogTitle && ogTitle.trim()) return ogTitle.trim();
    return document.title ? document.title.replace(/\s*[-|•]\s*Vimeo.*$/i, '').trim() : null;
  }

  // Toast notification helper
  function showToast(message) {
    const existing = document.querySelector(".ls-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "ls-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = "opacity 0.3s ease";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // Open video in LectureScribe
  function openInLectureScribe(videoId, tab = "transcript") {
    ext.runtime.sendMessage({
      type: "OPEN_LECTURE",
      videoId,
      tab
    }).catch(() => {});
  }

  // Create floating badge element
  function createBadgeElement(videoId, videoTitle) {
    const container = document.createElement("div");
    container.className = `ls-badge-container ls-badge-${currentSettings.badgePosition || "top-right"}`;
    container.dataset.videoId = videoId;

    const pill = document.createElement("div");
    pill.className = "ls-pill";
    pill.title = "Click to open in LectureScribe or expand quick actions";

    const icon = document.createElement("span");
    icon.className = "ls-pill-icon";
    icon.textContent = "🎓";

    const label = document.createElement("span");
    label.className = "ls-pill-label";
    label.textContent = "LectureScribe";

    const idSpan = document.createElement("span");
    idSpan.className = "ls-pill-id";
    idSpan.textContent = `#${videoId}`;

    const closeBtn = document.createElement("span");
    closeBtn.className = "ls-badge-close";
    closeBtn.textContent = "✕";
    closeBtn.title = "Dismiss badge";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      container.remove();
    });

    pill.appendChild(icon);
    pill.appendChild(label);
    pill.appendChild(idSpan);
    pill.appendChild(closeBtn);

    // Actions dropdown menu
    const menu = document.createElement("div");
    menu.className = "ls-actions-menu";

    const openWorkspaceBtn = document.createElement("button");
    openWorkspaceBtn.className = "ls-action-btn ls-primary";
    openWorkspaceBtn.innerHTML = '<span class="ls-action-btn-icon">🚀</span> Open Workspace';
    openWorkspaceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInLectureScribe(videoId, "transcript");
      container.classList.remove("ls-open");
    });

    const summaryBtn = document.createElement("button");
    summaryBtn.className = "ls-action-btn";
    summaryBtn.innerHTML = '<span class="ls-action-btn-icon">📝</span> AI Summary';
    summaryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInLectureScribe(videoId, "summary");
      container.classList.remove("ls-open");
    });

    const tutorBtn = document.createElement("button");
    tutorBtn.className = "ls-action-btn";
    tutorBtn.innerHTML = '<span class="ls-action-btn-icon">🤖</span> AI Tutor Chat';
    tutorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInLectureScribe(videoId, "tutor");
      container.classList.remove("ls-open");
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "ls-action-btn";
    copyBtn.innerHTML = '<span class="ls-action-btn-icon">📋</span> Copy Video ID';
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(videoId);
        showToast(`Copied Vimeo ID ${videoId} to clipboard!`);
      } catch (err) {
        showToast(`Vimeo ID: ${videoId}`);
      }
      container.classList.remove("ls-open");
    });

    const gcsBtn = document.createElement("button");
    gcsBtn.className = "ls-action-btn";
    gcsBtn.innerHTML = '<span class="ls-action-btn-icon">☁️</span> Upload to GCS';
    gcsBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      showToast(`Uploading lecture #${videoId} to Google Cloud Storage...`);
      container.classList.remove("ls-open");
      try {
        const currentVideo = detectedVideos.get(videoId);
        const res = await ext.runtime.sendMessage({
          type: "UPLOAD_TO_GCS",
          videoId,
          title: videoTitle,
          hHash: currentVideo?.hHash || null,
          referer: currentVideo?.referer || null,
          playerConfig: currentVideo?.playerConfig || null
        });
        if (res && res.success) {
          showToast(`✓ Uploaded to ${res.gcs_uri || 'GCS'}`);
        } else {
          showToast(`✕ Upload failed: ${res?.error || 'Check API'}`);
        }
      } catch (err) {
        showToast(`✕ Upload error: ${err.message}`);
      }
    });

    menu.appendChild(openWorkspaceBtn);
    menu.appendChild(summaryBtn);
    menu.appendChild(tutorBtn);
    menu.appendChild(gcsBtn);
    menu.appendChild(copyBtn);

    // Toggle dropdown menu on pill click
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      container.classList.toggle("ls-open");
    });

    // Close menu when clicking outside
    document.addEventListener("click", () => {
      container.classList.remove("ls-open");
    });

    container.appendChild(pill);
    container.appendChild(menu);

    return container;
  }

  // Attach badge to an embedded player iframe
  function attachBadgeToIframe(iframe, videoId, title) {
    if (!currentSettings.showFloatingBadge) return;
    if (iframe.dataset.lecturescribeBadgeInjected === "true") return;
    iframe.dataset.lecturescribeBadgeInjected = "true";

    const badge = createBadgeElement(videoId, title);

    // Determine wrapper or container
    const parent = iframe.parentElement;
    if (!parent) return;

    // Ensure the parent container can host absolute positioned children
    const computedStyle = window.getComputedStyle(parent);
    if (computedStyle.position === "static") {
      parent.style.position = "relative";
    }

    parent.appendChild(badge);
  }

  // Attach badge when running directly inside the player iframe
  function attachBadgeToDirectPlayer(videoId, title) {
    if (!currentSettings.showFloatingBadge) return;
    if (document.body.dataset.lecturescribeBadgeInjected === "true") return;
    document.body.dataset.lecturescribeBadgeInjected = "true";

    const badge = createBadgeElement(videoId, title);
    document.body.appendChild(badge);
  }

  // Scan current frame and DOM for Vimeo videos
  function scanForVideos() {
    const newlyDetected = [];

    // 1. Check if the current window URL itself is Vimeo
    const selfId = extractVimeoId(window.location.href);
    if (selfId && !detectedVideos.has(selfId)) {
      const isPlayerEmbed = window.location.hostname.includes("player.vimeo.com");
      const hHash = extractHHashFromDOM();
      let playerConfig = null;

      if (isPlayerEmbed) {
        playerConfig = extractPlayerConfigFromDOM();
        if (!playerConfig) {
          fetchInBrowserConfig(selfId, hHash).then((cfg) => {
            if (cfg) {
              const current = detectedVideos.get(selfId);
              if (current) {
                current.playerConfig = cfg;
                if (cfg.video?.title) current.title = cfg.video.title;
                ext.runtime.sendMessage({
                  type: "VIMEO_VIDEOS_DETECTED",
                  videos: [current]
                }).catch(() => {});
              }
            }
          });
        }
      }

      const title = (playerConfig?.video?.title) || getPageTitle() || (isPlayerEmbed ? `Vimeo Embed ${selfId}` : `Vimeo Video ${selfId}`);
      const videoInfo = {
        videoId: selfId,
        title: title,
        url: window.location.href,
        type: isPlayerEmbed ? "player_embed" : "direct_page",
        hHash: hHash,
        referer: document.referrer || window.location.href,
        playerConfig: playerConfig,
        detectedAt: Date.now()
      };
      detectedVideos.set(selfId, videoInfo);
      newlyDetected.push(videoInfo);

      // If directly inside player iframe, inject floating badge
      if (isPlayerEmbed) {
        attachBadgeToDirectPlayer(selfId, title);
      }
    }

    // 2. Scan for embedded <iframe> elements
    const iframes = document.querySelectorAll('iframe[src*="vimeo.com"], iframe[src*="player.vimeo.com"], iframe[data-src*="vimeo.com"]');
    iframes.forEach((iframe) => {
      const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
      const vId = extractVimeoId(src) || iframe.getAttribute("data-vimeo-id");
      if (vId) {
        const hHash = extractHHash(src);
        const title = iframe.getAttribute("title") || iframe.getAttribute("aria-label") || `Embedded Lecture ${vId}`;
        if (!detectedVideos.has(vId)) {
          const videoInfo = {
            videoId: vId,
            title: title,
            url: src || `https://player.vimeo.com/video/${vId}`,
            type: "embedded_iframe",
            hHash: hHash,
            referer: window.location.href,
            playerConfig: null,
            detectedAt: Date.now()
          };
          detectedVideos.set(vId, videoInfo);
          newlyDetected.push(videoInfo);
        }
        attachBadgeToIframe(iframe, vId, title);
      }
    });

    // 3. Scan for Vimeo links on page (e.g. course resources, lecture links)
    const links = document.querySelectorAll('a[href*="vimeo.com"]');
    links.forEach((a) => {
      const href = a.getAttribute("href") || "";
      const vId = extractVimeoId(href);
      if (vId && !detectedVideos.has(vId)) {
        const title = a.textContent?.trim() || `Linked Lecture ${vId}`;
        const videoInfo = {
          videoId: vId,
          title: title,
          url: href,
          type: "link",
          detectedAt: Date.now()
        };
        detectedVideos.set(vId, videoInfo);
        newlyDetected.push(videoInfo);
      }
    });

    // Notify background worker of any detected videos
    if (detectedVideos.size > 0) {
      ext.runtime.sendMessage({
        type: "VIMEO_VIDEOS_DETECTED",
        videos: Array.from(detectedVideos.values())
      }).catch(() => {});
    }
  }

  // Run initial scan
  scanForVideos();

  // Watch for dynamic DOM modifications (SPAs, Canvas, Blackboard, Coursera, Moodle)
  let scanTimeout = null;
  const observer = new MutationObserver((mutations) => {
    let hasRelevantNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasRelevantNodes = true;
        break;
      }
    }
    if (hasRelevantNodes) {
      clearTimeout(scanTimeout);
      scanTimeout = setTimeout(scanForVideos, 600);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scanForVideos();
    });
  }
})();
