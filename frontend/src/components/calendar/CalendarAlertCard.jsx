import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress
} from '@mui/material';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  BookOpen,
  Award,
  Sun,
  Coffee,
  Moon,
  Video,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Mic,
  Plus,
  Trash2
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import CalendarAIExtractorModal from './CalendarAIExtractorModal';

const PLATFORM_CONFIG = {
  zoom: {
    label: 'Join Zoom',
    bg: '#0b5cff',
    color: '#ffffff',
    hoverBg: '#094ecc',
    border: '#0b5cff'
  },
  meet: {
    label: 'Join Google Meet',
    bg: '#00796b',
    color: '#ffffff',
    hoverBg: '#00695c',
    border: '#00796b'
  },
  teams: {
    label: 'Join MS Teams',
    bg: '#4f46e5',
    color: '#ffffff',
    hoverBg: '#4338ca',
    border: '#4f46e5'
  },
  webex: {
    label: 'Join Webex',
    bg: '#00838f',
    color: '#ffffff',
    hoverBg: '#006064',
    border: '#00838f'
  },
  bbb: {
    label: 'Join Class (BBB)',
    bg: '#1d4ed8',
    color: '#ffffff',
    hoverBg: '#1e40af',
    border: '#1d4ed8'
  },
  moodle: {
    label: 'Open in Moodle',
    bg: '#ea580c',
    color: '#ffffff',
    hoverBg: '#c2410c',
    border: '#ea580c'
  },
  link: {
    label: 'Join Meeting',
    bg: '#2563eb',
    color: '#ffffff',
    hoverBg: '#1d4ed8',
    border: '#2563eb'
  }
};

