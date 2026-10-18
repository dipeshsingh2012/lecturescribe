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
  Calendar,
  Clock,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  X,
  ExternalLink,
  BookOpen,
  AlertCircle
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

export default function QuizRemindersCard({
  currentTheme,
  onSelectLecture,
  selectedCourse
}) {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dismissingId, setDismissingId] = useState(null);

  const fetchUpcomingQuizzes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/reminders/upcoming-quizzes?status=active`);
    if (!res.ok) {
      throw new Error(`Failed to load quiz reminders (${res.status})`);
    }
    const data = await res.json();
    setQuizzes(data.quizzes || []);
  } catch (err) {
    console.error('Error fetching quiz reminders:', err);
    setError(err.message);
  } finally {
    setLoading(false);
  }
  }, []);

  useEffect(() => {
    fetchUpcomingQuizzes();
  }, [fetchUpcomingQuizzes]);

  const handleDismiss = async (quizId) => {
    try {
      setDismissingId(quizId);
      // Optimistic removal
      setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
      await fetch(`${API_BASE}/api/reminders/quiz/${quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' })
      });
    } catch (err) {
      console.error('Failed to dismiss quiz reminder:', err);
    } finally {
      setDismissingId(null);
    }
  };

  const handleCalendarExport = (quiz) => {
    const title = encodeURIComponent(`[Quiz] ${quiz.quiz_title || quiz.quizTitle} (${quiz.course_name || quiz.courseName})`);
    const details = encodeURIComponent(
      `Predicted Quiz Announcement:\n"${quiz.cue_text || quiz.cueText}"\n\nIdentified by LectureScribe AI at timestamp ${quiz.cue_time || quiz.cueTime}.`
    );
    const dateParam = quiz.predicted_date_iso || quiz.predictedDateIso;
    let datesString = '';
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const cleanDate = dateParam.replace(/-/g, '');
      datesString = `&dates=${cleanDate}T090000Z/${cleanDate}T100000Z`;
    }
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}${datesString}`;
    window.open(gcalUrl, '_blank', 'noopener,noreferrer');
  };

  // Filter by selectedCourse if provided
  const displayedQuizzes = quizzes.filter((q) => {
    if (!selectedCourse) return true;
    const courseSlug = q.course_slug || q.courseSlug || '';
    const courseName = q.course_name || q.courseName || '';
    return (
      courseSlug.toLowerCase().includes(selectedCourse.toLowerCase()) ||
      courseName.toLowerCase().includes(selectedCourse.toLowerCase())
    );
  });

  if (loading && quizzes.length === 0) {
    return null; // Silent initial load so page doesn't jump
  }

  if (!loading && displayedQuizzes.length === 0) {
    return null; // Do not occupy screen space if there are no upcoming predicted quizzes
  }

  const p = currentTheme?.palette || {
    cardBg: '#1e293b',
    cardBorder: 'rgba(255, 255, 255, 0.1)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    primary: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.15)',
    badgeColor: '#38bdf8',
    badgeBorder: 'rgba(56, 189, 248, 0.3)'
  };

  return (
    <Box
      data-testid="quiz-reminders-card"
      sx={{
        mb: 3,
        p: 2.5,
        borderRadius: 2.5,
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.05) 100%)',
        border: '1px solid rgba(129, 140, 248, 0.25)',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.25)',
        position: 'relative'
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 2,
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)'
            }}
          >
            <Sparkles size={18} />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: p.textPrimary, lineHeight: 1.2 }}>
              Upcoming Predicted Quizzes & Assessments
            </Typography>
            <Typography variant="caption" sx={{ color: p.textSecondary, display: 'block', mt: 0.2 }}>
              Automatically predicted from instructor announcements in lecture transcripts
            </Typography>
          </Box>
          <Chip
            label={`${displayedQuizzes.length} upcoming`}
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: '0.75rem',
              bgcolor: 'rgba(99, 102, 241, 0.15)',
              color: '#818cf8',
              border: '1px solid rgba(99, 102, 241, 0.3)'
            }}
          />
        </Box>

        <Tooltip title="Refresh reminders">
          <IconButton
            size="small"
            onClick={fetchUpcomingQuizzes}
            disabled={loading}
            sx={{ color: p.textSecondary, '&:hover': { color: p.primary } }}
          >
            <RefreshCw size={15} className={loading ? 'loading-pulse' : ''} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Quizzes List */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {displayedQuizzes.map((quiz) => {
          const qId = quiz.id;
          const qVideoId = quiz.video_id || quiz.videoId || '';
          const qTitle = quiz.quiz_title || quiz.quizTitle || 'Upcoming Quiz';
          const qDate = quiz.predicted_date || quiz.predictedDate || 'Date TBD';
          const rawSlug = quiz.course_slug || quiz.courseSlug || '';
          const slugLabel = rawSlug
            ? rawSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
            : '';
          const qCourse = quiz.course_name || quiz.courseName || slugLabel || 'Course';
          const qLectureTitle = quiz.lecture_title || quiz.lectureTitle || '';
          const qTime = quiz.cue_time || quiz.cueTime || '';
          const qText = quiz.cue_text || quiz.cueText || '';
          const qConfidence = Math.round((quiz.confidence || 0.8) * 100);

          return (
            <Box
              key={qId}
              data-testid={`predicted-quiz-item-${qId}`}
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: p.cardBg || 'rgba(15, 23, 42, 0.6)',
                border: `1px solid ${p.cardBorder || 'rgba(255, 255, 255, 0.08)'}`,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'flex-start', sm: 'center' },
                justifyContent: 'space-between',
                gap: 2,
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: 'rgba(129, 140, 248, 0.4)',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.1)'
                }
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                  <Typography variant="body1" sx={{ fontWeight: 700, color: p.textPrimary }}>
                    {qTitle}
                  </Typography>
                  <Chip
                    label={qCourse}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      bgcolor: p.badgeBg || 'rgba(56, 189, 248, 0.15)',
                      color: p.badgeColor || p.primary,
                      border: `1px solid ${p.badgeBorder || 'rgba(56, 189, 248, 0.3)'}`
                    }}
                  />
                  {qLectureTitle && qLectureTitle !== qCourse && (
                    <Typography variant="caption" sx={{ color: p.textSecondary, fontWeight: 500 }}>
                      • {qLectureTitle}
                    </Typography>
                  )}
                  <Chip
                    label={`${qConfidence}% confidence`}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      bgcolor: 'rgba(16, 185, 129, 0.12)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.25)'
                    }}
                  />
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 0.8 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#f59e0b' }}>
                    <Calendar size={14} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#fbbf24' }}>
                      {qDate}
                    </Typography>
                  </Box>
                  {qTime && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: p.textSecondary }}>
                      <Clock size={13} />
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Spoken at {qTime}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {qText && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontStyle: 'italic',
                      color: p.textSecondary,
                      bgcolor: 'rgba(0, 0, 0, 0.15)',
                      p: '4px 8px',
                      borderRadius: 1,
                      borderLeft: '2px solid rgba(129, 140, 248, 0.6)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '650px'
                    }}
                  >
                    "{qText}"
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, alignSelf: { xs: 'flex-end', sm: 'center' } }}>
                <Tooltip title="Add event to Google Calendar">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Calendar size={13} />}
                    onClick={() => handleCalendarExport(quiz)}
                    sx={{
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      py: 0.5,
                      px: 1.2,
                      borderRadius: 1.5,
                      color: '#fbbf24',
                      borderColor: 'rgba(251, 191, 36, 0.3)',
                      '&:hover': {
                        bgcolor: 'rgba(251, 191, 36, 0.1)',
                        borderColor: '#fbbf24'
                      }
                    }}
                  >
                    Add to Cal
                  </Button>
                </Tooltip>

                {onSelectLecture && qVideoId && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<BookOpen size={13} />}
                    onClick={() => onSelectLecture(qVideoId, qTime, quiz.course_name || quiz.courseName || rawSlug)}
                    sx={{
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      py: 0.5,
                      px: 1.2,
                      borderRadius: 1.5,
                      color: p.primary,
                      borderColor: p.cardBorder,
                      '&:hover': {
                        bgcolor: 'rgba(56, 189, 248, 0.1)',
                        borderColor: p.primary
                      }
                    }}
                  >
                    Jump to Cue
                  </Button>
                )}

                <Tooltip title="Dismiss this reminder">
                  <IconButton
                    size="small"
                    onClick={() => handleDismiss(qId)}
                    disabled={dismissingId === qId}
                    sx={{
                      color: p.textSecondary,
                      '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' }
                    }}
                  >
                    <X size={15} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
