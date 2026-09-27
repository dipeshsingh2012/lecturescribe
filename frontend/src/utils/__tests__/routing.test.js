import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePathRoute,
  getLectureIdFromPath,
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

    it('returns nulls for root path', () => {
      const res = parsePathRoute('/');
      expect(res.courseName).toBeNull();
      expect(res.videoId).toBeNull();
    });
  });

  describe('getLectureIdFromPath and getCourseNameFromPath', () => {
    it('extracts lecture ID correctly', () => {
      expect(getLectureIdFromPath('/course/math/lecture/555')).toBe('555');
      expect(getLectureIdFromPath('/course/math')).toBeNull();
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
  });
});