const getMeetingInfo = (evt) => {
  let url = evt.meeting_url || evt.url;
  let platform = evt.meeting_platform;

  if (!url) {
    const combined = `${evt.location || ''} ${evt.description || ''}`;
    const match = combined.match(/https?:\/\/[^\s<>"')]+[^\s<>"'().,:;?!]/i);
    if (match) {
      url = match[0];
    }
  }

  if (url && (!platform || platform === 'link' || platform === 'generic')) {
    const lower = url.toLowerCase();
    if (lower.includes('zoom.us')) platform = 'zoom';
    else if (lower.includes('meet.google.com')) platform = 'meet';
    else if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) platform = 'teams';
    else if (lower.includes('webex.com')) platform = 'webex';
    else if (lower.includes('bigbluebutton') || lower.includes('/bbb')) platform = 'bbb';
    else if (lower.includes('moodle') || lower.includes('learning.iiitdwd.ac.in')) platform = 'moodle';
    else platform = 'link';
  }

  return {
    url,
    platform: platform || 'link',
    config: PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.link
  };
};

const renderWithLinks = (text, primaryColor = '#2563eb') => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s<>"')]+[^\s<>"'().,:;?!])/g;
  const parts = [];
  let lastIdx = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const start = match.index;
    const end = urlRegex.lastIndex;
    if (start > lastIdx) {
      parts.push(text.slice(lastIdx, start));
    }
    const url = match[0];
    parts.push(
      <Box
        component="a"
        key={`${start}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        sx={{
          color: primaryColor,
          fontWeight: 600,
          textDecoration: 'underline',
          wordBreak: 'break-all',
          display: 'inline',
          cursor: 'pointer',
          '&:hover': {
            opacity: 0.8,
            textDecoration: 'none'
          }
        }}
      >
        {url}
      </Box>
    );
    lastIdx = end;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length > 0 ? parts : text;
};

const CATEGORY_STYLES = {
  exam: {
    label: 'Exam / Viva',
    icon: <AlertTriangle size={13} />,
    bg: '#fee2e2',
    color: '#991b1b',
    border: '#fca5a5'
  },
  quiz: {
    label: 'Quiz / Test',
    icon: <Award size={13} />,
    bg: '#f3e8ff',
    color: '#6b21a8',
    border: '#d8b4fe'
  },
  assignment: {
    label: 'Assignment Due',
    icon: <FileText size={13} />,
    bg: '#fef3c7',
    color: '#92400e',
    border: '#fde68a'
  },
  lab: {
    label: 'Lab Session',
    icon: <BookOpen size={13} />,
    bg: '#d1fae5',
    color: '#065f46',
    border: '#6ee7b7'
  },
  lecture: {
    label: 'Lecture',
    icon: <BookOpen size={13} />,
    bg: '#e0f2fe',
    color: '#0369a1',
    border: '#bae6fd'
  },
  schedule: {
    label: 'Schedule',
    icon: <CalendarIcon size={13} />,
    bg: '#f1f5f9',
    color: '#334155',
    border: '#cbd5e1'
  }
};

export function filterCourseUpcomingEvents(agenda, selectedCourse) {
  if (!agenda || !selectedCourse) return [];

  const cleanCourse = selectedCourse.replace(/^[0-9\.\s\-_]+/, '').trim();
  const targetSlug = normalizeCourseSlug(selectedCourse);
  const cleanSlug = normalizeCourseSlug(cleanCourse);

  const targetWords = targetSlug.replace(/-/g, ' ');
  const cleanWords = cleanSlug.replace(/-/g, ' ');

  const combined = [
    ...(agenda?.today?.all || []),
    ...(Array.isArray(agenda?.upcoming) ? agenda.upcoming : (agenda?.upcoming?.all || [])),
    ...(agenda?.all_events || [])
  ];

  const todayEventIds = new Set((agenda?.today?.all || []).map((e) => e?.id).filter(Boolean));

  const isPastDate = (evt) => {
    if (!evt) return true;
    try {
      const now = new Date();
      const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const utcTodayStr = now.toISOString().slice(0, 10);

      // 1. Direct date_iso check (YYYY-MM-DD)
      if (evt.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(evt.date_iso)) {
        return evt.date_iso < localTodayStr && evt.date_iso < utcTodayStr;
      }

      const startOfTodayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
      const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
      const minTodayMs = Math.min(startOfTodayLocal, startOfTodayUtc);

      // 2. Numeric epoch timestamp (seconds from backend)
      const tsSec = evt.timestamp_end || evt.timestamp_start;
      if (tsSec) {
        return (tsSec * 1000) < minTodayMs;
      }

      // 3. Raw ISO start or end datetime
      const rawDt = evt.end || evt.start;
      if (rawDt) {
        const d = new Date(rawDt);
        if (!isNaN(d.getTime())) {
          return d.getTime() < minTodayMs;
        }
      }

      // 4. Formatted date string (e.g. "Saturday, Sep 19, 2026")
      if (evt.date_formatted) {
        const d = new Date(evt.date_formatted);
        if (!isNaN(d.getTime())) {
          return d.getTime() < minTodayMs;
        }
      }

      // 5. If event was in today's slot without explicit date string, it is today's event
      if (evt.id && todayEventIds.has(evt.id)) {
        return false;
      }
    } catch (e) {}
    return false;
  };

  const GENERIC_SLUGS = new Set([
    '', 'course', 'site', 'user', 'category', 'group', 'general',
    'schedule', 'event', 'lecture', 'session', 'quiz', 'assignment', 'exam'
  ]);
  const STOP_WORDS = new Set([
    'introduction', 'intro', 'advanced', 'fundamentals', 'principles', 'basics',
    'course', 'lecture', 'session', 'lab', 'to', 'of', 'and', 'in', 'for',
    'the', 'a', 'an', 'i', 'ii', 'iii', 'part'
  ]);
  const distinctiveWords = cleanWords.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const courseAcronym = cleanWords.split(' ').filter(Boolean).map(w => w[0]).join('');

  const seen = new Set();
  const filtered = [];

  for (const evt of combined) {
    if (!evt || !evt.id || seen.has(evt.id)) continue;
    seen.add(evt.id);

    // Never show past dates in course key dates / upcoming events
    if (isPastDate(evt)) {
      continue;
    }

    const evtSlug = normalizeCourseSlug(evt.course_slug || '');
    const evtName = (evt.course_name || '').toLowerCase();
    const titleDesc = `${evt.title || ''} ${evt.description || ''}`.toLowerCase();
    const evtTitleLower = (evt.title || '').toLowerCase().trim();

    let matches = false;
    if (evtSlug && !GENERIC_SLUGS.has(evtSlug)) {
      if (evtSlug === targetSlug || evtSlug === cleanSlug) {
        matches = true;
      } else if (courseAcronym && courseAcronym.length >= 3 && (evtSlug.startsWith(courseAcronym) || evtSlug.includes(courseAcronym))) {
        matches = true;
      }
    }
    
    if (!matches && evtName && !GENERIC_SLUGS.has(evtName)) {
      if (evtName === selectedCourse.toLowerCase() || evtName === cleanCourse.toLowerCase() || evtName.includes(cleanCourse.toLowerCase())) {
        matches = true;
      }
    }

    if (!matches) {
      if (cleanWords && (titleDesc.includes(cleanWords) || cleanWords.includes(evtTitleLower) || evtTitleLower.includes(cleanWords))) {
        matches = true;
      } else if (targetWords && (titleDesc.includes(targetWords) || targetWords.includes(evtTitleLower) || evtTitleLower.includes(targetWords))) {
        matches = true;
      } else if (distinctiveWords.length > 0 && distinctiveWords.every(w => titleDesc.includes(w) || evtTitleLower.includes(w))) {
        matches = true;
      }
    }

    if (matches) {
      filtered.push(evt);
    }
  }

  filtered.sort((a, b) => (a.timestamp_start || 0) - (b.timestamp_start || 0));
  return filtered;
}

export function getEventBadgeDate(evt) {
  if (!evt) return { day: '--', month: '---', time: '' };
  try {
    let day = '--';
    let month = '---';
    let timeStr = evt.start_time_formatted || '';

    // Direct ISO date parsing (e.g. 2026-10-27) avoids local/UTC timezone day shift
    if (evt.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(evt.date_iso)) {
      const parts = evt.date_iso.split('-');
      day = parseInt(parts[2], 10);
      const mIdx = parseInt(parts[1], 10) - 1;
      const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      month = MONTHS[mIdx] || '---';
    }

    const raw = evt.start || evt.date_iso;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        if (day === '--') {
          day = d.getDate();
          month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        }
        if (evt.is_all_day) {
          timeStr = 'All day';
        } else if (!timeStr && (evt.start || (evt.date_iso && evt.date_iso.includes('T')))) {
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          timeStr = `${hours}:${minutes}`;
        }
      }
    }

    if (day !== '--' && month !== '---') {
      return { day, month, time: timeStr || evt.start_time_formatted || '' };
    }
  } catch (e) {
    // fallback
  }

  const monthMatch = (evt.date_formatted || '').match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  const dayMatch = (evt.date_formatted || '').match(/\b(\d{1,2})\b/);
  if (dayMatch || monthMatch) {
    return {
      day: dayMatch ? dayMatch[1] : '--',
      month: monthMatch ? monthMatch[0].toUpperCase() : 'DATE',
      time: evt.start_time_formatted || ''
    };
  }

  const now = new Date();
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return {
    day: now.getDate(),
    month: MONTHS[now.getMonth()],
    time: evt.start_time_formatted || ''
  };
}

export default function CalendarAlertCard({
  currentTheme,
  googleUser,
  isTutor = false,
  selectedCourse = null,
  courses = [],
  videoId = '',
  lectureTitle = '',
  compact = false,
  onOpenFullCalendar = null,
  onSelectLecture = null
}) {
  const [agenda, setAgenda] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(selectedCourse ? 'upcoming' : 'today'); // 'today' | 'upcoming'
  const [copiedId, setCopiedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState('pdf');

  const openExtractorModal = (tab = 'pdf') => {
    setModalTab(tab);
    setModalOpen(true);
  };

  const handleCopyLink = (id, linkText) => {
    if (!linkText) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(linkText);
    }
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const fetchAgenda = useCallback(async (refresh = false) => {
    if (!googleUser && !selectedCourse) return;
    setLoading(true);
    setError(null);
    try {
      const daysWindow = selectedCourse ? 90 : 7;
      let url = `${API_BASE}/api/calendar/events?refresh=${refresh}&days=${daysWindow}`;
      if (selectedCourse) {
        url += `&course=${encodeURIComponent(selectedCourse)}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load calendar feed`);
      }
      const data = await res.json();
      setAgenda(data);
    } catch (err) {
      console.error('Failed to fetch Moodle agenda:', err);
      setError(err.message || 'Unable to sync Moodle calendar feed');
    } finally {
      setLoading(false);
    }
  }, [googleUser, selectedCourse]);

  const handleDeleteEvent = async (evtId) => {
    if (!evtId) return;
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(evtId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchAgenda(false);
      }
    } catch (e) {
      console.error('Failed to delete calendar event:', e);
    }
  };

  useEffect(() => {
    if (googleUser || selectedCourse) {
      fetchAgenda(false);
    }
  }, [fetchAgenda, googleUser, selectedCourse]);

  const courseUpcomingEvents = useMemo(() => {
    return filterCourseUpcomingEvents(agenda, selectedCourse);
  }, [agenda, selectedCourse]);

  const getBadgeDate = getEventBadgeDate;

  if (!googleUser && !selectedCourse) {
    return null;
  }

  // =========================================================================
  // MOODLE-STYLE COMPACT "KEY DATES" WIDGET FOR COURSE VIEW
  // =========================================================================
  if (selectedCourse) {
    return (
      <Box
        sx={{
          mb: 3,
          p: { xs: 2, sm: 2.2 },
          borderRadius: '16px',
          bgcolor: currentTheme?.palette?.cardBg || '#ffffff',
          border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.08)'}`,
          boxShadow: currentTheme?.palette?.cardShadow || '0 2px 8px rgba(0,0,0,0.04)',
          maxWidth: { xs: '100%', sm: 380 },
          width: '100%',
          transition: 'all 0.2s ease'
        }}
      >
        {/* Header: Blue Dot + Key dates */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.8 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: '#2563eb'
              }}
            />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 800,
                fontSize: '0.92rem',
                color: currentTheme?.palette?.textPrimary || '#0f172a',
                letterSpacing: '-0.2px'
              }}
            >
              Key dates
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {onOpenFullCalendar && (
              <Tooltip title="View full course calendar">
                <IconButton
                  size="small"
                  onClick={onOpenFullCalendar}
                  sx={{
                    p: 0.5,
                    color: currentTheme?.palette?.textSecondary || '#64748b',
                    '&:hover': { color: '#2563eb' }
                  }}
                  aria-label="View full course calendar"
                >
                  <CalendarIcon size={14} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Refresh key dates">
              <IconButton
                size="small"
                onClick={() => fetchAgenda(true)}
                disabled={loading}
                sx={{
                  p: 0.5,
                  color: currentTheme?.palette?.textSecondary || '#64748b'
                }}
                aria-label="Refresh key dates"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Content */}
        {loading && !agenda ? (
          <Box sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'center' }}>
            <CircularProgress size={16} sx={{ color: '#2563eb' }} />
            <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary, fontWeight: 600 }}>
              Syncing key dates...
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ py: 1.5, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: '#ef4444', display: 'block', mb: 0.5 }}>
              {error}
            </Typography>
            <Button size="small" onClick={() => fetchAgenda(true)} sx={{ fontSize: '0.7rem', textTransform: 'none', p: 0 }}>
              Retry
            </Button>
          </Box>
        ) : courseUpcomingEvents.length === 0 ? (
          <Box sx={{ py: 1.5, px: 0.5 }}>
            <Typography variant="body2" sx={{ fontSize: '0.84rem', color: currentTheme?.palette?.textSecondary, fontWeight: 500 }}>
              No upcoming key dates for this course.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {courseUpcomingEvents.map((evt) => {
              const badge = getBadgeDate(evt);
              const meetingInfo = getMeetingInfo(evt);

              return (
                <Box
                  key={evt.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 0.8,
                    borderRadius: '10px',
                    transition: 'background 0.15s ease',
                    '&:hover': {
                      bgcolor: currentTheme?.palette?.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'
                    }
                  }}
                >
                  {/* Date Badge: Top day number, bottom red uppercase month */}
                  <Box
                    sx={{
                      width: 46,
                      minWidth: 46,
                      height: 46,
                      borderRadius: '10px',
                      bgcolor: currentTheme?.palette?.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : '#f3f4f6',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        lineHeight: 1,
                        color: currentTheme?.palette?.textPrimary || '#0f172a'
                      }}
                    >
                      {badge.day}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        lineHeight: 1,
                        mt: '3px',
                        color: '#ef4444',
                        letterSpacing: '0.4px'
                      }}
                    >
                      {badge.month}
                    </Typography>
                  </Box>

                  {/* Title and Time */}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="body2"
                      onClick={
                        evt.source_metadata?.video_id && typeof onSelectLecture === 'function'
                          ? () => onSelectLecture(evt.source_metadata.video_id, evt.source_metadata.cue_time || '00:00', evt.course_name || selectedCourse)
                          : undefined
                      }
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        color: currentTheme?.palette?.textPrimary || '#0f172a',
                        lineHeight: 1.3,
                        cursor: evt.source_metadata?.video_id && typeof onSelectLecture === 'function' ? 'pointer' : 'default',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        '&:hover': evt.source_metadata?.video_id && typeof onSelectLecture === 'function' ? { color: '#2563eb' } : {}
                      }}
                      title={evt.title}
                    >
                      {evt.title}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.3 }}>
                      {badge.time && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: currentTheme?.palette?.textSecondary || '#64748b',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            letterSpacing: '0.3px'
                          }}
                        >
                          {badge.time}
                        </Typography>
                      )}

                      {meetingInfo.url && (
                        <Button
                          component="a"
                          href={meetingInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          size="small"
                          startIcon={<Video size={10} />}
                          sx={{
                            p: 0,
                            minWidth: 'auto',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            textTransform: 'none',
                            color: meetingInfo.config.bg || '#2563eb',
                            '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' }
                          }}
                        >
                          {meetingInfo.config.label || 'Join'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  const renderEventItem = (evt) => {
    const style = CATEGORY_STYLES[evt.category] || CATEGORY_STYLES.schedule;
    const meetingInfo = getMeetingInfo(evt);
    const isExpanded = expandedIds.has(evt.id);
    const isLongDesc = evt.description && (evt.description.length > 110 || evt.description.includes('\n'));

    return (
      <Box
        key={evt.id}
        sx={{
          p: 2,
          mb: 1.5,
          borderRadius: 2.5,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          bgcolor: currentTheme.palette.surface || 'rgba(255,255,255,0.03)',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: currentTheme.palette.primary,
            transform: 'translateY(-1px)',
            boxShadow: currentTheme.palette.cardShadow
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              size="small"
              icon={style.icon}
              label={style.label}
              sx={{
                bgcolor: style.bg,
                color: style.color,
                fontWeight: 700,
                fontSize: '0.72rem',
                border: `1px solid ${style.border}`,
                height: 24,
                '& .MuiChip-icon': { color: style.color, ml: '6px' }
              }}
            />
            {evt.day_slot && (
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, textTransform: 'capitalize', fontWeight: 600 }}>
                • {evt.day_slot.replace('_', ' ')}
              </Typography>
            )}
            {evt.source_type === 'pdf_ai' && (
              <Chip
                size="small"
                label="📄 AI Exam PDF"
                sx={{
                  height: 22,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(16, 185, 129, 0.14)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.35)'
                }}
              />
            )}
            {evt.source_type === 'transcript_ai' && (
              <Chip
                size="small"
                label={`🎙️ AI Transcript${evt.source_metadata?.cue_time ? ` @ ${evt.source_metadata.cue_time}` : ''}`}
                onClick={
                  evt.source_metadata?.video_id && typeof onSelectLecture === 'function'
                    ? (e) => {
                        e.stopPropagation();
                        onSelectLecture(
                          evt.source_metadata.video_id,
                          evt.source_metadata.cue_time || '00:00',
                          evt.course_name || selectedCourse
                        );
                      }
                    : undefined
                }
                sx={{
                  height: 22,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(168, 85, 247, 0.14)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  cursor: evt.source_metadata?.video_id && typeof onSelectLecture === 'function' ? 'pointer' : 'default'
                }}
              />
            )}
            {evt.course_name && !selectedCourse && (
              <Chip
                size="small"
                label={evt.course_name}
                sx={{
                  height: 22,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(59, 130, 246, 0.12)',
                  color: currentTheme.palette.primary
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, color: currentTheme.palette.textSecondary }}>
            <Clock size={13} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
              {evt.is_all_day ? 'All Day' : `${evt.start_time_formatted} - ${evt.end_time_formatted}`}
            </Typography>
            {evt.source_type && evt.source_type !== 'moodle_ical' && (
              <Tooltip title="Delete event">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteEvent(evt.id);
                  }}
                  sx={{ p: 0.3, color: currentTheme.palette.textSecondary, '&:hover': { color: '#ef4444' } }}
                  aria-label="Delete calendar event"
                >
                  <Trash2 size={13} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            fontSize: '0.95rem',
            color: currentTheme.palette.textPrimary,
            lineHeight: 1.35,
            mb: 0.5
          }}
        >
          {evt.title}
        </Typography>

        {evt.location && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8, mt: 0.8, color: currentTheme.palette.textSecondary }}>
            <MapPin size={13} style={{ flexShrink: 0, marginTop: 3 }} />
            <Typography variant="caption" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
              {renderWithLinks(evt.location, currentTheme.palette.primary)}
            </Typography>
          </Box>
        )}

        {meetingInfo.url && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.2, flexWrap: 'wrap' }}>
            <Button
              component="a"
              href={meetingInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              variant="contained"
              size="small"
              startIcon={<Video size={13} />}
              endIcon={<ExternalLink size={12} />}
              sx={{
                bgcolor: meetingInfo.config.bg,
                color: meetingInfo.config.color,
                fontWeight: 700,
                fontSize: '0.75rem',
                textTransform: 'none',
                borderRadius: 2,
                px: 1.4,
                py: 0.4,
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: meetingInfo.config.hoverBg,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }
              }}
            >
              {meetingInfo.config.label}
            </Button>
            <Tooltip title={copiedId === evt.id ? 'Copied link!' : 'Copy meeting link'}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyLink(evt.id, meetingInfo.url);
                }}
                sx={{
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  bgcolor: currentTheme.palette.surface || 'transparent',
                  color: copiedId === evt.id ? '#16a34a' : currentTheme.palette.textSecondary,
                  p: 0.5,
                  borderRadius: 1.5,
                  '&:hover': {
                    bgcolor: currentTheme.palette.cardBorder
                  }
                }}
                aria-label="Copy meeting link"
              >
                {copiedId === evt.id ? <Check size={13} /> : <Copy size={13} />}
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {evt.description && evt.description.length > 0 && (
          <Box sx={{ mt: 0.8 }}>
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.8rem',
                color: currentTheme.palette.textSecondary,
                whiteSpace: isExpanded ? 'pre-wrap' : 'normal',
                wordBreak: 'break-word',
                ...(!isExpanded && isLongDesc
                  ? {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }
                  : {})
              }}
            >
              {renderWithLinks(evt.description, currentTheme.palette.primary)}
            </Typography>

            {isLongDesc && (
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(evt.id);
                }}
                endIcon={isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                sx={{
                  mt: 0.4,
                  p: 0,
                  minWidth: 'auto',
                  textTransform: 'none',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: currentTheme.palette.primary,
                  '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' }
                }}
              >
                {isExpanded ? 'Show less' : 'Show details / credentials'}
              </Button>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const renderSlotSection = (title, icon, events) => {
    if (!events || events.length === 0) return null;
    return (
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2 }}>
          {icon}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: currentTheme.palette.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {title} ({events.length})
          </Typography>
        </Box>
        {events.map(renderEventItem)}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        mb: 4,
        p: { xs: 2.5, md: 3 },
        borderRadius: 3.5,
        bgcolor: currentTheme.palette.cardBg,
        border: `1px solid ${currentTheme.palette.cardBorder}`,
        boxShadow: currentTheme.palette.cardShadow,
        transition: 'all 0.2s ease'
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              p: 1.2,
              borderRadius: 2.5,
              bgcolor: 'rgba(59, 130, 246, 0.1)',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <CalendarIcon size={22} />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: compact ? '0.95rem' : { xs: '1rem', md: '1.15rem' }, color: currentTheme.palette.textPrimary }}>
                {selectedCourse ? `${selectedCourse} — Upcoming Events & Deadlines` : 'Academic Schedule & Alerts'}
              </Typography>
              <Chip
                label="Moodle Live"
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}
              />
              <Chip
                icon={<Sparkles size={11} />}
                label="AI PDF & Transcript Sync"
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(168, 85, 247, 0.12)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  '& .MuiChip-icon': { color: '#c084fc', ml: '4px' }
                }}
              />
              {selectedCourse && agenda && (
                <Chip
                  label={`${courseUpcomingEvents.length} Upcoming`}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: 'rgba(59, 130, 246, 0.12)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.3)'
                  }}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
              {selectedCourse
                ? 'Course Exams, Quiz Deadlines, Moodle Events & AI Transcript Detections'
                : 'IIIT Dharwad iCal Feed • AI Exam PDF & Transcript Extractor • Automated WhatsApp Alerts (8 AM, 4 PM IST)'}
            </Typography>
          </Box>
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileText size={13} />}
            onClick={() => openExtractorModal('pdf')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.75rem',
              borderRadius: 2,
              color: currentTheme.palette.primary,
              borderColor: currentTheme.palette.cardBorder
            }}
          >
            Exam PDF (AI)
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Mic size={13} />}
            onClick={() => openExtractorModal('transcript')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.75rem',
              borderRadius: 2,
              color: '#c084fc',
              borderColor: 'rgba(168, 85, 247, 0.4)'
            }}
          >
            {videoId ? 'Scan Lecture (AI)' : 'Scan Transcripts (AI)'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={13} />}
            onClick={() => openExtractorModal('manual')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.75rem',
              borderRadius: 2,
              color: currentTheme.palette.textPrimary,
              borderColor: currentTheme.palette.cardBorder
            }}
          >
            Add Event
          </Button>
          {onOpenFullCalendar && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CalendarIcon size={13} />}
              onClick={onOpenFullCalendar}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.75rem',
                borderRadius: 2,
                bgcolor: currentTheme.palette.primary,
                color: '#fff'
              }}
            >
              Full Calendar
            </Button>
          )}
          <Tooltip title="Refresh calendar feed from Moodle">
            <IconButton
              size="small"
              onClick={() => fetchAgenda(true)}
              disabled={loading}
              sx={{
                border: `1px solid ${currentTheme.palette.cardBorder}`,
                color: currentTheme.palette.textSecondary,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
              }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Counts Summary Bar (shown on general hub when no course is selected) */}
      {!selectedCourse && agenda?.counts && (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
          <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600, display: 'block' }}>
              Today's Sessions
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#3b82f6', lineHeight: 1.2 }}>
              {agenda.counts.today}
            </Typography>
          </Box>

          <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600, display: 'block' }}>
              Assignments Due
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#f59e0b', lineHeight: 1.2 }}>
              {agenda.counts.assignments}
            </Typography>
          </Box>

          <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600, display: 'block' }}>
              Quizzes & Tests
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#a855f7', lineHeight: 1.2 }}>
              {agenda.counts.quizzes}
            </Typography>
          </Box>

          <Box sx={{ px: 2, py: 1, borderRadius: 2, bgcolor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600, display: 'block' }}>
              Upcoming Exams
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#ef4444', lineHeight: 1.2 }}>
              {agenda.counts.exams}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Tabs (shown on general hub when no course is selected) */}
      {!selectedCourse && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, borderBottom: `1px solid ${currentTheme.palette.cardBorder}`, pb: 1 }}>
          <Button
            size="small"
            onClick={() => setActiveTab('today')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
              borderRadius: 2,
              px: 2,
              py: 0.6,
              ...(activeTab === 'today'
                ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                : { color: currentTheme.palette.textSecondary, bgcolor: 'transparent' })
            }}
          >
            Today's Timeline ({agenda?.today?.all?.length || 0})
          </Button>
          <Button
            size="small"
            onClick={() => setActiveTab('upcoming')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
              borderRadius: 2,
              px: 2,
              py: 0.6,
              ...(activeTab === 'upcoming'
                ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                : { color: currentTheme.palette.textSecondary, bgcolor: 'transparent' })
            }}
          >
            Next 7 Days ({agenda?.upcoming?.length || 0})
          </Button>
        </Box>
      )}

      {/* Content Area */}
      {loading && !agenda ? (
        <Box sx={{ py: 5, textAlign: 'center' }}>
          <CircularProgress size={28} sx={{ color: currentTheme.palette.primary, mb: 1.5 }} />
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600 }}>
            Syncing Moodle calendar events...
          </Typography>
        </Box>
      ) : error ? (
        <Box sx={{ p: 3, textAlign: 'center', borderRadius: 2.5, bgcolor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <AlertTriangle size={24} color="#ef4444" style={{ margin: '0 auto 8px' }} />
          <Typography variant="body2" sx={{ color: '#ef4444', fontWeight: 600, mb: 1 }}>
            {error}
          </Typography>
          <Button size="small" variant="outlined" color="error" onClick={() => fetchAgenda(true)}>
            Retry Feed Sync
          </Button>
        </Box>
      ) : selectedCourse ? (
        /* Course-Specific Upcoming Events Only */
        <Box>
          {courseUpcomingEvents.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center', borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.02)' }}>
              <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                No upcoming events scheduled for this course
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                No upcoming lectures, assignment deadlines, or exams found for {selectedCourse}.
              </Typography>
            </Box>
          ) : (
            courseUpcomingEvents.map((evt) => (
              <Box key={evt.id} sx={{ mb: 1.5 }}>
                <Typography variant="caption" sx={{ color: currentTheme.palette.primary, fontWeight: 700, mb: 0.5, display: 'block' }}>
                  {evt.date_formatted}
                </Typography>
                {renderEventItem(evt)}
              </Box>
            ))
          )}
        </Box>
      ) : activeTab === 'today' ? (
        <Box>
          {agenda?.today?.all?.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center', borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.02)' }}>
              <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                No events scheduled for today!
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Enjoy your free time or check the upcoming 7 days tab.
              </Typography>
            </Box>
          ) : (
            <>
              {renderSlotSection(
                'Morning Sessions & Classes',
                <Sun size={15} color="#f59e0b" />,
                agenda?.today?.morning
              )}
              {renderSlotSection(
                'Afternoon Labs & Lectures',
                <Coffee size={15} color="#3b82f6" />,
                agenda?.today?.afternoon
              )}
              {renderSlotSection(
                'Evening Deadlines & Submissions',
                <Moon size={15} color="#8b5cf6" />,
                agenda?.today?.evening
              )}
            </>
          )}
        </Box>
      ) : (
        <Box>
          {agenda?.upcoming?.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
                No upcoming events recorded for the next 7 days in Moodle.
              </Typography>
            </Box>
          ) : (
            agenda?.upcoming?.map((evt) => (
              <Box key={evt.id} sx={{ mb: 1.5 }}>
                <Typography variant="caption" sx={{ color: currentTheme.palette.primary, fontWeight: 700, mb: 0.5, display: 'block' }}>
                  {evt.date_formatted}
                </Typography>
                {renderEventItem(evt)}
              </Box>
            ))
          )}
        </Box>
      )}

      <CalendarAIExtractorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialTab={modalTab}
        defaultCourse={selectedCourse || ''}
        videoId={videoId}
        lectureTitle={lectureTitle}
        courses={courses}
        googleUser={googleUser}
        isTutor={isTutor}
        currentTheme={currentTheme}
        onEventsInjected={() => fetchAgenda(false)}
      />
    </Box>
  );
}
