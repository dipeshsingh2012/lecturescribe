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
  AlertCircle
} from 'lucide-react';

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

  const quillRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const initialLoadedRef = useRef(false);
  const currentNoteIdRef = useRef(null);
  const latestDataRef = useRef({ title: '', content: '' });

  // Helper to get local draft backup key
  const getDraftStorageKey = useCallback(
    (id) => `lecturescribe_draft_${googleUser?.email || 'anon'}_${id}`,
    [googleUser?.email]
  );

  // Sync state when activeNote loads for a new/different noteId
  useEffect(() => {
    if (activeNote && activeNote.note_id === noteId) {
      if (currentNoteIdRef.current !== noteId) {
        let initialTitle = activeNote.title || 'Untitled Note';
        let initialContent = activeNote.content || '';

        // Check local storage draft backup
        try {
          const draftKey = getDraftStorageKey(noteId);
          const savedDraftRaw = localStorage.getItem(draftKey);
          if (savedDraftRaw) {
            const savedDraft = JSON.parse(savedDraftRaw);
            const serverClean = (initialContent || '').replace(/<[^>]+>/g, '').trim();
            const draftClean = (savedDraft.content || '').replace(/<[^>]+>/g, '').trim();
            // If local draft has content while server snapshot is blank, restore local draft!
            if (!serverClean && draftClean) {
              console.info('[CourseNotepadView] Restoring local backup draft for note', noteId);
              initialContent = savedDraft.content;
              if (savedDraft.title) initialTitle = savedDraft.title;
            }
          }
        } catch (e) {
          console.warn('[CourseNotepadView] Error reading local draft backup:', e);
        }

        setTitle(initialTitle);
        setContent(initialContent);
        latestDataRef.current = { title: initialTitle, content: initialContent };
        setLastSavedTime(activeNote.updated_at ? new Date(activeNote.updated_at) : new Date());
        currentNoteIdRef.current = noteId;
        initialLoadedRef.current = true;
      } else if (activeNote.updated_at) {
        setLastSavedTime(new Date(activeNote.updated_at));
      }
    }
  }, [activeNote, noteId, getDraftStorageKey]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Save local draft to localStorage immediately on keystroke
  const saveLocalDraft = useCallback(
    (draftTitle, draftContent) => {
      if (!noteId) return;
      try {
        const draftKey = getDraftStorageKey(noteId);
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            title: draftTitle,
            content: draftContent,
            timestamp: Date.now()
          })
        );
      } catch (e) {
        console.warn('[CourseNotepadView] Error saving local draft:', e);
      }
    },
    [noteId, getDraftStorageKey]
  );

  // Handle debounced auto-save
  const triggerAutoSave = useCallback(
    (newTitle, newContent) => {
      if (!noteId || !googleUser?.email) return;

      // Always backup locally before triggering debounce
      saveLocalDraft(newTitle, newContent);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        // Safeguard: Never send empty overwrite if active note previously had substantial content
        const cleanText = (newContent || '').replace(/<[^>]+>/g, '').trim();
        const prevContentClean = (activeNote?.content || '').replace(/<[^>]+>/g, '').trim();
        if (prevContentClean.length > 20 && !cleanText) {
          console.warn('[CourseNotepadView] Blocked accidental empty auto-save payload.');
          return;
        }

        if (saveNote) {
          const res = await saveNote(courseName, noteId, googleUser.email, {
            title: newTitle || 'Untitled Note',
            content: newContent
          });
          if (res) {
            setLastSavedTime(new Date());
          }
        }
      }, 1200);
    },
    [courseName, noteId, googleUser, saveNote, saveLocalDraft, activeNote]
  );

  // Content change handler from ReactQuill
  const handleContentChange = (newContent, delta, source) => {
    setContent(newContent);
    latestDataRef.current.content = newContent;
    if (source === 'user') {
      saveLocalDraft(title, newContent);
      triggerAutoSave(title, newContent);
    }
  };

  // Title change handler
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    latestDataRef.current.title = newTitle;
    saveLocalDraft(newTitle, content);
    triggerAutoSave(newTitle, content);
  };

  // Handle back navigation with immediate flush if auto-save is pending
  const handleBack = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      if (saveNote && noteId && googleUser?.email) {
        const cleanText = (latestDataRef.current.content || '').replace(/<[^>]+>/g, '').trim();
        const prevContentClean = (activeNote?.content || '').replace(/<[^>]+>/g, '').trim();
        if (!(prevContentClean.length > 20 && !cleanText)) {
          try {
            const p = saveNote(courseName, noteId, googleUser.email, {
              title: latestDataRef.current.title || 'Untitled Note',
              content: latestDataRef.current.content
            });
            if (p && typeof p.catch === 'function') {
              p.catch((e) => console.warn('Error saving note before navigating back:', e));
            }
          } catch (e) {
            console.warn('Error saving note before navigating back:', e);
          }
        }
      }
    }
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
          {/* AUTO-SAVE STATUS INDICATOR */}
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
              <Chip
                icon={<AlertCircle size={12} color="#ef4444" />}
                label="Save error"
                size="small"
                variant="outlined"
                sx={{
                  height: 24,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  color: '#ef4444'
                }}
              />
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
