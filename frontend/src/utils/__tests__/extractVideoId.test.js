import { describe, it, expect } from 'vitest';
import { extractVideoId } from '../formatters';

describe('extractVideoId URL parsing and extraction', () => {
  describe('Direct numeric IDs', () => {
    it('returns raw numeric ID as-is', () => {
      expect(extractVideoId('76979871')).toBe('76979871');
      expect(extractVideoId('1229247139')).toBe('1229247139');
    });

    it('trims whitespace around numeric ID', () => {
      expect(extractVideoId('  76979871  ')).toBe('76979871');
      expect(extractVideoId('\n1229247139\t')).toBe('1229247139');
    });
  });

  describe('Standard Vimeo URLs', () => {
    it('extracts ID from HTTPS Vimeo URL', () => {
      expect(extractVideoId('https://vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/1229247139')).toBe('1229247139');
    });

    it('extracts ID from HTTP Vimeo URL', () => {
      expect(extractVideoId('http://vimeo.com/76979871')).toBe('76979871');
    });

    it('extracts ID from WWW Vimeo URL', () => {
      expect(extractVideoId('https://www.vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('http://www.vimeo.com/76979871')).toBe('76979871');
    });

    it('extracts ID from protocol-less Vimeo URL', () => {
      expect(extractVideoId('vimeo.com/76979871')).toBe('76979871');
      expect(extractVideoId('www.vimeo.com/76979871')).toBe('76979871');
    });
  });

  describe('Embed and Player URLs', () => {
    it('extracts ID from player.vimeo.com embed URLs', () => {
      expect(extractVideoId('https://player.vimeo.com/video/76979871')).toBe('76979871');
      expect(extractVideoId('http://player.vimeo.com/video/1229247139')).toBe('1229247139');
      expect(extractVideoId('player.vimeo.com/video/76979871')).toBe('76979871');
    });

    it('extracts ID from vimeo.com/video/ URLs', () => {
      expect(extractVideoId('https://vimeo.com/video/76979871')).toBe('76979871');
    });
  });

  describe('URLs with Query Parameters and Fragments', () => {
    it('extracts ID when query parameters are present', () => {
      expect(extractVideoId('https://vimeo.com/76979871?autoplay=1')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/76979871?autoplay=1&muted=true&color=ffffff')).toBe('76979871');
    });

    it('extracts ID when fragment / timestamp hash is present', () => {
      expect(extractVideoId('https://vimeo.com/76979871#t=1m30s')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/76979871#t=90')).toBe('76979871');
    });

    it('extracts ID with both query parameters and fragment', () => {
      expect(extractVideoId('https://vimeo.com/76979871?autoplay=1#t=1m30s')).toBe('76979871');
    });

    it('extracts ID with trailing slash', () => {
      expect(extractVideoId('https://vimeo.com/76979871/')).toBe('76979871');
    });
  });

  describe('Unlisted, Channels, and Management URLs', () => {
    it('extracts ID from unlisted video URLs containing privacy hash', () => {
      expect(extractVideoId('https://vimeo.com/76979871/d8e7c6b5a4')).toBe('76979871');
      expect(extractVideoId('https://player.vimeo.com/video/1229247139?h=abcdef1234')).toBe('1229247139');
    });

    it('extracts ID from Vimeo channel URLs', () => {
      expect(extractVideoId('https://vimeo.com/channels/staffpicks/76979871')).toBe('76979871');
      expect(extractVideoId('https://vimeo.com/channels/education/1229247139')).toBe('1229247139');
    });

    it('extracts ID from Vimeo group URLs', () => {
      expect(extractVideoId('https://vimeo.com/groups/motion/videos/76979871')).toBe('76979871');
    });

    it('extracts ID from Vimeo manage URLs', () => {
      expect(extractVideoId('https://vimeo.com/manage/videos/76979871')).toBe('76979871');
    });
  });

  describe('Edge cases and invalid inputs', () => {
    it('returns empty string for empty, null, or undefined inputs', () => {
      expect(extractVideoId('')).toBe('');
      expect(extractVideoId(null)).toBe('');
      expect(extractVideoId(undefined)).toBe('');
    });

    it('returns trimmed string if not matching Vimeo pattern nor digits', () => {
      expect(extractVideoId('custom-slug')).toBe('custom-slug');
      expect(extractVideoId('https://example.com/other')).toBe('https://example.com/other');
    });
  });
});
