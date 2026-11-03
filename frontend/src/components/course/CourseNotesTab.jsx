import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Chip
} from '@mui/material';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatters';
import MathRenderer from '../common/MathRenderer';

export default function CourseNotesTab({
  courseNotes = [],
  courseNotesLoading = false,
  onCreateNewNote,
  onOpenNote,
  onDeleteNote,
  googleUser,
  currentTheme
}) {
  return (
    <Box
      data-testid="course-notes-tab"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FileText size={20} color={currentTheme.palette.primary} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
            My Notes & Scratchpads
          </Typography>
          <Chip
            label={courseNotes.length}
            size="small"
            sx={{
              height: 20,
              fontSize: '0.72rem',
              fontWeight: 700,
              bgcolor: currentTheme.palette.badgeBg,
              color: currentTheme.palette.textSecondary
            }}
          />
        </Box>
        {googleUser && onCreateNewNote && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={14} />}
            onClick={onCreateNewNote}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.78rem',
              borderRadius: 2,
              bgcolor: currentTheme.palette.primary,
              color: '#fff',
              '&:hover': { bgcolor: currentTheme.palette.primaryHover || currentTheme.palette.primary }
            }}
          >
            New Note
          </Button>
        )}
      </Box>

      {courseNotesLoading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 5 }}>
          <CircularProgress size={26} sx={{ color: currentTheme.palette.primary, mr: 1.5 }} />
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
            Loading notes...
          </Typography>
        </Box>
      ) : courseNotes.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 4,
            textAlign: 'center',
            bgcolor: currentTheme.palette.cardBg,
            border: `1px dashed ${currentTheme.palette.cardBorder}`,
            borderRadius: 3
          }}
        >
          <FileText size={36} color={currentTheme.palette.primary} style={{ margin: '0 auto 10px', opacity: 0.8 }} />
          <Typography variant="subtitle1" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 0.5 }}>
            No Notes Created Yet
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: currentTheme.palette.textSecondary, display: 'block', maxWidth: 460, mx: 'auto', mb: 2 }}
          >
            Create a scratchpad to jot down course notes, LaTeX math derivations, lecture reflections, or project outlines.
          </Typography>
          {googleUser && onCreateNewNote && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<Plus size={14} />}
              onClick={onCreateNewNote}
              sx={{
                bgcolor: currentTheme.palette.cardBg,
                color: currentTheme.palette.primary,
                borderColor: currentTheme.palette.cardBorder,
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: 2
              }}
            >
              Create First Note
            </Button>
          )}
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
          {courseNotes.map((note) => (
            <Paper
              key={note.note_id}
              elevation={0}
              sx={{
                p: 2.25,
                borderRadius: 2.5,
                bgcolor: currentTheme.palette.cardBg,
                border: `1px solid ${currentTheme.palette.cardBorder}`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 1.5,
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                '&:hover': {
                  borderColor: currentTheme.palette.primary,
                  boxShadow: currentTheme.palette.cardShadow,
                  transform: 'translateY(-2px)'
                }
              }}
              onClick={() => onOpenNote && onOpenNote(note)}
            >
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box
                    sx={{
                      px: 1,
                      py: 0.3,
                      borderRadius: 1.5,
                      fontWeight: 800,
                      fontSize: '0.68rem',
                      letterSpacing: '0.5px',
                      bgcolor: 'rgba(16, 185, 129, 0.12)',
                      color: '#10b981'
                    }}
                  >
                    NOTE
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                    {onDeleteNote && (
                      <Tooltip title="Delete note">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete "${note.title || 'Untitled Note'}"?`)) {
                              onDeleteNote(note.note_id);
                            }
                          }}
                          sx={{
                            color: currentTheme.palette.textSecondary,
                            p: 0.5,
                            '&:hover': { color: '#ef4444' }
                          }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    color: currentTheme.palette.textPrimary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <MathRenderer text={note.title || 'Untitled Note'} />
                </Typography>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  pt: 1,
                  borderTop: `1px solid ${currentTheme.palette.cardBorder}`
                }}
              >
                <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.72rem' }}>
                  {formatRelativeTime(note.updated_at || note.created_at)}
                </Typography>
                <Button
                  size="small"
                  sx={{
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    color: currentTheme.palette.primary,
                    p: 0,
                    minWidth: 0
                  }}
                >
                  Open →
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}

