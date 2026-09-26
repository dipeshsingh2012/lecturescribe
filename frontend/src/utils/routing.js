export const parsePathRoute = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  if (!path) return { courseName: null, videoId: null };
  // 1. Nested course lecture: /course/:courseName/lecture/:videoId
  const nestedMatch = path.match(/^\/(?:course|courses)\/([^/?#]+)\/(?:lecture|video)\/([a-zA-Z0-9_\-]+)/i);
  if (nestedMatch) {
    let courseName = nestedMatch[1];
    try {
      courseName = decodeURIComponent(courseName.replace(/\+/g, ' '));
    } catch {}
    return { courseName, videoId: nestedMatch[2] };
  }
  // 2. Standalone course: /course/:courseName
  const courseMatch = path.match(/^\/(?:course|courses)\/([^/?#]+)/i);
  if (courseMatch) {
    let courseName = courseMatch[1];
    try {
      courseName = decodeURIComponent(courseName.replace(/\+/g, ' '));
    } catch {}
    return { courseName, videoId: null };
  }
  // 3. Standalone / legacy lecture: /lecture/:videoId
  const lectureMatch = path.match(/^\/(?:lecture|lectures|video|watch)\/([a-zA-Z0-9_\-]+)/i);
  if (lectureMatch) {
    return { courseName: null, videoId: lectureMatch[1] };
  }
  return { courseName: null, videoId: null };
};

export const getLectureIdFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  return parsePathRoute(path).videoId;
};

export const getCourseNameFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  return parsePathRoute(path).courseName;
};

export const normalizeCourseSlug = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

export const navigateTo = (path, replace = false, onStateUpdate = null) => {
  try {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      if (replace) {
        window.history.replaceState({}, '', path);
      } else {
        window.history.pushState({}, '', path);
      }
    }
  } catch (e) {
    console.warn("Navigation history warning:", e);
  }
  if (typeof onStateUpdate === 'function') {
    onStateUpdate(path);
  }
};
