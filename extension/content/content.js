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

  const KNOWN_LMS_CODE_MAPPINGS = {
    "AMDSAIC04": "1.1 Applied Mathematics for Data Science and AI",
    "MLPC04": "1.2 Machine Learning Paradigms",
    "ISNLPC04": "1.3 Introduction to Speech and Natural Language Processing",
    "ICVC04": "1.4 Introduction to Computer Vision",
    "IGAIC04": "1.5 Introduction to Generative AI",
    "IFAC04": "1.6 Introduction to Financial Analytics",
    "IAIHC04": "1.7 Introduction to AI in Healthcare",
    "IRC04": "1.8 Introduction to Research",
    "DSLC04": "1.9 Data Science Lab",
  };

  function isCourseCode(value) {
    return /^[A-Za-z]{2,}[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test((value || "").trim());
  }

  function cleanCourseName(name) {
    if (!name || typeof name !== 'string') return null;
    let s = name.trim();
    s = s.replace(/^Course\s*[:\-–]\s*/i, '');
    s = s.replace(/^[A-Za-z]{2,}[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\s*[:\-–]\s*/i, '');
    s = s.replace(/\s*\([A-Za-z]{2,}[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\)\s*$/i, '');
    s = s.replace(/\s*[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
    s = s.replace(/\s*[-:|•]\s*(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode|Topic|Recording)\b.*$/i, '');
    s = s.replace(/[\s\-_:\|\/]+$/, '').trim();
    return s.length >= 3 ? s : null;
  }

  function getMoodleCourseFullName(breadcrumb, codeText = null) {
    let rawCode = (codeText || breadcrumb?.textContent || "").trim().toUpperCase();
    rawCode = rawCode.replace(/CO4$/, 'C04');
    if (rawCode && KNOWN_LMS_CODE_MAPPINGS[rawCode]) {
      return KNOWN_LMS_CODE_MAPPINGS[rawCode];
    }
    const codeNoDigits = rawCode.replace(/\d+$/, '');
    if (codeNoDigits && KNOWN_LMS_CODE_MAPPINGS[codeNoDigits]) {
      return KNOWN_LMS_CODE_MAPPINGS[codeNoDigits];
    }

    // 1. Breadcrumb link title or aria-label
    const breadcrumbLink = breadcrumb?.querySelector("a") || breadcrumb;
    const linkTitle = breadcrumbLink?.getAttribute("title") || breadcrumbLink?.getAttribute("aria-label");
    if (linkTitle) {
      const cleaned = cleanCourseName(linkTitle);
      if (cleaned && !isCourseCode(cleaned)) return cleaned;
    }

    // 2. Direct Moodle course links on page (links to /course/view.php)
    const courseLinks = document.querySelectorAll('a[href*="/course/view.php"]');
    for (const link of courseLinks) {
      const titleAttr = link.getAttribute("title") || link.getAttribute("aria-label");
      if (titleAttr) {
        const cleaned = cleanCourseName(titleAttr);
        if (cleaned && !isCourseCode(cleaned)) return cleaned;
      }
      const linkText = link.textContent?.trim();
      if (linkText && !['home', 'dashboard', 'my courses', 'courses'].includes(linkText.toLowerCase())) {
        const cleaned = cleanCourseName(linkText);
        if (cleaned && !isCourseCode(cleaned)) return cleaned;
      }
    }

    // 3. Moodle DOM headers & context containers
    const selectors = [
      "[data-course-fullname]",
      "[data-coursefullname]",
      ".course-header .coursename",
      ".course-header .course-title",
      ".page-context-header h1",
      ".page-context-header .page-header-headings h1",
      ".page-header-headings h1",
      "#page-header h1",
      ".coursebox .coursename",
      ".header-title h1",
      "[data-region='course-header']",
      "[data-region='course-name']",
      ".coursename",
      ".course-title"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const raw = element?.getAttribute("data-course-fullname") ||
                  element?.getAttribute("data-coursefullname") ||
                  element?.textContent?.trim();
      if (raw) {
        const cleaned = cleanCourseName(raw);
        if (cleaned && !isCourseCode(cleaned)) return cleaned;
      }
    }

    // 4. Moodle document.title
    const docTitle = document.title || "";
    const courseMatch = docTitle.match(/Course:\s*([^|•\-\n:]+)/i);
    if (courseMatch && courseMatch[1]) {
      const cleaned = cleanCourseName(courseMatch[1]);
      if (cleaned && !isCourseCode(cleaned)) return cleaned;
    }
    const codeMatch = docTitle.match(/[A-Za-z]{2,}[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\s*[:\-–]\s*([^|•\-\n:]+)/i);
    if (codeMatch && codeMatch[1]) {
      const cleaned = cleanCourseName(codeMatch[1]);
      if (cleaned && !isCourseCode(cleaned)) return cleaned;
    }
    const parts = docTitle.split(/[:|•\-–]/);
    for (const part of parts) {
      const cleaned = cleanCourseName(part);
      if (cleaned && !isCourseCode(cleaned) && !['vimeo', 'moodle', 'home', 'lms', 'player'].includes(cleaned.toLowerCase())) {
        return cleaned;
      }
    }

    return KNOWN_LMS_CODE_MAPPINGS[rawCode] || null;
  }

  // Extract LMS course breadcrumbs or header title
  function extractLmsCourseContext() {
    try {
      // 1. Canvas LMS Breadcrumbs (#breadcrumbs li or nav[aria-label="breadcrumbs"])
      const canvasCrumbs = document.querySelectorAll('#breadcrumbs li, .breadcrumbs li, nav[aria-label="breadcrumbs"] li');
      if (canvasCrumbs && canvasCrumbs.length > 1) {
        for (let i = 1; i < canvasCrumbs.length; i++) {
          const text = canvasCrumbs[i]?.textContent?.trim();
          if (text && !['home', 'dashboard', 'courses', 'modules', 'pages', 'assignments', 'announcements'].includes(text.toLowerCase())) {
            return cleanCourseName(text) || text;
          }
        }
      }

      // 2. Canvas Course Header elements
      const canvasHeader = document.querySelector('#section-tabs-header, .course-title, #course_header, .course-header');
      if (canvasHeader && canvasHeader.textContent && canvasHeader.textContent.trim()) {
        return cleanCourseName(canvasHeader.textContent.trim()) || canvasHeader.textContent.trim();
      }

      // 3. Moodle LMS Breadcrumbs
      const moodleCrumbs = document.querySelectorAll('.breadcrumb-item, .breadcrumb li');
      if (moodleCrumbs && moodleCrumbs.length > 1) {
        for (let i = 1; i < moodleCrumbs.length; i++) {
          const text = moodleCrumbs[i]?.textContent?.trim();
          if (text && !['home', 'dashboard', 'my courses', 'courses'].includes(text.toLowerCase())) {
            if (isCourseCode(text)) {
              return getMoodleCourseFullName(moodleCrumbs[i], text) || text;
            }
            return cleanCourseName(text) || text;
          }
        }
      }

      // 4. Blackboard / D2L / Brightspace
      const bbHeader = document.querySelector('.course-name, #courseMenu_link, #crumb_1, .d2l-navigation-s-header-title');
      if (bbHeader && bbHeader.textContent && bbHeader.textContent.trim()) {
        return cleanCourseName(bbHeader.textContent.trim()) || bbHeader.textContent.trim();
      }

      // 5. Generic nav breadcrumb links
      const genericCrumbs = document.querySelectorAll('[aria-label*="breadcrumb" i] a, .breadcrumb a');
      for (const a of genericCrumbs) {
        const text = a.textContent?.trim();
        if (text && text.length > 3 && !['home', 'dashboard', 'my courses', 'courses'].includes(text.toLowerCase())) {
          return cleanCourseName(text) || text;
        }
      }
    } catch (_) {}
    return null;
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
    openWorkspaceBtn.innerHTML = '<span class="ls-action-btn-icon">🚀</span> Open LectureScribe';
    openWorkspaceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInLectureScribe(videoId, "transcript");
      container.classList.remove("ls-open");
    });

    const copyToLectureScribeBtn = document.createElement("button");
    copyToLectureScribeBtn.className = "ls-action-btn";
    copyToLectureScribeBtn.innerHTML = '<span class="ls-action-btn-icon">📥</span> Copy to LectureScribe';
    copyToLectureScribeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      showToast(`Importing lecture #${videoId} to LectureScribe...`);
      container.classList.remove("ls-open");

      try {
        const currentVideo = detectedVideos.get(videoId);
        const lmsCourse = extractLmsCourseContext() || currentVideo?.courseName || null;
        const lmsUrl = window.location.href;

        const res = await ext.runtime.sendMessage({
          type: "IMPORT_LECTURE",
          videoId,
          title: videoTitle || currentVideo?.title || null,
          courseName: lmsCourse,
          lmsPageUrl: lmsUrl,
          playerConfig: currentVideo?.playerConfig || null
        });

        if (res && res.success) {
          showToast(`✓ Lecture #${videoId} saved to ${res.course_name || "LectureScribe"}!`);
          ext.runtime.sendMessage({
            type: "OPEN_LECTURE",
            videoId,
            courseSlug: res.course_slug || null,
            tab: "transcript"
          }).catch(() => {});
        } else {
          showToast(`✕ Import failed: ${res?.error || "Check backend API"}`);
        }
      } catch (err) {
        showToast(`✕ Import error: ${err.message}`);
      }
    });

    menu.appendChild(openWorkspaceBtn);
    menu.appendChild(copyToLectureScribeBtn);


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

      const lmsCourse = extractLmsCourseContext();
      const lmsPageUrl = isPlayerEmbed ? (document.referrer || null) : window.location.href;
      const title = (playerConfig?.video?.title) || getPageTitle() || (isPlayerEmbed ? `Vimeo Embed ${selfId}` : `Vimeo Video ${selfId}`);
      const videoInfo = {
        videoId: selfId,
        title: title,
        url: window.location.href,
        type: isPlayerEmbed ? "player_embed" : "direct_page",
        hHash: hHash,
        referer: document.referrer || window.location.href,
        lmsPageUrl: lmsPageUrl,
        courseName: lmsCourse,
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
        const lmsCourse = extractLmsCourseContext();
        const lmsPageUrl = window.location.href;
        if (!detectedVideos.has(vId)) {
          const videoInfo = {
            videoId: vId,
            title: title,
            url: src || `https://player.vimeo.com/video/${vId}`,
            type: "embedded_iframe",
            hHash: hHash,
            referer: window.location.href,
            lmsPageUrl: lmsPageUrl,
            courseName: lmsCourse,
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
