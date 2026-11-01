export const formatRelativeTime = (dateStr) => {
  if (!dateStr) return 'Recently';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Recently';
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

  // Match optional path segments ending with the digit ID
  const match = trimmed.match(/(?:^|\/)(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|manage\/videos\/|video\/)?(\d+)(?:[?/#]|$)/);
  if (match) return match[1];
  return trimmed.split(/[?#]/)[0].trim();
};

export const normalizeTimestamp = (ts) => {
  if (!ts) return '';
  const str = String(ts).trim();
  if (!str) return '';

  // Pattern 1: 3-digit hour/minutes merged like 108:04 or 115:00 (HMM:SS)
  const hmmMatch = str.match(/^(\d)(\d{2}):(\d{2})$/);
  if (hmmMatch) {
    const [, h, mm, ss] = hmmMatch;
    return `${parseInt(h, 10)}:${mm}:${ss}`;
  }

  // Pattern 2: Standard H:MM:SS or HH:MM:SS (e.g. 01:08:04 -> 1:08:04)
  const hmsMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    return `${parseInt(hmsMatch[1], 10)}:${hmsMatch[2]}:${hmsMatch[3]}`;
  }

  // Pattern 3: Standard MM:SS (e.g. 14:20 or 05:30)
  return str;
};

export const parseTimestampToSeconds = (ts) => {
  if (!ts) return 0;
  if (typeof ts === 'number') return isNaN(ts) ? 0 : ts;
  const str = String(ts).trim();
  if (!str) return 0;
  if (str.includes(':')) {
    // Check if 3-digit hour/minutes merged like 108:04 -> 1h 08m 04s
    const hmmMatch = str.match(/^(\d)(\d{2}):(\d{2})$/);
    if (hmmMatch) {
      const [, h, mm, ss] = hmmMatch;
      return parseInt(h, 10) * 3600 + parseInt(mm, 10) * 60 + parseInt(ss, 10);
    }
    const parts = str.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }
  const hmMatch = str.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
  if (hmMatch && (hmMatch[1] || hmMatch[2] || hmMatch[3])) {
    const h = parseInt(hmMatch[1] || '0', 10);
    const m = parseInt(hmMatch[2] || '0', 10);
    const s = parseInt(hmMatch[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }
  const num = Number(str);
  return isNaN(num) ? 0 : num;
};

export const isGcsSignedUrlFresh = (url) => {
  if (!url || typeof url !== 'string') return false;
  try {
    const dateMatch = url.match(/[?&]X-Goog-Date=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/i);
    const expMatch = url.match(/[?&]X-Goog-Expires=(\d+)/i);
    if (dateMatch && expMatch) {
      const [, y, m, d, hh, mm, ss] = dateMatch;
      const signedAtMs = Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss);
      const expiresSec = parseInt(expMatch[1], 10);
      if (!isNaN(signedAtMs) && !isNaN(expiresSec)) {
        // Treat as expired if within 5 minutes of expiry
        return Date.now() < signedAtMs + Math.max(0, expiresSec - 300) * 1000;
      }
    }
    return true;
  } catch {
    return false;
  }
};

export const formatSecondsToTimestamp = (sec) => {
  const num = typeof sec === 'number' ? sec : Number(sec);
  if (isNaN(num) || num <= 0) return '00:00';
  const total = Math.floor(num);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const getUserDisplayName = (userOrName, email = null, fallback = 'Student') => {
  if (typeof userOrName === 'string' && userOrName.trim()) {
    return userOrName.trim();
  }
  if (userOrName && typeof userOrName === 'object') {
    if (userOrName.name && String(userOrName.name).trim()) {
      return String(userOrName.name).trim();
    }
    const e = userOrName.email || email;
    if (e && String(e).includes('@')) {
      return String(e).split('@')[0];
    }
  }
  if (email && String(email).includes('@')) {
    return String(email).split('@')[0];
  }
  return fallback;
};

export const getUserFirstName = (userOrName, email = null, fallback = 'Scholar') => {
  const full = getUserDisplayName(userOrName, email, fallback);
  if (!full || full === fallback) return fallback;
  return full.split(' ')[0] || fallback;
};

export const cleanSubmissionFallback = (text, targetWords = 120, query = '') => {
  if (!text) return '';
  const queryLower = (query || '').toLowerCase();
  let adaptiveTarget = targetWords;
  if (queryLower.includes('comprehensive') || queryLower.includes('full summary') || queryLower.includes('summary')) {
    adaptiveTarget = 650;
  } else if (queryLower.includes('concept') || queryLower.includes('definition')) {
    adaptiveTarget = 250;
  }

  // Lightweight strip of bot preambles, timestamps, and basic markdown formatting
  let cleaned = text
    .replace(/^(based on (the )?(professor's )?(lecture|transcript|video|explanation|sources)[^:.\n]*?[,.:]+\s*)/i, '')
    .replace(/^(here('s| is) (what|a summary|my takeaway|the answer)[^:.,\n]*[:.,\n]+)/i, '')
    .replace(/\[\d{1,3}:\d{2}(?::\d{2})?(?:[\s,\-–—]+\d{1,3}:\d{2}(?::\d{2})?)*\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bthe\s+instructor\b/gi, 'the professor')
    .replace(/\binstructor('s)?\b/gi, 'professor$1');

  // Normalize lines while preserving paragraph breaks
  const lines = cleaned.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const words = cleaned.split(/\s+/);
  if (words.length > adaptiveTarget + 15) {
    const slice = words.slice(0, adaptiveTarget).join(' ');
    const lastP = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
    if (lastP > slice.length * 0.7) {
      cleaned = slice.slice(0, lastP + 1);
    } else {
      cleaned = slice + '.';
    }
  }
  return cleaned;
};

export const truncateEnd = (str, maxLength = 30) => {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
};

export const formatResponseTime = (ms) => {
  if (ms === null || ms === undefined || ms === '' || typeof ms === 'boolean') return null;
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return null;
  const roundedMs = Math.round(num);
  if (roundedMs < 1000) {
    return `${Math.max(1, roundedMs)}ms`;
  }
  const totalTenths = Math.round(num / 100);
  if (totalTenths < 600) {
    return `${(totalTenths / 10).toFixed(1)}s`;
  }
  const mins = Math.floor(totalTenths / 600);
  const secs = ((totalTenths % 600) / 10).toFixed(1);
  return `${mins}m ${secs}s`;
};

const CTRL_B_LATEX_RE = /\x08(ackepsilon|ackprime|acksim|acksimeq|ackslash|arwedge|ar|ecause|egin|etween|eta|eth|fseries|f|igsqcup|igtriangledown|igtriangleup|igodot|igoplus|igotimes|iguplus|igvee|igwedge|igcap|igcup|iggl|iggm|iggr|igg|igl|igm|igr|ig|inom|lacktriangleleft|lacktriangleright|lacktriangledown|lacktriangle|lacklozenge|lacksquare|mod|m|oldsymbol|old|owtie|ot|oxminus|oxplus|oxtimes|oxdot|oxed|ox|reve|ullet|umpeq)(?![a-zA-Z])/g;
const CTRL_F_LATEX_RE = /\x0c(allingdotseq|orall|rac|rown|box|lat)(?![a-zA-Z])/g;
const CTRL_N_LATEX_RE = /\x0a(Leftrightarrow|leftrightarrow|trianglelefteq|trianglerighteq|shortparallel|ntriangleleft|triangleleft|triangleright|nsubseteqq|nsupseteqq|subseteqq|supseteqq|Leftarrow|leftarrow|Rightarrow|rightarrow|ewcommand|leqslant|shortmid|subseteq|supseteq|atural|earrow|oindent|olimits|onumber|preceq|succeq|VDash|Vdash|vDash|vdash|warrow|abla|leqq|otin|prec|succ|gtr|leq|mid|orm|sim|eg|eq|ot)(?![a-zA-Z])/g;
const CTRL_R_LATEX_RE = /\x0d(ightleftharpoons|ightharpoondown|ightharpoonup|ightleftarrows|ightrightarrows|ightsquigarrow|ightthreetimes|ightarrowtail|isingdotseq|estriction|ightarrow|moustache|aisebox|ight|angle|brace|brack|floor|times|Vert|vert|ceil|eal|ule|hd|ho|e|m)(?![a-zA-Z])/g;
const CTRL_T_LATEX_RE = /\x09(woheadleftarrow|woheadrightarrow|rianglerighteq|rianglelefteq|riangledown|riangleright|riangleleft|hickapprox|extnormal|herefore|riangleq|riangle|hicksim|hinspace|binom|extbf|extit|extmd|extrm|extsc|extsf|extsl|exttt|extup|frac|heta|ilde|imes|anh|ext|iny|au|eX)(?![a-zA-Z])/g;

const MATH_CTRL_T_RE = /\x09(op|ag|an|o)(?![a-zA-Z])/g;
const MATH_CTRL_N_RE = /\x0a(parallel|exists|less|e|i|u)(?![a-zA-Z])/g;

const BARE_BRACE_MACRO_RE = /(?<![\\a-zA-Z])(operatorname|textnormal|widetilde|underline|overline|widehat|textbf|textit|textrm|texttt|textsf|textup|textmd|textsc|textsl|mathcal|mathbb|mathbf|mathrm|mathit|mathsf|mathtt|dfrac|tfrac|binom|boxed|tilde|frac|sqrt|text|hat|bar|vec|dot|ddot)(?=\s*\{)/g;
const PROTECTED_TEXT_MACRO_RE = /(\\(?:textnormal|operatorname|textbf|textit|textrm|texttt|textsf|textup|textmd|textsc|textsl|text|mathrm|mathit|mathsf|mathtt)\s*\{[^{}]*\})/g;
const BARE_MATH_SYMBOL_RE = /(?<![\\a-zA-Z])(varepsilon|rightarrow|Rightarrow|leftarrow|Leftarrow|vartheta|varrho|varsigma|upsilon|Upsilon|epsilon|Lambda|lambda|partial|subseteq|supseteq|approx|propto|forall|exists|implies|sigma|Sigma|theta|Theta|alpha|gamma|Gamma|delta|Delta|kappa|omega|Omega|nabla|infty|equiv|simeq|cdots|ldots|times|beta|zeta|iota|phi|Phi|chi|psi|Psi|rho|tau|eta|mu|nu|xi|Xi|pi|Pi|cdot|leq|geq|neq|iff)(?![a-zA-Z])/g;

const UNIFIED_MATH_SPAN_RE = /(\$\$([\s\S]+?)\$\$|(?<!\\|\$)\$(?!\$)((?:\\.|(?:\x0a(?:parallel|exists|less|e|i|u)(?![a-zA-Z]))|[^\n$])+?)(?<!\\)\$(?!\$|\d)|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\))/g;

const repairMathInner = (mathBody) => {
  if (!mathBody) return mathBody;
  let fixed = mathBody
    .replace(MATH_CTRL_T_RE, (_m, s) => `\\t${s}`)
    .replace(MATH_CTRL_N_RE, (_m, s) => `\\n${s}`);

  // Restore missing backslashes on brace-taking macros outside already-escaped \text{...}
  fixed = fixed
    .split(PROTECTED_TEXT_MACRO_RE)
    .map((part, idx) => (idx % 2 === 1 ? part : part.replace(BARE_BRACE_MACRO_RE, (_m, cmd) => `\\${cmd}`)))
    .join('');

  // Re-split so newly restored \text{...} blocks are also protected from bare Greek symbol replacement
  return fixed
    .split(PROTECTED_TEXT_MACRO_RE)
    .map((part, idx) => (idx % 2 === 1 ? part : part.replace(BARE_MATH_SYMBOL_RE, (_m, sym) => `\\${sym}`)))
    .join('');
};

export const repairCorruptedLatex = (text) => {
  if (!text || typeof text !== 'string') return text || '';

  let repaired = text
    .replace(CTRL_B_LATEX_RE, (_m, s) => `\\b${s}`)
    .replace(CTRL_F_LATEX_RE, (_m, s) => `\\f${s}`)
    .replace(CTRL_N_LATEX_RE, (_m, s) => `\\n${s}`)
    .replace(CTRL_R_LATEX_RE, (_m, s) => `\\r${s}`)
    .replace(CTRL_T_LATEX_RE, (_m, s) => `\\t${s}`);

  if (repaired.includes('$') || repaired.includes('\\(') || repaired.includes('\\[')) {
    repaired = repaired.replace(UNIFIED_MATH_SPAN_RE, (full, _outer, displayDollar, inlineDollar, displayBracket, inlineParen) => {
      if (displayDollar !== undefined) {
        return `$$${repairMathInner(displayDollar)}$$`;
      }
      if (inlineDollar !== undefined) {
        const inner = repairMathInner(inlineDollar).replace(/^[ \t]+/, '').replace(/(?<!\\)[ \t]+$/, '');
        return `$${inner}$`;
      }
      if (displayBracket !== undefined) {
        return `\\[${repairMathInner(displayBracket)}\\]`;
      }
      if (inlineParen !== undefined) {
        return `\\(${repairMathInner(inlineParen)}\\)`;
      }
      return full;
    });
  }

  return repaired;
};
