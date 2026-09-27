import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  formatBytes,
  getFileTypeBadge,
  extractVideoId,
  parseTimestampToSeconds,
  cleanSubmissionFallback
} from '../formatters';

describe('formatters utility functions', () => {
  describe('formatRelativeTime', () => {
    it('returns "Recently" for empty/invalid inputs', () => {
      expect(formatRelativeTime(null)).toBe('Recently');
      expect(formatRelativeTime('')).toBe('Recently');
      expect(formatRelativeTime('invalid-date')).toBe('Recently');
    });

    it('formats recent timestamps accurately', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 10000).toISOString())).toBe('Just now');
      expect(formatRelativeTime(new Date(now - 5 * 60000).toISOString())).toBe('5m ago');
      expect(formatRelativeTime(new Date(now - 3 * 3600000).toISOString())).toBe('3h ago');
      expect(formatRelativeTime(new Date(now - 25 * 3600000).toISOString())).toBe('Yesterday');
      expect(formatRelativeTime(new Date(now - 5 * 86400000).toISOString())).toBe('5d ago');
    });
  });

  describe('formatBytes', () => {
    it('returns "0 B" for 0 or undefined', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(null)).toBe('0 B');
    });

    it('formats bytes, kilobytes, megabytes, and gigabytes', () => {
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(2621440)).toBe('2.5 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });

  describe('getFileTypeBadge', () => {
    it('returns correct badge for pdf', () => {
      const badge = getFileTypeBadge('pdf', 'test.pdf');
      expect(badge.label).toBe('PDF');
      expect(badge.color).toBe('#ef4444');
    });

    it('returns correct badge for docs and slides', () => {
      expect(getFileTypeBadge('docx').label).toBe('DOC');
      expect(getFileTypeBadge('ppt').label).toBe('SLIDES');
      expect(getFileTypeBadge('link').label).toBe('LINK');
      expect(getFileTypeBadge('gdrive').label).toBe('LINK');
    });

    it('falls back to uppercase extension or FILE', () => {
      expect(getFileTypeBadge('zip').label).toBe('ZIP');
      expect(getFileTypeBadge('', '').label).toBe('FILE');
    });
  });

  describe('extractVideoId', () => {
    it('returns empty string for empty url', () => {
      expect(extractVideoId('')).toBe('');
      expect(extractVideoId(null)).toBe('');
    });

    it('returns plain numeric IDs directly', () => {
      expect(extractVideoId('123456789')).toBe('123456789');
      expect(extractVideoId('  987654  ')).toBe('987654');
    });

    it('extracts ID from standard Vimeo URLs', () => {
      expect(extractVideoId('https://vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/video/76979871')).toBe('76979871');
      expect(extractVideoId('vimeo.com/76979871?autoplay=1')).toBe('76979871');
    });
  });

  describe('parseTimestampToSeconds', () => {
    it('parses MM:SS to seconds', () => {
      expect(parseTimestampToSeconds('01:30')).toBe(90);
      expect(parseTimestampToSeconds('00:45')).toBe(45);
    });

    it('parses HH:MM:SS to seconds', () => {
      expect(parseTimestampToSeconds('01:02:03')).toBe(3723);
    });

    it('handles falsy or empty values', () => {
      expect(parseTimestampToSeconds('')).toBe(0);
      expect(parseTimestampToSeconds(null)).toBe(0);
    });
  });

  describe('cleanSubmissionFallback', () => {
    it('removes conversational bot preambles and timestamps', () => {
      const raw = "Based on the professor's lecture: [01:23] Machine learning is a field of study.";
      const cleaned = cleanSubmissionFallback(raw);
      expect(cleaned).not.toContain("Based on the professor's lecture");
      expect(cleaned).not.toContain("[01:23]");
      expect(cleaned).toContain("Machine learning is a field of study.");
    });

    it('strips markdown formatting symbols', () => {
      const raw = "## Overview\n* **Supervised** learning uses `labeled` datasets.";
      const cleaned = cleanSubmissionFallback(raw);
      expect(cleaned).not.toContain('##');
      expect(cleaned).not.toContain('**');
      expect(cleaned).not.toContain('`');
      expect(cleaned).toContain('Supervised learning uses labeled datasets.');
    });

    it('limits output to target words', () => {
      const longText = new Array(200).fill('word').join(' ');
      const cleaned = cleanSubmissionFallback(longText, 50);
      const wordCount = cleaned.split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(52);
    });
  });
});
