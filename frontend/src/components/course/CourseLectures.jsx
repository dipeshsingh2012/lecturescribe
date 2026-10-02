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
  CircularProgress
} from '@mui/material';
import {
  Video,
  Clock,
  ExternalLink,
  Trash2,
  BookOpen,
  ArrowLeft
} from 'lucide-react';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import { formatRelativeTime } from '../../utils/formatters';

export default function CourseLectures({
  courseLoading,
  filteredCourseLectures = [],
  handleTranscribe,
  handleDeleteFromLibrary,
  handleClearCourse,
  selectedCourse,
  librarySearch = '',
  currentTheme
}) {
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
      {filteredCourseLectures.map((item) => {
        const driveUrl = item.drive_folder_url || item.driveFolderUrl;

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
                  label="Transcript Search"
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
                Study Lecture →
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
                <Tooltip title="Remove from My Library">
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteFromLibrary(item.video_id)}
                    sx={{ color: '#64748b', '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' } }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            </CardActions>
          </Card>
        );
      })}
    </Box>
  );
}
