import { parseTimestampToSeconds } from './formatters';

export const SORT_OPTIONS = [
  { value: 'title_asc', label: 'Title (A → Z)', field: 'title', order: 'asc' },
  { value: 'title_desc', label: 'Title (Z → A)', field: 'title', order: 'desc' },
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
  const prog = item.progress;
  const rawPct = prog?.progress_percent;
  if (typeof rawPct === 'number' && !isNaN(rawPct)) return rawPct;
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
  const rawPct = item?.progress?.progress_percent;
  return typeof rawPct === 'number' && !isNaN(rawPct) && rawPct >= 90;
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

export const sortLectures = (lectures, sortBy = 'title_asc') => {
  if (!Array.isArray(lectures)) return [];
  const list = [...lectures];

  // Normalize 'title' to 'title_asc'
  const normalizedSort = sortBy === 'title' ? 'title_asc' : sortBy;

  return list.sort((a, b) => {
    switch (normalizedSort) {
      case 'title_desc': {
        const titleA = getLectureTitle(a);
        const titleB = getLectureTitle(b);
        return titleB.localeCompare(titleA, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(b.video_id || '').localeCompare(String(a.video_id || ''));
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
      case 'title_asc':
      default: {
        const titleA = getLectureTitle(a);
        const titleB = getLectureTitle(b);
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' }) ||
          String(a.video_id || '').localeCompare(String(b.video_id || ''));
      }
    }
  });
};

export const filterAndSortLectures = (lectures, { search = '', status = 'all', sortBy = 'title_asc' } = {}) => {
  if (!Array.isArray(lectures)) return [];
  let result = lectures;

  // Search filter
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(item =>
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q))
    );
  }

  // Status filter
  if (status && status !== 'all') {
    result = filterLecturesByStatus(result, status);
  }

  // Sort
  return sortLectures(result, sortBy);
};

