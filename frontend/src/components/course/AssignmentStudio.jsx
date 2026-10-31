import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  TextField,
  Chip,
  Paper,
  Divider,
  CircularProgress,
  Tooltip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel
} from '@mui/material';
import {
  ArrowLeft,
  Sparkles,
  Send,
  Download,
  FileText,
  FileCode,
  Edit3,
  Eye,
  Columns,
  CheckCircle2,
  Clock,
  BookOpen,
  RotateCcw,
  RefreshCw,
  Copy,
  Check,
  Cpu
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';

export default function AssignmentStudio({
  courseName = 'Active Course',
  initialSessionId = null,
  onClose,
  onSessionChange,
  onAssignmentUpdated,
  currentTheme,
  isTutor = false,
  userEmail = '',
  userName = ''
}) {
  const courseSlug = normalizeCourseSlug(courseName);

  // Storage Keys for persistent progress across tab switches and refreshes
  const activeSessionKey = `lecturescribe_active_studio_session_${courseSlug}`;
  const setupStorageKey = `lecturescribe_studio_draft_setup_${courseSlug}`;
  const editorModeKey = `lecturescribe_studio_editor_mode_${courseSlug}`;

  // Studio State - restore active session from props or localStorage
  const [sessionId, setSessionId] = useState(() => {
    if (initialSessionId) return initialSessionId;
    try {
      if (typeof window !== 'undefined' && courseSlug) {
        const saved = localStorage.getItem(activeSessionKey);
        if (saved && saved !== 'new') return saved;
      }
    } catch (e) {}
    return null;
  });

  const [title, setTitle] = useState('');
  const [problemPrompt, setProblemPrompt] = useState('');
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [citations, setCitations] = useState([]);
  const [studioStatus, setStudioStatus] = useState('discussing');
  const [pdfBlobName, setPdfBlobName] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');

  // UI state
  const [loadingSession, setLoadingSession] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [compilingPdf, setCompilingPdf] = useState(false);
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState(null);
  const [editorMode, setEditorMode] = useState(() => {
    try {
      if (typeof window !== 'undefined' && courseSlug) {
        return localStorage.getItem(editorModeKey) || 'preview';
      }
    } catch (e) {}
    return 'preview';
  });
  const [savingDraft, setSavingDraft] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const chatBottomRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const latestDraftRef = useRef(draftMarkdown);
  latestDraftRef.current = draftMarkdown;
  const fetchedSessionRef = useRef(null);

  const palette = currentTheme?.palette || {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  const inputStorageKey = sessionId ? `lecturescribe_studio_input_${courseSlug}_${sessionId}` : null;
  const draftStorageKey = sessionId ? `lecturescribe_studio_draft_${courseSlug}_${sessionId}` : null;

  // Scroll chat to bottom
  const scrollToBottom = () => {
    if (typeof chatBottomRef.current?.scrollIntoView === 'function') {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, sendingMessage]);

  // Restore unsaved problem prompt / title when on the setup screen
  useEffect(() => {
    if (sessionId) return;
    try {
      const saved = localStorage.getItem(setupStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.title) setTitle(parsed.title);
        if (parsed.problemPrompt) {
          setProblemPrompt(parsed.problemPrompt);
          setHasRestoredDraft(true);
        }
        if (parsed.selectedModel) setSelectedModel(parsed.selectedModel);
      }
    } catch (e) {}
  }, [sessionId, setupStorageKey]);

  const handleTitleChange = (val) => {
    setTitle(val);
    if (!sessionId && courseSlug) {
      try {
        const current = JSON.parse(localStorage.getItem(setupStorageKey) || '{}');
        localStorage.setItem(setupStorageKey, JSON.stringify({ ...current, title: val }));
      } catch (e) {}
    }
  };

  const handlePromptChange = (val) => {
    setProblemPrompt(val);
    if (!sessionId && courseSlug) {
      try {
        const current = JSON.parse(localStorage.getItem(setupStorageKey) || '{}');
        localStorage.setItem(setupStorageKey, JSON.stringify({ ...current, problemPrompt: val }));
      } catch (e) {}
    }
  };

  const handleClearDraftSetup = () => {
    setTitle('');
    setProblemPrompt('');
    setHasRestoredDraft(false);
    try {
      localStorage.removeItem(setupStorageKey);
    } catch (e) {}
  };

  // Restore unsent message input if user was typing in chat and switched tabs
  useEffect(() => {
    if (!inputStorageKey) return;
    try {
      const savedInput = localStorage.getItem(inputStorageKey);
      if (savedInput) {
        setMessageInput(savedInput);
      }
    } catch (e) {}
  }, [inputStorageKey]);

  const handleMessageInputChange = (val) => {
    setMessageInput(val);
    if (inputStorageKey) {
      try {
        if (val) {
          localStorage.setItem(inputStorageKey, val);
        } else {
          localStorage.removeItem(inputStorageKey);
        }
      } catch (e) {}
    }
  };

  const handleToggleEditorMode = (mode) => {
    setEditorMode(mode);
    try {
      if (courseSlug) {
        localStorage.setItem(editorModeKey, mode);
      }
    } catch (e) {}
  };

  // Load available LLM models discovered dynamically from Redis/backend
  useEffect(() => {
    fetch(`${API_BASE}/api/llm/available-models`)
      .then((res) => {
        if (!res.ok) throw new Error('Could not fetch models');
        return res.json();
      })
      .then((data) => {
        if (data.status === 'success' && Array.isArray(data.models)) {
          setAvailableModels(data.models);
          setSelectedModel((prev) => prev || data.recommended_model || data.models[0]?.id || 'gemini-3.8-flash');
        }
      })
      .catch((err) => {
        console.warn('Could not fetch available LLM models, using default:', err);
        setSelectedModel((prev) => prev || 'gemini-3.8-flash');
      });
  }, []);

  // Flush any pending draft autosave immediately to backend
  const flushDraftSave = async (textToSave) => {
    if (!sessionId || !courseSlug || textToSave === undefined) return;
    try {
      await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_markdown: textToSave }),
        keepalive: true
      });
    } catch (err) {
      console.warn('Flush draft save error:', err);
    }
  };

  // Load existing session data from backend
  const fetchSessionData = async (targetId, showSpinner = true) => {
    if (!targetId || !courseSlug) return;
    if (showSpinner) setLoadingSession(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(targetId)}`);
      if (!res.ok) throw new Error('Could not load studio session');
      const data = await res.json();

      setSessionId(data.session_id);
      if (onSessionChange && initialSessionId !== data.session_id) {
        onSessionChange(data.session_id);
      }
      setTitle(data.title || 'Assignment Studio');
      setProblemPrompt(data.problem_statement || '');
      setChatHistory(data.chat_history || []);

      // Only use local cache as fallback if server draft is empty
      let draftText = data.draft_markdown || '';
      try {
        const localKey = `lecturescribe_studio_draft_${courseSlug}_${data.session_id}`;
        const cached = JSON.parse(localStorage.getItem(localKey) || 'null');
        if (!draftText && cached?.content) {
          draftText = cached.content;
        }
      } catch (e) {}

      setDraftMarkdown(draftText);
      latestDraftRef.current = draftText;
      setCitations(data.citations || []);
      setStudioStatus(data.studio_status || 'discussing');
      setPdfBlobName(data.pdf_blob_name);
      if (data.selected_model) {
        setSelectedModel(data.selected_model);
      }
      if (data.download_pdf_url) {
        setPdfDownloadUrl(`${API_BASE}${data.download_pdf_url}`);
      }
    } catch (err) {
      console.error('Error fetching studio session:', err);
      setErrorMsg('Failed to load existing studio session.');
    } finally {
      if (showSpinner) setLoadingSession(false);
    }
  };

  // Load existing session once if initialSessionId or restored sessionId is provided
  useEffect(() => {
    const targetSessionId = initialSessionId || sessionId;
    if (!targetSessionId || !courseSlug) return;
    if (fetchedSessionRef.current === targetSessionId) return;
    fetchedSessionRef.current = targetSessionId;
    fetchSessionData(targetSessionId, true);
  }, [initialSessionId, sessionId, courseSlug]);

  // Immediate flush on unmount (e.g. user clicks another course tab like Lectures/Notes)
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        if (latestDraftRef.current) {
          flushDraftSave(latestDraftRef.current);
        }
      }
    };
  }, [sessionId, courseSlug]);

  // Save when switching browser tabs (visibilitychange)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (latestDraftRef.current && sessionId && courseSlug) {
          flushDraftSave(latestDraftRef.current);
        }
      } else if (document.visibilityState === 'visible') {
        if (sessionId && courseSlug) {
          fetchSessionData(sessionId, false);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [sessionId, courseSlug]);

  // Start new studio session
  const handleStartSession = async (e) => {
    e?.preventDefault();
    if (!problemPrompt.trim() || !courseSlug) return;

    setSendingMessage(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: problemPrompt.trim(),
          title: title.trim() || undefined,
          role: isTutor ? 'tutor' : 'student',
          user_email: userEmail || undefined,
          model_name: selectedModel || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Could not start studio session.');
      }

      const data = await res.json();
      setSessionId(data.session_id);
      setTitle(data.title);
      setChatHistory(data.chat_history || []);
      setDraftMarkdown(data.draft_markdown || '');
      latestDraftRef.current = data.draft_markdown || '';
      setCitations(data.citations || []);
      if (data.selected_model) {
        setSelectedModel(data.selected_model);
      }
      setStudioStatus('discussing');

      // Clear setup form draft and persist active session
      try {
        localStorage.removeItem(setupStorageKey);
        localStorage.setItem(activeSessionKey, data.session_id);
      } catch (err) {}

      if (onSessionChange) onSessionChange(data.session_id);
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err) {
      console.error('Start studio session error:', err);
      setErrorMsg(err.message || 'Failed to initialize session.');
    } finally {
      setSendingMessage(false);
    }
  };

  // Send conversational chat turn (discussion, trigger draft, or iterate)
  const handleSendMessage = async (customText = null, action = null) => {
    const textToSend = (customText || messageInput).trim();
    if (!textToSend || !sessionId || !courseSlug) return;

    setMessageInput('');
    if (inputStorageKey) {
      try { localStorage.removeItem(inputStorageKey); } catch (e) {}
    }
    setSendingMessage(true);
    setErrorMsg(null);

    // Optimistically append user message
    const optimisticMessage = {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString()
    };
    setChatHistory((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          user_email: userEmail || undefined,
          model_name: selectedModel || undefined,
          action: action || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Co-pilot reply failed.');
      }

      const data = await res.json();
      setChatHistory(data.chat_history || []);
      if (data.draft_markdown) {
        setDraftMarkdown(data.draft_markdown);
        latestDraftRef.current = data.draft_markdown;
        setEditorMode('preview'); // Automatically activate preview pane
        if (draftStorageKey) {
          try {
            localStorage.setItem(draftStorageKey, JSON.stringify({
              content: data.draft_markdown,
              timestamp: Date.now()
            }));
          } catch (e) {}
        }
      }
      if (data.citations) {
        setCitations(data.citations);
      }
      if (data.selected_model) {
        setSelectedModel(data.selected_model);
      }
      if (data.studio_status) {
        setStudioStatus(data.studio_status);
      }
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err) {
      console.error('Studio chat turn error:', err);
      setErrorMsg(err.message || 'Co-pilot communication error.');
    } finally {
      setSendingMessage(false);
    }
  };

  // Direct manual draft editing with immediate local backup and debounced cloud save
  const handleManualDraftChange = (e) => {
    const nextVal = e.target.value;
    setDraftMarkdown(nextVal);
    latestDraftRef.current = nextVal;

    // 0ms instant local storage backup
    if (draftStorageKey) {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({
          content: nextVal,
          timestamp: Date.now()
        }));
      } catch (err) {}
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      setSavingDraft(true);
      await flushDraftSave(nextVal);
      setSavingDraft(false);
    }, 1000);
  };

  // Back to Assignments / Explicit Close clears active session
  const handleBackOrClose = () => {
    try {
      if (courseSlug) {
        localStorage.removeItem(activeSessionKey);
      }
    } catch (e) {}
    if (onClose) onClose();
  };

  // Trigger preview of the document (extracts available outline/draft or requests full generation)
  const handleTriggerPreview = async () => {
    // 1. If draft already exists, switch directly to preview without re-triggering LLM
    if (draftMarkdown && draftMarkdown.trim()) {
      handleToggleEditorMode('preview');
      return;
    }

    // 2. If chat history has a complete assistant response, adopt it immediately
    const lastAssistantMsg = [...chatHistory].reverse().find(
      (m) => m.role === 'assistant' && m.content && !m.content.startsWith('I encountered a temporary issue')
    );
    if (lastAssistantMsg?.content) {
      const initialText = lastAssistantMsg.content;
      setDraftMarkdown(initialText);
      latestDraftRef.current = initialText;
      handleToggleEditorMode('preview');
      if (draftStorageKey) {
        try {
          localStorage.setItem(draftStorageKey, JSON.stringify({
            content: initialText,
            timestamp: Date.now()
          }));
        } catch (e) {}
      }
      // Save draft immediately to backend without re-invoking LLM
      await flushDraftSave(initialText);
      return;
    }

    // 3. Fallback: only if no draft and no prior assistant response exist
    await handleSendMessage('Generate First Draft', 'generate_draft');
  };

  // Compile PDF
  const handleCompilePdf = async () => {
    if (!sessionId || !courseSlug) return;
    setCompilingPdf(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/studio/${encodeURIComponent(sessionId)}/compile-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || undefined,
          author: userName || userEmail || undefined,
          draft_markdown: draftMarkdown || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'PDF compilation failed.');
      }

      const data = await res.json();
      setStudioStatus('completed');
      setPdfBlobName(data.pdf_blob_name);
      setPdfDownloadUrl(`${API_BASE}/api/course/assignment/${encodeURIComponent(sessionId)}/download/pdf`);
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err) {
      console.error('PDF compilation error:', err);
      setErrorMsg(err.message || 'Failed to compile PDF.');
    } finally {
      setCompilingPdf(false);
    }
  };

  const handleCopyDraft = () => {
    navigator.clipboard.writeText(draftMarkdown || '');
    setCopiedDraft(true);
    setTimeout(() => setCopiedDraft(false), 2000);
  };

  // Status Chip helper
  const getStatusChip = () => {
    switch (studioStatus) {
      case 'completed':
        return <Chip icon={<CheckCircle2 size={13} />} label="Completed & Compiled" size="small" sx={{ bgcolor: 'rgba(16, 185, 129, 0.12)', color: '#047857', fontWeight: 700 }} />;
      case 'drafting':
      case 'refining':
        return <Chip icon={<Edit3 size={13} />} label="Drafting & Iterating" size="small" sx={{ bgcolor: 'rgba(147, 51, 234, 0.12)', color: '#7e22ce', fontWeight: 700 }} />;
      default:
        return <Chip icon={<Clock size={13} />} label="Discussing & Scoping" size="small" sx={{ bgcolor: 'rgba(245, 158, 11, 0.12)', color: '#b45309', fontWeight: 700 }} />;
    }
  };

  // Render initial setup screen if session not started yet
  if (!sessionId) {
    return (
      <Box sx={{ width: '100%', maxWidth: 900, mx: 'auto', p: 3 }}>
        <Button
          startIcon={<ArrowLeft size={16} />}
          onClick={handleBackOrClose}
          sx={{ mb: 3, textTransform: 'none', color: palette.textSecondary, fontWeight: 600 }}
        >
          Back to Assignments
        </Button>

        <Paper
          elevation={0}
          sx={{
            p: 4,
            borderRadius: 3,
            border: `1px solid ${palette.cardBorder}`,
            bgcolor: palette.cardBg
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <Chip
              icon={<Sparkles size={14} color="#7e22ce" />}
              label="Interactive Co-Pilot"
              size="small"
              sx={{ bgcolor: 'rgba(147, 51, 234, 0.1)', color: '#7e22ce', fontWeight: 700 }}
            />
            <Typography variant="body2" sx={{ color: palette.textSecondary }}>
              Research & Theory Problem Studio
            </Typography>
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 1.5 }}>
            Co-Create Grounded Assignment & Research Solutions
          </Typography>

          <Typography variant="body2" sx={{ color: palette.textSecondary, mb: 3 }}>
            Paste any free-text question, essay prompt, or theoretical problem statement. The Co-Pilot will discuss scope with you,
            triangulate knowledge from <strong>{courseName}</strong> lecture cues, summaries, and slides, and iteratively compile a publication-grade PDF.
          </Typography>

          {hasRestoredDraft && (
            <Box
              sx={{
                mb: 3,
                p: 2,
                borderRadius: 2,
                bgcolor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                flexWrap: 'wrap'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Clock size={16} color="#2563eb" />
                <Typography variant="body2" sx={{ color: '#1d4ed8', fontWeight: 600 }}>
                  Restored unsaved problem prompt from your previous tab/session.
                </Typography>
              </Box>
              <Button
                size="small"
                onClick={handleClearDraftSetup}
                sx={{ textTransform: 'none', color: '#1d4ed8', fontWeight: 700, fontSize: '0.78rem' }}
              >
                Clear & Start Fresh
              </Button>
            </Box>
          )}

          {errorMsg && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {errorMsg}
            </Alert>
          )}

          <form onSubmit={handleStartSession}>
            <TextField
              fullWidth
              label="Assignment Title (Optional)"
              placeholder="e.g. Comparative Analysis of Attention Mechanisms"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (problemPrompt.trim() && !sendingMessage) {
                    handleStartSession(e);
                  }
                }
              }}
              sx={{ mb: 2.5 }}
              size="small"
            />

            <TextField
              fullWidth
              multiline
              rows={5}
              required
              label="Problem Statement / Question / Prompt"
              placeholder="Paste or type the problem statement, essay question, or research task here... (e.g. Compare Bahdanau vs Luong attention mechanisms, derive their mathematical formulations, and analyze computational complexity based on course lectures)"
              value={problemPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (problemPrompt.trim() && !sendingMessage) {
                    handleStartSession(e);
                  }
                }
              }}
              sx={{ mb: 2.5 }}
            />

            <Box sx={{ mb: 3 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: palette.textSecondary, mb: 0.8, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                <Cpu size={14} /> AI Model (Discovered dynamically via Redis):
              </Typography>
              <FormControl fullWidth size="small">
                <Select
                  value={selectedModel || (availableModels[0]?.id || 'gemini-3.8-flash')}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  sx={{ borderRadius: 2 }}
                >
                  {availableModels.map((m) => (
                    <MenuItem key={m.id} value={m.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {m.displayName || m.id}
                          </Typography>
                          {m.isRecommended && (
                            <Chip label="Recommended" size="small" color="primary" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                          {m.provider} &bull; {(m.contextWindow / 1024).toFixed(0)}k context
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                  {availableModels.length === 0 && (
                    <MenuItem value="gemini-3.8-flash">Gemini 3.8 Flash (Recommended)</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
              <Button onClick={handleBackOrClose} sx={{ textTransform: 'none', color: palette.textSecondary }}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={sendingMessage || !problemPrompt.trim()}
                startIcon={sendingMessage ? <CircularProgress size={16} color="inherit" /> : <Sparkles size={16} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  bgcolor: palette.primary,
                  px: 3
                }}
              >
                {sendingMessage ? 'Initializing Studio...' : 'Launch Studio Co-Pilot'}
              </Button>
            </Box>
          </form>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 120px)', minHeight: 650, display: 'flex', flexDirection: 'column' }}>
      {/* TOP ACTION BAR */}
      <Paper
        elevation={0}
        sx={{
          px: 3,
          py: 1.5,
          borderBottom: `1px solid ${palette.cardBorder}`,
          bgcolor: palette.cardBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            size="small"
            startIcon={<ArrowLeft size={16} />}
            onClick={handleBackOrClose}
            sx={{ textTransform: 'none', color: palette.textSecondary, fontWeight: 600 }}
          >
            Assignments
          </Button>
          <Divider orientation="vertical" flexItem sx={{ height: 24, my: 'auto' }} />
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: palette.textPrimary, lineHeight: 1.2 }}>
              {title || 'Assignment Studio'}
            </Typography>
            <Typography variant="caption" sx={{ color: palette.textSecondary }}>
              Course: <strong>{courseName}</strong> &bull; {getStatusChip()}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* Dynamic Model Selector in active studio */}
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <Select
              size="small"
              value={selectedModel || (availableModels[0]?.id || 'gemini-3.8-flash')}
              onChange={(e) => setSelectedModel(e.target.value)}
              sx={{
                height: 32,
                fontSize: '0.78rem',
                fontWeight: 600,
                borderRadius: 2,
                bgcolor: 'rgba(0,0,0,0.03)'
              }}
            >
              {availableModels.map((m) => (
                <MenuItem key={m.id} value={m.id} sx={{ fontSize: '0.8rem' }}>
                  {m.displayName || m.id}
                </MenuItem>
              ))}
              {availableModels.length === 0 && (
                <MenuItem value="gemini-3.8-flash" sx={{ fontSize: '0.8rem' }}>
                  Gemini 3.8 Flash (Recommended)
                </MenuItem>
              )}
            </Select>
          </FormControl>

          {/* Preview / Split / Edit Toggle */}
          <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', borderRadius: 2, p: 0.5, display: 'flex', gap: 0.5 }}>
            <Button
              size="small"
              startIcon={<Eye size={14} />}
              onClick={() => handleToggleEditorMode('preview')}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.78rem',
                borderRadius: 1.5,
                bgcolor: editorMode === 'preview' ? palette.cardBg : 'transparent',
                color: editorMode === 'preview' ? palette.primary : palette.textSecondary,
                boxShadow: editorMode === 'preview' ? 1 : 0
              }}
            >
              Preview
            </Button>
            <Button
              size="small"
              startIcon={<Columns size={14} />}
              onClick={() => handleToggleEditorMode('split')}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.78rem',
                borderRadius: 1.5,
                bgcolor: editorMode === 'split' ? palette.cardBg : 'transparent',
                color: editorMode === 'split' ? palette.primary : palette.textSecondary,
                boxShadow: editorMode === 'split' ? 1 : 0
              }}
            >
              Split
            </Button>
            <Button
              size="small"
              startIcon={<Edit3 size={14} />}
              onClick={() => handleToggleEditorMode('edit')}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.78rem',
                borderRadius: 1.5,
                bgcolor: editorMode === 'edit' ? palette.cardBg : 'transparent',
                color: editorMode === 'edit' ? palette.primary : palette.textSecondary,
                boxShadow: editorMode === 'edit' ? 1 : 0
              }}
            >
              Edit Raw {savingDraft && '...'}
            </Button>
          </Box>

          {/* Auto-save Status Badge */}
          {draftMarkdown && (
            <Tooltip title="All revisions and discussions are continuously saved to your browser and synced with PostgreSQL.">
              <Chip
                size="small"
                icon={<CheckCircle2 size={12} color={savingDraft ? "#b45309" : "#059669"} />}
                label={savingDraft ? "Saving..." : "All changes saved"}
                sx={{
                  height: 26,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  bgcolor: savingDraft ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.1)',
                  color: savingDraft ? '#b45309' : '#047857'
                }}
              />
            </Tooltip>
          )}

          <Tooltip title="Copy full markdown draft">
            <IconButton size="small" onClick={handleCopyDraft} sx={{ color: palette.textSecondary }}>
              {copiedDraft ? <Check size={16} color="#059669" /> : <Copy size={16} />}
            </IconButton>
          </Tooltip>

          {/* Download PDF button if compiled */}
          {pdfDownloadUrl && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<Download size={14} />}
              href={pdfDownloadUrl}
              target="_blank"
              download
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                color: '#047857',
                borderColor: '#10b981'
              }}
            >
              Download PDF
            </Button>
          )}

          {/* Compile PDF Button */}
          <Button
            variant="contained"
            size="small"
            disabled={compilingPdf || !draftMarkdown.trim()}
            onClick={handleCompilePdf}
            startIcon={compilingPdf ? <CircularProgress size={14} color="inherit" /> : <FileText size={14} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: palette.primary,
              px: 2
            }}
          >
            {compilingPdf ? 'Compiling PDF...' : 'Compile to PDF'}
          </Button>
        </Box>
      </Paper>

      {/* SPLIT STUDIO WORKSPACE */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT PANE: INTERACTIVE CO-PILOT (45%) */}
        <Box
          sx={{
            width: { xs: '100%', md: '45%' },
            borderRight: `1px solid ${palette.cardBorder}`,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: palette.cardBg
          }}
        >
          {/* Co-Pilot Header */}
          <Box sx={{ p: 2, borderBottom: `1px solid ${palette.cardBorder}`, bgcolor: 'rgba(59, 130, 246, 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Sparkles size={16} color="#2563eb" />
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary }}>
                Studio Co-Pilot
              </Typography>
            </Box>
            {citations.length > 0 && (
              <Chip
                icon={<BookOpen size={12} />}
                label={`${citations.length} Grounded References`}
                size="small"
                sx={{ fontSize: '0.72rem', height: 22 }}
              />
            )}
          </Box>

          {/* Chat message thread */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {chatHistory.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start'
                  }}
                >
                  <Typography variant="caption" sx={{ color: palette.textSecondary, mb: 0.5, px: 1 }}>
                    {isUser ? 'You' : 'Co-Pilot'}
                  </Typography>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      maxWidth: '90%',
                      borderRadius: 2.5,
                      bgcolor: isUser ? palette.primary : 'rgba(0,0,0,0.03)',
                      color: isUser ? '#ffffff' : palette.textPrimary,
                      border: isUser ? 'none' : `1px solid ${palette.cardBorder}`,
                      fontSize: '0.88rem',
                      lineHeight: 1.55
                    }}
                  >
                    {isUser ? (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </Typography>
                    ) : (
                      <Box sx={{ '& p': { m: 0, mb: 1 }, '& p:last-child': { mb: 0 }, '& ul, & ol': { pl: 2, m: 0 } }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {msg.content}
                        </ReactMarkdown>
                      </Box>
                    )}
                  </Paper>
                </Box>
              );
            })}

            {sendingMessage && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                  Co-Pilot is researching course materials and formulating response...
                </Typography>
              </Box>
            )}

            <div ref={chatBottomRef} />
          </Box>

          {/* Quick Action Suggestion Chips */}
          <Box sx={{ px: 2, py: 1, borderTop: `1px solid ${palette.cardBorder}`, display: 'flex', gap: 1, overflowX: 'auto', bgcolor: 'rgba(0,0,0,0.01)' }}>
            {!draftMarkdown ? (
              <Chip
                icon={<Eye size={12} color="#ffffff" />}
                label="Preview Document"
                size="small"
                onClick={handleTriggerPreview}
                sx={{ bgcolor: palette.primary, color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              />
            ) : (
              <>
                <Chip
                  label="Expand derivations"
                  size="small"
                  onClick={() => handleSendMessage('Please expand the mathematical derivations step-by-step.')}
                  sx={{ cursor: 'pointer', fontSize: '0.75rem' }}
                />
                <Chip
                  label="Add complexity table"
                  size="small"
                  onClick={() => handleSendMessage('Add a structured markdown comparison table for computational complexity.')}
                  sx={{ cursor: 'pointer', fontSize: '0.75rem' }}
                />
                <Chip
                  label="Formal academic tone"
                  size="small"
                  onClick={() => handleSendMessage('Refine the tone to be formal, scholarly, and publication-ready.')}
                  sx={{ cursor: 'pointer', fontSize: '0.75rem' }}
                />
              </>
            )}
          </Box>

          {/* Chat input box */}
          <Box sx={{ p: 2, borderTop: `1px solid ${palette.cardBorder}` }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                multiline
                maxRows={4}
                size="small"
                placeholder={draftMarkdown ? "Ask Co-Pilot to refine or expand draft... (Enter to send, Shift+Enter for newline)" : "Discuss scope or type 'Generate First Draft'... (Enter to send, Shift+Enter for newline)"}
                value={messageInput}
                onChange={(e) => handleMessageInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!sendingMessage && messageInput.trim()) {
                      handleSendMessage();
                    }
                  }
                }}
              />
              <IconButton
                color="primary"
                disabled={sendingMessage || !messageInput.trim()}
                onClick={() => handleSendMessage()}
                sx={{
                  bgcolor: palette.primary,
                  color: '#fff',
                  borderRadius: 2,
                  '&:hover': { bgcolor: palette.primary },
                  '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.2)' }
                }}
              >
                <Send size={18} />
              </IconButton>
            </Box>
          </Box>
        </Box>

        {/* RIGHT PANE: LIVE ACADEMIC DRAFT (55%) */}
        <Box sx={{ width: { xs: '100%', md: '55%' }, display: 'flex', flexDirection: 'column', bgcolor: '#f8fafc', overflow: 'hidden' }}>
          {/* Draft Toolbar */}
          <Box sx={{ p: 2, borderBottom: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FileCode size={16} color="#475569" />
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary }}>
                {editorMode === 'preview' ? 'Rendered Academic Document' : editorMode === 'split' ? 'Side-by-Side Live Editor & Preview' : 'Raw Markdown Editor'}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: palette.textSecondary }}>
              LaTeX Math ($...$) &bull; Markdown Tables &bull; Real-time Sync
            </Typography>
          </Box>

          {/* Draft Content Area */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: editorMode === 'split' ? 2.5 : 4 }}>
            {!draftMarkdown.trim() ? (
              <Paper
                elevation={0}
                sx={{
                  p: 5,
                  borderRadius: 3,
                  textAlign: 'center',
                  border: `2px dashed ${palette.cardBorder}`,
                  bgcolor: palette.cardBg,
                  maxWidth: 550,
                  mx: 'auto',
                  mt: 8
                }}
              >
                <Eye size={36} color="#2563eb" style={{ margin: '0 auto 16px' }} />
                <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 1 }}>
                  Live Document Preview
                </Typography>
                <Typography variant="body2" sx={{ color: palette.textSecondary, mb: 3 }}>
                  Click <strong>"Preview"</strong> to render and review the course-grounded academic document, derivations, and solutions.
                </Typography>
                <Button
                  variant="contained"
                  disabled={sendingMessage}
                  onClick={handleTriggerPreview}
                  startIcon={sendingMessage ? <CircularProgress size={16} color="inherit" /> : <Eye size={16} />}
                  sx={{ textTransform: 'none', fontWeight: 700, bgcolor: palette.primary, px: 3, py: 1 }}
                >
                  {sendingMessage ? 'Generating Preview...' : 'Preview'}
                </Button>
              </Paper>
            ) : editorMode === 'edit' ? (
              <TextField
                fullWidth
                multiline
                rows={28}
                value={draftMarkdown}
                onChange={handleManualDraftChange}
                onBlur={() => {
                  if (draftMarkdown && sessionId) {
                    flushDraftSave(draftMarkdown);
                  }
                }}
                placeholder="Markdown and LaTeX math content..."
                sx={{
                  bgcolor: palette.cardBg,
                  borderRadius: 2,
                  '& .MuiInputBase-input': {
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                    fontSize: '0.88rem',
                    lineHeight: 1.6
                  }
                }}
              />
            ) : editorMode === 'split' ? (
              <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start', width: '100%' }}>
                <Box sx={{ width: '50%' }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: palette.textSecondary, mb: 1, display: 'block' }}>
                    MARKDOWN SOURCE (LIVE EDITING)
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    rows={26}
                    value={draftMarkdown}
                    onChange={handleManualDraftChange}
                    onBlur={() => {
                      if (draftMarkdown && sessionId) {
                        flushDraftSave(draftMarkdown);
                      }
                    }}
                    placeholder="Markdown content..."
                    sx={{
                      bgcolor: palette.cardBg,
                      borderRadius: 2,
                      '& .MuiInputBase-input': {
                        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                        fontSize: '0.86rem',
                        lineHeight: 1.6
                      }
                    }}
                  />
                </Box>
                <Box sx={{ width: '50%' }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: palette.textSecondary, mb: 1, display: 'block' }}>
                    LIVE PREVIEW
                  </Typography>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3,
                      borderRadius: 2,
                      border: `1px solid ${palette.cardBorder}`,
                      bgcolor: palette.cardBg,
                      fontFamily: '"Times New Roman", Times, Georgia, serif',
                      color: '#0f172a',
                      lineHeight: 1.65,
                      maxHeight: 'calc(100vh - 240px)',
                      overflowY: 'auto',
                      '& h1': { fontSize: '1.45rem', fontWeight: 800, borderBottom: '2px solid #0f172a', pb: 0.5, mb: 1.5, mt: 0.5 },
                      '& h2': { fontSize: '1.15rem', fontWeight: 700, borderBottom: '1px solid #cbd5e1', pb: 0.5, mt: 2, mb: 1, color: '#1e40af' },
                      '& h3': { fontSize: '1rem', fontWeight: 700, mt: 1.5, mb: 0.8, color: '#0f172a' },
                      '& p': { fontSize: '0.92rem', mb: 1.4, textAlign: 'justify' },
                      '& table': { width: '100%', borderCollapse: 'collapse', my: 2, fontSize: '0.82rem' },
                      '& th, & td': { border: '1px solid #cbd5e1', p: '6px 10px', textAlign: 'left' },
                      '& th': { bgcolor: '#f8fafc', fontWeight: 700 },
                      '& blockquote': { borderLeft: '3px solid #3b82f6', m: 0, my: 1.5, pl: 1.5, color: '#475569', fontStyle: 'italic' },
                      '& pre': { bgcolor: '#f1f5f9', p: 1.5, borderRadius: 1.5, overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {draftMarkdown}
                    </ReactMarkdown>
                  </Paper>
                </Box>
              </Box>
            ) : (
              /* Rendered Academic Paper View (Full Width) */
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 3, md: 5 },
                  borderRadius: 2,
                  border: `1px solid ${palette.cardBorder}`,
                  bgcolor: palette.cardBg,
                  maxWidth: 820,
                  mx: 'auto',
                  boxShadow: '0 4px 20px -4px rgba(0,0,0,0.06)',
                  fontFamily: '"Times New Roman", Times, Georgia, serif',
                  color: '#0f172a',
                  lineHeight: 1.7,
                  '& h1': {
                    fontSize: '1.75rem',
                    fontWeight: 800,
                    borderBottom: '2px solid #0f172a',
                    pb: 1,
                    mb: 2,
                    mt: 1
                  },
                  '& h2': {
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    borderBottom: '1px solid #cbd5e1',
                    pb: 0.5,
                    mt: 3,
                    mb: 1.5,
                    color: '#1e40af'
                  },
                  '& h3': {
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    mt: 2.5,
                    mb: 1,
                    color: '#0f172a'
                  },
                  '& p': {
                    fontSize: '0.98rem',
                    mb: 1.8,
                    textAlign: 'justify'
                  },
                  '& table': {
                    width: '100%',
                    borderCollapse: 'collapse',
                    my: 2.5,
                    fontSize: '0.88rem'
                  },
                  '& th, & td': {
                    border: '1px solid #cbd5e1',
                    p: '8px 12px',
                    textAlign: 'left'
                  },
                  '& th': {
                    bgcolor: '#f8fafc',
                    fontWeight: 700
                  },
                  '& blockquote': {
                    borderLeft: '3px solid #3b82f6',
                    m: 0,
                    my: 2,
                    pl: 2,
                    color: '#475569',
                    fontStyle: 'italic'
                  },
                  '& pre': {
                    bgcolor: '#f1f5f9',
                    p: 2,
                    borderRadius: 1.5,
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.84rem'
                  }
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {draftMarkdown}
                </ReactMarkdown>
              </Paper>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
