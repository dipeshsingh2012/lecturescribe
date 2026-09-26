import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  CircularProgress
} from '@mui/material';
import {
  Paperclip,
  Video,
  ExternalLink,
  Download,
  Trash2,
  Upload
} from 'lucide-react';
import { formatRelativeTime, formatBytes, getFileTypeBadge } from '../../utils/formatters';

export default function CourseMaterials({
  courseResourcesLoading,
  courseResources = [],
  googleUser,
  userLibrary = [],
  selectedCourse,
  activeCourseData,
  openUploadModal,
  handleDeleteResource,
  currentTheme
}) {
  if (courseResourcesLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={36} sx={{ color: currentTheme.palette.primary, mb: 2 }} />
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
          Loading course materials...
        </Typography>
      </Box>
    );
  }

  if (courseResources.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 6,
          textAlign: 'center',
          bgcolor: currentTheme.palette.cardBg,
          border: `1px dashed ${currentTheme.palette.cardBorder}`,
          borderRadius: 3
        }}
      >
        <Paperclip size={44} color={currentTheme.palette.primary} style={{ margin: '0 auto 12px', opacity: 0.85 }} />
        <Typography variant="h6" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 1 }}>
          No Course Materials Yet
        </Typography>
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 440, mx: 'auto', mb: 2 }}>
          {googleUser
            ? 'Upload slide decks, reading assignments, syllabi, or resource links for this course.'
            : 'Sign in with Google to upload course materials and syllabus docs.'}
        </Typography>
        {googleUser && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Upload size={14} />}
            onClick={() => openUploadModal({
              courseName: activeCourseData?.course_name || selectedCourse,
              videoId: null
            })}
            sx={{
              bgcolor: currentTheme.palette.primary,
              color: '#fff',
              fontWeight: 700,
              textTransform: 'none',
              borderRadius: 2,
              px: 2.5,
              '&:hover': { bgcolor: currentTheme.palette.primaryHover }
            }}
          >
            Upload First Material
          </Button>
        )}
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {courseResources.map((res) => {
        const badge = getFileTypeBadge(res.file_type, res.filename);
        const isOwner = googleUser?.email && res.user_email?.toLowerCase() === googleUser.email.toLowerCase();
        const associatedLecture = res.video_id
          ? (userLibrary.find(l => l.video_id === res.video_id)?.video_title || `Lecture ${res.video_id}`)
          : null;

        return (
          <Paper
            key={res.id}
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              bgcolor: currentTheme.palette.cardBg,
              border: `1px solid ${currentTheme.palette.cardBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
              transition: 'all 0.2s ease',
              '&:hover': { borderColor: currentTheme.palette.primary, boxShadow: currentTheme.palette.cardShadow }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1 }}>
              <Box sx={{
                px: 1.2,
                py: 0.6,
                borderRadius: 1.5,
                fontWeight: 800,
                fontSize: '0.75rem',
                letterSpacing: '0.5px',
                bgcolor: badge.bg,
                color: badge.color,
                flexShrink: 0
              }}>
                {badge.label}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, mb: 0.3 }}>
                  {res.title || res.filename}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', fontSize: '0.75rem', color: currentTheme.palette.textSecondary }}>
                  {associatedLecture && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: currentTheme.palette.primary }}>
                      <Video size={13} /> {associatedLecture}
                    </Box>
                  )}
                  {res.file_size_bytes > 0 && <span>{formatBytes(res.file_size_bytes)}</span>}
                  <span>Uploaded {formatRelativeTime(res.created_at)}</span>
                  {res.user_email && <span style={{ opacity: 0.75 }}>by {res.user_email}</span>}
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              <Button
                variant="outlined"
                size="small"
                component="a"
                href={res.download_url}
                target="_blank"
                rel="noopener noreferrer"
                download={res.file_type !== 'link' && res.file_type !== 'gdrive'}
                startIcon={res.file_type === 'link' || res.file_type === 'gdrive' ? <ExternalLink size={14} /> : <Download size={14} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  borderRadius: 2,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  '&:hover': { borderColor: currentTheme.palette.primary, bgcolor: 'var(--highlight-bg)' }
                }}
              >
                {res.file_type === 'link' || res.file_type === 'gdrive' ? 'Open' : 'Download'}
              </Button>
              {isOwner && (
                <Tooltip title="Delete Resource">
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteResource(res.id, res.video_id, selectedCourse)}
                    sx={{ color: '#ef4444', '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.1)' } }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}
