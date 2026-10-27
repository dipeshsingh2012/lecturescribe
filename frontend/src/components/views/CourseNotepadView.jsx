import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip
} from '@mui/material';
import {
  ArrowLeft,
  Check,
  RotateCw,
  Download,
  Trash2,
  FileText,
  AlertCircle,
  Save,
  Calendar as CalendarIcon
} from 'lucide-react';
import CalendarAlertCard from '../calendar/CalendarAlertCard';

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['blockquote', 'code-block'],
    ['link'],
    ['clean']
  ]
};

const QUILL_FORMATS = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'list',
  'align',
  'blockquote',
  'code-block',
  'link'
];

export default function CourseNotepadView({
  courseName,
  noteId,
  activeNote,
  activeNoteLoading,
  saveStatus,
  saveNote,
  deleteNote,
  onNavigateBack,
  googleUser,
  currentTheme
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCalendarWidget, setShowCalendarWidget] = useState(false);

  const quillRef = useRef(null);
  const initialLoadedRef = useRef(false);
  const currentNoteIdRef = useRef(null);

  // Sync state when activeNote loads for a new/different noteId or when fetched content arrives
  useEffect(() => {
    if (activeNote && activeNote.note_id === noteId) {
      const isNewNote = currentNoteIdRef.current !== noteId;
      const contentArrived =
        typeof activeNote.content === 'string' &&
        activeNote.content !== '' &&
        (!content || content === '<p><br></p>');

      if (isNewNote || contentArrived) {
        const initialTitle = activeNote.title || 'Untitled Note';
        const initialContent = activeNote.content || '';

        if (isNewNote || !title || title === 'Untitled Note') {
          setTitle(initialTitle);
        }
        setContent(initialContent);
        setLastSavedTime(activeNote.updated_at ? new Date(activeNote.updated_at) : new Date());
        currentNoteIdRef.current = noteId;
        initialLoadedRef.current = true;
        setHasUnsavedChanges(false);
      } else if (activeNote.updated_at) {
        setLastSavedTime(new Date(activeNote.updated_at));
      }
    }
  }, [activeNote, noteId, content, title]);

  // Manual explicit save action (triggered by Save button or Ctrl+S)
  const handleManualSave = useCallback(async () => {
    if (!noteId || !saveNote || !googleUser?.email) return;

    const res = await saveNote(courseName, noteId, googleUser.email, {
      title: title || 'Untitled Note',
      content
    });
    if (res) {
      setHasUnsavedChanges(false);
      setLastSavedTime(new Date());
    }
  }, [courseName, noteId, googleUser, saveNote, title, content]);

  // Keyboard shortcut Ctrl+S / Cmd+S for instant manual save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave]);

  // Content change handler from ReactQuill (handles both user typing and paste)
  const handleContentChange = (newContent, delta, source) => {
    setContent(newContent);
    if (initialLoadedRef.current && source === 'user') {
      setHasUnsavedChanges(true);
    }
  };

  // Title change handler
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    setHasUnsavedChanges(true);
  };

  // Handle back navigation
  const handleBack = () => {
    if (onNavigateBack) onNavigateBack();
  };

  // Download note as plain text / markdown file
  const handleDownloadTxt = () => {
    const safeTitle = (title || 'note').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const plainText = content
      ? content
          .replace(/<p><br><\/p>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
      : '';
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeTitle}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Delete note confirmed
  const handleConfirmDelete = async () => {
    setDeleteDialogOpen(false);
    if (deleteNote) {
      await deleteNote(courseName, noteId, googleUser?.email);
      onNavigateBack();
    }
  };

  // Word and character count statistics from plain text
  const plainText = useMemo(() => {
    if (!content) return '';
    return content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  }, [content]);

  const charCount = plainText.length;
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;

  if (activeNoteLoading && !initialLoadedRef.current) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 2
        }}
      >
        <CircularProgress size={36} sx={{ color: currentTheme?.palette?.primary || '#3b82f6' }} />
        <Typography variant="body2" sx={{ color: currentTheme?.palette?.textSecondary || '#64748b' }}>
          Loading notepad...
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 120px)',
        minHeight: '600px',
        maxWidth: 1060,
        mx: 'auto',
        boxSizing: 'border-box',
        px: { xs: 2, sm: 3 }
      }}
    >
      {/* ========================================================================= */}
      {/* TOP HEADER & ACTION BAR */}
      {/* ========================================================================= */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 1.5,
          borderBottom: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.08)'}`,
          gap: 2,
          flexWrap: 'wrap'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Tooltip title="Back to course">
            <IconButton
              onClick={handleBack}
              size="small"
              sx={{
                color: currentTheme?.palette?.textPrimary || '#1e293b',
                bgcolor: currentTheme?.palette?.cardBg || '#f8fafc',
                border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.1)'}`,
                '&:hover': { bgcolor: currentTheme?.palette?.badgeBg || 'rgba(0,0,0,0.05)' }
              }}
            >
              <ArrowLeft size={18} />
            </IconButton>
          </Tooltip>

          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FileText size={16} color={currentTheme?.palette?.primary || '#3b82f6'} />
              <Typography
                variant="caption"
                sx={{
                  color: currentTheme?.palette?.textSecondary || '#64748b',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {courseName} / Notepad
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* STATUS & ACTIONS */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* SAVE STATUS INDICATOR */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            {saveStatus === 'saving' ? (
              <Chip
                icon={<RotateCw size={12} className="animate-spin" />}
                label="Saving..."
                size="small"
                variant="outlined"
                sx={{
                  height: 24,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  borderColor: currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.15)',
                  color: currentTheme?.palette?.textSecondary || '#64748b'
                }}
              />
            ) : saveStatus === 'error' ? (
              <Tooltip title="Save failed. Click to retry saving now.">
                <Chip
                  icon={<AlertCircle size={12} color="#ef4444" />}
                  label="Save error (Retry)"
                  size="small"
                  variant="outlined"
                  onClick={handleManualSave}
                  sx={{
                    height: 24,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    color: '#ef4444',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.08)' }
                  }}
                />
              </Tooltip>
            ) : hasUnsavedChanges ? (
              <Tooltip title="You have unsaved changes. Press Save or Ctrl+S to save.">
                <Chip
                  label="Unsaved changes"
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 24,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderColor: 'rgba(234, 179, 8, 0.4)',
                    color: '#eab308',
                    bgcolor: 'rgba(234, 179, 8, 0.08)'
                  }}
                />
              </Tooltip>
            ) : (
              <Tooltip title={lastSavedTime ? `Saved to cloud at ${lastSavedTime.toLocaleTimeString()}` : 'Saved'}>
                <Chip
                  icon={<Check size={12} color="#10b981" />}
                  label="Saved"
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 24,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderColor: 'rgba(16, 185, 129, 0.3)',
                    color: '#10b981'
                  }}
                />
              </Tooltip>
            )}
          </Box>

          {/* EXPLICIT SAVE BUTTON */}
          <Button
            size="small"
            variant={saveStatus === 'error' ? 'contained' : hasUnsavedChanges ? 'contained' : 'outlined'}
            color={saveStatus === 'error' ? 'error' : 'primary'}
            startIcon={<Save size={14} />}
            onClick={handleManualSave}
            disabled={saveStatus === 'saving' || (!hasUnsavedChanges && saveStatus !== 'error')}
            sx={{
              height: 28,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.78rem',
              borderRadius: 2,
              px: 1.5,
              borderColor: currentTheme?.palette?.cardBorder
            }}
          >
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Retry Save' : 'Save'}
          </Button>

          {/* STATS CHIP */}
          <Chip
            label={`${wordCount} words • ${charCount} chars`}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.72rem',
              fontWeight: 600,
              bgcolor: currentTheme?.palette?.badgeBg || 'rgba(0,0,0,0.04)',
              color: currentTheme?.palette?.textSecondary || '#64748b',
              display: { xs: 'none', sm: 'inline-flex' }
            }}
          />

          {/* TOGGLE COURSE CALENDAR WIDGET */}
          <Button
            size="small"
            variant={showCalendarWidget ? 'contained' : 'outlined'}
            startIcon={<CalendarIcon size={13} />}
            onClick={() => setShowCalendarWidget((prev) => !prev)}
            sx={{
              height: 28,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.75rem',
              borderRadius: 2,
              px: 1.2,
              borderColor: currentTheme?.palette?.cardBorder
            }}
          >
            Deadlines
          </Button>

          {/* DOWNLOAD .TXT */}
          <Tooltip title="Download as text">
            <IconButton
              onClick={handleDownloadTxt}
              size="small"
              sx={{
                color: currentTheme?.palette?.textSecondary || '#64748b',
                '&:hover': { color: currentTheme?.palette?.primary || '#3b82f6' }
              }}
            >
              <Download size={17} />
            </IconButton>
          </Tooltip>

          {/* DELETE NOTE */}
          <Tooltip title="Delete note">
            <IconButton
              onClick={() => setDeleteDialogOpen(true)}
              size="small"
              sx={{
                color: currentTheme?.palette?.textSecondary || '#64748b',
                '&:hover': { color: '#ef4444' }
              }}
            >
              <Trash2 size={17} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {showCalendarWidget && (
        <Box sx={{ mt: 2 }}>
          <CalendarAlertCard
            currentTheme={currentTheme}
            googleUser={googleUser || { email: 'guest@lecturescribe.local', name: 'Learner' }}
            selectedCourse={courseName}
            compact={true}
          />
        </Box>
      )}

      {/* ========================================================================= */}
      {/* NOTE TITLE INPUT */}
      {/* ========================================================================= */}
      <Box sx={{ pt: 2, pb: 1.5 }}>
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled Note"
          style={{
            width: '100%',
            fontSize: '1.65rem',
            fontWeight: 800,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: currentTheme?.palette?.textPrimary || '#0f172a',
            fontFamily: 'inherit',
            padding: '4px 0',
            letterSpacing: '-0.02em'
          }}
        />
      </Box>

      {/* ========================================================================= */}
      {/* VISUAL WORD-STYLE RICH TEXT QUILL EDITOR */}
      {/* ========================================================================= */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          minHeight: 0,
          pb: 2,
          '& .quill': {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0
          },
          '& .ql-toolbar.ql-snow': {
            borderRadius: '12px 12px 0 0',
            borderColor: currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.12)',
            bgcolor: currentTheme?.palette?.cardBg || '#f8fafc',
            borderBottom: 'none',
            px: 1.5,
            py: 1,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 0.5
          },
          '& .ql-container.ql-snow': {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '0 0 12px 12px',
            borderColor: currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.12)',
            bgcolor: currentTheme?.palette?.surface || currentTheme?.palette?.cardBg || '#ffffff',
            fontSize: '1.02rem',
            fontFamily: 'inherit',
            overflow: 'hidden'
          },
          '& .ql-editor': {
            flex: 1,
            minHeight: '350px',
            overflowY: 'auto',
            color: currentTheme?.palette?.textPrimary || '#0f172a',
            fontSize: '1.02rem',
            lineHeight: 1.7,
            p: 2.5,
            '&.ql-blank::before': {
              color: currentTheme?.palette?.textSecondary || '#94a3b8',
              fontStyle: 'normal',
              left: '20px'
            }
          },
          '& .ql-snow .ql-stroke': {
            stroke: currentTheme?.palette?.textPrimary || '#334155'
          },
          '& .ql-snow .ql-fill': {
            fill: currentTheme?.palette?.textPrimary || '#334155'
          },
          '& .ql-snow .ql-picker': {
            color: currentTheme?.palette?.textPrimary || '#334155'
          },
          '& .ql-snow .ql-picker-options': {
            bgcolor: currentTheme?.palette?.cardBg || '#ffffff',
            borderColor: currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.15)',
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 12px rgba(0,0,0,0.1)'
          }
        }}
      >
        <ReactQuill
          ref={quillRef}
          theme="snow"
          value={content}
          onChange={handleContentChange}
          modules={QUILL_MODULES}
          formats={QUILL_FORMATS}
          placeholder="Start writing notes, formatting headings, lists, or lecture takeaways..."
        />
      </Box>

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              bgcolor: currentTheme?.palette?.cardBg || '#ffffff',
              border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.1)'}`
            }
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, color: currentTheme?.palette?.textPrimary }}>
          Delete Notepad Note?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: currentTheme?.palette?.textSecondary }}>
            Are you sure you want to delete <strong>"{title || 'Untitled Note'}"</strong>? This will permanently delete the note from cloud storage.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ pb: 2, px: 3 }}>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            sx={{ textTransform: 'none', fontWeight: 600, color: currentTheme?.palette?.textSecondary }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
          >
            Delete Note
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
