import { describe, it, expect } from 'vitest';
import {
  isRestrictedPublisherUrl,
  getPublisherInfo,
  isOpenAccessDirectPdf,
  getVideoSourceInfo
} from '../publisherDetect';

describe('publisherDetect utility', () => {
  it('correctly identifies JAMA Network as restricted', () => {
    const url = 'https://jamanetwork.com/journals/jama/fullarticle/2492881';
    expect(isRestrictedPublisherUrl(url)).toBe(true);
    const info = getPublisherInfo(url);
    expect(info.isRestricted).toBe(true);
    expect(info.name).toBe('JAMA Network');
    expect(info.domain).toBe('jamanetwork.com');
  });

  it('correctly identifies ScienceDirect, Springer, Wiley, NEJM, and DOI links as restricted', () => {
    expect(isRestrictedPublisherUrl('https://www.sciencedirect.com/science/article/pii/S0140673620301835')).toBe(true);
    expect(isRestrictedPublisherUrl('https://link.springer.com/article/10.1007/s00134-016-4577-4')).toBe(true);
    expect(isRestrictedPublisherUrl('https://onlinelibrary.wiley.com/doi/10.1002/art.41738')).toBe(true);
    expect(isRestrictedPublisherUrl('https://www.nejm.org/doi/full/10.1056/NEJMoa2002032')).toBe(true);
    expect(isRestrictedPublisherUrl('https://doi.org/10.1001/jama.2016.0287')).toBe(true);
  });

  it('allows safe, embeddable open-access sources and Google Books', () => {
    expect(isRestrictedPublisherUrl('https://books.google.com/books?id=12345&output=embed')).toBe(false);
    expect(isRestrictedPublisherUrl('https://archive.org/embed/patternclassific0000rich_2ed?ui=embed')).toBe(false);
    expect(isOpenAccessDirectPdf('https://arxiv.org/pdf/1706.03762.pdf')).toBe(true);
    expect(isOpenAccessDirectPdf('https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC4968574&blobtype=pdf')).toBe(true);
  });

  it('handles invalid or empty URLs safely', () => {
    expect(isRestrictedPublisherUrl(null)).toBe(false);
    expect(isRestrictedPublisherUrl('')).toBe(false);
    expect(isRestrictedPublisherUrl(undefined)).toBe(false);
    expect(isOpenAccessDirectPdf(null)).toBe(false);
  });

  describe('getVideoSourceInfo', () => {
    it('detects YouTube lecture URLs', () => {
      const info = getVideoSourceInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(info.platform).toBe('youtube');
      expect(info.label).toBe('YouTube');
      expect(info.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('detects Udemy lecture URLs', () => {
      const info = getVideoSourceInfo('https://www.udemy.com/course/machinelearning/learn/lecture/12345');
      expect(info.platform).toBe('udemy');
      expect(info.label).toBe('Udemy');
    });

    it('detects Coursera and Vimeo URLs', () => {
      expect(getVideoSourceInfo('https://www.coursera.org/learn/deep-neural-networks/lecture/abc').label).toBe('Coursera');
      expect(getVideoSourceInfo('https://vimeo.com/987654321').label).toBe('Vimeo');
    });

    it('detects Moodle LMS URLs', () => {
      const info = getVideoSourceInfo('https://learning.iiitdwd.ac.in/mod/page/view.php?id=3111');
      expect(info.platform).toBe('moodle');
      expect(info.label).toBe('Moodle LMS');
    });

    it('detects generic external lecture sources and formats domain label', () => {
      const info = getVideoSourceInfo('https://ocw.mit.edu/courses/physics/lecture-1');
      expect(info.platform).toBe('generic');
      expect(info.label).toBe('Ocw.mit.edu');
    });

    it('falls back to course portal when URL is empty or internal video.lecturescribe.local with courseName', () => {
      const info = getVideoSourceInfo('https://video.lecturescribe.local/123', 'Machine Learning');
      expect(info.label).toBe('Course Portal');
      expect(info.url).toContain('Machine%20Learning');
    });
  });
});

