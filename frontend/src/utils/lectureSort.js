import { parseTimestampToSeconds } from './formatters';

export const SORT_OPTIONS = [
  { value: 'title_desc', label: 'Title (Z → A)', field: 'title', order: 'desc' },
  { value: 'title_asc', label: 'Title (A → Z)', field: 'title', order: 'asc' },
  { value: 'date_desc', label: 'Newest Added', field: 'date', order: 'desc' },
  { value: 'date_asc', label: 'Oldest Added', field: 'date', order: 'asc' },
  { value: 'progress_desc', label: 'Highest Progress', field: 'progress', order: 'desc' },
  { value: 'progress_asc', label: 'Lowest Progress', field: 'progress', order: 'asc' },
  { value: 'duration_desc', label: 'Longest Duration', field: 'duration', order: 'desc' },
  { value: 'duration_asc', label: 'Shortest Duration', field: 'duration', order: 'asc' }
];

export const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'unwatched', label: 'Not Started' }
];

export const RESOURCE_SORT_OPTIONS = [
  { value: 'title_desc', label: 'Name (Z → A)' },
  { value: 'title_asc', label: 'Name (A → Z)' },
  { value: 'date_desc', label: 'Newest First' },
  { value: 'date_asc', label: 'Oldest First' },
  { value: 'size_desc', label: 'Size (Largest)' },
  { value: 'size_asc', label: 'Size (Smallest)' }
];

export const getLectureTitle = (item) => {
  if (!item) return '';
  return (item.video_title || item.title || (item.video_id ? String(item.video_id) : '')).trim();
};

export const getLectureDate = (item) => {
  if (!item) return 0;
  const d = item.created_at || item.last_accessed_at || item.last_viewed_at || item.ingested_at;
  if (!d) return 0;
  const t = new Date(d).getTime();
  return isNaN(t) ? 0 : t;
};

export const getLectureProgress = (item) => {
  if (!item) return 0;
  if (isLectureCompleted(item)) return 100;
  const prog = item.progress;
  if (typeof prog === 'number' && !isNaN(prog)) return Math.min(100, Math.max(0, prog));
  const rawPct = prog?.progress_percent ?? item.progress_percent ?? item.progressPercent;
  if (typeof rawPct === 'number' && !isNaN(rawPct)) return Math.min(100, Math.max(0, rawPct));

  // Try calculating from seconds
  const lastSec = prog?.last_seconds ?? item.last_seconds;
  const durSec = prog?.duration_seconds || item.total_duration_seconds || item.duration_seconds || (typeof item.duration === 'string' ? parseTimestampToSeconds(item.duration) : 0);
  if (typeof lastSec === 'number' && typeof durSec === 'number' && durSec > 0) {
    return Math.min(100, Math.max(0, Math.round((lastSec / durSec) * 100)));
  }

  if (typeof prog?.last_seconds === 'number' && prog.last_seconds > 2) return 5;
  if (prog?.last_timestamp && prog.last_timestamp !== '00:00' && prog.last_timestamp !== '0:00') return 5;
  return 0;
};

export const getLectureDuration = (item) => {
  if (!item) return 0;
  if (typeof item.total_duration_seconds === 'number') return item.total_duration_seconds;
  if (typeof item.duration_seconds === 'number') return item.duration_seconds;
  if (typeof item.duration === 'number') return item.duration;
  if (typeof item.duration === 'string') {
    return parseTimestampToSeconds(item.duration);
  }
  return 0;
};

export const isLectureCompleted = (item) => {
  if (!item) return false;
  if (item.is_completed === true || item.completed === true) return true;
  const prog = item.progress;
  if (prog === true) return true;
  if (typeof prog === 'number' && !isNaN(prog) && prog >= 85) return true;
  if (prog?.is_completed === true || prog?.completed === true) return true;

  const rawPct = prog?.progress_percent ?? item.progress_percent ?? item.progressPercent;
  if (typeof rawPct === 'number' && !isNaN(rawPct) && rawPct >= 85) return true;

  // Check last_seconds vs duration
  const lastSec = prog?.last_seconds ?? item.last_seconds;
  const durSec = prog?.duration_seconds || item.total_duration_seconds || item.duration_seconds || (typeof item.duration === 'string' ? parseTimestampToSeconds(item.duration) : 0);
  if (typeof lastSec === 'number' && typeof durSec === 'number' && durSec > 0) {
    if (lastSec >= durSec * 0.85 || (durSec - lastSec <= 30 && durSec > 60)) {
      return true;
    }
  }
  return false;
};

