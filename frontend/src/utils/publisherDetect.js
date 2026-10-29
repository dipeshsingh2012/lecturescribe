/**
 * Utility to identify academic publishers, domains with strict framing restrictions
 * (e.g. X-Frame-Options: SAMEORIGIN / CSP frame-ancestors 'self'), and open access sources.
 */

const RESTRICTED_PUBLISHER_DOMAINS = [
  { pattern: /jamanetwork\.com/i, name: 'JAMA Network' },
  { pattern: /sciencedirect\.com/i, name: 'ScienceDirect (Elsevier)' },
  { pattern: /elsevier\.com/i, name: 'Elsevier' },
  { pattern: /springer\.com/i, name: 'Springer' },
  { pattern: /nature\.com/i, name: 'Nature Publishing Group' },
  { pattern: /wiley\.com/i, name: 'Wiley Online Library' },
  { pattern: /nejm\.org/i, name: 'New England Journal of Medicine' },
  { pattern: /academic\.oup\.com/i, name: 'Oxford University Press' },
  { pattern: /tandfonline\.com/i, name: 'Taylor & Francis' },
  { pattern: /bmj\.com/i, name: 'The BMJ' },
  { pattern: /thelancet\.com/i, name: 'The Lancet' },
  { pattern: /cell\.com/i, name: 'Cell Press' },
  { pattern: /ahajournals\.org/i, name: 'AHA Journals' },
  { pattern: /pnas\.org/i, name: 'PNAS' },
  { pattern: /ieeexplore\.ieee\.org|ieee\.org/i, name: 'IEEE Xplore' },
  { pattern: /dl\.acm\.org|acm\.org/i, name: 'ACM Digital Library' },
  { pattern: /frontiersin\.org/i, name: 'Frontiers' },
  { pattern: /doi\.org/i, name: 'DOI Official Repository' }
];

const OPEN_ACCESS_DIRECT_DOMAINS = [
  /arxiv\.org/i,
  /europepmc\.org/i,
  /ncbi\.nlm\.nih\.gov/i,
  /pmc\.ncbi\.nlm\.nih\.gov/i,
  /biorxiv\.org/i,
  /medrxiv\.org/i,
  /archive\.org/i
];

/**
 * Returns publisher details if the URL belongs to a restricted domain.
 * @param {string} url
 * @returns {{ isRestricted: boolean, name?: string, domain?: string }}
 */
export function getPublisherInfo(url) {
  if (!url || typeof url !== 'string') {
    return { isRestricted: false };
  }

  for (const pub of RESTRICTED_PUBLISHER_DOMAINS) {
    if (pub.pattern.test(url)) {
      try {
        const parsed = new URL(url);
        return {
          isRestricted: true,
          name: pub.name,
          domain: parsed.hostname
        };
      } catch {
        return {
          isRestricted: true,
          name: pub.name,
          domain: ''
        };
      }
    }
  }

  return { isRestricted: false };
}

/**
 * Check if a URL is known to reject in-page iframe embedding.
 * @param {string} url
 * @returns {boolean}
 */
export function isRestrictedPublisherUrl(url) {
  return getPublisherInfo(url).isRestricted;
}

/**
 * Check if URL points directly to an open-access repository or direct PDF.
 * @param {string} url
 * @returns {boolean}
 */
export function isOpenAccessDirectPdf(url) {
  if (!url || typeof url !== 'string') return false;
  if (isRestrictedPublisherUrl(url)) return false;

  for (const pattern of OPEN_ACCESS_DIRECT_DOMAINS) {
    if (pattern.test(url)) return true;
  }

  return url.toLowerCase().includes('.pdf');
}

/**
 * Identify video source platform (e.g. YouTube, Udemy, Coursera, Moodle, Vimeo, etc.)
 * for generic lecture playback, source linking, and fallback views.
 * @param {string} rawUrl
 * @param {string} courseName
 * @returns {{ platform: string, label: string, url: string, title: string, color: string, bg: string, border: string } | null}
 */
