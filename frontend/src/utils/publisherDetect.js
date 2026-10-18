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

