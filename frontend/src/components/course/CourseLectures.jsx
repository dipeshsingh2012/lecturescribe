import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Divider,
  Paper,
  CircularProgress,
  FormControl,
  Select,
  MenuItem
} from '@mui/material';
import {
  Video,
  ExternalLink,
  Trash2,
  BookOpen,
  ArrowLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  Calendar as CalendarIcon,
  Clock,
  Sparkles
} from 'lucide-react';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import { API_BASE } from '../../utils/constants';
import { filterCourseUpcomingEvents, getEventBadgeDate } from '../calendar/CalendarAlertCard';
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  filterAndSortLectures,
  isLectureCompleted,
  isLectureInProgress,
  getLectureProgress
} from '../../utils/lectureSort';

export default function CourseLectures({
  courseLoading,
  filteredCourseLectures = [],
  handleTranscribe,
  handleDeleteFromLibrary,
  handleClearCourse,
  selectedCourse,
  librarySearch = '',
  currentTheme,
  sortBy: externalSortBy,
  onSortChange: externalOnSortChange,
  statusFilter: externalStatusFilter,
  onStatusFilterChange: externalOnStatusFilterChange,
  onOpenFullCalendar,
  googleUser
}) {
  const [internalSortBy, setInternalSortBy] = React.useState('title_desc');
  const [internalStatusFilter, setInternalStatusFilter] = React.useState('all');
  const [pulseData, setPulseData] = React.useState({ nextEvent: null, nextQuiz: null, loading: false });

  React.useEffect(() => {
    if (!selectedCourse) return;
    let isMounted = true;
    setPulseData((prev) => ({ ...prev, loading: true }));

    const loadPulseData = async () => {
      try {
        const [calRes, quizRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/calendar/events?days=90&course=${encodeURIComponent(selectedCourse)}`),
          fetch(`${API_BASE}/api/reminders/upcoming-quizzes?status=active`)
        ]);

        let matchedEvent = null;
        let matchedQuiz = null;

        if (calRes.status === 'fulfilled' && calRes.value.ok) {
          const calJson = await calRes.value.json();
          const upcoming = filterCourseUpcomingEvents(calJson, selectedCourse);
          matchedEvent = upcoming.length > 0 ? upcoming[0] : null;
        }

        if (quizRes.status === 'fulfilled' && quizRes.value.ok) {
          const quizJson = await quizRes.value.json();
          const quizzes = quizJson?.quizzes || [];
          matchedQuiz = quizzes.find((q) => {
            const slug = q.course_slug || q.courseSlug || '';
            const name = q.course_name || q.courseName || '';
            return slug.toLowerCase().includes(selectedCourse.toLowerCase()) ||
                   name.toLowerCase().includes(selectedCourse.toLowerCase());
          }) || null;
        }

        if (isMounted) {
          setPulseData({ nextEvent: matchedEvent, nextQuiz: matchedQuiz, loading: false });
        }
      } catch (err) {
        if (isMounted) {
          setPulseData((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    loadPulseData();
    return () => { isMounted = false; };
  }, [selectedCourse]);

  const sortBy = externalSortBy !== undefined ? externalSortBy : internalSortBy;
  const setSortBy = externalOnSortChange || setInternalSortBy;

  const statusFilter = externalStatusFilter !== undefined ? externalStatusFilter : internalStatusFilter;
  const setStatusFilter = externalOnStatusFilterChange || setInternalStatusFilter;

  // Compute status counts for the current lecture list
  const statusCounts = React.useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    let unwatched = 0;
    for (const item of filteredCourseLectures) {
      if (isLectureCompleted(item)) {
        completed++;
      } else if (isLectureInProgress(item)) {
        inProgress++;
      } else {
        unwatched++;
      }
    }
    return {
      all: filteredCourseLectures.length,
      in_progress: inProgress,
      completed,
      unwatched
    };
  }, [filteredCourseLectures]);

  // Overall course progress
  const totalLectures = filteredCourseLectures.length;
  const completedLectures = statusCounts.completed;
  const inProgressLectures = statusCounts.in_progress;
  const courseOverallProgress = React.useMemo(() => {
    if (!totalLectures) return 0;
    const sumPct = filteredCourseLectures.reduce((acc, item) => acc + getLectureProgress(item), 0);
    return Math.min(100, Math.max(0, Math.round(sumPct / totalLectures)));
  }, [filteredCourseLectures, totalLectures]);

  // Displayed lectures with sorting and filtering applied
  const displayedLectures = React.useMemo(() => {
    return filterAndSortLectures(filteredCourseLectures, {
      status: statusFilter,
      sortBy: sortBy
    });
  }, [filteredCourseLectures, statusFilter, sortBy]);

  const isAscending = sortBy.endsWith('_asc');

  const toggleSortDirection = () => {
    if (sortBy === 'title_desc' || sortBy === 'title') setSortBy('title_asc');
    else if (sortBy === 'title_asc') setSortBy('title_desc');
    else if (sortBy === 'date_desc') setSortBy('date_asc');
    else if (sortBy === 'date_asc') setSortBy('date_desc');
    else if (sortBy === 'progress_desc') setSortBy('progress_asc');
    else if (sortBy === 'progress_asc') setSortBy('progress_desc');
    else if (sortBy === 'duration_desc') setSortBy('duration_asc');
    else if (sortBy === 'duration_asc') setSortBy('duration_desc');
    else setSortBy('title_desc');
  };

  const handleQuickSort = (baseField) => {
    if (baseField === 'title') {
      if (sortBy === 'title_desc' || sortBy === 'title') setSortBy('title_asc');
      else setSortBy('title_desc');
    } else if (baseField === 'date') {
      if (sortBy === 'date_desc') setSortBy('date_asc');
      else setSortBy('date_desc');
    } else if (baseField === 'progress') {
      if (sortBy === 'progress_desc') setSortBy('progress_asc');
      else setSortBy('progress_desc');
    } else if (baseField === 'duration') {
      if (sortBy === 'duration_desc') setSortBy('duration_asc');
      else setSortBy('duration_desc');
    }
  };

  if (courseLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={36} sx={{ color: currentTheme.palette.primary, mb: 2 }} />
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
          Loading course lectures...
        </Typography>
      </Box>
    );
  }

  if (filteredCourseLectures.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 6,
          textAlign: 'center',
          bgcolor: currentTheme.palette.cardBg,
          border: `1px dashed ${currentTheme.palette.cardBorder}`,
          borderRadius: 3,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <BookOpen size={48} color={currentTheme.palette.primary} style={{ margin: '0 auto 16px', opacity: 0.85 }} />
        <Typography variant="h6" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 1 }}>
          No matching lectures in this course
        </Typography>
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 460, mx: 'auto', mb: 2 }}>
          {librarySearch ? `No lectures matched "${librarySearch}".` : 'No lectures in this course yet.'}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ArrowLeft size={16} />}
          onClick={handleClearCourse}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Back to All Courses
        </Button>
      </Paper>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* UNIFIED COURSE OVERVIEW: PROGRESS, KEY DATES, PREDICTED QUIZZES */}
      <Box
        sx={{
          mb: 2.5,
          p: 2,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr 1.05fr' },
          gap: { xs: 2, md: 2.5 },
          alignItems: 'stretch'
        }}
      >
        {/* Section 1: Course Progress */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pr: { md: 2 }, borderRight: { md: `1px solid var(--border-color)` } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: '8px',
                  bgcolor: courseOverallProgress === 100 ? 'rgba(16, 185, 129, 0.12)' : 'var(--highlight-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${courseOverallProgress === 100 ? 'rgba(16, 185, 129, 0.25)' : 'var(--badge-border)'}`
                }}
              >
                <CheckCircle2 size={16} color={courseOverallProgress === 100 ? '#10b981' : currentTheme.palette.primary} />
              </Box>
              <Typography component="div" sx={{ fontWeight: 800, fontSize: '0.88rem', color: currentTheme.palette.textPrimary, lineHeight: 1.2 }}>
                Course Progress
              </Typography>
            </Box>
            <Typography component="div" sx={{ fontWeight: 800, fontSize: '0.98rem', color: courseOverallProgress === 100 ? '#10b981' : currentTheme.palette.primary }}>
              {courseOverallProgress}%
            </Typography>
          </Box>

          <Box sx={{ width: '100%', height: 6, borderRadius: 3, bgcolor: 'var(--border-color)', overflow: 'hidden', mb: 0.8 }}>
            <Box
              sx={{
                width: `${courseOverallProgress}%`,
                height: '100%',
                bgcolor: courseOverallProgress === 100 ? '#10b981' : currentTheme.palette.primary,
                transition: 'width 0.4s ease'
              }}
            />
          </Box>

          <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.74rem' }}>
            {completedLectures} of {totalLectures} {totalLectures === 1 ? 'lecture' : 'lectures'} completed
            {inProgressLectures > 0 ? ` • ${inProgressLectures} in progress` : ''}
          </Typography>
        </Box>

        {/* Section 2: Key Dates & Next Deadline */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pr: { md: 2 }, borderRight: { md: `1px solid var(--border-color)` } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: '8px',
                  bgcolor: 'rgba(59, 130, 246, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(59, 130, 246, 0.25)'
                }}
              >
                <CalendarIcon size={16} color="#3b82f6" />
              </Box>
              <Typography component="div" sx={{ fontWeight: 800, fontSize: '0.88rem', color: currentTheme.palette.textPrimary, lineHeight: 1.2 }}>
                Key Dates
              </Typography>
            </Box>
            {onOpenFullCalendar && (
              <Button
                size="small"
                onClick={onOpenFullCalendar}
                sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 700, p: 0, minWidth: 'auto', color: currentTheme.palette.primary }}
              >
                Calendar →
              </Button>
            )}
          </Box>

          {pulseData.nextEvent ? (() => {
            const badge = getEventBadgeDate(pulseData.nextEvent);
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, bgcolor: 'var(--highlight-bg)', px: 1.2, py: 0.8, borderRadius: 1.5, border: '1px solid var(--badge-border)' }}>
                {/* Date Badge: Top day number, bottom red uppercase month */}
                <Box
                  sx={{
                    width: 38,
                    minWidth: 38,
                    height: 38,
                    borderRadius: '8px',
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
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      lineHeight: 1,
                      color: currentTheme?.palette?.textPrimary || '#0f172a'
                    }}
                  >
                    {badge.day}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.55rem',
                      fontWeight: 800,
                      lineHeight: 1,
                      mt: '2px',
                      color: '#ef4444',
                      letterSpacing: '0.3px'
                    }}
                  >
                    {badge.month}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.78rem', color: currentTheme?.palette?.textPrimary, noWrap: true, textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {pulseData.nextEvent.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary, fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.2 }}>
                    <Clock size={11} />
                    {badge.time || pulseData.nextEvent.date_formatted || pulseData.nextEvent.start_time_formatted || 'Upcoming event'}
                  </Typography>
                </Box>
              </Box>
            );
          })() : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, color: currentTheme?.palette?.textSecondary, py: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.75rem', fontStyle: 'italic' }}>
                No upcoming key dates for this course.
              </Typography>
            </Box>
          )}
        </Box>

        {/* Section 3: Predicted Quiz Announcement */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: '8px',
                  bgcolor: 'rgba(234, 88, 12, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(234, 88, 12, 0.25)'
                }}
              >
                <Sparkles size={16} color="#ea580c" />
              </Box>
              <Typography component="div" sx={{ fontWeight: 800, fontSize: '0.88rem', color: currentTheme.palette.textPrimary, lineHeight: 1.2 }}>
                Predicted Quiz
              </Typography>
            </Box>
            {pulseData.nextQuiz && (
              <Chip
                label={`${Math.round((pulseData.nextQuiz.confidence || 0.8) * 100)}% match`}
                size="small"
                sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'rgba(234, 88, 12, 0.1)', color: '#ea580c' }}
              />
            )}
          </Box>

          {pulseData.nextQuiz ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, bgcolor: 'var(--highlight-bg)', px: 1.2, py: 0.8, borderRadius: 1.5, border: '1px solid var(--badge-border)' }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.78rem', color: currentTheme.palette.textPrimary, noWrap: true, textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {pulseData.nextQuiz.quiz_title || pulseData.nextQuiz.quizTitle || 'Upcoming Quiz'}
                </Typography>
                <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.7rem' }}>
                  {pulseData.nextQuiz.predicted_date || (pulseData.nextQuiz.cue_time ? `Cue at ${pulseData.nextQuiz.cue_time}` : 'Predicted from lecture')}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const vid = pulseData.nextQuiz.video_id || pulseData.nextQuiz.videoId;
                  const ts = pulseData.nextQuiz.cue_time || pulseData.nextQuiz.cueTime;
                  if (typeof handleTranscribe === 'function' && vid) {
                    handleTranscribe(vid, true, selectedCourse, false, ts);
                  }
                }}
                sx={{
                  textTransform: 'none',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  py: 0.2,
                  px: 0.9,
                  height: 24,
                  minWidth: 'auto',
                  borderRadius: 1.5,
                  color: '#ea580c',
                  borderColor: 'rgba(234, 88, 12, 0.4)',
                  whiteSpace: 'nowrap',
                  '&:hover': { borderColor: '#ea580c', bgcolor: 'rgba(234, 88, 12, 0.08)' }
                }}
              >
                Jump to Cue
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, color: currentTheme.palette.textSecondary, py: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: '0.75rem', fontStyle: 'italic' }}>
                No upcoming quiz predictions
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* COMPACT FILTER & SORT TOOLBAR */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 3,
          p: 1.25,
          px: 2,
          borderRadius: 2.5,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        {/* Status Filters */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              color: currentTheme.palette.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '0.7rem',
              mr: 0.4
            }}
          >
            Filter:
          </Typography>
          {STATUS_FILTERS.map((f) => {
            const count = statusCounts[f.value];
            const isSelected = statusFilter === f.value;
            return (
              <Chip
                key={f.value}
                label={`${f.label} (${count})`}
                size="small"
                clickable
                onClick={() => setStatusFilter(f.value)}
                aria-label={`Filter by ${f.label}`}
                sx={{
                  fontWeight: 700,
                  fontSize: '0.73rem',
                  height: 26,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  ...(isSelected
                    ? {
                        bgcolor: currentTheme.palette.primary,
                        color: '#ffffff',
                        border: `1px solid ${currentTheme.palette.primary}`,
                        '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                      }
                    : {
                        bgcolor: 'transparent',
                        color: currentTheme.palette.textSecondary,
                        border: `1px solid ${currentTheme.palette.cardBorder}`,
                        '&:hover': {
                          bgcolor: 'var(--highlight-bg)',
                          borderColor: currentTheme.palette.primary,
                          color: currentTheme.palette.primary
                        }
                      })
                }}
              />
            );
          })}
        </Box>

        {/* Sort Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
          {/* Quick Sort Filter Chips */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Chip
              label={`Title ${sortBy.startsWith('title') ? (isAscending ? 'A→Z' : 'Z→A') : ''}`.trim()}
              size="small"
              clickable
              onClick={() => handleQuickSort('title')}
              aria-label="Sort by Title"
              sx={{
                fontWeight: 700,
                fontSize: '0.72rem',
                height: 26,
                cursor: 'pointer',
                ...(sortBy.startsWith('title')
                  ? {
                      bgcolor: 'var(--highlight-bg)',
                      color: currentTheme.palette.primary,
                      border: `1px solid ${currentTheme.palette.primary}`
                    }
                  : {
                      bgcolor: 'transparent',
                      color: currentTheme.palette.textSecondary,
                      border: `1px solid ${currentTheme.palette.cardBorder}`,
                      '&:hover': { borderColor: currentTheme.palette.primary }
                    })
              }}
            />
            <Chip
              label={`Date ${sortBy.startsWith('date') ? (sortBy === 'date_desc' ? 'Newest' : 'Oldest') : ''}`.trim()}
              size="small"
              clickable
              onClick={() => handleQuickSort('date')}
              aria-label="Sort by Date"
              sx={{
                fontWeight: 700,
                fontSize: '0.72rem',
                height: 26,
                cursor: 'pointer',
                ...(sortBy.startsWith('date')
                  ? {
                      bgcolor: 'var(--highlight-bg)',
                      color: currentTheme.palette.primary,
                      border: `1px solid ${currentTheme.palette.primary}`
                    }
                  : {
                      bgcolor: 'transparent',
                      color: currentTheme.palette.textSecondary,
                      border: `1px solid ${currentTheme.palette.cardBorder}`,
                      '&:hover': { borderColor: currentTheme.palette.primary }
                    })
              }}
            />
            <Chip
              label="Progress"
              size="small"
              clickable
              onClick={() => handleQuickSort('progress')}
              aria-label="Sort by Progress"
              sx={{
                fontWeight: 700,
                fontSize: '0.72rem',
                height: 26,
                cursor: 'pointer',
                ...(sortBy.startsWith('progress')
                  ? {
                      bgcolor: 'var(--highlight-bg)',
                      color: currentTheme.palette.primary,
                      border: `1px solid ${currentTheme.palette.primary}`
                    }
                  : {
                      bgcolor: 'transparent',
                      color: currentTheme.palette.textSecondary,
                      border: `1px solid ${currentTheme.palette.cardBorder}`,
                      '&:hover': { borderColor: currentTheme.palette.primary }
                    })
              }}
            />
          </Box>

          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' }, mx: 0.3, borderColor: currentTheme.palette.cardBorder }} />

          {/* Sort Dropdown */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: currentTheme.palette.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: '0.7rem',
                display: { xs: 'none', lg: 'inline' }
              }}
            >
              Sort by:
            </Typography>
            <FormControl size="small">
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                displayEmpty
                inputProps={{ 'aria-label': 'Sort lectures', 'data-testid': 'lecture-sort-select' }}
                sx={{
                  height: 26,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: currentTheme.palette.textPrimary,
                  bgcolor: currentTheme.palette.cardBg,
                  borderRadius: 1.5,
                  minWidth: 140,
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: currentTheme.palette.cardBorder
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: currentTheme.palette.primary
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: currentTheme.palette.primary
                  }
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.78rem', fontWeight: 500 }}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Tooltip title={isAscending ? 'Ascending (Click for Descending)' : 'Descending (Click for Ascending)'}>
              <IconButton
                size="small"
                onClick={toggleSortDirection}
                aria-label="Toggle sort direction"
                sx={{
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  borderRadius: 1.5,
                  p: '3px',
                  color: currentTheme.palette.primary,
                  bgcolor: 'var(--highlight-bg)',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    borderColor: currentTheme.palette.primary,
                    transform: 'scale(1.05)'
                  }
                }}
              >
                {isAscending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* EMPTY FILTERED STATE (when lectures exist but none match selected status filter) */}
      {displayedLectures.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 5,
            textAlign: 'center',
            bgcolor: currentTheme.palette.cardBg,
            border: `1px dashed ${currentTheme.palette.cardBorder}`,
            borderRadius: 3,
            boxShadow: currentTheme.palette.cardShadow
          }}
        >
          <RotateCcw size={36} color={currentTheme.palette.primary} style={{ margin: '0 auto 12px', opacity: 0.85 }} />
          <Typography variant="subtitle1" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 1 }}>
            No lectures found for filter &ldquo;{STATUS_FILTERS.find(f => f.value === statusFilter)?.label || statusFilter}&rdquo;
          </Typography>
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 440, mx: 'auto', mb: 2 }}>
            Try selecting a different filter or show all lectures in this course.
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={() => setStatusFilter('all')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: currentTheme.palette.primary,
              '&:hover': { bgcolor: currentTheme.palette.primaryHover }
            }}
          >
            Show All Lectures
          </Button>
        </Paper>
      ) : (
        /* LECTURES GRID */
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(3, minmax(0, 1fr))'
            },
            gap: 3,
            width: '100%',
            alignItems: 'stretch'
          }}
        >
          {displayedLectures.map((item) => {
            const driveUrl = item.drive_folder_url || item.driveFolderUrl;
            const prog = item.progress;
            const progressPct = Math.min(100, Math.max(0, Math.round(getLectureProgress(item))));
            const isCompleted = isLectureCompleted(item);
            const hasProgress = isLectureInProgress(item) || isCompleted;
            const resumeTimestamp = prog?.last_timestamp || '00:00';

            return (
              <Card
                key={item.video_id}
                role="button"
                tabIndex={0}
                aria-label={`Study ${item.video_title || item.title || `Lecture ${item.video_id}`}`}
                onClick={() => handleTranscribe(item.video_url || item.video_id, true, selectedCourse || item.course_name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTranscribe(item.video_url || item.video_id, true, selectedCourse || item.course_name);
                  }
                }}
                sx={{
                  width: '100%',
                  height: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  bgcolor: currentTheme.palette.cardBg,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  borderRadius: 3,
                  boxShadow: currentTheme.palette.cardShadow,
                  transition: 'all 0.2s ease-in-out',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    borderColor: currentTheme.palette.primary,
                    boxShadow: currentTheme.palette.cardHoverShadow
                  }
                }}
              >
                <CardContent sx={{ flex: 1, p: 2.5, display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                    <Box sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '8px',
                      bgcolor: 'var(--highlight-bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--badge-border)'
                    }}>
                      <Video size={16} color={currentTheme.palette.primary} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {driveUrl && (
                        <Tooltip title="Open in Google Drive">
                          <IconButton
                            size="small"
                            component="a"
                            href={driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open in Google Drive"
                            onClick={(e) => e.stopPropagation()}
                            sx={{
                              width: 28,
                              height: 28,
                              borderRadius: '6px',
                              bgcolor: 'var(--highlight-bg)',
                              border: '1px solid var(--badge-border)',
                              color: currentTheme.palette.primary,
                              '&:hover': {
                                transform: 'scale(1.1)',
                                borderColor: currentTheme.palette.primary
                              }
                            }}
                          >
                            <GoogleDriveIcon size={14} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {typeof handleDeleteFromLibrary === 'function' && (
                        <Tooltip title="Remove from Course Library">
                          <IconButton
                            size="small"
                            aria-label="Remove from Course Library"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFromLibrary(item.video_id);
                            }}
                            sx={{
                              width: 28,
                              height: 28,
                              borderRadius: '6px',
                              color: '#64748b',
                              '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' }
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>

                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      color: currentTheme.palette.textPrimary,
                      lineHeight: 1.4,
                      mt: 0.5,
                      fontSize: '1rem',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {item.video_title || item.title || `Lecture ${item.video_id}`}
                  </Typography>

                  <Box sx={{ mt: 'auto', pt: 1.5, borderTop: '1px dashed var(--border-color)' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: isCompleted ? '#10b981' : 'var(--text-secondary)',
                          fontSize: '0.72rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          fontWeight: isCompleted || hasProgress ? 600 : 500,
                          opacity: hasProgress ? 1 : 0.75
                        }}
                      >
                        ⏱️ {isCompleted ? 'Completed' : (hasProgress ? `Resume at ${resumeTimestamp}` : 'Not started')}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: isCompleted ? '#10b981' : (hasProgress ? currentTheme.palette.primary : 'var(--text-secondary)'),
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          opacity: hasProgress ? 1 : 0.75
                        }}
                      >
                        {progressPct}%
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        width: '100%',
                        height: 4,
                        borderRadius: 2,
                        bgcolor: 'var(--border-color)',
                        overflow: 'hidden'
                      }}
                    >
                      <Box
                        sx={{
                          width: `${progressPct}%`,
                          height: '100%',
                          bgcolor: isCompleted ? '#10b981' : currentTheme.palette.primary,
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
