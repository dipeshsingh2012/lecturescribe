import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress
} from '@mui/material';
import { Edit3, Globe } from 'lucide-react';
import { normalizeCourseSlug } from '../../utils/routing';

export default function CourseRenameDialog({
  open,
  onClose,
  course,
  onRename,
  currentTheme
}) {
  const currentName = typeof course === 'string' ? course : (course?.course_name || '');
  const courseIdentifier = typeof course === 'string' ? course : (course?.course_slug || course?.course_name || '');

  const [newName, setNewName] = useState(currentName);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName(currentName);
      setError('');
      setIsSubmitting(false);
    }
  }, [open, currentName]);

  const trimmed = newName.trim();
  const isUnchanged = trimmed === currentName.trim();
  const isTooShort = trimmed.length < 2;
  const isInvalid = !trimmed || isTooShort || isUnchanged;
  const previewSlug = normalizeCourseSlug(trimmed) || 'course-name';

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isInvalid || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      if (typeof onRename === 'function') {
        await onRename(courseIdentifier, trimmed);
      }
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to rename course. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isInvalid && !isSubmitting) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog
      open={Boolean(open)}
      onClose={isSubmitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: currentTheme?.palette?.cardBg || 'background.paper',
            color: currentTheme?.palette?.textPrimary || 'text.primary',
            border: `1px solid ${currentTheme?.palette?.cardBorder || 'var(--border-color)'}`,
            borderRadius: 3,
            boxShadow: currentTheme?.palette?.cardShadow || 4,
            p: 0.5
          }
        }
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.2, pb: 1, fontWeight: 800 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: '10px',
              bgcolor: 'var(--highlight-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(0, 117, 237, 0.2)'
            }}
          >
            <Edit3 size={18} color={currentTheme?.palette?.primary || '#0075ed'} />
          </Box>
          <Typography variant="h6" component="div" sx={{ fontWeight: 800, fontSize: '1.1rem' }}>
            Edit Course Name
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <Typography variant="body2" sx={{ color: currentTheme?.palette?.textSecondary || 'text.secondary', mb: 2 }}>
            Renaming this course will update all associated lectures, notes, quizzes, and resources while preserving existing streaming links.
          </Typography>

          <TextField
            autoFocus
            fullWidth
            label="Course Name"
            variant="outlined"
            size="medium"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
            disabled={isSubmitting}
            helperText={`${newName.length} / 255 characters`}
            slotProps={{
              htmlInput: { maxLength: 255 },
              formHelperText: { sx: { textAlign: 'right', mr: 0 } }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2
              }
            }}
          />

          {/* URL preview */}
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 2,
              bgcolor: 'var(--highlight-bg)',
              border: `1px solid var(--badge-border)`,
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            <Globe size={16} color={currentTheme?.palette?.textSecondary || '#6b7280'} />
            <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary || 'text.secondary', fontFamily: 'monospace' }}>
              URL Path: <strong>/course/{previewSlug}</strong>
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, gap: 1 }}>
          <Button
            onClick={onClose}
            disabled={isSubmitting}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              color: currentTheme?.palette?.textSecondary || 'text.secondary',
              borderRadius: 2
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isInvalid || isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              px: 2.5,
              bgcolor: currentTheme?.palette?.primary || '#0075ed',
              '&:hover': {
                bgcolor: currentTheme?.palette?.primaryHover || '#005bb5'
              }
            }}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
