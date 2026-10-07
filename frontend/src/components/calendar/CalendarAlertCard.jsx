import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronUp
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

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
  general: {
    label: 'Schedule',
    icon: <CalendarIcon size={13} />,
    bg: '#f1f5f9',
    color: '#334155',
    border: '#cbd5e1'
  }
};

export default function CalendarAlertCard({ currentTheme }) {
  const [agenda, setAgenda] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('today'); // 'today' | 'upcoming'
  const [copiedId, setCopiedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

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
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events?refresh=${refresh}&days=7`);
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
  }, []);

  useEffect(() => {
    fetchAgenda(false);
  }, [fetchAgenda]);

  const renderEventItem = (evt) => {
    const style = CATEGORY_STYLES[evt.category] || CATEGORY_STYLES.general;
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
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, color: currentTheme.palette.textSecondary }}>
            <Clock size={13} />
            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
              {evt.is_all_day ? 'All Day' : `${evt.start_time_formatted} - ${evt.end_time_formatted}`}
            </Typography>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: { xs: '1rem', md: '1.15rem' }, color: currentTheme.palette.textPrimary }}>
                Academic Schedule & Alerts
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
            </Box>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
              IIIT Dharwad iCal Feed • Automated WhatsApp Alerts (8 AM, 4 PM IST)
            </Typography>
          </Box>
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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

      {/* Counts Summary Bar */}
      {agenda?.counts && (
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

      {/* Tabs */}
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
    </Box>
  );
}
