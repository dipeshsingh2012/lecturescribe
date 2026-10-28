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
  Clock,
  ExternalLink,
  Trash2,
  BookOpen,
  ArrowLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  RotateCcw
} from 'lucide-react';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import { formatRelativeTime } from '../../utils/formatters';
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
  onStatusFilterChange: externalOnStatusFilterChange
}) {
  const [internalSortBy, setInternalSortBy] = React.useState('title_desc');
  const [internalStatusFilter, setInternalStatusFilter] = React.useState('all');

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
      {/* FILTER & SORT TOOLBAR */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          alignItems: { xs: 'stretch', lg: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          mb: 3,
          p: 2,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        {/* Status Filters */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              color: currentTheme.palette.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontSize: '0.72rem',
              mr: 0.5
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
                  fontSize: '0.75rem',
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}>
          {/* Quick Sort Filter Chips */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
            <Chip
              label={`Title ${sortBy.startsWith('title') ? (isAscending ? 'A→Z' : 'Z→A') : ''}`.trim()}
              size="small"
              clickable
              onClick={() => handleQuickSort('title')}
              aria-label="Sort by Title"
              sx={{
                fontWeight: 700,
                fontSize: '0.74rem',
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
                fontSize: '0.74rem',
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
                fontSize: '0.74rem',
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

          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' }, mx: 0.5, borderColor: currentTheme.palette.cardBorder }} />

          {/* Full Sort Dropdown */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: currentTheme.palette.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontSize: '0.72rem',
                display: { xs: 'none', sm: 'inline' }
              }}
            >
              Sort by:
            </Typography>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                displayEmpty
                inputProps={{ 'aria-label': 'Sort lectures', 'data-testid': 'lecture-sort-select' }}
                sx={{
                  height: 32,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: currentTheme.palette.textPrimary,
                  bgcolor: currentTheme.palette.cardBg,
                  borderRadius: 2,
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
                  <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.82rem', fontWeight: 500 }}>
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
                  borderRadius: 2,
                  p: '5px',
                  color: currentTheme.palette.primary,
                  bgcolor: 'var(--highlight-bg)',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    borderColor: currentTheme.palette.primary,
                    transform: 'scale(1.05)'
                  }
                }}
              >
                {isAscending ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
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
            const hasPct = typeof prog?.progress_percent === 'number' && prog.progress_percent > 0;
            const resumeTimestamp = prog?.last_timestamp || '00:00';

            return (
              <Card
                key={item.video_id}
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {driveUrl && (
                        <Tooltip title="Saved in Google Drive">
                          <Box
                            component="a"
                            href={driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Saved in Google Drive"
                            onClick={(e) => e.stopPropagation()}
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 24,
                              height: 24,
                              borderRadius: '6px',
                              bgcolor: 'var(--highlight-bg)',
                              border: '1px solid var(--badge-border)',
                              cursor: 'pointer',
                              transition: 'transform 0.15s ease',
                              '&:hover': {
                                transform: 'scale(1.15)',
                                borderColor: currentTheme.palette.primary
                              }
                            }}
                          >
                            <GoogleDriveIcon size={14} />
                          </Box>
                        </Tooltip>
                      )}
                      <Typography variant="caption" sx={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Clock size={12} /> {formatRelativeTime(item.last_accessed_at || item.created_at)}
                      </Typography>
                    </Box>
                  </Box>

                  <Typography
                    variant="subtitle1"
                    sx={{
                      fontWeight: 700,
                      color: currentTheme.palette.textPrimary,
                      lineHeight: 1.4,
                      mb: 1.5,
                      minHeight: '2.8em',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      '&:hover': { color: currentTheme.palette.primary }
                    }}
                    onClick={() => handleTranscribe(item.video_url || item.video_id, true, selectedCourse || item.course_name)}
                  >
                    {item.video_title || item.title || `Lecture ${item.video_id}`}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mt: 'auto' }}>
                    {driveUrl ? (
                      <Chip
                        icon={<GoogleDriveIcon size={14} />}
                        label="In Google Drive"
                        size="small"
                        component="a"
                        href={driveUrl}
                        target="_blank"
                        rel="noreferrer"
                        clickable
                        sx={{
                          bgcolor: 'var(--highlight-bg)',
                          color: currentTheme.palette.primary,
                          border: '1px solid var(--badge-border)',
                          fontWeight: 600,
                          fontSize: '0.7rem',
                          '&:hover': {
                            bgcolor: 'var(--highlight-bg)',
                            borderColor: currentTheme.palette.primary
                          }
                        }}
                      />
                    ) : (
                      <Chip
                        label="Local / Database"
                        size="small"
                        sx={{
                          bgcolor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8',
                          fontSize: '0.7rem'
                        }}
                      />
                    )}
                    <Chip
                      label="Transcript"
                      size="small"
                      sx={{
                        bgcolor: currentTheme.palette.badgeBg,
                        color: currentTheme.palette.badgeColor,
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}
                    />
                    <Chip
                      label="AI Tutor"
                      size="small"
                      sx={{
                        bgcolor: 'rgba(139, 92, 246, 0.1)',
                        color: '#8b5cf6',
                        fontSize: '0.7rem',
                        fontWeight: 600
                      }}
                    />
                  </Box>

                  {hasProgress && (
                    <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed var(--border-color)' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ color: 'var(--text-secondary)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}>
                          ⏱️ {isCompleted ? 'Completed' : `Resume at ${resumeTimestamp}`}
                        </Typography>
                        {hasPct && (
                          <Typography variant="caption" sx={{ color: isCompleted ? '#10b981' : currentTheme.palette.primary, fontWeight: 700, fontSize: '0.72rem' }}>
                            {progressPct}%
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ width: '100%', height: 4, borderRadius: 2, bgcolor: 'var(--border-color)', overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${progressPct}%`,
                          height: '100%',
                          bgcolor: isCompleted ? '#10b981' : currentTheme.palette.primary,
                          transition: 'width 0.3s ease'
                        }} />
                      </Box>
                    </Box>
                  )}
                </CardContent>

                <Divider sx={{ borderColor: currentTheme.palette.cardBorder }} />

                <CardActions sx={{ p: 1.5, justifyContent: 'space-between' }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleTranscribe(item.video_url || item.video_id, true, selectedCourse || item.course_name)}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      bgcolor: currentTheme.palette.accentCta,
                      '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                    }}
                  >
                    {hasProgress && !isCompleted
                      ? `Resume (${resumeTimestamp}) →`
                      : 'Study Lecture →'}
                  </Button>

                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {driveUrl && (
                      <Tooltip title="Open in Google Drive">
                        <IconButton
                          size="small"
                          component="a"
                          href={driveUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open in Google Drive"
                          sx={{
                            color: currentTheme.palette.primary,
                            border: '1px solid var(--badge-border)',
                            borderRadius: '6px',
                            p: '5px',
                            bgcolor: 'var(--highlight-bg)',
                            '&:hover': {
                              borderColor: currentTheme.palette.primary,
                              bgcolor: 'var(--highlight-bg)'
                            }
                          }}
                        >
                          <GoogleDriveIcon size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {typeof handleDeleteFromLibrary === 'function' && (
                      <Tooltip title="Remove from Course Library">
                        <IconButton
                          size="small"
                          aria-label="Remove from Course Library"
                          onClick={() => handleDeleteFromLibrary(item.video_id)}
                          sx={{ color: '#64748b', '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' } }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </CardActions>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
