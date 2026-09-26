export const formatRelativeTime = (dateStr) => {
  if (!dateStr) return 'Recently';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Recently';
  }
};

export const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const getFileTypeBadge = (fileType, filename) => {
  const ext = (fileType || filename?.split('.').pop() || '').toLowerCase();
  if (['pdf'].includes(ext)) {
    return { label: 'PDF', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' };
  }
  if (['doc', 'docx'].includes(ext)) {
    return { label: 'DOC', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' };
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return { label: 'SLIDES', color: '#f97316', bg: 'rgba(249, 115, 22, 0.12)' };
  }
  if (['link', 'gdrive'].includes(ext)) {
    return { label: 'LINK', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
  }
  return { label: ext.toUpperCase() || 'FILE', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' };
};

export const extractVideoId = (url) => {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : trimmed;
};

export const parseTimestampToSeconds = (ts) => {
  if (!ts) return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

export const cleanSubmissionFallback = (text, targetWords = 120) => {
  if (!text) return '';
  let cleaned = text
    .replace(/^(based on (the )?(professor's )?(lecture|transcript|video|explanation|sources)[^:.\n]*?[,.:]+\s*)/i, '')
    .replace(/^(we can identify|we see that|we can observe|it can be seen that)\s+/i, '')
    .replace(/^(here('s| is) (what|a summary|my takeaway|the answer)[^:.,\n]*[:.,\n]+)/i, '')
    .replace(/^(certainly|sure thing|as an ai|in this lecture)[^:.,\n]*[:.,\n]+/i, '')
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/);
  if (words.length > targetWords + 15) {
    cleaned = words.slice(0, targetWords).join(' ') + '.';
  }
  return cleaned;
};
