import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Paper,
  Chip,
  Tooltip,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Sparkles,
  FolderOpen,
  Upload,
  Download,
  Edit3,
  Undo2,
  Send,
  Terminal,
  Eraser
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { API_BASE } from '../../utils/constants';
import {
  parseDraftToNotebookCells,
  notebookCellsToMarkdown
} from '../../utils/notebookUtils';

function sourceToString(src) {
  if (Array.isArray(src)) return src.join('');
  return String(src || '');
}

function stringToSourceLines(str) {
  const lines = String(str || '').split('\n');
  if (!lines.length) return [];
  return lines.map((ln, idx) => (idx < lines.length - 1 ? `${ln}\n` : ln));
}

function normalizeCells(notebookJson, draftMarkdown) {
  if (notebookJson && Array.isArray(notebookJson.cells) && notebookJson.cells.length > 0) {
    return notebookJson.cells.map((c) => ({
      cell_type: c.cell_type === 'code' ? 'code' : 'markdown',
      source: sourceToString(c.source),
      execution_count: c.execution_count ?? null,
      outputs: Array.isArray(c.outputs) ? c.outputs : [],
      metadata: c.metadata || {}
    }));
  }
  return parseDraftToNotebookCells(draftMarkdown).map((c) => ({
    cell_type: c.cell_type === 'code' ? 'code' : 'markdown',
    source: sourceToString(c.source),
    execution_count: null,
    outputs: [],
    metadata: {}
  }));
}

