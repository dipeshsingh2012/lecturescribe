import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import katex from 'katex';
import DOMPurify from 'dompurify';
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
  Calendar as CalendarIcon,
  Eye,
  Columns,
  X
} from 'lucide-react';
import CalendarAlertCard from '../calendar/CalendarAlertCard';
import MathRenderer, { hasLatexMath } from '../common/MathRenderer';
import { repairCorruptedLatex } from '../../utils/formatters';

if (typeof window !== 'undefined') {
  window.katex = katex;
}

const decodeHtmlEntities = (str) => {
  if (!str) return '';
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
};

export const renderNotepadHtmlWithLatex = (rawContent) => {
  if (!rawContent || typeof rawContent !== 'string') return '';

  let html = repairCorruptedLatex(rawContent);

  // If plain text without HTML tags, wrap lines in paragraphs
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    html = html
      .split('\n')
      .map((line) => `<p>${line || '<br>'}</p>`)
      .join('');
  }

  // 1. Ensure Quill formula blots (<span class="ql-formula" data-value="...">) are rendered with KaTeX
  html = html.replace(
    /<span[^>]*class=["'][^"']*ql-formula[^"']*["'][^>]*data-value=["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi,
    (_match, rawVal) => {
      const formula = decodeHtmlEntities(rawVal).trim();
      if (!formula) return _match;
      try {
        const rendered = katex.renderToString(formula, { throwOnError: false, displayMode: false });
        return `<span class="ql-formula cue-math-expression" data-value="${rawVal}">${rendered}</span>`;
      } catch {
        return _match;
      }
    }
  );

  // 2. Render display math blocks ($$...$$ and \[...\]) even if split across <p> or <br> tags
  html = html.replace(
    /\$\$([\s\S]+?)\$\$|\\{1,2}\[([\s\S]+?)\\{1,2}\]/g,
    (fullMatch, dollarBlock, bracketBlock) => {
      const rawInner = dollarBlock ?? bracketBlock ?? '';
      const cleanedInner = decodeHtmlEntities(
        rawInner
          .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
      ).trim();

      if (!cleanedInner) return fullMatch;
      try {
        const rendered = katex.renderToString(cleanedInner, {
          throwOnError: false,
          displayMode: true
        });
        return `<span class="cue-math-expression cue-math-display" style="display:block;margin:0.75rem 0;text-align:center;overflow-x:auto;">${rendered}</span>`;
      } catch {
        return fullMatch;
      }
    }
  );

  // 3. Render inline math (\(...\) and $...$) inside text nodes (outside HTML tags)
  html = html
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (segment.startsWith('<')) return segment;
      if (!segment.includes('$') && !segment.includes('\\(')) return segment;
      return segment.replace(/\\{1,2}\(([\s\S]+?)\\{1,2}\)|\$([^$\n]+)\$/g, (m, parenInline, dollarInline) => {
        const rawFormula = parenInline ?? dollarInline ?? '';
        const cleanedFormula = decodeHtmlEntities(rawFormula).trim();
        if (!cleanedFormula) return m;
        try {
          const rendered = katex.renderToString(cleanedFormula, {
            throwOnError: false,
            displayMode: false
          });
          return `<span class="cue-math-expression" style="padding:0 2px;font-weight:600;">${rendered}</span>`;
        } catch {
          return m;
        }
      });
    })
    .join('');

  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['aria-hidden', 'style', 'target', 'data-value']
  });
};

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['blockquote', 'code-block'],
    ['link', 'formula'],
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
  'link',
  'formula'
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
  const [showPreview, setShowPreview] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  const quillRef = useRef(null);
  const splitContainerRef = useRef(null);
  const initialLoadedRef = useRef(false);
  const currentNoteIdRef = useRef(null);

  useEffect(() => {
    if (!isDraggingSplit) return;

    const handleMouseMove = (e) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relX = e.clientX - rect.left;
      const pct = Math.min(75, Math.max(25, (relX / rect.width) * 100));
      setSplitRatio(pct);
    };

    const handleMouseUp = () => {
      setIsDraggingSplit(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit]);

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

  const renderedMathHtml = useMemo(
    () => (showPreview ? renderNotepadHtmlWithLatex(content) : ''),
    [content, showPreview]
  );

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
        height: 'calc(100vh - 76px)',
        minHeight: '640px',
        maxWidth: '1680px',
        mx: 'auto',
        boxSizing: 'border-box',
        px: { xs: 2, sm: 3, md: 4 }
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

          {/* VSCODE-STYLE VERTICAL SPLIT PREVIEW BUTTON */}
          <Tooltip title={showPreview ? 'Hide Side-by-Side Preview' : 'Open Preview to the Side (LaTeX & Rich Text)'}>
            <Button
              data-testid="notepad-preview-toggle"
              size="small"
              variant={showPreview ? 'contained' : 'outlined'}
              startIcon={<Columns size={13} />}
              onClick={() => setShowPreview((prev) => !prev)}
              sx={{
                height: 28,
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.75rem',
                borderRadius: 2,
                px: 1.25,
                borderColor: currentTheme?.palette?.cardBorder
              }}
            >
              Preview
            </Button>
          </Tooltip>

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
        {hasLatexMath(title) && (
          <Box
            data-testid="course-notepad-title-math-preview"
            sx={{
              mt: 0.5,
              px: 1.2,
              py: 0.6,
              borderRadius: 1.5,
              bgcolor: currentTheme?.palette?.badgeBg || 'rgba(59, 130, 246, 0.06)',
              color: currentTheme?.palette?.textPrimary || '#0f172a',
              fontSize: '1.05rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                textTransform: 'uppercase',
                fontSize: '0.65rem',
                letterSpacing: '0.05em',
                color: currentTheme?.palette?.primary || '#3b82f6'
              }}
            >
              Title Math:
            </Typography>
            <Box component="span">
              <MathRenderer text={title} />
            </Box>
          </Box>
        )}
      </Box>

      {/* ========================================================================= */}
      {/* VISUAL WORD-STYLE RICH TEXT QUILL EDITOR & VSCODE VERTICAL SPLIT PREVIEW */}
      {/* ========================================================================= */}
      <Box
        ref={splitContainerRef}
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          position: 'relative',
          minHeight: 0,
          pb: 2,
          userSelect: isDraggingSplit ? 'none' : 'auto',
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
        <Box
          sx={{
            flex: showPreview ? { xs: '1 1 100%', md: `0 0 ${splitRatio}%` } : '1 1 100%',
            width: showPreview ? { xs: '100%', md: `${splitRatio}%` } : '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
            pr: showPreview ? { xs: 0, md: 1 } : 0
          }}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={content}
            onChange={handleContentChange}
            modules={QUILL_MODULES}
            formats={QUILL_FORMATS}
            placeholder="Start writing notes, formatting headings, lists, or LaTeX math ($...$ or $$...$$)..."
          />
        </Box>

        {showPreview && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor and preview panels"
              tabIndex={0}
              className={`workspace-split-resizer ${isDraggingSplit ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingSplit(true);
              }}
              onDoubleClick={() => setSplitRatio(50)}
              title="Drag to resize • Double-click to reset 50/50"
            />
            <Box
              data-testid="course-notepad-rendered-view"
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: '350px',
                minWidth: 0,
                ml: { xs: 0, md: 1 },
                mt: { xs: 2, md: 0 },
                borderRadius: '12px',
                border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.12)'}`,
                bgcolor: currentTheme?.palette?.surface || currentTheme?.palette?.cardBg || '#ffffff',
                overflow: 'hidden'
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderBottom: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(0,0,0,0.08)'}`,
                  bgcolor: currentTheme?.palette?.cardBg || '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Eye size={14} color={currentTheme?.palette?.primary || '#3b82f6'} />
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: currentTheme?.palette?.primary || '#3b82f6'
                    }}
                  >
                    Preview
                  </Typography>
                </Box>
                <Tooltip title="Close Preview">
                  <IconButton
                    size="small"
                    aria-label="Close Preview"
                    onClick={() => setShowPreview(false)}
                    sx={{ p: 0.4, color: currentTheme?.palette?.textSecondary || '#64748b' }}
                  >
                    <X size={14} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  p: 2.5,
                  color: currentTheme?.palette?.textPrimary || '#0f172a',
                  fontSize: '1.02rem',
                  lineHeight: 1.7,
                  '& p': { margin: '0 0 0.75rem 0' }
                }}
                dangerouslySetInnerHTML={{
                  __html:
                    renderedMathHtml ||
                    '<p style="color:#94a3b8;font-style:italic;">Nothing to preview yet. Write notes or LaTeX formulas ($...$ or $$...$$) to see them rendered.</p>'
                }}
              />
            </Box>
          </>
        )}
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
