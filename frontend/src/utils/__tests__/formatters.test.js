import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  formatBytes,
  getFileTypeBadge,
  extractVideoId,
  parseTimestampToSeconds,
  cleanSubmissionFallback,
  truncateEnd
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
    it('returns empty string for empty url or null/undefined', () => {
      expect(extractVideoId('')).toBe('');
      expect(extractVideoId(null)).toBe('');
      expect(extractVideoId(undefined)).toBe('');
    });

    it('returns plain numeric IDs directly with whitespace trimmed', () => {
      expect(extractVideoId('123456789')).toBe('123456789');
      expect(extractVideoId('  987654  ')).toBe('987654');
      expect(extractVideoId('\n1229247139\t')).toBe('1229247139');
    });

    it('extracts ID from standard Vimeo URLs', () => {
      expect(extractVideoId('https://vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('http://vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('https://www.vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('vimeo.com/76979871')).toBe('76979871');
    });

    it('extracts ID from player and embed URLs', () => {
      expect(extractVideoId('https://vimeo.com/video/76979871')).toBe('76979871');
      expect(extractVideoId('https://player.vimeo.com/video/76979871')).toBe('76979871');
    });

    it('extracts ID from URLs with query parameters and fragments', () => {
      expect(extractVideoId('vimeo.com/76979871?autoplay=1')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/76979871?autoplay=1&muted=true')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/76979871#t=30s')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/76979871/')).toBe('76979871');
    });

    it('extracts ID from unlisted, channel, group, and manage URLs', () => {
      expect(extractVideoId('https://vimeo.com/76979871/abc123def')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/channels/staffpicks/76979871')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/groups/motion/videos/76979871')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/manage/videos/76979871')).toBe('76979871');
    });

    it('returns trimmed string for non-matching URLs', () => {
      expect(extractVideoId('custom-slug')).toBe('custom-slug');
      expect(extractVideoId('https://example.com/other')).toBe('https://example.com/other');
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

    it('preserves paragraph breaks', () => {
      const raw = "Paragraph one content.\n\nParagraph two content.";
      const cleaned = cleanSubmissionFallback(raw);
      expect(cleaned).toContain('\n\n');
      expect(cleaned).toContain('Paragraph one content.');
      expect(cleaned).toContain('Paragraph two content.');
    });

    it('adapts target word count for comprehensive summary query', () => {
      const longText = new Array(400).fill('word').join(' ') + '.';
      const cleaned = cleanSubmissionFallback(longText, 120, 'Generate Full Comprehensive Summary');
      const wordCount = cleaned.split(/\s+/).length;
      expect(wordCount).toBeGreaterThan(250);
    });
  });

  describe('truncateEnd', () => {
    it('returns empty string for null, undefined, or non-string', () => {
      expect(truncateEnd(null)).toBe('');
      expect(truncateEnd(undefined)).toBe('');
      expect(truncateEnd(123)).toBe('');
    });

    it('returns original string if length is within maxLength', () => {
      expect(truncateEnd('Short text', 20)).toBe('Short text');
      expect(truncateEnd('Exact length', 12)).toBe('Exact length');
    });

    it('truncates at maxLength and appends ellipsis at the end', () => {
      const longCourse = 'Applied Mathematics for Data Science and AI';
      const truncated = truncateEnd(longCourse, 25);
      expect(truncated).toBe('Applied Mathematics for D...');
      expect(truncated.endsWith('...')).toBe(true);
    });
  });
});