function buildNbPayload(cells) {
  return {
    cells: cells.map((c) =>
      c.cell_type === 'code'
        ? {
            cell_type: 'code',
            execution_count: c.execution_count ?? null,
            metadata: c.metadata || {},
            outputs: c.outputs || [],
            source: stringToSourceLines(c.source)
          }
        : {
            cell_type: 'markdown',
            metadata: c.metadata || {},
            source: stringToSourceLines(c.source)
          }
    ),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.10.0' }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
}

const ColabNotebookEditor = forwardRef(function ColabNotebookEditor({
  courseSlug,
  sessionId,
  title = 'Assignment_Notebook',
  draftMarkdown = '',
  notebookJson = null,
  selectedModel = '',
  userEmail = '',
  userName = '',
  compact = false,
  palette = {
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    primary: '#2563eb',
    textPrimary: '#0f172a',
    textSecondary: '#475569'
  },
  onNotebookChange,
  onSubmittedToLms
}, ref) {
  const [cells, setCells] = useState(() => normalizeCells(notebookJson, draftMarkdown));
  const [runningCellIdx, setRunningCellIdx] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [kernelState, setKernelState] = useState('idle');
  const [editingMdIdx, setEditingMdIdx] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [cellElapsedMs, setCellElapsedMs] = useState({});

  // Cell-aware Co-Pilot state
  const [assistingIdx, setAssistingIdx] = useState(null);
  const [cellSuggestions, setCellSuggestions] = useState({});
  const [undoHistory, setUndoHistory] = useState({});

  // Workspace Files drawer
  const [filesOpen, setFilesOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef(null);

  // LMS Submission state
  const [submittingLms, setSubmittingLms] = useState(false);
  const [lmsSubmittedMsg, setLmsSubmittedMsg] = useState(null);
  const [colabError, setColabError] = useState(null);

  const lastSyncedMdRef = useRef(draftMarkdown);

  // Sync when external draftMarkdown or notebookJson changes (e.g., from Co-Pilot chat)
  useEffect(() => {
    if (draftMarkdown !== lastSyncedMdRef.current) {
      lastSyncedMdRef.current = draftMarkdown;
      setCells(normalizeCells(notebookJson, draftMarkdown));
    }
  }, [draftMarkdown, notebookJson]);

  const baseStudioUrl =
    courseSlug && sessionId
      ? `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/notebook`
      : null;

  // Fetch workspace files when Files drawer opens or session changes
  const refreshFiles = async () => {
    if (!baseStudioUrl) return;
    try {
      const res = await fetch(`${baseStudioUrl}/files`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.files)) setWorkspaceFiles(data.files);
      }
    } catch {
      // Non-fatal
    }
  };

  useEffect(() => {
    if (filesOpen) refreshFiles();
  }, [filesOpen, baseStudioUrl]);

  const commitCells = (nextCells, persistToBackend = false) => {
    setCells(nextCells);
    const nbObj = buildNbPayload(nextCells);
    const syncedMd = notebookCellsToMarkdown(nextCells);
    lastSyncedMdRef.current = syncedMd;
    if (onNotebookChange) {
      onNotebookChange(nbObj, syncedMd);
    }
    if (persistToBackend && baseStudioUrl) {
      fetch(`${baseStudioUrl}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebook_json: nbObj, draft_markdown: syncedMd })
      }).catch(() => {});
    }
  };

  const handleCellSourceChange = (idx, newSource) => {
    const next = cells.map((c, i) => (i === idx ? { ...c, source: newSource } : c));
    commitCells(next, false);
  };

  const handleAddCell = (cellType, afterIdx = cells.length - 1) => {
    const newCell = {
      cell_type: cellType,
      source: cellType === 'code' ? '# New Python cell\n' : '### New Note\n',
      execution_count: null,
      outputs: [],
      metadata: {}
    };
    const next = [...cells];
    next.splice(afterIdx + 1, 0, newCell);
    commitCells(next, true);
    if (cellType === 'markdown') {
      setEditingMdIdx(afterIdx + 1);
    }
  };

  const handleDeleteCell = (idx) => {
    const next = cells.filter((_, i) => i !== idx);
    commitCells(next, true);
  };

  const handleMoveCell = (idx, delta) => {
    const target = idx + delta;
    if (target < 0 || target >= cells.length) return;
    const next = [...cells];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    commitCells(next, true);
  };

  const handleClearOutputs = () => {
    const next = cells.map((c) =>
      c.cell_type === 'code' ? { ...c, execution_count: null, outputs: [] } : c
    );
    commitCells(next, true);
  };

  const handleRunCell = async (idx) => {
    const cell = cells[idx];
    if (!cell || cell.cell_type !== 'code' || !baseStudioUrl) return;
    setRunningCellIdx(idx);
    setKernelState('running');
    setColabError(null);
    try {
      const nbObj = buildNbPayload(cells);
      const res = await fetch(`${baseStudioUrl}/execute-cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cell_index: idx,
          code: cell.source,
          notebook_json: nbObj
        })
      });
      if (!res.ok) throw new Error(`Cell execution failed (${res.status})`);
      const data = await res.json();
      const next = cells.map((c, i) =>
        i === idx
          ? {
              ...c,
              execution_count: data.execution_count ?? c.execution_count,
              outputs: Array.isArray(data.outputs) ? data.outputs : []
            }
          : c
      );
      setCellElapsedMs((prev) => ({ ...prev, [idx]: data.elapsed_ms }));
      if (Array.isArray(data.files)) setWorkspaceFiles(data.files);
      setKernelState(data.kernel?.state || 'idle');
      commitCells(next, false);
    } catch (err) {
      setColabError(err.message || 'Execution failed');
      setKernelState('idle');
    } finally {
      setRunningCellIdx(null);
    }
  };

  const handleRunAll = async () => {
    if (!baseStudioUrl || cells.length === 0) return;
    setRunningAll(true);
    setKernelState('running');
    setColabError(null);
    try {
      const res = await fetch(`${baseStudioUrl}/execute-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cells: cells.map((c) => ({ cell_type: c.cell_type, source: c.source, metadata: c.metadata })),
          restart_first: false
        })
      });
      if (!res.ok) throw new Error(`Run All failed (${res.status})`);
      const data = await res.json();
      if (data.notebook_json) {
        const next = normalizeCells(data.notebook_json, data.draft_markdown || draftMarkdown);
        commitCells(next, false);
      }
      if (Array.isArray(data.files)) setWorkspaceFiles(data.files);
      setKernelState(data.kernel?.state || 'idle');
    } catch (err) {
      setColabError(err.message || 'Run All failed');
      setKernelState('idle');
    } finally {
      setRunningAll(false);
    }
  };

  const handleRestartKernel = async () => {
    if (!baseStudioUrl) return;
    setColabError(null);
    try {
      const res = await fetch(`${baseStudioUrl}/kernel/restart`, { method: 'POST' });
      if (res.ok) {
        setKernelState('idle');
      }
    } catch (err) {
      setColabError(err.message || 'Kernel restart failed');
    }
  };

  const handleInterruptKernel = async () => {
    if (!baseStudioUrl) return;
    try {
      await fetch(`${baseStudioUrl}/kernel/interrupt`, { method: 'POST' });
    } catch {
      // Ignore
    }
  };

  const handleCellAssist = async (idx, action, errorTraceback = '') => {
    const cell = cells[idx];
    if (!cell || !baseStudioUrl) return;
    setAssistingIdx(idx);
    setColabError(null);
    try {
      const surrounding = cells.slice(Math.max(0, idx - 2), Math.min(cells.length, idx + 3));
      const res = await fetch(`${baseStudioUrl}/cell-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cell_source: cell.source,
          action,
          error_traceback: errorTraceback,
          surrounding_cells: surrounding,
          model_name: selectedModel || undefined
        })
      });
      if (!res.ok) throw new Error(`Co-Pilot assist failed (${res.status})`);
      const data = await res.json();
      setCellSuggestions((prev) => ({
        ...prev,
        [idx]: {
          action,
          explanation: data.explanation || '',
          updated_source: data.updated_source || cell.source
        }
      }));
    } catch (err) {
      setColabError(err.message || 'Cell Co-Pilot failed');
    } finally {
      setAssistingIdx(null);
    }
  };

  const handleApplySuggestion = (idx) => {
    const sug = cellSuggestions[idx];
    if (!sug) return;
    setUndoHistory((prev) => ({ ...prev, [idx]: cells[idx]?.source || '' }));
    const next = cells.map((c, i) => (i === idx ? { ...c, source: sug.updated_source } : c));
    commitCells(next, true);
    setCellSuggestions((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  };

  const handleUndoCell = (idx) => {
    if (undoHistory[idx] === undefined) return;
    const prevSource = undoHistory[idx];
    const next = cells.map((c, i) => (i === idx ? { ...c, source: prevSource } : c));
    commitCells(next, true);
    setUndoHistory((prev) => {
      const copy = { ...prev };
      delete copy[idx];
      return copy;
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !baseStudioUrl) return;
    setUploadingFile(true);
    setColabError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${baseStudioUrl}/files`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`File upload failed (${res.status})`);
      const data = await res.json();
      if (Array.isArray(data.files)) setWorkspaceFiles(data.files);
    } catch (err) {
      setColabError(err.message || 'File upload failed');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (filename) => {
    if (!baseStudioUrl) return;
    try {
      const res = await fetch(`${baseStudioUrl}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.files)) setWorkspaceFiles(data.files);
      }
    } catch {
      // Ignore
    }
  };

  const handleSubmitToLms = async () => {
    if (!baseStudioUrl || !userEmail) return;
    setSubmittingLms(true);
    setColabError(null);
    setLmsSubmittedMsg(null);
    try {
      const res = await fetch(`${baseStudioUrl}/submit-lms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_email: userEmail,
          student_name: userName || '',
          title,
          draft_markdown: notebookCellsToMarkdown(cells),
          notebook_json: buildNbPayload(cells)
        })
      });
      if (!res.ok) throw new Error(`LMS submission failed (${res.status})`);
      const data = await res.json();
      setLmsSubmittedMsg(`Submitted ${data.ipynb_filename || 'notebook.ipynb'} to Course LMS!`);
      if (onSubmittedToLms) onSubmittedToLms(data);
    } catch (err) {
      setColabError(err.message || 'Failed to submit to LMS');
    } finally {
      setSubmittingLms(false);
    }
  };

  useImperativeHandle(ref, () => ({
    runAll: () => handleRunAll(),
    addCell: (type) => handleAddCell(type),
    clearOutputs: () => handleClearOutputs(),
    restartKernel: () => handleRestartKernel(),
    interruptKernel: () => handleInterruptKernel(),
    toggleFiles: () => setFilesOpen((v) => !v),
    submitToLms: () => handleSubmitToLms(),
    getNotebookJson: () => buildNbPayload(cells),
    getMarkdown: () => notebookCellsToMarkdown(cells),
    getCells: () => cells
  }));

  const renderCellOutputs = (cell, idx) => {
    const outputs = cell.outputs || [];
    if (!outputs.length) return null;

    return (
      <Box
        data-testid="notebook-cell-outputs"
        sx={{
          bgcolor: '#f8fafc',
          borderTop: '1px solid #cbd5e1',
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        {outputs.map((out, oIdx) => {
          if (out.output_type === 'stream') {
            const text = Array.isArray(out.text) ? out.text.join('') : String(out.text || '');
            const isStderr = out.name === 'stderr';
            return (
              <Box
                key={oIdx}
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: isStderr ? 'rgba(245, 158, 11, 0.1)' : '#ffffff',
                  border: isStderr ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #e2e8f0',
                  color: isStderr ? '#92400e' : '#0f172a',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '0.78rem',
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto'
                }}
              >
                {text}
              </Box>
            );
          }

          if (out.output_type === 'display_data' || out.output_type === 'execute_result') {
            const data = out.data || {};
            if (data['image/png']) {
              return (
                <Box key={oIdx} sx={{ textAlign: 'center', bgcolor: '#ffffff', p: 1, borderRadius: 1, border: '1px solid #e2e8f0' }}>
                  <img
                    src={`data:image/png;base64,${data['image/png']}`}
                    alt={`Cell ${idx + 1} plot output`}
                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 4 }}
                  />
                </Box>
              );
            }
            if (data['text/html']) {
              const htmlStr = Array.isArray(data['text/html']) ? data['text/html'].join('') : String(data['text/html']);
              return (
                <Box
                  key={oIdx}
                  sx={{
                    overflowX: 'auto',
                    bgcolor: '#ffffff',
                    p: 1,
                    borderRadius: 1,
                    border: '1px solid #e2e8f0',
                    fontSize: '0.78rem',
                    '& table': { borderCollapse: 'collapse', width: '100%' },
                    '& th, & td': { border: '1px solid #cbd5e1', p: '4px 8px', textAlign: 'left' },
                    '& th': { bgcolor: '#f1f5f9', fontWeight: 700 }
                  }}
                  dangerouslySetInnerHTML={{ __html: htmlStr }}
                />
              );
            }
            if (data['text/plain']) {
              const plain = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : String(data['text/plain']);
              return (
                <Box
                  key={oIdx}
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1,
                    borderRadius: 1,
                    bgcolor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    color: '#1e293b',
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: '0.78rem',
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto'
                  }}
                >
                  {out.execution_count ? `Out[${out.execution_count}]: ` : ''}
                  {plain}
                </Box>
              );
            }
          }

          if (out.output_type === 'error') {
            const tb = Array.isArray(out.traceback) ? out.traceback.join('\n') : `${out.ename || 'Error'}: ${out.evalue || ''}`;
            return (
              <Box
                key={oIdx}
                sx={{
                  p: 1.25,
                  borderRadius: 1.5,
                  bgcolor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.35)'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
                  <Typography variant="caption" sx={{ fontWeight: 800, color: '#b91c1c' }}>
                    {out.ename || 'Error'}: {out.evalue || ''}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={assistingIdx === idx}
                    startIcon={assistingIdx === idx ? <CircularProgress size={12} color="inherit" /> : <Sparkles size={12} />}
                    onClick={() => handleCellAssist(idx, 'fix', tb)}
                    aria-label="Fix with Co-Pilot"
                    sx={{
                      textTransform: 'none',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      py: 0.25,
                      px: 1.2,
                      bgcolor: '#dc2626',
                      '&:hover': { bgcolor: '#b91c1c' }
                    }}
                  >
                    {assistingIdx === idx ? 'Diagnosing...' : 'Fix with Co-Pilot'}
                  </Button>
                </Box>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: '0.74rem',
                    color: '#991b1b',
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto'
                  }}
                >
                  {tb}
                </Box>
              </Box>
            );
          }
          return null;
        })}
      </Box>
    );
  };

  let codeCellCounter = 0;

  return (
    <Box data-testid="jupyter-notebook-preview" sx={{ maxWidth: compact ? '100%' : 920, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* COLAB RUNTIME TOOLBAR */}
      <Paper
        elevation={0}
        data-testid="colab-runtime-toolbar"
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 2,
          border: `1px solid ${palette.cardBorder}`,
          bgcolor: palette.cardBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="contained"
            disabled={runningAll || runningCellIdx !== null || !baseStudioUrl}
            onClick={handleRunAll}
            startIcon={runningAll ? <CircularProgress size={13} color="inherit" /> : <Play size={13} />}
            aria-label="Run All Cells"
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', py: 0.35, bgcolor: '#059669', '&:hover': { bgcolor: '#047857' } }}
          >
            {runningAll ? 'Running All...' : 'Run All'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => handleAddCell('code')}
            startIcon={<Plus size={13} />}
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.73rem', py: 0.3 }}
          >
            Code
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => handleAddCell('markdown')}
            startIcon={<Plus size={13} />}
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.73rem', py: 0.3 }}
          >
            Markdown
          </Button>
          <Tooltip title="Restart Python Kernel">
            <IconButton size="small" onClick={handleRestartKernel} aria-label="Restart Kernel" sx={{ color: palette.textSecondary }}>
              <RotateCcw size={14} />
            </IconButton>
          </Tooltip>
          {(runningAll || runningCellIdx !== null) && (
            <Tooltip title="Interrupt Execution">
              <IconButton size="small" onClick={handleInterruptKernel} aria-label="Interrupt Kernel" sx={{ color: '#dc2626' }}>
                <Square size={14} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Clear All Outputs">
            <IconButton size="small" onClick={handleClearOutputs} aria-label="Clear Outputs" sx={{ color: palette.textSecondary }}>
              <Eraser size={14} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            icon={<Terminal size={12} />}
            label={`Python 3 • ${kernelState}`}
            sx={{
              height: 24,
              fontSize: '0.7rem',
              fontWeight: 700,
              bgcolor: kernelState === 'running' ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)',
              color: kernelState === 'running' ? '#b45309' : '#047857'
            }}
          />
          <Button
            size="small"
            variant={filesOpen ? 'contained' : 'outlined'}
            startIcon={<FolderOpen size={13} />}
            onClick={() => setFilesOpen((v) => !v)}
            aria-label="Toggle Workspace Files"
            sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.73rem', py: 0.3 }}
          >
            Files{workspaceFiles.length > 0 ? ` (${workspaceFiles.length})` : ''}
          </Button>
          {userEmail && baseStudioUrl && (
            <Button
              size="small"
              variant="outlined"
              disabled={submittingLms}
              startIcon={submittingLms ? <CircularProgress size={12} /> : <Send size={12} />}
              onClick={handleSubmitToLms}
              aria-label="Submit Notebook to LMS"
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.73rem', py: 0.3, color: '#7c3aed', borderColor: '#8b5cf6' }}
            >
              {submittingLms ? 'Submitting...' : 'Submit to LMS'}
            </Button>
          )}
        </Box>
      </Paper>

      {colabError && (
        <Alert severity="error" onClose={() => setColabError(null)} sx={{ py: 0.4, fontSize: '0.8rem' }}>
          {colabError}
        </Alert>
      )}
      {lmsSubmittedMsg && (
        <Alert severity="success" onClose={() => setLmsSubmittedMsg(null)} sx={{ py: 0.4, fontSize: '0.8rem' }}>
          {lmsSubmittedMsg}
        </Alert>
      )}

      {/* COLLAPSIBLE WORKSPACE FILES DRAWER */}
      {filesOpen && (
        <Paper
          elevation={0}
          data-testid="colab-files-drawer"
          sx={{
            p: 1.5,
            borderRadius: 2,
            border: `1px solid ${palette.cardBorder}`,
            bgcolor: '#f8fafc'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: palette.textPrimary }}>
              SESSION WORKSPACE FILES (mounted in kernel working directory)
            </Typography>
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <Button
                size="small"
                variant="contained"
                disabled={uploadingFile}
                startIcon={uploadingFile ? <CircularProgress size={12} color="inherit" /> : <Upload size={12} />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', py: 0.25 }}
              >
                {uploadingFile ? 'Uploading...' : 'Upload Dataset'}
              </Button>
            </Box>
          </Box>
          {workspaceFiles.length === 0 ? (
            <Typography variant="caption" sx={{ color: palette.textSecondary }}>
              No files uploaded yet. Upload CSV/JSON/Excel datasets or run code that saves files to see them here.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {workspaceFiles.map((f) => (
                <Box
                  key={f.filename}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1.2,
                    py: 0.6,
                    bgcolor: '#ffffff',
                    borderRadius: 1,
                    border: '1px solid #e2e8f0'
                  }}
                >
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f172a', display: 'block' }}>
                      {f.filename} <span style={{ color: '#64748b', fontWeight: 500 }}>({(f.size_bytes / 1024).toFixed(1)} KB)</span>
                    </Typography>
                    {Array.isArray(f.columns) && f.columns.length > 0 && (
                      <Typography variant="caption" sx={{ color: '#475569', fontSize: '0.68rem' }}>
                        Columns: {f.columns.slice(0, 8).join(', ')}{f.columns.length > 8 ? '…' : ''}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {baseStudioUrl && (
                      <Tooltip title="Download file">
                        <IconButton
                          size="small"
                          component="a"
                          href={`${baseStudioUrl}/files/${encodeURIComponent(f.filename)}`}
                          download={f.filename}
                        >
                          <Download size={13} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Delete file">
                      <IconButton size="small" onClick={() => handleDeleteFile(f.filename)} sx={{ color: '#dc2626' }}>
                        <Trash2 size={13} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* NOTEBOOK CELLS */}
      {cells.map((cell, idx) => {
        if (cell.cell_type === 'code') {
          codeCellCounter += 1;
          const displayNum = cell.execution_count ?? codeCellCounter;
          const isThisRunning = runningCellIdx === idx;
          const lineCount = Math.max(2, (cell.source || '').split('\n').length);
          const suggestion = cellSuggestions[idx];

          return (
            <Paper
              key={`code-${idx}`}
              elevation={0}
              data-testid="notebook-code-cell"
              sx={{
                borderRadius: 2,
                border: '1px solid #cbd5e1',
                overflow: 'hidden',
                bgcolor: '#0f172a'
              }}
            >
              {/* Code Cell Header */}
              <Box
                sx={{
                  px: 1.5,
                  py: 0.6,
                  bgcolor: '#1e293b',
                  borderBottom: '1px solid #334155',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 0.5
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Tooltip title="Run cell (Shift+Enter)">
                    <IconButton
                      size="small"
                      disabled={isThisRunning || runningAll || !baseStudioUrl}
                      onClick={() => handleRunCell(idx)}
                      aria-label={`Run code cell ${codeCellCounter}`}
                      sx={{
                        bgcolor: 'rgba(16,185,129,0.2)',
                        color: '#34d399',
                        p: 0.45,
                        '&:hover': { bgcolor: 'rgba(16,185,129,0.35)' }
                      }}
                    >
                      {isThisRunning ? <CircularProgress size={12} color="inherit" /> : <Play size={12} />}
                    </IconButton>
                  </Tooltip>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      color: '#38bdf8',
                      fontWeight: 700,
                      fontSize: '0.74rem'
                    }}
                  >
                    In [{displayNum}]: &nbsp;Python
                  </Typography>
                  {cellElapsedMs[idx] && (
                    <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
                      {cellElapsedMs[idx]} ms
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                  <Button
                    size="small"
                    disabled={assistingIdx === idx || !baseStudioUrl}
                    onClick={() => handleCellAssist(idx, 'explain')}
                    sx={{ minWidth: 0, px: 0.8, py: 0.1, color: '#cbd5e1', fontSize: '0.68rem', textTransform: 'none' }}
                  >
                    Explain
                  </Button>
                  <Button
                    size="small"
                    disabled={assistingIdx === idx || !baseStudioUrl}
                    onClick={() => handleCellAssist(idx, 'visualize')}
                    sx={{ minWidth: 0, px: 0.8, py: 0.1, color: '#cbd5e1', fontSize: '0.68rem', textTransform: 'none' }}
                  >
                    Plot
                  </Button>
                  {undoHistory[idx] !== undefined && (
                    <Tooltip title="Undo Co-Pilot edit">
                      <IconButton size="small" onClick={() => handleUndoCell(idx)} sx={{ color: '#fbbf24', p: 0.35 }}>
                        <Undo2 size={12} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Move up">
                    <IconButton size="small" onClick={() => handleMoveCell(idx, -1)} disabled={idx === 0} sx={{ color: '#94a3b8', p: 0.35 }}>
                      <ArrowUp size={12} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Move down">
                    <IconButton size="small" onClick={() => handleMoveCell(idx, 1)} disabled={idx === cells.length - 1} sx={{ color: '#94a3b8', p: 0.35 }}>
                      <ArrowDown size={12} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Copy code cell">
                    <IconButton
                      size="small"
                      aria-label={`Copy code cell ${codeCellCounter}`}
                      onClick={() => {
                        navigator.clipboard.writeText(cell.source || '');
                        setCopiedIdx(idx);
                        setTimeout(() => setCopiedIdx(null), 1600);
                      }}
                      sx={{ color: copiedIdx === idx ? '#34d399' : '#94a3b8', p: 0.35 }}
                    >
                      {copiedIdx === idx ? <Check size={12} /> : <Copy size={12} />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete cell">
                    <IconButton size="small" onClick={() => handleDeleteCell(idx)} sx={{ color: '#f87171', p: 0.35 }}>
                      <Trash2 size={12} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Editable Code Input */}
              <Box sx={{ p: compact ? 1 : 1.25 }}>
                <textarea
                  value={cell.source}
                  onChange={(e) => handleCellSourceChange(idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault();
                      handleRunCell(idx);
                    } else if (e.key === 'Tab') {
                      e.preventDefault();
                      const el = e.target;
                      const start = el.selectionStart;
                      const end = el.selectionEnd;
                      const updated = cell.source.slice(0, start) + '    ' + cell.source.slice(end);
                      handleCellSourceChange(idx, updated);
                    }
                  }}
                  rows={Math.min(28, lineCount + 1)}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    color: '#e2e8f0',
                    border: 'none',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: compact ? '0.78rem' : '0.84rem',
                    lineHeight: 1.55
                  }}
                />
              </Box>

              {/* Cell Co-Pilot Suggestion Banner */}
              {suggestion && (
                <Box
                  sx={{
                    px: 1.5,
                    py: 1,
                    bgcolor: '#1e1b4b',
                    borderTop: '1px solid #4338ca',
                    color: '#e0e7ff'
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#a5b4fc' }}>
                      Co-Pilot ({suggestion.action})
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      {suggestion.action !== 'explain' && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleApplySuggestion(idx)}
                          sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.2, bgcolor: '#4f46e5' }}
                        >
                          Apply Code
                        </Button>
                      )}
                      <Button
                        size="small"
                        onClick={() =>
                          setCellSuggestions((prev) => {
                            const copy = { ...prev };
                            delete copy[idx];
                            return copy;
                          })
                        }
                        sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.2, color: '#c7d2fe' }}
                      >
                        Dismiss
                      </Button>
                    </Box>
                  </Box>
                  <Typography variant="caption" sx={{ display: 'block', color: '#e0e7ff', fontSize: '0.76rem' }}>
                    {suggestion.explanation}
                  </Typography>
                </Box>
              )}

              {/* Inline Cell Outputs */}
              {renderCellOutputs(cell, idx)}
            </Paper>
          );
        }

        // Markdown Cell
        const isEditingMd = editingMdIdx === idx;
        return (
          <Paper
            key={`md-${idx}`}
            elevation={0}
            data-testid="notebook-markdown-cell"
            onDoubleClick={() => setEditingMdIdx(idx)}
            sx={{
              p: compact ? 1.5 : 2,
              borderRadius: 2,
              border: `1px solid ${palette.cardBorder}`,
              borderLeft: '3px solid #3b82f6',
              bgcolor: palette.cardBg,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              color: '#0f172a',
              lineHeight: 1.65
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.3, mb: 0.5 }}>
              <Tooltip title={isEditingMd ? 'Render Markdown' : 'Edit Markdown'}>
                <IconButton size="small" onClick={() => setEditingMdIdx(isEditingMd ? null : idx)} sx={{ p: 0.3, color: palette.textSecondary }}>
                  <Edit3 size={12} />
                </IconButton>
              </Tooltip>
              <IconButton size="small" onClick={() => handleMoveCell(idx, -1)} disabled={idx === 0} sx={{ p: 0.3, color: palette.textSecondary }}>
                <ArrowUp size={12} />
              </IconButton>
              <IconButton size="small" onClick={() => handleMoveCell(idx, 1)} disabled={idx === cells.length - 1} sx={{ p: 0.3, color: palette.textSecondary }}>
                <ArrowDown size={12} />
              </IconButton>
              <IconButton size="small" onClick={() => handleDeleteCell(idx)} sx={{ p: 0.3, color: '#dc2626' }}>
                <Trash2 size={12} />
              </IconButton>
            </Box>

            {isEditingMd ? (
              <textarea
                autoFocus
                value={cell.source}
                onChange={(e) => handleCellSourceChange(idx, e.target.value)}
                onBlur={() => {
                  setEditingMdIdx(null);
                  commitCells(cells, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    setEditingMdIdx(null);
                    commitCells(cells, true);
                  }
                }}
                rows={Math.max(3, (cell.source || '').split('\n').length + 1)}
                style={{
                  width: '100%',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '0.84rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: 8,
                  outline: 'none'
                }}
              />
            ) : (
              <Box
                sx={{
                  '& h1': { fontSize: compact ? '1.3rem' : '1.5rem', fontWeight: 800, mt: 0.5, mb: 1.2, color: '#0f172a' },
                  '& h2': { fontSize: compact ? '1.08rem' : '1.2rem', fontWeight: 700, mt: 1.5, mb: 0.8, color: '#1e40af' },
                  '& h3': { fontSize: '0.98rem', fontWeight: 700, mt: 1.2, mb: 0.6, color: '#0f172a' },
                  '& p': { fontSize: compact ? '0.88rem' : '0.94rem', mb: 1.2 },
                  '& ul, & ol': { pl: 2.5, mb: 1.2 },
                  '& table': { width: '100%', borderCollapse: 'collapse', my: 1.5, fontSize: '0.82rem' },
                  '& th, & td': { border: '1px solid #cbd5e1', p: '6px 10px', textAlign: 'left' },
                  '& th': { bgcolor: '#f8fafc', fontWeight: 700 },
                  '& code': { bgcolor: '#f1f5f9', px: 0.6, py: 0.2, borderRadius: 0.8, fontSize: '0.84em' }
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {cell.source}
                </ReactMarkdown>
              </Box>
            )}
          </Paper>
        );
      })}
    </Box>
  );
});

export default ColabNotebookEditor;