export function getVideoSourceInfo(rawUrl, courseName = '') {
  const url = (rawUrl || '').trim();

  if (!url || url.includes('video.lecturescribe.local')) {
    if (courseName) {
      return {
        platform: 'moodle',
        label: 'Course Portal',
        url: `https://learning.iiitdwd.ac.in/course/search.php?search=${encodeURIComponent(courseName)}`,
        title: `Open ${courseName} on Course Portal`,
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.1)',
        border: 'rgba(245, 158, 11, 0.35)'
      };
    }
    return null;
  }

  const lower = url.toLowerCase();

  // YouTube
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return {
      platform: 'youtube',
      label: 'YouTube',
      url,
      title: 'Open original lecture on YouTube',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.1)',
      border: 'rgba(239, 68, 68, 0.35)'
    };
  }

  // Udemy
  if (lower.includes('udemy.com')) {
    return {
      platform: 'udemy',
      label: 'Udemy',
      url,
      title: 'Open course lecture on Udemy',
      color: '#a855f7',
      bg: 'rgba(168, 85, 247, 0.1)',
      border: 'rgba(168, 85, 247, 0.35)'
    };
  }

  // Coursera
  if (lower.includes('coursera.org')) {
    return {
      platform: 'coursera',
      label: 'Coursera',
      url,
      title: 'Open lecture on Coursera',
      color: '#0056d2',
      bg: 'rgba(0, 86, 210, 0.1)',
      border: 'rgba(0, 86, 210, 0.35)'
    };
  }

  // Vimeo
  if (lower.includes('vimeo.com')) {
    return {
      platform: 'vimeo',
      label: 'Vimeo',
      url,
      title: 'Open video on Vimeo',
      color: '#06b6d4',
      bg: 'rgba(6, 182, 212, 0.1)',
      border: 'rgba(6, 182, 212, 0.35)'
    };
  }

  // NPTEL / Swayam
  if (lower.includes('nptel.ac.in') || lower.includes('swayam.gov.in')) {
    return {
      platform: 'nptel',
      label: 'NPTEL',
      url,
      title: 'Open lecture on NPTEL',
      color: '#ea580c',
      bg: 'rgba(234, 88, 12, 0.1)',
      border: 'rgba(234, 88, 12, 0.35)'
    };
  }

  // edX
  if (lower.includes('edx.org')) {
    return {
      platform: 'edx',
      label: 'edX',
      url,
      title: 'Open lecture on edX',
      color: '#0284c7',
      bg: 'rgba(2, 132, 199, 0.1)',
      border: 'rgba(2, 132, 199, 0.35)'
    };
  }

  // Canvas LMS
  if (lower.includes('instructure.com') || lower.includes('canvas')) {
    return {
      platform: 'canvas',
      label: 'Canvas LMS',
      url,
      title: 'Open lecture on Canvas LMS',
      color: '#e11d48',
      bg: 'rgba(225, 29, 72, 0.1)',
      border: 'rgba(225, 29, 72, 0.35)'
    };
  }

  // Moodle LMS / IIIT Dharwad
  if (lower.includes('learning.iiitdwd.ac.in') || lower.includes('moodle')) {
    return {
      platform: 'moodle',
      label: 'Moodle LMS',
      url,
      title: 'Open original lecture session on Moodle LMS',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.1)',
      border: 'rgba(245, 158, 11, 0.35)'
    };
  }

  // Panopto
  if (lower.includes('panopto.com')) {
    return {
      platform: 'panopto',
      label: 'Panopto',
      url,
      title: 'Open lecture on Panopto',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.1)',
      border: 'rgba(16, 185, 129, 0.35)'
    };
  }

  // Generic external HTTP/HTTPS URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    let hostname = '';
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      hostname = '';
    }

    const domainTitle = hostname ? hostname.charAt(0).toUpperCase() + hostname.slice(1) : 'Original Source';

    return {
      platform: 'generic',
      label: domainTitle.length > 25 ? 'Original Source' : domainTitle,
      url,
      title: `Open original lecture source on ${hostname || 'external site'}`,
      color: '#6366f1',
      bg: 'rgba(99, 102, 241, 0.1)',
      border: 'rgba(99, 102, 241, 0.35)'
    };
  }

  return null;
}

