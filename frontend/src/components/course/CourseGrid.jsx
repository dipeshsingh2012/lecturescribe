import React from 'react';
import {
  Box,
  Card,
  Typography,
  Chip,
  Button,
  Paper
} from '@mui/material';
import {
  BookOpen,
  Clock,
  Play
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatters';

export default function CourseGrid({
  filteredCourses = [],
  handleSelectCourse,
  librarySearch = '',
  currentTheme
}) {
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
            border: `1px solid ${currentTheme.palette.cardBorder}`,
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
            {(course.lectures || []).slice(0, 2).map((l, i) => (
              <Box key={l.video_id || i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Play size={11} color="var(--theme-primary)" style={{ flexShrink: 0 }} />
                <Typography variant="caption" sx={{
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  fontSize: '0.78rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {l.title || `Lecture ${l.video_id}`}
                </Typography>
              </Box>
            ))}
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
  );
}
