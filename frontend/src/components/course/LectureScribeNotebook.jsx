import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import {
  ArrowLeft,
  Download,
  FileText,
  FolderOpen,
  List,
  Plus,
  Play,
  RotateCcw,
  Square,
  Eraser,
  CheckCircle2,
  Code2,
  FilePlus2,
  Send
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import { downloadDraftAsIpynb, downloadIpynbObject } from '../../utils/notebookUtils';
import ColabNotebookEditor from './ColabNotebookEditor';

export default function LectureScribeNotebook({
  courseName = 'Active Course',
  initialSessionId = null,
  onClose,
  onAssignmentUpdated,
  currentTheme,
  userEmail = '',
  userName = ''
}) {
  const courseSlug = normalizeCourseSlug(courseName);
  const editorRef = useRef(null);

  const [sessionId, setSessionId] = useState(initialSessionId);
  const [title, setTitle] = useState('Untitled_Notebook.ipynb');
  const [draftMarkdown, setDraftMarkdown] = useState('```python\n\n```');
  const [notebookJson, setNotebookJson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingTitle, setSavingTitle] = useState(false);
  const [downloadingIpynb, setDownloadingIpynb] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusNotice, setStatusNotice] = useState(null);

  // Colab-style menu anchors
  const [fileMenuAnchor, setFileMenuAnchor] = useState(null);
  const [editMenuAnchor, setEditMenuAnchor] = useState(null);
  const [insertMenuAnchor, setInsertMenuAnchor] = useState(null);
  const [runtimeMenuAnchor, setRuntimeMenuAnchor] = useState(null);

  const palette = currentTheme?.palette || {
    primary: '#1a73e8',
    cardBg: '#ffffff',
    cardBorder: '#dadce0',
    textPrimary: '#202124',
    textSecondary: '#5f6368'
  };

  const initBlankNotebook = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/notebook/new`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: userEmail || undefined,
            title: 'Untitled_Notebook.ipynb'
          })
        }
      );
      if (!res.ok) throw new Error(`Could not initialize notebook (${res.status})`);
      const data = await res.json();
      setSessionId(data.session_id);
      setTitle(data.title || 'Untitled_Notebook.ipynb');
      setDraftMarkdown(data.draft_markdown || '```python\n\n```');
      setNotebookJson(data.notebook_json || null);
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err) {
      console.error('Notebook init error:', err);
      setErrorMsg(err.message || 'Failed to create a new notebook session.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (initialSessionId && initialSessionId !== 'new') {
        setLoading(true);
        try {
          const res = await fetch(
            `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(initialSessionId)}`
          );
          if (!res.ok) throw new Error(`Could not load notebook (${res.status})`);
          const data = await res.json();
          if (!cancelled) {
            setSessionId(data.session_id);
            setTitle(data.title || 'Untitled_Notebook.ipynb');
            setDraftMarkdown(data.draft_markdown || '```python\n\n```');
            setNotebookJson(data.notebook_json || null);
            setLoading(false);
          }
          return;
        } catch (err) {
          if (!cancelled) setErrorMsg(err.message || 'Failed to load notebook.');
        }
      }
      if (!cancelled) {
        await initBlankNotebook();
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [courseSlug, initialSessionId]);

  // Extract Markdown headings for the Colab-style Table of Contents sidebar
  const tocHeadings = useMemo(() => {
    const cells = notebookJson?.cells || [];
    const headings = [];
    cells.forEach((cell, idx) => {
      if (cell.cell_type !== 'markdown') return;
      const text = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
      text.split('\n').forEach((line) => {
        const m = line.match(/^(#{1,3})\s+(.+)/);
        if (m) {
          headings.push({ level: m[1].length, text: m[2].trim(), cellIdx: idx });
        }
      });
    });
    return headings;
  }, [notebookJson, draftMarkdown]);

  const handleTitleBlur = async () => {
    const cleanTitle = title.trim() || 'Untitled_Notebook.ipynb';
    setTitle(cleanTitle);
    if (!sessionId) return;
    setSavingTitle(true);
    try {
      const nbObj = editorRef.current?.getNotebookJson() || notebookJson;
      const md = editorRef.current?.getMarkdown() || draftMarkdown;
      await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/notebook/state`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notebook_json: nbObj || { cells: [], nbformat: 4, nbformat_minor: 5 }, draft_markdown: md })
        }
      );
    } catch {
      // Non-fatal
    } finally {
      setSavingTitle(false);
    }
  };

  const handleDownloadIpynb = async () => {
    setFileMenuAnchor(null);
    const currentMd = editorRef.current?.getMarkdown() || draftMarkdown;
    if (!sessionId) {
      downloadDraftAsIpynb(currentMd, title);
      return;
    }
    setDownloadingIpynb(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/compile-ipynb`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || 'Untitled_Notebook.ipynb',
            draft_markdown: currentMd,
            execute: true
          })
        }
      );
      if (!res.ok) throw new Error(`Compile failed (${res.status})`);
      const data = await res.json();
      if (data.notebook_json) {
        downloadIpynbObject(data.notebook_json, data.ipynb_filename || title);
      } else {
        downloadDraftAsIpynb(currentMd, title);
      }
      setStatusNotice(`Downloaded ${data.ipynb_filename || title}`);
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch {
      downloadDraftAsIpynb(currentMd, title);
    } finally {
      setDownloadingIpynb(false);
    }
  };

  const handleExportPdf = async () => {
    setFileMenuAnchor(null);
    if (!sessionId) return;
    setExportingPdf(true);
    setErrorMsg(null);
    try {
      const currentMd = editorRef.current?.getMarkdown() || draftMarkdown;
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/compile-pdf`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || 'Untitled_Notebook',
            author: userName || userEmail || undefined,
            draft_markdown: currentMd
          })
        }
      );
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
      const pdfUrl = `${API_BASE}/api/course/assignment/${encodeURIComponent(sessionId)}/download/pdf`;
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      setStatusNotice('Exported notebook PDF.');
    } catch (err) {
      setErrorMsg(err.message || 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <Box
      data-testid="lecturescribe-notebook-workspace"
      sx={{
        width: '100%',
        height: 'calc(100vh - 110px)',
        minHeight: 660,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#f8f9fa',
        border: '1px solid #dadce0',
        borderRadius: 2,
        overflow: 'hidden'
      }}
    >
      {/* GOOGLE COLAB-STYLE TOP HEADER & MENU BAR */}
      <Box
        sx={{
          bgcolor: '#ffffff',
          borderBottom: '1px solid #dadce0',
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Tooltip title="Back to Assignments">
            <IconButton size="small" onClick={onClose} aria-label="Back to Assignments" sx={{ color: '#5f6368' }}>
              <ArrowLeft size={18} />
            </IconButton>
          </Tooltip>

          {/* Iconic Colab-style Amber/Orange Logo Badge */}
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #f9ab00 0%, #e37400 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 900,
              fontSize: '0.85rem',
              letterSpacing: '-0.5px',
              boxShadow: '0 2px 6px rgba(227, 116, 0, 0.3)',
              flexShrink: 0
            }}
          >
            LN
          </Box>

          <Box>
            {/* Inline Editable Notebook Filename */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <input
                aria-label="Notebook filename"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                style={{
                  border: '1px solid transparent',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: '0.96rem',
                  fontWeight: 700,
                  color: '#202124',
                  background: 'transparent',
                  minWidth: 220,
                  outline: 'none'
                }}
              />
              {savingTitle && <Typography variant="caption" sx={{ color: '#5f6368' }}>Saving…</Typography>}
              <Chip
                size="small"
                label={courseName}
                sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, bgcolor: '#f1f3f4', color: '#3c4043' }}
              />
            </Box>

            {/* Classic Colab Menu Bar: File | Edit | Insert | Runtime */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.2 }}>
              <Button size="small" onClick={(e) => setFileMenuAnchor(e.currentTarget)} sx={{ minWidth: 0, px: 1, py: 0.15, textTransform: 'none', fontSize: '0.76rem', color: '#3c4043' }}>
                File
              </Button>
              <Menu anchorEl={fileMenuAnchor} open={Boolean(fileMenuAnchor)} onClose={() => setFileMenuAnchor(null)}>
                <MenuItem onClick={() => { setFileMenuAnchor(null); initBlankNotebook(); }}>
                  <FilePlus2 size={14} style={{ marginRight: 8 }} /> New notebook
                </MenuItem>
                <MenuItem onClick={handleDownloadIpynb}>
                  <Download size={14} style={{ marginRight: 8 }} /> Download .ipynb
                </MenuItem>
                <MenuItem onClick={handleExportPdf} disabled={exportingPdf}>
                  <FileText size={14} style={{ marginRight: 8 }} /> Export PDF
                </MenuItem>
                {userEmail && (
                  <MenuItem onClick={() => { setFileMenuAnchor(null); editorRef.current?.submitToLms(); }}>
                    <Send size={14} style={{ marginRight: 8 }} /> Submit to Course LMS
                  </MenuItem>
                )}
              </Menu>

              <Button size="small" onClick={(e) => setEditMenuAnchor(e.currentTarget)} sx={{ minWidth: 0, px: 1, py: 0.15, textTransform: 'none', fontSize: '0.76rem', color: '#3c4043' }}>
                Edit
              </Button>
              <Menu anchorEl={editMenuAnchor} open={Boolean(editMenuAnchor)} onClose={() => setEditMenuAnchor(null)}>
                <MenuItem onClick={() => { setEditMenuAnchor(null); editorRef.current?.clearOutputs(); }}>
                  <Eraser size={14} style={{ marginRight: 8 }} /> Clear all outputs
                </MenuItem>
              </Menu>

              <Button size="small" onClick={(e) => setInsertMenuAnchor(e.currentTarget)} sx={{ minWidth: 0, px: 1, py: 0.15, textTransform: 'none', fontSize: '0.76rem', color: '#3c4043' }}>
                Insert
              </Button>
              <Menu anchorEl={insertMenuAnchor} open={Boolean(insertMenuAnchor)} onClose={() => setInsertMenuAnchor(null)}>
                <MenuItem onClick={() => { setInsertMenuAnchor(null); editorRef.current?.addCell('code'); }}>
                  <Code2 size={14} style={{ marginRight: 8 }} /> Code cell
                </MenuItem>
                <MenuItem onClick={() => { setInsertMenuAnchor(null); editorRef.current?.addCell('markdown'); }}>
                  <Plus size={14} style={{ marginRight: 8 }} /> Text cell (Markdown)
                </MenuItem>
              </Menu>

              <Button size="small" onClick={(e) => setRuntimeMenuAnchor(e.currentTarget)} sx={{ minWidth: 0, px: 1, py: 0.15, textTransform: 'none', fontSize: '0.76rem', color: '#3c4043' }}>
                Runtime
              </Button>
              <Menu anchorEl={runtimeMenuAnchor} open={Boolean(runtimeMenuAnchor)} onClose={() => setRuntimeMenuAnchor(null)}>
                <MenuItem onClick={() => { setRuntimeMenuAnchor(null); editorRef.current?.runAll(); }}>
                  <Play size={14} style={{ marginRight: 8 }} /> Run all
                </MenuItem>
                <MenuItem onClick={() => { setRuntimeMenuAnchor(null); editorRef.current?.interruptKernel(); }}>
                  <Square size={14} style={{ marginRight: 8 }} /> Interrupt execution
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { setRuntimeMenuAnchor(null); editorRef.current?.restartKernel(); }}>
                  <RotateCcw size={14} style={{ marginRight: 8 }} /> Restart runtime
                </MenuItem>
              </Menu>
            </Box>
          </Box>
        </Box>

        {/* Right Header Controls: Connected Status + Download .ipynb */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Chip
            size="small"
            icon={<CheckCircle2 size={13} color="#188038" />}
            label="Python 3 • Connected"
            sx={{
              height: 28,
              bgcolor: '#e6f4ea',
              color: '#137333',
              fontWeight: 700,
              fontSize: '0.73rem',
              border: '1px solid #ceead6'
            }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={downloadingIpynb || loading}
            onClick={handleDownloadIpynb}
            startIcon={downloadingIpynb ? <CircularProgress size={13} color="inherit" /> : <Download size={14} />}
            aria-label="Download .ipynb"
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.76rem',
              bgcolor: '#1a73e8',
              '&:hover': { bgcolor: '#1557b0' },
              borderRadius: 1.5,
              px: 1.8
            }}
          >
            {downloadingIpynb ? 'Building .ipynb…' : 'Download .ipynb'}
          </Button>
        </Box>
      </Box>

      {/* BODY: COLAB LEFT ICON RAIL + OPTIONAL TOC SIDEBAR + CENTERED NOTEBOOK CANVAS */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Vertical Icon Rail (44px, Google Colab signature) */}
        <Box
          sx={{
            width: 44,
            bgcolor: '#ffffff',
            borderRight: '1px solid #dadce0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            py: 1.5,
            gap: 1,
            flexShrink: 0
          }}
        >
          <Tooltip title="Table of contents" placement="right">
            <IconButton
              size="small"
              onClick={() => setTocOpen((v) => !v)}
              aria-label="Toggle Table of Contents"
              sx={{ color: tocOpen ? '#1a73e8' : '#5f6368', bgcolor: tocOpen ? 'rgba(26,115,232,0.1)' : 'transparent' }}
            >
              <List size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Files" placement="right">
            <IconButton
              size="small"
              onClick={() => editorRef.current?.toggleFiles()}
              aria-label="Open Workspace Files"
              sx={{ color: '#5f6368' }}
            >
              <FolderOpen size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Run all cells" placement="right">
            <IconButton
              size="small"
              onClick={() => editorRef.current?.runAll()}
              aria-label="Rail Run All"
              sx={{ color: '#188038' }}
            >
              <Play size={18} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Optional Table of Contents Sidebar */}
        {tocOpen && (
          <Box
            data-testid="colab-toc-sidebar"
            sx={{
              width: 220,
              bgcolor: '#ffffff',
              borderRight: '1px solid #dadce0',
              p: 1.5,
              overflowY: 'auto',
              flexShrink: 0
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, color: '#3c4043', display: 'block', mb: 1 }}>
              TABLE OF CONTENTS
            </Typography>
            {tocHeadings.length === 0 ? (
              <Typography variant="caption" sx={{ color: '#5f6368' }}>
                Add Markdown headings (# Section) to populate the outline.
              </Typography>
            ) : (
              tocHeadings.map((h, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  sx={{
                    display: 'block',
                    pl: (h.level - 1) * 1.2,
                    py: 0.4,
                    color: '#202124',
                    fontWeight: h.level === 1 ? 700 : 500,
                    fontSize: '0.76rem'
                  }}
                >
                  {h.text}
                </Typography>
              ))
            )}
          </Box>
        )}

        {/* Centered Colab Notebook Canvas */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 } }}>
          {errorMsg && (
            <Alert severity="error" onClose={() => setErrorMsg(null)} sx={{ maxWidth: 920, mx: 'auto', mb: 2 }}>
              {errorMsg}
            </Alert>
          )}
          {statusNotice && (
            <Alert severity="success" onClose={() => setStatusNotice(null)} sx={{ maxWidth: 920, mx: 'auto', mb: 2 }}>
              {statusNotice}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 12, gap: 1.5 }}>
              <CircularProgress size={28} sx={{ color: '#e37400' }} />
              <Typography variant="body2" sx={{ color: '#5f6368', fontWeight: 600 }}>
                Connecting to Python 3 Runtime…
              </Typography>
            </Box>
          ) : (
            <>
              <ColabNotebookEditor
                ref={editorRef}
                courseSlug={courseSlug}
                sessionId={sessionId}
                title={title}
                draftMarkdown={draftMarkdown}
                notebookJson={notebookJson}
                userEmail={userEmail}
                userName={userName}
                palette={palette}
                onNotebookChange={(nbObj, syncedMd) => {
                  setNotebookJson(nbObj);
                  setDraftMarkdown(syncedMd);
                }}
                onSubmittedToLms={() => {
                  if (onAssignmentUpdated) onAssignmentUpdated();
                }}
              />

              {/* Colab-style Bottom + Code / + Text Quick Insert Bar */}
              <Box sx={{ maxWidth: 920, mx: 'auto', mt: 2, display: 'flex', justifyContent: 'center', gap: 1.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Plus size={14} />}
                  onClick={() => editorRef.current?.addCell('code')}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    bgcolor: '#ffffff',
                    color: '#3c4043',
                    borderColor: '#dadce0',
                    '&:hover': { bgcolor: '#f1f3f4', borderColor: '#bdc1c6' }
                  }}
                >
                  + Code
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Plus size={14} />}
                  onClick={() => editorRef.current?.addCell('markdown')}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    bgcolor: '#ffffff',
                    color: '#3c4043',
                    borderColor: '#dadce0',
                    '&:hover': { bgcolor: '#f1f3f4', borderColor: '#bdc1c6' }
                  }}
                >
                  + Text
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
