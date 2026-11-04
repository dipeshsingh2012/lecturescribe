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
import { Edit3 } from 'lucide-react';

export default function LectureRenameDialog({
  open,
  onClose,
  lecture,
  onRename,
  currentTheme
}) {
  const currentTitle = typeof lecture === 'string'
    ? lecture
    : (lecture?.video_title || lecture?.title || '');
  const videoId = typeof lecture === 'object'
    ? (lecture?.video_id || lecture?.videoId || lecture?.id || '')
    : '';

  const [newTitle, setNewTitle] = useState(currentTitle);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewTitle(currentTitle);
      setError('');
      setIsSubmitting(false);
    }
  }, [open, currentTitle]);

  const trimmed = newTitle.trim();
  const isUnchanged = trimmed === currentTitle.trim();
  const isTooShort = trimmed.length < 2;
  const isInvalid = !trimmed || isTooShort || isUnchanged;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isInvalid || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      if (typeof onRename === 'function') {
        await onRename(videoId, trimmed);
      }
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to rename lecture. Please try again.');
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
            Edit Lecture Title
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <Typography variant="body2" sx={{ color: currentTheme?.palette?.textSecondary || 'text.secondary', mb: 2 }}>
            Updating this lecture title will update your course workspace, transcripts, and study notes.
          </Typography>

          <TextField
            autoFocus
            fullWidth
            label="Lecture Title"
            variant="outlined"
            size="medium"
            value={newTitle}
            onChange={(e) => {
              setNewTitle(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
            disabled={isSubmitting}
            error={Boolean(trimmed && isTooShort)}
            helperText={
              trimmed && isTooShort
                ? 'Title must be at least 2 characters long'
                : `${trimmed.length} / 255`
            }
            slotProps={{
              htmlInput: { maxLength: 255 },
              formHelperText: {
                sx: {
                  textAlign: 'right',
                  color: currentTheme?.palette?.textSecondary || 'text.secondary'
                }
              }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: 'var(--input-bg, transparent)',
                color: currentTheme?.palette?.textPrimary || 'inherit',
                borderRadius: 2,
                '& fieldset': {
                  borderColor: currentTheme?.palette?.cardBorder || 'var(--border-color)'
                },
                '&:hover fieldset': {
                  borderColor: currentTheme?.palette?.primary || '#0075ed'
                },
                '&.Mui-focused fieldset': {
                  borderColor: currentTheme?.palette?.primary || '#0075ed'
                }
              },
              '& .MuiInputLabel-root': {
                color: currentTheme?.palette?.textSecondary || 'text.secondary',
                '&.Mui-focused': {
                  color: currentTheme?.palette?.primary || '#0075ed'
                }
              }
            }}
          />
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
          <Button
            onClick={onClose}
            disabled={isSubmitting}
            sx={{
              color: currentTheme?.palette?.textSecondary || 'text.secondary',
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: 2,
              px: 2
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
              bgcolor: currentTheme?.palette?.primary || '#0075ed',
              color: '#ffffff',
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              px: 2.5,
              '&:hover': {
                bgcolor: currentTheme?.palette?.primaryHover || '#005bb5'
              },
              '&.Mui-disabled': {
                bgcolor: 'rgba(0, 117, 237, 0.3)',
                color: 'rgba(255, 255, 255, 0.5)'
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
