import { describe, it, expect } from 'vitest';
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  getLectureTitle,
  getLectureDate,
  getLectureProgress,
  getLectureDuration,
  isLectureCompleted,
  isLectureInProgress,
  isLectureUnwatched,
  filterLecturesByStatus,
  sortLectures,
  filterAndSortLectures
} from '../lectureSort';

describe('lectureSort utilities', () => {
  const lectures = [
    {
      video_id: 'v1',
      video_title: 'Lecture 10: Dynamic Programming',
      created_at: '2026-09-01T10:00:00Z',
      duration: '45:00',
      progress: { progress_percent: 100 }
    },
    {
      video_id: 'v2',
      video_title: 'Lecture 2: Graphs',
      created_at: '2026-09-05T10:00:00Z',
      duration: '1:15:00',
      progress: { progress_percent: 45, last_seconds: 500 }
    },
    {
      video_id: 'v3',
      video_title: 'Lecture 1: Introduction',
      created_at: '2026-09-10T10:00:00Z',
      duration: '30:00',
      progress: null
    }
  ];

  it('provides SORT_OPTIONS and STATUS_FILTERS definitions', () => {
    expect(SORT_OPTIONS.length).toBeGreaterThan(0);
    expect(SORT_OPTIONS[0].value).toBe('title_desc');
    expect(STATUS_FILTERS.length).toBeGreaterThan(0);
  });

  describe('getters and status checks', () => {
    it('getLectureTitle extracts video_title, title, or video_id', () => {
      expect(getLectureTitle({ video_title: 'Test' })).toBe('Test');
      expect(getLectureTitle({ title: 'Fallback' })).toBe('Fallback');
      expect(getLectureTitle({ video_id: '123' })).toBe('123');
      expect(getLectureTitle(null)).toBe('');
    });

    it('getLectureDate extracts timestamps safely', () => {
      expect(getLectureDate({ created_at: '2026-09-01T10:00:00Z' })).toBe(new Date('2026-09-01T10:00:00Z').getTime());
      expect(getLectureDate(null)).toBe(0);
    });

    it('getLectureProgress extracts progress_percent or fallback', () => {
      expect(getLectureProgress({ progress: { progress_percent: 50 } })).toBe(50);
      expect(getLectureProgress({ progress: { last_seconds: 10 } })).toBe(5);
      expect(getLectureProgress(null)).toBe(0);
    });

    it('getLectureDuration handles strings and numbers', () => {
      expect(getLectureDuration({ total_duration_seconds: 3600 })).toBe(3600);
      expect(getLectureDuration({ duration: '45:00' })).toBe(2700);
      expect(getLectureDuration(null)).toBe(0);
    });

    it('identifies completion status accurately', () => {
      expect(isLectureCompleted(lectures[0])).toBe(true);
      expect(isLectureCompleted(lectures[1])).toBe(false);
      expect(isLectureInProgress(lectures[1])).toBe(true);
      expect(isLectureUnwatched(lectures[2])).toBe(true);
    });
  });

  describe('sortLectures', () => {
    it('defaults to sorting by title descending (Z-A) with natural alphanumeric comparison (10, 2, 1)', () => {
      const sorted = sortLectures(lectures);
      expect(sorted.map(l => l.video_title)).toEqual([
        'Lecture 10: Dynamic Programming',
        'Lecture 2: Graphs',
        'Lecture 1: Introduction'
      ]);
    });

    it('sorts by title ascending (A-Z)', () => {
      const sorted = sortLectures(lectures, 'title_asc');
      expect(sorted.map(l => l.video_title)).toEqual([
        'Lecture 1: Introduction',
        'Lecture 2: Graphs',
        'Lecture 10: Dynamic Programming'
      ]);
    });

    it('sorts by date descending (newest first)', () => {
      const sorted = sortLectures(lectures, 'date_desc');
      expect(sorted[0].video_id).toBe('v3'); // Sep 10
      expect(sorted[1].video_id).toBe('v2'); // Sep 5
      expect(sorted[2].video_id).toBe('v1'); // Sep 1
    });

    it('sorts by date ascending (oldest first)', () => {
      const sorted = sortLectures(lectures, 'date_asc');
      expect(sorted[0].video_id).toBe('v1'); // Sep 1
      expect(sorted[1].video_id).toBe('v2'); // Sep 5
      expect(sorted[2].video_id).toBe('v3'); // Sep 10
    });

    it('sorts by progress descending', () => {
      const sorted = sortLectures(lectures, 'progress_desc');
      expect(sorted[0].video_id).toBe('v1'); // 100%
      expect(sorted[1].video_id).toBe('v2'); // 45%
      expect(sorted[2].video_id).toBe('v3'); // 0%
    });

    it('sorts by duration descending', () => {
      const sorted = sortLectures(lectures, 'duration_desc');
      expect(sorted[0].video_id).toBe('v2'); // 1:15:00
      expect(sorted[1].video_id).toBe('v1'); // 45:00
      expect(sorted[2].video_id).toBe('v3'); // 30:00
    });
  });

  describe('filterAndSortLectures', () => {
    it('filters by status and sorts by title', () => {
      const filtered = filterAndSortLectures(lectures, {
        status: 'in_progress',
        sortBy: 'title_asc'
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0].video_id).toBe('v2');
    });

    it('filters by search keyword and applies default title sort', () => {
      const filtered = filterAndSortLectures(lectures, {
        search: 'Lecture'
      });
      expect(filtered.length).toBe(3);
      expect(filtered[0].video_title).toBe('Lecture 10: Dynamic Programming');
    });
  });
});

