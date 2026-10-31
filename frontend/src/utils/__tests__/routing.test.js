import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePathRoute,
  getLectureTabFromPath,
  getCourseTabFromPath,
  VALID_COURSE_TABS,
  getLectureIdFromPath,
  getNoteIdFromPath,
  getCourseNameFromPath,
  normalizeCourseSlug,
  navigateTo
} from '../routing';

describe('routing utility functions', () => {
  describe('normalizeCourseSlug', () => {
    it('normalizes course strings to clean URL slugs', () => {
      expect(normalizeCourseSlug('Applied Mathematics for AI')).toBe('applied-mathematics-for-ai');
      expect(normalizeCourseSlug('CS 101: Intro to Python!')).toBe('cs-101-intro-to-python');
      expect(normalizeCourseSlug('---Data-Science---')).toBe('data-science');
      expect(normalizeCourseSlug('')).toBe('');
      expect(normalizeCourseSlug(null)).toBe('');
    });
  });

  describe('parsePathRoute', () => {
    it('parses nested course lecture paths', () => {
      const res = parsePathRoute('/course/data-science/lecture/123456');
      expect(res.courseName).toBe('data-science');
      expect(res.videoId).toBe('123456');
    });

    it('parses standalone course paths', () => {
      const res = parsePathRoute('/course/computer-vision');
      expect(res.courseName).toBe('computer-vision');
      expect(res.videoId).toBeNull();
    });

    it('parses standalone lecture paths', () => {
      const res = parsePathRoute('/lecture/987654');
      expect(res.courseName).toBeNull();
      expect(res.videoId).toBe('987654');
    });

    it('parses nested course note paths', () => {
      const res = parsePathRoute('/course/master-of-technology/note/note_12345');
      expect(res.courseName).toBe('master-of-technology');
      expect(res.noteId).toBe('note_12345');
      expect(res.videoId).toBeNull();
    });

    it('returns nulls for root path', () => {
      const res = parsePathRoute('/');
      expect(res.courseName).toBeNull();
      expect(res.videoId).toBeNull();
      expect(res.noteId).toBeNull();
    });
  });

  describe('getNoteIdFromPath', () => {
    it('extracts note ID correctly', () => {
      expect(getNoteIdFromPath('/course/master-of-technology/note/note_abc123')).toBe('note_abc123');
      expect(getNoteIdFromPath('/course/master-of-technology')).toBeNull();
    });
  });

  describe('getLectureIdFromPath and getCourseNameFromPath', () => {
    it('extracts lecture ID correctly', () => {
      expect(getLectureIdFromPath('/course/math/lecture/555')).toBe('555');
      expect(getLectureIdFromPath('/course/math')).toBeNull();
    });

    describe('getLectureTabFromPath', () => {
      it('reads tab selection only from lecture routes', () => {
        expect(getLectureTabFromPath('/lecture/123?tab=summary')).toBe('summary');
        expect(getLectureTabFromPath('/lecture/123?tab=quiz')).toBe('quiz');
        expect(getLectureTabFromPath('/course/data-science/lecture/123?tab=tutor')).toBe('tutor');
      });

      it('defaults to transcript for other pages and lecture routes without a tab', () => {
        expect(getLectureTabFromPath('/course/data-science?tab=quiz')).toBe('transcript');
        expect(getLectureTabFromPath('/?tab=quiz')).toBe('transcript');
        expect(getLectureTabFromPath('/lecture/123')).toBe('transcript');
      });
    });

    describe('getCourseTabFromPath', () => {
      it('reads valid course tabs from query string', () => {
        expect(getCourseTabFromPath('/course/math?tab=quiz')).toBe('quiz');
        expect(getCourseTabFromPath('/course/math?tab=tutor')).toBe('tutor');
        expect(getCourseTabFromPath('/course/math?tab=summary')).toBe('summary');
        expect(getCourseTabFromPath('/course/math?tab=library')).toBe('library');
        expect(getCourseTabFromPath('/course/math?tab=assignments')).toBe('assignments');
      });

      it('defaults to lectures when no tab is present or tab is invalid', () => {
        expect(getCourseTabFromPath('/course/math')).toBe('lectures');
        expect(getCourseTabFromPath('/course/math?tab=invalid_tab')).toBe('lectures');
        expect(getCourseTabFromPath('/')).toBe('lectures');
        expect(getCourseTabFromPath(null)).toBe('lectures');
      });

      it('includes all primary and secondary course tabs in VALID_COURSE_TABS', () => {
        expect(VALID_COURSE_TABS.has('lectures')).toBe(true);
        expect(VALID_COURSE_TABS.has('quiz')).toBe(true);
        expect(VALID_COURSE_TABS.has('summary')).toBe(true);
        expect(VALID_COURSE_TABS.has('tutor')).toBe(true);
        expect(VALID_COURSE_TABS.has('library')).toBe(true);
        expect(VALID_COURSE_TABS.has('resources')).toBe(true);
        expect(VALID_COURSE_TABS.has('calendar')).toBe(true);
        expect(VALID_COURSE_TABS.has('assignments')).toBe(true);
      });
    });

    it('extracts course name correctly', () => {
      expect(getCourseNameFromPath('/course/physics-101/lecture/555')).toBe('physics-101');
      expect(getCourseNameFromPath('/lecture/555')).toBeNull();
    });
  });

  describe('navigateTo', () => {
    beforeEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('pushes state and triggers onStateUpdate callback', () => {
      const onStateUpdate = vi.fn();
      navigateTo('/course/ml', false, onStateUpdate);
      expect(window.location.pathname).toBe('/course/ml');
      expect(onStateUpdate).toHaveBeenCalledWith('/course/ml');
    });

    it('replaces state when replace option is true', () => {
      navigateTo('/course/deep-learning', true);
      expect(window.location.pathname).toBe('/course/deep-learning');
    });

    it('navigates with query parameters such as tab marker', () => {
      navigateTo('/lecture/1231770905?tab=tutor', false);
      expect(window.location.pathname).toBe('/lecture/1231770905');
      expect(window.location.search).toBe('?tab=tutor');
    });
  });
});
