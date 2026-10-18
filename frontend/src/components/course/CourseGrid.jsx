import React, { useState } from 'react';
import {
  Box,
  Card,
  Typography,
  Chip,
  Button,
  Paper,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress
} from '@mui/material';
import {
  BookOpen,
  Clock,
  Play,
  Trash2,
  AlertTriangle,
  Pin
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatters';

export default function CourseGrid({
  filteredCourses = [],
  handleSelectCourse,
  handleDeleteCourse,
  handleTogglePin,
  librarySearch = '',
  currentTheme
}) {
  const [courseToDelete, setCourseToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!courseToDelete || typeof handleDeleteCourse !== 'function') {
      setCourseToDelete(null);
      return;
    }
    setIsDeleting(true);
    try {
      await handleDeleteCourse(courseToDelete.course_name);
      setCourseToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  if (filteredCourses.length === 0) {
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
          {librarySearch ? 'No matching courses found' : 'Your Course Library is Empty'}
        </Typography>
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 460, mx: 'auto', mb: 1 }}>
          {librarySearch
            ? `No courses or lectures matched "${librarySearch}". Try a different keyword.`
            : 'Paste any lecture link in the quick-add bar above to transcribe, index into search and AI tutor, and start studying!'}
        </Typography>
      </Paper>
    );
  }

  return (
    <>
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
        {filteredCourses.map((course) => (
          <Card
            key={course.course_name}
            onClick={() => handleSelectCourse(course.course_name)}
            sx={{
              width: '100%',
              height: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              cursor: 'pointer',
              bgcolor: currentTheme.palette.cardBg,
              border: course.is_pinned
                ? `1.5px solid ${currentTheme.palette.primary}`
                : `1px solid ${currentTheme.palette.cardBorder}`,
              borderRadius: 3,
              boxShadow: currentTheme.palette.cardShadow,
              transition: 'all 0.2s ease-in-out',
              display: 'flex',
              flexDirection: 'column',
              p: 2.5,
              '&:hover': {
                transform: 'translateY(-4px)',
                borderColor: currentTheme.palette.primary,
                boxShadow: currentTheme.palette.cardHoverShadow
              }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                bgcolor: 'var(--highlight-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(0, 117, 237, 0.2)'
              }}>
                <BookOpen size={22} color={currentTheme.palette.primary} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                {course.is_pinned && (
                  <Chip
                    label="Pinned"
                    size="small"
                    sx={{
                      fontWeight: 800,
                      fontSize: '0.68rem',
                      height: 24,
                      bgcolor: 'rgba(0, 117, 237, 0.12)',
                      color: currentTheme.palette.primary,
                      border: '1px solid rgba(0, 117, 237, 0.25)'
                    }}
                  />
                )}
                <Chip
                  label={`${course.lecture_count} ${course.lecture_count === 1 ? 'lecture' : 'lectures'}`}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    bgcolor: currentTheme.palette.badgeBg,
                    color: currentTheme.palette.badgeColor,
                    border: `1px solid ${currentTheme.palette.badgeBorder}`
                  }}
                />
                {typeof handleTogglePin === 'function' && (
                  <Tooltip
                    title={course.is_pinned ? `Unpin ${course.course_name}` : `Pin ${course.course_name} to top`}
                    arrow
                  >
                    <IconButton
                      size="small"
                      aria-label={course.is_pinned ? `Unpin ${course.course_name}` : `Pin ${course.course_name} to top`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(course.course_slug || course.course_name);
                      }}
                      sx={{
                        color: course.is_pinned ? currentTheme.palette.primary : currentTheme.palette.textSecondary,
                        p: 0.6,
                        borderRadius: 1.5,
                        bgcolor: course.is_pinned ? 'rgba(0, 117, 237, 0.08)' : 'transparent',
                        '&:hover': {
                          color: currentTheme.palette.primary,
                          bgcolor: 'rgba(0, 117, 237, 0.15)'
                        }
                      }}
                    >
                      <Pin
                        size={15}
                        style={{
                          transform: course.is_pinned ? 'rotate(45deg)' : 'none',
                          transition: 'transform 0.2s ease'
                        }}
                        fill={course.is_pinned ? 'currentColor' : 'none'}
                      />
                    </IconButton>
                  </Tooltip>
                )}
                {typeof handleDeleteCourse === 'function' && (
                  <Tooltip title="Delete Course" arrow>
                    <IconButton
                      size="small"
                      aria-label={`Delete ${course.course_name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCourseToDelete(course);
                      }}
                      sx={{
                        color: currentTheme.palette.textSecondary,
                        p: 0.6,
                        borderRadius: 1.5,
                        '&:hover': {
                          color: '#ef4444',
                          bgcolor: 'rgba(239, 68, 68, 0.1)'
                        }
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
                fontWeight: 800,
                color: currentTheme.palette.textPrimary,
                lineHeight: 1.35,
                mb: 1,
                minHeight: '2.7em',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {course.course_name}
            </Typography>

            <Typography variant="caption" sx={{ color: '#64748b', mb: 2, display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Clock size={12} /> Last active: {formatRelativeTime(course.latest_viewed_at)}
            </Typography>

            {/* Recent Sessions Preview */}
            <Box sx={{
              bgcolor: 'var(--panel-bg)',
              p: 1.5,
              borderRadius: 2,
              mb: 2.5,
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8
            }}>
              {(course.lectures || []).slice(0, 2).map((l, i) => {
                const lProg = l.progress;
                const lHasProg = Boolean(lProg && (
                  (typeof lProg.progress_percent === 'number' && lProg.progress_percent > 0) ||
                  (typeof lProg.last_seconds === 'number' && lProg.last_seconds > 2) ||
                  (lProg.last_timestamp && lProg.last_timestamp !== '00:00' && lProg.last_timestamp !== '0:00')
                ));
                const lCompleted = lProg?.progress_percent >= 90;
                const lPct = typeof lProg?.progress_percent === 'number' && lProg.progress_percent > 0
                  ? Math.round(lProg.progress_percent)
                  : null;

                return (
                  <Box key={l.video_id || i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Play size={11} color="var(--theme-primary)" style={{ flexShrink: 0 }} />
                    <Typography variant="caption" sx={{
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      fontSize: '0.78rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1
                    }}>
                      {l.title || `Lecture ${l.video_id}`}
                    </Typography>
                    {lHasProg && (
                      <Typography variant="caption" sx={{
                        ml: 'auto',
                        flexShrink: 0,
                        fontSize: '0.68rem',
                        color: lCompleted ? '#10b981' : 'var(--theme-primary)',
                        fontWeight: 700,
                        bgcolor: lCompleted ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                        px: 0.8,
                        py: 0.2,
                        borderRadius: 1
                      }}>
                        {lCompleted ? 'Done' : (lPct ? `${lPct}%` : (lProg.last_timestamp || 'In progress'))}
                      </Typography>
                    )}
                  </Box>
                );
              })}
              {(course.lecture_count || 0) > 2 && (
                <Typography variant="caption" sx={{ color: 'var(--theme-primary)', fontWeight: 600, fontSize: '0.72rem', mt: 0.2 }}>
                  + {course.lecture_count - 2} more {course.lecture_count - 2 === 1 ? 'lecture' : 'lectures'}
                </Typography>
              )}
            </Box>

            <Button
              variant="contained"
              fullWidth
              endIcon={<Play size={14} />}
              sx={{
                mt: 'auto',
                bgcolor: currentTheme.palette.primary,
                color: '#ffffff',
                fontWeight: 700,
                textTransform: 'none',
                py: 1,
                borderRadius: 2,
                '&:hover': { bgcolor: currentTheme.palette.primaryHover }
              }}
            >
              View Lectures ({course.lecture_count}) →
            </Button>
          </Card>
        ))}
      </Box>

      <Dialog
        open={Boolean(courseToDelete)}
        onClose={() => !isDeleting && setCourseToDelete(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              bgcolor: currentTheme.palette.cardBg,
              color: currentTheme.palette.textPrimary,
              border: `1px solid ${currentTheme.palette.cardBorder}`,
              borderRadius: 3
            }
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.2, fontWeight: 800, pb: 1 }}>
          <AlertTriangle size={20} color="#ef4444" />
          Delete Course?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: currentTheme.palette.textPrimary, mb: 1.5, lineHeight: 1.6 }}>
            Are you sure you want to delete <strong>{courseToDelete?.course_name}</strong> ({courseToDelete?.lecture_count || 0} {courseToDelete?.lecture_count === 1 ? 'lecture' : 'lectures'})?
          </Typography>
          <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block', lineHeight: 1.5 }}>
            This will permanently purge all lectures, transcripts, notes, resources, readings, quizzes, and chat history associated with this course.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setCourseToDelete(null)}
            disabled={isDeleting}
            variant="outlined"
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: currentTheme.palette.textSecondary,
              borderColor: currentTheme.palette.cardBorder
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            variant="contained"
            startIcon={isDeleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: '#ef4444',
              color: '#ffffff',
              '&:hover': { bgcolor: '#dc2626' }
            }}
          >
            {isDeleting ? 'Deleting...' : 'Delete Course'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