export const isLectureInProgress = (item) => {
  if (isLectureCompleted(item)) return false;
  const prog = item?.progress;
  const rawPct = prog?.progress_percent;
  const hasPct = typeof rawPct === 'number' && !isNaN(rawPct) && rawPct > 0;
  const hasSec = typeof prog?.last_seconds === 'number' && prog.last_seconds > 2;
  const hasTs = Boolean(prog?.last_timestamp && prog.last_timestamp !== '00:00' && prog.last_timestamp !== '0:00');
  return Boolean(hasPct || hasSec || hasTs);
};

export const isLectureUnwatched = (item) => {
  return !isLectureCompleted(item) && !isLectureInProgress(item);
};

export const filterLecturesByStatus = (lectures, statusFilter = 'all') => {
  if (!Array.isArray(lectures)) return [];
  if (statusFilter === 'all') return lectures;
  if (statusFilter === 'completed') return lectures.filter(isLectureCompleted);
  if (statusFilter === 'in_progress') return lectures.filter(isLectureInProgress);
  if (statusFilter === 'unwatched') return lectures.filter(isLectureUnwatched);
  return lectures;
};

export const sortLectures = (lectures, sortBy = 'title_desc') => {
  if (!Array.isArray(lectures)) return [];
  const list = [...lectures];

  // Normalize 'title' to 'title_desc'
  const normalizedSort = sortBy === 'title' ? 'title_desc' : sortBy;

  return list.sort((a, b) => {
    switch (normalizedSort) {
      case 'title_asc': {
        const titleA = getLectureTitle(a);
        const titleB = getLectureTitle(b);
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(a.video_id || '').localeCompare(String(b.video_id || ''));
      }
      case 'date_desc': {
        const diff = getLectureDate(b) - getLectureDate(a);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'date_asc': {
        const diff = getLectureDate(a) - getLectureDate(b);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'progress_desc': {
        const diff = getLectureProgress(b) - getLectureProgress(a);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'progress_asc': {
        const diff = getLectureProgress(a) - getLectureProgress(b);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'duration_desc': {
        const diff = getLectureDuration(b) - getLectureDuration(a);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'duration_asc': {
        const diff = getLectureDuration(a) - getLectureDuration(b);
        if (diff !== 0) return diff;
        return getLectureTitle(a).localeCompare(getLectureTitle(b), undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'title_desc':
      default: {
        const titleA = getLectureTitle(a);
        const titleB = getLectureTitle(b);
        return titleB.localeCompare(titleA, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(b.video_id || '').localeCompare(String(a.video_id || ''));
      }
    }
  });
};

export const filterAndSortLectures = (lectures, { search = '', status = 'all', sortBy = 'title_desc' } = {}) => {
  if (!Array.isArray(lectures)) return [];
  let result = lectures;

  // Search filter
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(item =>
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q)) ||
      (Array.isArray(item.topics) && item.topics.some(t => String(t).toLowerCase().includes(q)))
    );
  }

  // Status filter
  if (status && status !== 'all') {
    result = filterLecturesByStatus(result, status);
  }

  // Sort
  return sortLectures(result, sortBy);
};

export const sortResources = (resources, sortBy = 'title_desc') => {
  if (!Array.isArray(resources)) return [];
  const list = [...resources];

  return list.sort((a, b) => {
    const titleA = String(a.title || a.filename || '').trim();
    const titleB = String(b.title || b.filename || '').trim();

    switch (sortBy) {
      case 'title_asc':
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(a.id || '').localeCompare(String(b.id || ''));
      case 'date_desc': {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA || titleB.localeCompare(titleA, undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'date_asc': {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeA - timeB || titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
      }
      case 'size_desc':
        return (b.file_size_bytes || 0) - (a.file_size_bytes || 0) || titleB.localeCompare(titleA, undefined, { numeric: true, sensitivity: 'base' });
      case 'size_asc':
        return (a.file_size_bytes || 0) - (b.file_size_bytes || 0) || titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
      case 'title_desc':
      default:
        return titleB.localeCompare(titleA, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(b.id || '').localeCompare(String(a.id || ''));
    }
  });
};

