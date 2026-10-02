import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Collapse
} from '@mui/material';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle2,
  FileText,
  BookOpen,
  Award,
  Sun,
  Coffee,
  Moon,
  Info
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

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
  const [testAlertLoading, setTestAlertLoading] = useState(false);
  const [testAlertMessage, setTestAlertMessage] = useState(null);

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

  const handleSendTestAlert = async () => {
    setTestAlertLoading(true);
    setTestAlertMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/calendar/test-alert`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Test alert dispatch failed');
      }

      const dispatchInfo = data.dispatch_result || {};
      if (dispatchInfo.status === 'sent') {
        setTestAlertMessage({
          type: 'success',
          text: `WhatsApp test alert dispatched to ${dispatchInfo.recipient || 'your phone'} via Twilio!`
        });
      } else if (dispatchInfo.status === 'simulated') {
        setTestAlertMessage({
          type: 'info',
          text: 'Twilio credentials not configured yet — alert payload generated and logged in backend console!'
        });
      } else {
        setTestAlertMessage({
          type: 'warning',
          text: `Alert status: ${dispatchInfo.status} (${dispatchInfo.error || 'Check server logs'})`
        });
      }
    } catch (err) {
      setTestAlertMessage({
        type: 'error',
        text: err.message || 'Failed to dispatch test alert'
      });
    } finally {
      setTestAlertLoading(false);
    }
  };

  const renderEventItem = (evt) => {
    const style = CATEGORY_STYLES[evt.category] || CATEGORY_STYLES.general;
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.8, color: currentTheme.palette.textSecondary }}>
            <MapPin size={13} />
            <Typography variant="caption" sx={{ fontWeight: 500 }}>
              {evt.location}
            </Typography>
          </Box>
        )}

        {evt.description && evt.description.length > 0 && (
          <Typography
            variant="body2"
            sx={{
              mt: 0.8,
              fontSize: '0.8rem',
              color: currentTheme.palette.textSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical'
            }}
          >
            {evt.description}
          </Typography>
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
            </Box>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
              IIIT Dharwad iCal Feed • Automated WhatsApp Alerts (11 AM, 3 PM, 6 PM IST)
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

          <Button
            variant="contained"
            size="small"
            startIcon={testAlertLoading ? <CircularProgress size={14} color="inherit" /> : <Send size={14} />}
            disabled={testAlertLoading}
            onClick={handleSendTestAlert}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: 2.2,
              px: 2,
              py: 0.7,
              bgcolor: '#25D366', // WhatsApp Brand Green
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(37, 211, 102, 0.25)',
              '&:hover': { bgcolor: '#1eb855' }
            }}
          >
            {testAlertLoading ? 'Dispatching...' : 'Test WhatsApp Alert'}
          </Button>
        </Box>
      </Box>

      {/* Test Alert Notification Toast */}
      <Collapse in={!!testAlertMessage}>
        {testAlertMessage && (
          <Box
            sx={{
              p: 1.5,
              mb: 2.5,
              borderRadius: 2.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              fontSize: '0.85rem',
              fontWeight: 600,
              ...(testAlertMessage.type === 'success' && {
                bgcolor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10b981'
              }),
              ...(testAlertMessage.type === 'info' && {
                bgcolor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#3b82f6'
              }),
              ...(testAlertMessage.type === 'error' && {
                bgcolor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444'
              })
            }}
          >
            {testAlertMessage.type === 'success' && <CheckCircle2 size={16} />}
            {testAlertMessage.type === 'info' && <Info size={16} />}
            {testAlertMessage.type === 'error' && <AlertTriangle size={16} />}
            <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
              {testAlertMessage.text}
            </Typography>
            <IconButton size="small" onClick={() => setTestAlertMessage(null)} sx={{ color: 'inherit', p: 0.5 }}>
              ×
            </IconButton>
          </Box>
        )}
      </Collapse>

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
