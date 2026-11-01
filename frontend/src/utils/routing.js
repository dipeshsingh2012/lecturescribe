export const parsePathRoute = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  if (!path) return { courseName: null, videoId: null, noteId: null };
  // 1. Nested course note: /course/:courseName/note/:noteId or /course/:courseName/notes/:noteId
  const noteMatch = path.match(/^\/(?:course|courses)\/([^/?#]+)\/(?:note|notes)\/([a-zA-Z0-9_\-]+)/i);
  if (noteMatch) {
    let courseName = noteMatch[1];
    try {
      courseName = decodeURIComponent(courseName.replace(/\+/g, ' '));
    } catch {}
    return { courseName, videoId: null, noteId: noteMatch[2] };
  }
  // 2. Nested course lecture: /course/:courseName/lecture/:videoId
  const nestedMatch = path.match(/^\/(?:course|courses)\/([^/?#]+)\/(?:lecture|video)\/([a-zA-Z0-9_\-]+)/i);
  if (nestedMatch) {
    let courseName = nestedMatch[1];
    try {
      courseName = decodeURIComponent(courseName.replace(/\+/g, ' '));
    } catch {}
    return { courseName, videoId: nestedMatch[2], noteId: null };
  }
  // 3. Standalone course: /course/:courseName
  const courseMatch = path.match(/^\/(?:course|courses)\/([^/?#]+)/i);
  if (courseMatch) {
    let courseName = courseMatch[1];
    try {
      courseName = decodeURIComponent(courseName.replace(/\+/g, ' '));
    } catch {}
    return { courseName, videoId: null, noteId: null };
  }
  // 4. Standalone / legacy lecture: /lecture/:videoId
  const lectureMatch = path.match(/^\/(?:lecture|lectures|video|watch)\/([a-zA-Z0-9_\-]+)/i);
  if (lectureMatch) {
    return { courseName: null, videoId: lectureMatch[1], noteId: null };
  }
  return { courseName: null, videoId: null, noteId: null };
};

export const getNoteIdFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  return parsePathRoute(path).noteId;
};

export const getLectureIdFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  return parsePathRoute(path).videoId;
};

export const getLectureTabFromPath = (path = (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/')) => {
  if (!parsePathRoute(path).videoId) return 'transcript';

  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1).split('#')[0] : '';
  const tab = new URLSearchParams(query).get('tab');
  return tab === 'summary' || tab === 'tutor' || tab === 'quiz' ? tab : 'transcript';
};

export const isCalendarPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  if (!path) return false;
  return /^\/calendar(?:\/|$|\?)/i.test(path);
};

export const getCourseNameFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
  return parsePathRoute(path).courseName;
};

export const VALID_COURSE_TABS = new Set([
  'lectures',
  'summary',
  'quiz',
  'tutor',
  'resources',
  'library',
  'calendar',
  'grades',
  'forum',
  'participants',
  'syllabus',
  'rubrics',
  'workshops',
  'assignments',
  'question-bank',
  'analytics'
]);

export const getCourseTabFromPath = (path = (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/')) => {
  if (!path) return 'lectures';
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1).split('#')[0] : '';
  const tab = new URLSearchParams(query).get('tab');
  return tab && VALID_COURSE_TABS.has(tab) ? tab : 'lectures';
};

export const normalizeCourseSlug = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

export const CANONICAL_COURSE_MAP = {
  'machine-learning-paradigms': '1.2 Machine Learning Paradigms',
  '1-2-machine-learning-paradigms': '1.2 Machine Learning Paradigms',
  'Machine Learning Paradigms': '1.2 Machine Learning Paradigms',
  'applied-mathematics-for-data-science-and-ai': '1.1 Applied Mathematics for Data Science and AI',
  'applied-mathemartics-for-data-science-and-ai': '1.1 Applied Mathematics for Data Science and AI',
  '1-1-applied-mathematics-for-data-science-and-ai': '1.1 Applied Mathematics for Data Science and AI',
  'Applied Mathematics for Data Science and AI': '1.1 Applied Mathematics for Data Science and AI',
  'Applied Mathemartics for Data Science and AI': '1.1 Applied Mathematics for Data Science and AI',
  'introduction-to-speech-and-natural-language-processing': '1.3 Introduction to Speech and Natural Language Processing',
  '1-3-introduction-to-speech-and-natural-language-processing': '1.3 Introduction to Speech and Natural Language Processing',
  'Introduction to Speech and Natural Language Processing': '1.3 Introduction to Speech and Natural Language Processing',
  'introduction-to-computer-vision': '1.4 Introduction to Computer Vision',
  '1-4-introduction-to-computer-vision': '1.4 Introduction to Computer Vision',
  'Introduction to Computer Vision': '1.4 Introduction to Computer Vision',
  'introduction-to-generative-ai': '1.5 Introduction to Generative AI',
  '1-5-introduction-to-generative-ai': '1.5 Introduction to Generative AI',
  'Introduction to Generative AI': '1.5 Introduction to Generative AI',
  'introduction-to-financial-analytics': '1.6 Introduction to Financial Analytics',
  '1-6-introduction-to-financial-analytics': '1.6 Introduction to Financial Analytics',
  'Introduction to Financial Analytics': '1.6 Introduction to Financial Analytics',
  'ifaco4': '1.6 Introduction to Financial Analytics',
  'introduction-to-ai-in-healthcare': '1.7 Introduction to AI in Healthcare',
  '1-7-introduction-to-ai-in-healthcare': '1.7 Introduction to AI in Healthcare',
  'Introduction to AI in Healthcare': '1.7 Introduction to AI in Healthcare',
  'introduction-to-research': '1.8 Introduction to Research',
  '1-8-introduction-to-research': '1.8 Introduction to Research',
  'Introduction to Research': '1.8 Introduction to Research',
  'data-science-lab': '1.9 Data Science Lab',
  '1-9-data-science-lab': '1.9 Data Science Lab',
  'Data Science Lab': '1.9 Data Science Lab',
};

export const toBaseCourseSlug = (str) => {
  if (!str) return '';
  let clean = str.toLowerCase().replace(/[^a-z0-9\- ]/g, ' ').trim();
  // Strip leading decimal/numbers e.g. "1.2 ", "1-2-", "1.2"
  clean = clean.replace(/^\s*\d+[\s.\-_]+\d+[\s.\-_:]*/, '');
  clean = clean.replace(/^\s*\d{1,2}[\s.\-_:]+/, '');
  clean = clean.replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  if (clean === 'applied-mathemartics-for-data-science-and-ai') {
    clean = 'applied-mathematics-for-data-science-and-ai';
  }
  return clean;
};

export const toCanonicalCourseName = (courseIdentifier) => {
  if (!courseIdentifier) return '';
  const clean = courseIdentifier.trim();
  const slug = normalizeCourseSlug(clean);
  const baseSlug = toBaseCourseSlug(clean);
  if (CANONICAL_COURSE_MAP[clean]) return CANONICAL_COURSE_MAP[clean];
  if (CANONICAL_COURSE_MAP[slug]) return CANONICAL_COURSE_MAP[slug];
  if (CANONICAL_COURSE_MAP[baseSlug]) return CANONICAL_COURSE_MAP[baseSlug];

  // If already numbered, return as-is
  if (/^\d+\.\d+\s+/.test(clean)) return clean;

  // If slug format, format nicely
  if (clean.includes('-') && clean === clean.toLowerCase()) {
    const m = clean.match(/^(\d+)-(\d+)-(.+)$/);
    if (m) {
      return `${m[1]}.${m[2]} ${m[3].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
    }
    return clean.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return clean;
};

export const coursesMatch = (courseA, courseB) => {
  if (!courseA || !courseB) return false;
  const nameA = typeof courseA === 'string' ? courseA : (courseA.course_name || courseA.name || courseA.slug || '');
  const slugA = typeof courseA === 'object' ? (courseA.course_slug || courseA.slug || '') : '';
  const nameB = typeof courseB === 'string' ? courseB : (courseB.course_name || courseB.name || courseB.slug || '');
  const slugB = typeof courseB === 'object' ? (courseB.course_slug || courseB.slug || '') : '';

  const cleanA = nameA.trim().toLowerCase();
  const cleanB = nameB.trim().toLowerCase();
  if (cleanA && cleanA === cleanB) return true;

  const normA = normalizeCourseSlug(nameA);
  const normB = normalizeCourseSlug(nameB);
  if (normA && normA === normB) return true;
  if (slugA && slugB && slugA === slugB) return true;
  if (slugA && slugA === normB) return true;
  if (slugB && slugB === normA) return true;

  const baseA = toBaseCourseSlug(slugA || nameA);
  const baseB = toBaseCourseSlug(slugB || nameB);
  if (baseA && baseB && baseA === baseB) return true;

  return false;
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
