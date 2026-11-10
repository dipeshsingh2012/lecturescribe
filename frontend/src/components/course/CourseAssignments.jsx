import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  TextField,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab
} from '@mui/material';
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  BookOpen,
  Code2,
  Terminal,
  ChevronDown,
  ChevronUp,
  FileCode,
  RotateCcw,
  Database,
  Calendar,
  Send,
  Award,
  Users,
  Play,
  Eye,
  Copy,
  Check
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import { getUserDisplayName } from '../../utils/formatters';
import AssignmentStudio from './AssignmentStudio';
import ResponseTimeBadge from '../common/ResponseTimeBadge';

export default function CourseAssignments({
  courseName = 'Active Course',
  assignments = [],
  loading = false,
  error = null,
  uploading = false,
  uploadError = null,
  onUploadAssignment,
  onProvideDataset,
  onSkipDataset,
  onApproveAssignment,
  onFetchAnalysis,
  onRegenerateAssignment,
  onDeleteAssignment,
  onRefreshAssignments,
  currentTheme,
  isTutor = true,
  userEmail = '',
  userName = ''
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedDatasetFile, setSelectedDatasetFile] = useState(null);
  const [customTitle, setCustomTitle] = useState('');
  const [expandedDetails, setExpandedDetails] = useState({});
  const [pendingDatasetFiles, setPendingDatasetFiles] = useState({});
  const [uploadingDataset, setUploadingDataset] = useState({});
  const [approvingAsgnId, setApprovingAsgnId] = useState(null);
  const [customGuidance, setCustomGuidance] = useState({});
  const [showGuidanceInput, setShowGuidanceInput] = useState({});
  const [activeAnalysisModal, setActiveAnalysisModal] = useState(null);
  const [analysisModalTab, setAnalysisModalTab] = useState(0);
  const [copiedRawText, setCopiedRawText] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [activeNotebookModal, setActiveNotebookModal] = useState(null);
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  const courseSlug = normalizeCourseSlug(courseName);

  const [activeStudioSessionId, setActiveStudioSessionId] = useState(() => {
    try {
      if (typeof window !== 'undefined' && courseSlug) {
        return localStorage.getItem(`lecturescribe_active_studio_session_${courseSlug}`) || null;
      }
    } catch (e) {}
    return null;
  });

  // Keep studio session in sync across tab changes and course transitions
  useEffect(() => {
    if (!courseSlug) return;
    try {
      const saved = localStorage.getItem(`lecturescribe_active_studio_session_${courseSlug}`);
      if (saved) {
        setActiveStudioSessionId(saved);
      }
    } catch (e) {}
  }, [courseSlug]);

  const handleOpenStudio = (sid = 'new') => {
    setActiveStudioSessionId(sid);
    try {
      if (courseSlug) {
        localStorage.setItem(`lecturescribe_active_studio_session_${courseSlug}`, sid);
      }
    } catch (e) {}
  };

  const handleCloseStudio = () => {
    setActiveStudioSessionId(null);
    try {
      if (courseSlug) {
        localStorage.removeItem(`lecturescribe_active_studio_session_${courseSlug}`);
      }
    } catch (e) {}
  };

  const handleSessionChange = (newSessionId) => {
    setActiveStudioSessionId(newSessionId);
    try {
      if (courseSlug && newSessionId) {
        localStorage.setItem(`lecturescribe_active_studio_session_${courseSlug}`, newSessionId);
      }
    } catch (e) {}
  };

  const handleApproveSubmit = async (assignmentId) => {
    if (!assignmentId) return;
    setApprovingAsgnId(assignmentId);
    try {
      const guidance = customGuidance[assignmentId] || '';
      if (onApproveAssignment) {
        await onApproveAssignment(assignmentId, guidance);
      } else {
        await fetch(
          `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_email: userEmail || undefined,
              custom_instructions: guidance || undefined
            })
          }
        );
        onRefreshAssignments?.();
      }
      if (activeAnalysisModal?.assignment_id === assignmentId) {
        setActiveAnalysisModal(null);
      }
    } catch (err) {
      console.error('Approval execution error:', err);
    } finally {
      setApprovingAsgnId(null);
    }
  };

  const handleOpenAnalysisModal = async (asgn) => {
    if (!asgn) return;
    setActiveAnalysisModal({
      ...asgn,
      raw_extracted_text: asgn.raw_extracted_text || ''
    });
    setAnalysisModalTab(0);
    setCopiedRawText(false);

    if (!asgn.raw_extracted_text && onFetchAnalysis) {
      setLoadingAnalysis(true);
      try {
        const fullData = await onFetchAnalysis(asgn.assignment_id);
        if (fullData) {
          setActiveAnalysisModal((prev) => (prev ? { ...prev, ...fullData } : null));
        }
      } catch (e) {
        console.warn('Could not fetch full analysis:', e);
      } finally {
        setLoadingAnalysis(false);
      }
    }
  };

  const handleCopyRawText = (text) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      setCopiedRawText(true);
      setTimeout(() => setCopiedRawText(false), 2000);
    } catch (e) {}
  };

  const handleOpenNotebookPreview = async (asgn) => {
    if (!asgn || !asgn.assignment_id) return;
    setActiveNotebookModal({
      assignment_id: asgn.assignment_id,
      title: asgn.title || 'Solution Notebook',
      source_filename: asgn.source_filename,
      notebook: null,
      error: null
    });
    setLoadingNotebook(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(asgn.assignment_id)}/notebook`
      );
      if (res.ok) {
        const data = await res.json();
        setActiveNotebookModal((prev) => (prev ? { ...prev, notebook: data.notebook } : null));
      } else {
        const errData = await res.json().catch(() => ({}));
        setActiveNotebookModal((prev) => (prev ? { ...prev, error: errData.detail || 'Could not load notebook deliverable.' } : null));
      }
    } catch (err) {
      console.warn('Could not fetch notebook:', err);
      setActiveNotebookModal((prev) => (prev ? { ...prev, error: err.message } : null));
    } finally {
      setLoadingNotebook(false);
    }
  };

  // Option 1: Deadline Publishing, Student Submissions & AI SpeedGrader state
  const [publishDrafts, setPublishDrafts] = useState({});
  const [publishingId, setPublishingId] = useState(null);
  const [publishStatusMsg, setPublishStatusMsg] = useState({});
  const [openGraderMap, setOpenGraderMap] = useState({});
  const [submissionsByAsgn, setSubmissionsByAsgn] = useState({});
  const [loadingSubs, setLoadingSubs] = useState({});
  const [gradeDrafts, setGradeDrafts] = useState({});
  const [aiGradingSubId, setAiGradingSubId] = useState(null);
  const [savingGradeSubId, setSavingGradeSubId] = useState(null);
  const [studentSubmitDrafts, setStudentSubmitDrafts] = useState({});
  const [submittingAsgnId, setSubmittingAsgnId] = useState(null);

  const fetchSubmissionsForAssignment = async (assignmentId) => {
    if (!courseSlug || !assignmentId) return;
    setLoadingSubs((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/submissions`
      );
      if (res.ok) {
        const data = await res.json();
        const subs = data.submissions || [];
        setSubmissionsByAsgn((prev) => ({ ...prev, [assignmentId]: subs }));
        const nextDrafts = {};
        subs.forEach((s) => {
          nextDrafts[s.submission_id] = {
            score: s.score ?? s.ai_suggested_score ?? '',
            feedback: s.instructor_feedback || s.ai_feedback || ''
          };
        });
        setGradeDrafts((prev) => ({ ...prev, ...nextDrafts }));
      }
    } catch (e) {
      console.warn('[CourseAssignments] fetchSubmissions error:', e);
    } finally {
      setLoadingSubs((prev) => ({ ...prev, [assignmentId]: false }));
    }
  };

  const handleToggleGrader = (assignmentId) => {
    const nextOpen = !openGraderMap[assignmentId];
    setOpenGraderMap((prev) => ({ ...prev, [assignmentId]: nextOpen }));
    if (nextOpen) {
      fetchSubmissionsForAssignment(assignmentId);
    }
  };

  const handlePublishSettings = async (asgn) => {
    const aid = asgn.assignment_id;
    const draft = publishDrafts[aid] || {};
    const dueDate = draft.due_date !== undefined ? draft.due_date : (asgn.due_date || '');
    const maxMarks = draft.max_marks !== undefined ? Number(draft.max_marks) : Number(asgn.max_marks || 100);
    setPublishingId(aid);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(aid)}/publish`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            due_date: dueDate || null,
            max_marks: maxMarks,
            is_published: true,
            actor_email: userEmail || undefined
          })
        }
      );
      if (res.ok) {
        setPublishStatusMsg((prev) => ({
          ...prev,
          [aid]: dueDate ? 'Deadline published & synced to LMS Calendar!' : 'Assignment settings saved.'
        }));
      }
    } catch (e) {
      console.error('Publish assignment settings error:', e);
    } finally {
      setPublishingId(null);
    }
  };

  const handleStudentSubmitWork = async (asgn) => {
    const aid = asgn.assignment_id;
    const draft = studentSubmitDrafts[aid] || {};
    if (!draft.text?.trim() && !draft.fileName) return;
    setSubmittingAsgnId(aid);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(aid)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_email: userEmail || 'student@iiitdwd.ac.in',
            student_name: getUserDisplayName(userName, userEmail, 'Student'),
            submission_text: draft.text || '',
            file_name: draft.fileName || ''
          })
        }
      );
      if (res.ok) {
        await fetchSubmissionsForAssignment(aid);
        setStudentSubmitDrafts((prev) => ({ ...prev, [aid]: { text: '', fileName: '', submitted: true } }));
      }
    } catch (e) {
      console.error('Student submit error:', e);
    } finally {
      setSubmittingAsgnId(null);
    }
  };

  const handleRunAiSpeedGrader = async (assignmentId, submissionId) => {
    setAiGradingSubId(submissionId);
    const t0 = performance.now();
    try {
      const emailParam = userEmail ? `?actor_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submissionId)}/ai-grade${emailParam}`,
        { method: 'POST' }
      );
      if (res.ok) {
        const data = await res.json();
        const rawSub = data.submission;
        const elapsedMs =
          data.response_time_ms ??
          rawSub?.response_time_ms ??
          Math.max(1, Math.round(performance.now() - t0));
        const sub = rawSub ? { ...rawSub, response_time_ms: rawSub.response_time_ms ?? elapsedMs } : null;
        if (sub) {
          setSubmissionsByAsgn((prev) => ({
            ...prev,
            [assignmentId]: (prev[assignmentId] || []).map((s) => (s.submission_id === submissionId ? sub : s))
          }));
          setGradeDrafts((prev) => ({
            ...prev,
            [submissionId]: {
              score: sub.ai_suggested_score ?? sub.score ?? '',
              feedback: sub.ai_feedback || sub.instructor_feedback || ''
            }
          }));
        }
      }
    } catch (e) {
      console.error('AI SpeedGrader error:', e);
    } finally {
      setAiGradingSubId(null);
    }
  };

  const handleSaveSubmissionGrade = async (assignmentId, submissionId) => {
    const draft = gradeDrafts[submissionId] || {};
    if (draft.score === '' || draft.score === undefined) return;
    setSavingGradeSubId(submissionId);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submissionId)}/grade`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: Number(draft.score),
            instructor_feedback: draft.feedback || '',
            actor_email: userEmail || undefined
          })
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.submission) {
          setSubmissionsByAsgn((prev) => ({
            ...prev,
            [assignmentId]: (prev[assignmentId] || []).map((s) => (s.submission_id === submissionId ? data.submission : s))
          }));
        }
      }
    } catch (e) {
      console.error('Save grade error:', e);
    } finally {
      setSavingGradeSubId(null);
    }
  };

  const fileInputRef = useRef(null);
  const datasetInputRef = useRef(null);
  const provideInputRefs = useRef({});

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please select a valid PDF assignment file.');
        return;
      }
      setSelectedFile(file);
      if (!customTitle) {
        const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
        setCustomTitle(cleanName);
      }
    }
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;
    try {
      await onUploadAssignment(selectedFile, customTitle, selectedDatasetFile);
      setSelectedFile(null);
      setSelectedDatasetFile(null);
      setCustomTitle('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (datasetInputRef.current) {
        datasetInputRef.current.value = '';
      }
    } catch (err) {
      // handled by parent hook
    }
  };

  const handleDatasetFileSelected = (assignmentId, file) => {
    if (file) {
      setPendingDatasetFiles((prev) => ({
        ...prev,
        [assignmentId]: file
      }));
    }
  };

  const handleProvideDatasetSubmit = async (assignmentId) => {
    const file = pendingDatasetFiles[assignmentId];
    if (!file || !onProvideDataset) return;

    setUploadingDataset((prev) => ({ ...prev, [assignmentId]: true }));
    try {
      await onProvideDataset(assignmentId, file);
      setPendingDatasetFiles((prev) => {
        const next = { ...prev };
        delete next[assignmentId];
        return next;
      });
    } catch (e) {
      console.error('Provide dataset error:', e);
    } finally {
      setUploadingDataset((prev) => ({ ...prev, [assignmentId]: false }));
    }
  };

  const toggleDetails = (assignmentId) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [assignmentId]: !prev[assignmentId]
    }));
  };

  const palette = currentTheme?.palette || {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  if (activeStudioSessionId) {
    return (
      <AssignmentStudio
        courseName={courseName}
        initialSessionId={activeStudioSessionId === 'new' ? null : activeStudioSessionId}
        onClose={handleCloseStudio}
        onSessionChange={handleSessionChange}
        onAssignmentUpdated={() => {
          if (onRefreshAssignments) onRefreshAssignments();
        }}
        currentTheme={currentTheme}
        isTutor={isTutor}
        userEmail={userEmail}
        userName={userName}
      />
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 1100, mx: 'auto', pb: 8 }}>
      {/* HEADER BANNER */}
      <Paper
        elevation={0}
        sx={{
          p: 3.5,
          mb: 4,
          borderRadius: 3,
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(147, 51, 234, 0.05) 100%)',
          border: `1px solid ${palette.cardBorder}`
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Chip
            icon={<Sparkles size={14} color="#2563eb" />}
            label="AI Assignment Planner & Solver"
            size="small"
            sx={{
              bgcolor: 'rgba(59, 130, 246, 0.12)',
              color: '#1d4ed8',
              fontWeight: 700,
              fontSize: '0.75rem'
            }}
          />
          <Chip
            icon={<Code2 size={13} color="#059669" />}
            label="Code Execution & Outputs"
            size="small"
            sx={{
              bgcolor: 'rgba(16, 185, 129, 0.1)',
              color: '#047857',
              fontWeight: 600,
              fontSize: '0.75rem'
            }}
          />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 0.5 }}>
          {courseName} • Assignment Planner & Studio
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2, mt: 1 }}>
          <Typography variant="body2" sx={{ color: palette.textSecondary, maxWidth: 680, lineHeight: 1.6 }}>
            Upload assignment questions in PDF format for automated Jupyter execution, or launch the <strong>Interactive Studio</strong> to paste free-text problems, discuss scope with the Co-Pilot, and co-create course-grounded solutions.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Sparkles size={16} />}
            onClick={() => handleOpenStudio('new')}
            sx={{
              textTransform: 'none',
              fontWeight: 800,
              bgcolor: '#7e22ce',
              color: '#ffffff',
              borderRadius: 2.5,
              px: 2.5,
              py: 1,
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(126, 34, 206, 0.25)',
              '&:hover': { bgcolor: '#6b21a8' }
            }}
          >
            Launch Free-Text Studio
          </Button>
        </Box>
      </Paper>

      {/* UPLOAD DROPZONE / ACTION CARD */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 4,
          borderRadius: 3,
          border: `1px dashed ${selectedFile ? palette.primary : palette.cardBorder}`,
          bgcolor: selectedFile ? 'rgba(59, 130, 246, 0.03)' : palette.cardBg,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2.5, alignItems: 'center' }}>
          <Box
            onClick={() => fileInputRef.current?.click()}
            sx={{
              flex: 1,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
              p: 2,
              borderRadius: 2,
              bgcolor: 'rgba(0,0,0,0.02)',
              '&:hover': { bgcolor: 'rgba(59, 130, 246, 0.05)' }
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                bgcolor: 'rgba(59, 130, 246, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: palette.primary,
                flexShrink: 0
              }}
            >
              <Upload size={24} />
            </Box>
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: palette.textPrimary }}>
                {selectedFile ? selectedFile.name : 'Select or drop Assignment PDF'}
              </Typography>
              <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB • Ready to solve`
                  : 'Supports homework PDFs, problem sheets, and lab tasks'}
              </Typography>
            </Box>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </Box>

          {/* Optional Title input */}
          {selectedFile && (
            <TextField
              size="small"
              label="Assignment Title (Optional)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              sx={{ minWidth: { xs: '100%', md: 240 } }}
            />
          )}

          {/* Optional Dataset file attachment */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              ref={datasetInputRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.json,.txt,.parquet"
              style={{ display: 'none' }}
              onChange={(e) => setSelectedDatasetFile(e.target.files?.[0] || null)}
            />
            {selectedDatasetFile ? (
              <Chip
                icon={<Database size={13} color="#059669" />}
                label={`Dataset: ${selectedDatasetFile.name}`}
                onDelete={() => {
                  setSelectedDatasetFile(null);
                  if (datasetInputRef.current) datasetInputRef.current.value = '';
                }}
                size="small"
                sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 600 }}
              />
            ) : (
              <Tooltip title="If your assignment requires a dataset file (e.g. titanic.csv, sales.xlsx), attach it here to solve without pausing">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Database size={14} />}
                  onClick={() => datasetInputRef.current?.click()}
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.78rem',
                    borderRadius: 2,
                    borderColor: palette.cardBorder,
                    color: palette.textSecondary,
                    '&:hover': { bgcolor: 'rgba(59, 130, 246, 0.05)' }
                  }}
                >
                  + Attach Dataset
                </Button>
              </Tooltip>
            )}
          </Box>

          <Button
            variant="contained"
            disabled={!selectedFile || uploading}
            onClick={handleStartUpload}
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <Sparkles size={16} />}
            sx={{
              px: 3,
              py: 1.2,
              fontWeight: 700,
              borderRadius: 2,
              textTransform: 'none',
              bgcolor: palette.primary,
              minWidth: { xs: '100%', md: 'auto' },
              flexShrink: 0
            }}
          >
            {uploading ? 'Processing Solution...' : 'Generate Solution'}
          </Button>
        </Box>

        {uploadError && (
          <Alert severity="error" sx={{ mt: 2, borderRadius: 2 }}>
            {uploadError}
          </Alert>
        )}
      </Paper>

      {/* ASSIGNMENTS LIST */}
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, display: 'flex', alignItems: 'center', gap: 1 }}>
          <FileCode size={20} color="#3b82f6" />
          Assignment Solutions ({assignments.length})
        </Typography>
      </Box>

      {loading && assignments.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <CircularProgress size={36} />
          <Typography variant="body2" sx={{ mt: 2, color: palette.textSecondary }}>
            Loading course assignments...
          </Typography>
        </Box>
      ) : assignments.length === 0 ? (
        /* EMPTY STATE */
        <Paper
          elevation={0}
          sx={{
            textAlign: 'center',
            py: 7,
            px: 3,
            borderRadius: 3,
            border: `1px dashed ${palette.cardBorder}`,
            bgcolor: palette.cardBg
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              mx: 'auto',
              borderRadius: '50%',
              bgcolor: 'rgba(59, 130, 246, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: palette.primary,
              mb: 2
            }}
          >
            <FileText size={28} />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: palette.textPrimary, mb: 0.5 }}>
            No assignments added yet
          </Typography>
          <Typography variant="body2" sx={{ color: palette.textSecondary, maxWidth: 520, mx: 'auto', mb: 3 }}>
            Upload an assignment PDF above to generate code-verified solutions aligned with your lecture notes and downloadable as both <strong>.ipynb</strong> and <strong>PDF</strong>.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Upload size={16} />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            Select Assignment PDF
          </Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {assignments.map((asgn) => {
            const isAwaitingApproval = asgn.status === 'awaiting_approval';
            const isProcessing = asgn.status === 'pending' || asgn.status === 'processing' || asgn.status === 'generating';
            const isNeedsInput = asgn.status === 'needs_input';
            const isCompleted = asgn.status === 'completed';
            const isFailed = asgn.status === 'failed';
            const isExpanded = !!expandedDetails[asgn.assignment_id];
            const questions = asgn.questions_summary || [];

            const ipynbUrl = `${API_BASE}/api/course/assignment/${asgn.assignment_id}/download/ipynb`;
            const pdfUrl = `${API_BASE}/api/course/assignment/${asgn.assignment_id}/download/pdf`;

            return (
              <Paper
                key={asgn.assignment_id}
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: 3,
                  border: `1px solid ${palette.cardBorder}`,
                  bgcolor: palette.cardBg,
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 280 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.8, flexWrap: 'wrap' }}>
                      <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, fontSize: '1.05rem' }}>
                        {asgn.title || 'Assignment Solution'}
                      </Typography>
                      {asgn.assignment_type === 'studio' && (
                        <Chip
                          icon={<Sparkles size={13} color="#7e22ce" />}
                          label="Studio Co-Pilot"
                          size="small"
                          sx={{ bgcolor: 'rgba(147, 51, 234, 0.1)', color: '#7e22ce', fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      )}
                      {isAwaitingApproval && (
                        <Chip
                          icon={<Sparkles size={13} color="#d97706" />}
                          label="Analysis Ready • Awaiting Your Go-Ahead"
                          size="small"
                          sx={{ bgcolor: '#fffbeb', color: '#92400e', fontWeight: 800, fontSize: '0.72rem', border: '1px solid #fde68a' }}
                        />
                      )}
                      {isCompleted && (
                        <>
                          <Chip
                            icon={<CheckCircle2 size={13} color="#047857" />}
                            label="Ready"
                            size="small"
                            sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700, fontSize: '0.72rem' }}
                          />
                          <ResponseTimeBadge ms={asgn.response_time_ms} />
                        </>
                      )}
                      {isNeedsInput && (
                        <Chip
                          icon={<AlertTriangle size={13} color="#b45309" />}
                          label="Dataset Required"
                          size="small"
                          sx={{ bgcolor: '#fffbeb', color: '#b45309', fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      )}
                      {isProcessing && (
                        <Chip
                          icon={<CircularProgress size={12} color="inherit" />}
                          label="Generating Solution & Executing..."
                          size="small"
                          sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      )}
                      {isFailed && (
                        <Chip
                          icon={<AlertCircle size={13} color="#b91c1c" />}
                          label="Failed"
                          size="small"
                          sx={{ bgcolor: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      )}
                    </Box>

                    <Typography variant="caption" sx={{ color: palette.textSecondary, display: 'block', mb: 1.5 }}>
                      File: <strong>{asgn.source_filename}</strong> • Added {new Date(asgn.created_at || Date.now()).toLocaleDateString()}
                    </Typography>

                    {isProcessing && (
                      <Box sx={{ width: '100%', maxWidth: 450, mt: 1.5, mb: 1.5 }}>
                        <LinearProgress sx={{ borderRadius: 1.5, height: 6 }} />
                        <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 600, mt: 0.5, display: 'block' }}>
                          Parsing PDF problems → Aligning with lecture citations → Running Python verification cells...
                        </Typography>
                      </Box>
                    )}

                    {/* CO-PILOT AWAITING APPROVAL / TRANSPARENT ANALYSIS BANNER */}
                    {isAwaitingApproval && (
                      <Box
                        sx={{
                          mt: 1.5,
                          mb: 2,
                          p: 2.2,
                          borderRadius: 2.5,
                          bgcolor: '#fffbeb',
                          border: '1px solid #fde68a'
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                          <Typography
                            variant="subtitle2"
                            sx={{ color: '#92400e', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}
                          >
                            <Sparkles size={16} color="#d97706" /> Co-Pilot Analysis & Plan Ready
                          </Typography>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Eye size={14} />}
                            onClick={() => handleOpenAnalysisModal(asgn)}
                            sx={{
                              textTransform: 'none',
                              fontWeight: 700,
                              borderRadius: 2,
                              fontSize: '0.78rem',
                              borderColor: '#f59e0b',
                              color: '#92400e',
                              bgcolor: '#ffffff',
                              '&:hover': { bgcolor: '#fef3c7' }
                            }}
                          >
                            Inspect Raw Text & Analysis
                          </Button>
                        </Box>

                        <Typography variant="body2" sx={{ color: '#78350f', fontSize: '0.82rem', mb: 1.5 }}>
                          Verbatim text extracted with <code>pypdf</code>. The AI parsed the problems and mapped lecture citations. Review below and give your go-ahead to execute verification code in the sandbox.
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                          <Chip
                            icon={<FileText size={12} color="#92400e" />}
                            label={`${asgn.raw_extracted_text ? asgn.raw_extracted_text.split(/\s+/).filter(Boolean).length : 'Verbatim'} Words`}
                            size="small"
                            sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.74rem' }}
                          />
                          <Chip
                            icon={<Code2 size={12} color="#92400e" />}
                            label={`${questions.length} Problems Extracted`}
                            size="small"
                            sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.74rem' }}
                          />
                          {asgn.citations?.length > 0 && (
                            <Chip
                              icon={<BookOpen size={12} color="#92400e" />}
                              label={`${asgn.citations.length} Lecture References`}
                              size="small"
                              sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.74rem' }}
                            />
                          )}
                        </Box>

                        {showGuidanceInput[asgn.assignment_id] && (
                          <Box sx={{ mb: 1.5 }}>
                            <TextField
                              fullWidth
                              size="small"
                              placeholder="Add guidance (e.g. 'Use PyTorch', 'Skip question 3', 'Include detailed derivations')..."
                              value={customGuidance[asgn.assignment_id] || ''}
                              onChange={(e) => setCustomGuidance((prev) => ({ ...prev, [asgn.assignment_id]: e.target.value }))}
                              sx={{ bgcolor: '#ffffff', borderRadius: 1.5 }}
                            />
                          </Box>
                        )}

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                          <Button
                            variant="contained"
                            size="small"
                            disabled={approvingAsgnId === asgn.assignment_id}
                            onClick={() => handleApproveSubmit(asgn.assignment_id)}
                            startIcon={
                              approvingAsgnId === asgn.assignment_id ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <Play size={14} />
                              )
                            }
                            sx={{
                              textTransform: 'none',
                              fontWeight: 800,
                              borderRadius: 2,
                              bgcolor: '#d97706',
                              color: '#ffffff',
                              boxShadow: '0 2px 6px rgba(217,119,6,0.3)',
                              '&:hover': { bgcolor: '#b45309' }
                            }}
                          >
                            {approvingAsgnId === asgn.assignment_id ? 'Starting Sandbox Runner...' : 'Approve & Execute Lab Notebook'}
                          </Button>

                          {asgn.assignment_type === 'studio' ? (
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<Sparkles size={14} color="#7e22ce" />}
                              onClick={() => handleOpenStudio(asgn.assignment_id)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: 2,
                                borderColor: '#d8b4fe',
                                color: '#7e22ce',
                                bgcolor: 'rgba(147, 51, 234, 0.05)',
                                '&:hover': { bgcolor: 'rgba(147, 51, 234, 0.12)' }
                              }}
                            >
                              Open in Studio Co-Pilot
                            </Button>
                          ) : (
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<Eye size={14} color="#0284c7" />}
                              onClick={() => handleOpenAnalysisModal(asgn)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: 2,
                                borderColor: '#bae6fd',
                                color: '#0284c7',
                                bgcolor: 'rgba(2, 132, 199, 0.05)',
                                '&:hover': { bgcolor: 'rgba(2, 132, 199, 0.12)' }
                              }}
                            >
                              Inspect Extraction & Plan
                            </Button>
                          )}

                          <Button
                            variant="text"
                            size="small"
                            onClick={() => setShowGuidanceInput((prev) => ({ ...prev, [asgn.assignment_id]: !prev[asgn.assignment_id] }))}
                            sx={{ textTransform: 'none', fontWeight: 600, color: '#92400e', fontSize: '0.8rem' }}
                          >
                            {showGuidanceInput[asgn.assignment_id] ? 'Hide Guidance' : '+ Add Guidance'}
                          </Button>
                        </Box>
                      </Box>
                    )}

                    {isNeedsInput && (
                      <Box
                        sx={{
                          mt: 1.5,
                          mb: 1.5,
                          p: 2,
                          borderRadius: 2,
                          bgcolor: '#fffbeb',
                          border: '1px solid #fde68a'
                        }}
                      >
                        <Typography
                          variant="subtitle2"
                          sx={{ color: '#92400e', fontWeight: 700, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <AlertTriangle size={16} /> Dataset Required to Run Solution
                        </Typography>
                        <Typography variant="body2" sx={{ color: '#b45309', fontSize: '0.82rem', mb: 1.5 }}>
                          {asgn.error_message ||
                            `This assignment requires external dataset(s): ${asgn.required_files?.join(', ') || 'dataset file'}. Upload the dataset file below to run and verify the Python execution cells.`}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="file"
                            ref={(el) => {
                              provideInputRefs.current[asgn.assignment_id] = el;
                            }}
                            style={{ display: 'none' }}
                            onChange={(e) => handleDatasetFileSelected(asgn.assignment_id, e.target.files?.[0])}
                          />
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Database size={14} />}
                            onClick={() => provideInputRefs.current[asgn.assignment_id]?.click()}
                            sx={{
                              textTransform: 'none',
                              fontWeight: 600,
                              borderColor: '#f59e0b',
                              color: '#b45309',
                              bgcolor: '#ffffff',
                              '&:hover': { bgcolor: '#fef3c7' }
                            }}
                          >
                            {pendingDatasetFiles[asgn.assignment_id]?.name ||
                              `Select Dataset (${asgn.required_files?.[0] || '.csv'})`}
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            disabled={!pendingDatasetFiles[asgn.assignment_id] || uploadingDataset[asgn.assignment_id]}
                            onClick={() => handleProvideDatasetSubmit(asgn.assignment_id)}
                            startIcon={
                              uploadingDataset[asgn.assignment_id] ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <Upload size={14} />
                              )
                            }
                            sx={{
                              textTransform: 'none',
                              fontWeight: 700,
                              bgcolor: '#d97706',
                              color: '#ffffff',
                              '&:hover': { bgcolor: '#b45309' }
                            }}
                          >
                            {uploadingDataset[asgn.assignment_id] ? 'Uploading...' : 'Upload & Resume Execution'}
                          </Button>
                          {(onSkipDataset || onRegenerateAssignment) && (
                            <Button
                              variant="text"
                              size="small"
                              onClick={() => {
                                if (onSkipDataset) {
                                  onSkipDataset(asgn.assignment_id);
                                } else if (onRegenerateAssignment) {
                                  onRegenerateAssignment(asgn.assignment_id);
                                }
                              }}
                              startIcon={<Sparkles size={14} />}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                color: '#92400e',
                                '&:hover': { bgcolor: 'rgba(217, 119, 6, 0.12)' }
                              }}
                            >
                              Generate Without Dataset
                            </Button>
                          )}
                        </Box>
                      </Box>
                    )}

                    {isFailed && asgn.error_message && (
                      <Alert severity="error" sx={{ mt: 1, py: 0.5, px: 1.5, fontSize: '0.8rem', borderRadius: 2 }}>
                        {asgn.error_message}
                      </Alert>
                    )}
                  </Box>

                  {/* ACTION BUTTONS */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    {(asgn.assignment_type === 'studio' || asgn.chat_history?.length > 0) && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Sparkles size={14} color="#7e22ce" />}
                        onClick={() => handleOpenStudio(asgn.assignment_id)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          borderRadius: 2,
                          borderColor: '#d8b4fe',
                          color: '#7e22ce',
                          bgcolor: 'rgba(147, 51, 234, 0.05)',
                          '&:hover': { bgcolor: 'rgba(147, 51, 234, 0.12)' }
                        }}
                      >
                        Open in Studio
                      </Button>
                    )}

                    {isCompleted && (
                      <>
                        {asgn.assignment_type !== 'studio' && (
                          <>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<Eye size={14} color="#2563eb" />}
                              onClick={() => handleOpenNotebookPreview(asgn)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: 2,
                                borderColor: '#93c5fd',
                                color: '#2563eb',
                                bgcolor: 'rgba(37, 99, 235, 0.05)',
                                '&:hover': { bgcolor: 'rgba(37, 99, 235, 0.12)' }
                              }}
                            >
                              Preview Executed Notebook
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<Terminal size={14} />}
                              href={ipynbUrl}
                              download
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: 2,
                                borderColor: '#cbd5e1',
                                color: '#0f172a',
                                '&:hover': { bgcolor: 'rgba(0,0,0,0.03)' }
                              }}
                            >
                              Download .ipynb
                            </Button>
                          </>
                        )}
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<Download size={14} />}
                          href={pdfUrl}
                          download
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            borderRadius: 2,
                            bgcolor: '#2563eb',
                            color: '#ffffff',
                            '&:hover': { bgcolor: '#1d4ed8' }
                          }}
                        >
                          Download Solution PDF
                        </Button>
                      </>
                    )}

                    {isAwaitingApproval && (
                      <Button
                        variant="contained"
                        size="small"
                        disabled={approvingAsgnId === asgn.assignment_id}
                        onClick={() => handleApproveSubmit(asgn.assignment_id)}
                        startIcon={
                          approvingAsgnId === asgn.assignment_id ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <Play size={14} />
                          )
                        }
                        sx={{
                          textTransform: 'none',
                          fontWeight: 800,
                          borderRadius: 2,
                          bgcolor: '#d97706',
                          color: '#ffffff',
                          boxShadow: '0 2px 6px rgba(217,119,6,0.3)',
                          '&:hover': { bgcolor: '#b45309' }
                        }}
                      >
                        {approvingAsgnId === asgn.assignment_id ? 'Starting...' : 'Approve & Execute'}
                      </Button>
                    )}

                    <Tooltip title="Inspect verbatim text (pypdf) & AI problem breakdown">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenAnalysisModal(asgn)}
                        sx={{ border: `1px solid ${palette.cardBorder}`, borderRadius: 2, color: '#0284c7' }}
                      >
                        <Eye size={15} />
                      </IconButton>
                    </Tooltip>

                    {questions.length > 0 && (
                      <IconButton
                        size="small"
                        onClick={() => toggleDetails(asgn.assignment_id)}
                        sx={{ border: `1px solid ${palette.cardBorder}`, borderRadius: 2 }}
                        title="Toggle Problem Breakdown"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </IconButton>
                    )}

                    <IconButton
                      size="small"
                      disabled={isProcessing}
                      onClick={() => {
                        if (window.confirm(`Regenerate solution for "${asgn.title}" with updated lecture citations?`)) {
                          onRegenerateAssignment?.(asgn.assignment_id);
                        }
                      }}
                      sx={{ border: `1px solid ${palette.cardBorder}`, borderRadius: 2, color: '#3b82f6' }}
                      title="Regenerate Solution & Executed PDF"
                    >
                      <RotateCcw size={15} />
                    </IconButton>

                    <IconButton
                      size="small"
                      onClick={() => {
                        if (window.confirm(`Delete assignment "${asgn.title}"?`)) {
                          onDeleteAssignment(asgn.assignment_id);
                        }
                      }}
                      sx={{ color: '#94a3b8', '&:hover': { color: '#ef4444' } }}
                      title="Delete assignment"
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Box>
                </Box>

                {/* OPTION 1: DEADLINE & CALENDAR SYNC BAR + SUBMISSIONS / AI SPEEDGRADER */}
                <Box
                  sx={{
                    mt: 2,
                    pt: 2,
                    borderTop: `1px dashed ${palette.cardBorder}`,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5
                  }}
                >
                  {isTutor ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap' }}>
                      <TextField
                        type="datetime-local"
                        size="small"
                        label="Due Date (Calendar Sync)"
                        slotProps={{ inputLabel: { shrink: true } }}
                        value={
                          publishDrafts[asgn.assignment_id]?.due_date !== undefined
                            ? publishDrafts[asgn.assignment_id].due_date
                            : (asgn.due_date || '').slice(0, 16)
                        }
                        onChange={(e) =>
                          setPublishDrafts((prev) => ({
                            ...prev,
                            [asgn.assignment_id]: {
                              ...(prev[asgn.assignment_id] || {}),
                              due_date: e.target.value
                            }
                          }))
                        }
                        sx={{ minWidth: 215 }}
                      />
                      <TextField
                        type="number"
                        size="small"
                        label="Max Marks"
                        value={
                          publishDrafts[asgn.assignment_id]?.max_marks !== undefined
                            ? publishDrafts[asgn.assignment_id].max_marks
                            : (asgn.max_marks ?? 100)
                        }
                        onChange={(e) =>
                          setPublishDrafts((prev) => ({
                            ...prev,
                            [asgn.assignment_id]: {
                              ...(prev[asgn.assignment_id] || {}),
                              max_marks: e.target.value
                            }
                          }))
                        }
                        sx={{ width: 105 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={publishingId === asgn.assignment_id}
                        startIcon={<Calendar size={14} />}
                        onClick={() => handlePublishSettings(asgn)}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                      >
                        {publishingId === asgn.assignment_id ? 'Syncing...' : 'Publish & Sync Calendar'}
                      </Button>
                      {(asgn.due_date || publishStatusMsg[asgn.assignment_id]) && (
                        <Chip
                          icon={<Calendar size={12} color="#047857" />}
                          label={publishStatusMsg[asgn.assignment_id] || `Due: ${new Date(asgn.due_date).toLocaleDateString()}`}
                          size="small"
                          sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700, fontSize: '0.72rem' }}
                        />
                      )}
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        icon={<Calendar size={13} />}
                        label={asgn.due_date ? `Due: ${new Date(asgn.due_date).toLocaleString()}` : 'No strict deadline'}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                      <Chip
                        icon={<Award size={13} />}
                        label={`${asgn.max_marks || 100} Marks`}
                        size="small"
                        sx={{ fontWeight: 700, bgcolor: 'rgba(59, 130, 246, 0.1)', color: '#1d4ed8' }}
                      />
                    </Box>
                  )}

                  <Button
                    variant={openGraderMap[asgn.assignment_id] ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={isTutor ? <Users size={14} /> : <Send size={14} />}
                    onClick={() => handleToggleGrader(asgn.assignment_id)}
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                  >
                    {isTutor
                      ? `Submissions & AI SpeedGrader${submissionsByAsgn[asgn.assignment_id] ? ` (${submissionsByAsgn[asgn.assignment_id].length})` : ''}`
                      : 'Submit Work / View Grade'}
                  </Button>
                </Box>

                {/* SUBMISSIONS & AI SPEEDGRADER DRAWER */}
                <Collapse in={!!openGraderMap[asgn.assignment_id]} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      mt: 2,
                      p: 2.5,
                      borderRadius: 2.5,
                      bgcolor: 'rgba(59, 130, 246, 0.03)',
                      border: `1px solid ${palette.cardBorder}`
                    }}
                  >
                    {/* Student Submission Form (available to students or tutors testing submission) */}
                    <Box sx={{ mb: isTutor ? 2.5 : 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 1 }}>
                        {isTutor ? 'Submit Test Student Solution / Reference Attempt' : 'Submit Your Assignment Solution'}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                        <TextField
                          multiline
                          minRows={2}
                          size="small"
                          placeholder="Paste your mathematical derivation, Python code, or solution summary here..."
                          value={studentSubmitDrafts[asgn.assignment_id]?.text || ''}
                          onChange={(e) =>
                            setStudentSubmitDrafts((prev) => ({
                              ...prev,
                              [asgn.assignment_id]: {
                                ...(prev[asgn.assignment_id] || {}),
                                text: e.target.value
                              }
                            }))
                          }
                        />
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                          <TextField
                            size="small"
                            placeholder="Attachment filename (e.g. solution.ipynb)"
                            value={studentSubmitDrafts[asgn.assignment_id]?.fileName || ''}
                            onChange={(e) =>
                              setStudentSubmitDrafts((prev) => ({
                                ...prev,
                                [asgn.assignment_id]: {
                                  ...(prev[asgn.assignment_id] || {}),
                                  fileName: e.target.value
                                }
                              }))
                            }
                            sx={{ minWidth: 240 }}
                          />
                          <Button
                            variant="contained"
                            size="small"
                            disabled={submittingAsgnId === asgn.assignment_id}
                            startIcon={<Send size={14} />}
                            onClick={() => handleStudentSubmitWork(asgn)}
                            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                          >
                            {submittingAsgnId === asgn.assignment_id ? 'Submitting...' : 'Submit Assignment'}
                          </Button>
                        </Box>
                      </Box>
                    </Box>

                    {/* Submissions List & AI SpeedGrader */}
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 1.5 }}>
                      {isTutor ? 'Student Submissions & AI SpeedGrader' : 'Your Submission Status & Feedback'}
                    </Typography>

                    {loadingSubs[asgn.assignment_id] ? (
                      <CircularProgress size={22} />
                    ) : (submissionsByAsgn[asgn.assignment_id] || []).length === 0 ? (
                      <Typography variant="body2" sx={{ color: palette.textSecondary, fontSize: '0.84rem' }}>
                        No student submissions recorded for this assignment yet.
                      </Typography>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {(submissionsByAsgn[asgn.assignment_id] || []).map((sub) => {
                          const gDraft = gradeDrafts[sub.submission_id] || {};
                          return (
                            <Paper
                              key={sub.submission_id}
                              elevation={0}
                              sx={{
                                p: 2,
                                borderRadius: 2,
                                border: `1px solid ${palette.cardBorder}`,
                                bgcolor: palette.cardBg
                              }}
                            >
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                                <Box>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {sub.student_name || sub.student_email} ({sub.student_email})
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                                    Submitted {new Date(sub.submitted_at || Date.now()).toLocaleString()}
                                    {sub.file_name ? ` • Attachment: ${sub.file_name}` : ''}
                                  </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Chip
                                    label={
                                      sub.status === 'graded'
                                        ? `Graded: ${sub.score} / ${sub.max_marks}`
                                        : 'Submitted (Pending Grade)'
                                    }
                                    size="small"
                                    sx={{
                                      bgcolor: sub.status === 'graded' ? '#ecfdf5' : '#eff6ff',
                                      color: sub.status === 'graded' ? '#047857' : '#1d4ed8',
                                      fontWeight: 700
                                    }}
                                  />
                                  {isTutor && (
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      disabled={aiGradingSubId === sub.submission_id}
                                      startIcon={<Sparkles size={13} />}
                                      onClick={() => handleRunAiSpeedGrader(asgn.assignment_id, sub.submission_id)}
                                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 1.5 }}
                                    >
                                      {aiGradingSubId === sub.submission_id ? 'Evaluating...' : 'AI SpeedGrade'}
                                    </Button>
                                  )}
                                </Box>
                              </Box>

                              {sub.submission_text && (
                                <Typography
                                  variant="body2"
                                  sx={{
                                    p: 1.5,
                                    mb: 1.5,
                                    borderRadius: 1.5,
                                    bgcolor: 'rgba(0,0,0,0.025)',
                                    fontFamily: 'monospace',
                                    fontSize: '0.8rem',
                                    whiteSpace: 'pre-wrap'
                                  }}
                                >
                                  {sub.submission_text}
                                </Typography>
                              )}

                              {sub.ai_suggested_score !== null && sub.ai_suggested_score !== undefined && (
                                <Alert severity="info" sx={{ mb: 1.5, py: 0.5, borderRadius: 1.5 }}>
                                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <span>
                                      <strong>AI SpeedGrader Suggestion:</strong> {sub.ai_suggested_score} / {sub.max_marks} — {sub.ai_feedback}
                                    </span>
                                    <ResponseTimeBadge ms={sub.response_time_ms} />
                                  </Box>
                                </Alert>
                              )}

                              {isTutor ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap', mt: 1 }}>
                                  <TextField
                                    type="number"
                                    size="small"
                                    label={`Score (/ ${sub.max_marks})`}
                                    value={gDraft.score ?? ''}
                                    onChange={(e) =>
                                      setGradeDrafts((prev) => ({
                                        ...prev,
                                        [sub.submission_id]: {
                                          ...(prev[sub.submission_id] || {}),
                                          score: e.target.value
                                        }
                                      }))
                                    }
                                    sx={{ width: 130 }}
                                  />
                                  <TextField
                                    size="small"
                                    label="Instructor Feedback"
                                    value={gDraft.feedback ?? ''}
                                    onChange={(e) =>
                                      setGradeDrafts((prev) => ({
                                        ...prev,
                                        [sub.submission_id]: {
                                          ...(prev[sub.submission_id] || {}),
                                          feedback: e.target.value
                                        }
                                      }))
                                    }
                                    sx={{ flex: 1, minWidth: 220 }}
                                  />
                                  <Button
                                    variant="contained"
                                    size="small"
                                    disabled={savingGradeSubId === sub.submission_id}
                                    onClick={() => handleSaveSubmissionGrade(asgn.assignment_id, sub.submission_id)}
                                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 1.5 }}
                                  >
                                    {savingGradeSubId === sub.submission_id ? 'Saving...' : 'Approve & Save Grade'}
                                  </Button>
                                </Box>
                              ) : (
                                sub.instructor_feedback && (
                                  <Typography variant="body2" sx={{ color: '#047857', fontWeight: 600 }}>
                                    Instructor Feedback: {sub.instructor_feedback}
                                  </Typography>
                                )
                              )}
                            </Paper>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                </Collapse>

                {/* PROBLEM BREAKDOWN COLLAPSIBLE DRAWER */}
                {questions.length > 0 && (
                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: palette.textPrimary, mb: 1.5 }}>
                      Extracted Problems & Course Alignments:
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      {questions.map((q, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            bgcolor: 'rgba(0,0,0,0.02)',
                            border: `1px solid ${palette.cardBorder}`
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700, color: '#1e293b', mb: 0.5 }}>
                            Problem {q.question_number || idx + 1}: {q.title || 'Problem'}
                          </Typography>
                          <Typography variant="body2" sx={{ color: palette.textSecondary, fontSize: '0.82rem', mb: 1 }}>
                            {q.question_text?.slice(0, 220)}...
                          </Typography>

                          {q.course_references?.length > 0 && (
                            <Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed #cbd5e1' }}>
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <BookOpen size={12} /> Course Lecture References:
                              </Typography>
                              {q.course_references.map((c, cIdx) => (
                                <Typography key={cIdx} variant="caption" sx={{ display: 'block', color: '#475569', fontSize: '0.75rem' }}>
                                  • <strong>{c.lecture_title}</strong> at <code>{c.timestamp}</code>: "{c.snippet?.slice(0, 90)}..."
                                </Typography>
                              ))}
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Collapse>
                )}
              </Paper>
            );
          })}
        </Box>
      )}

      {/* RAW PDF TEXT & CO-PILOT ANALYSIS INSPECTOR MODAL */}
      <Dialog
        open={!!activeAnalysisModal}
        onClose={() => setActiveAnalysisModal(null)}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: {
            sx: { borderRadius: 3, p: 0, bgcolor: palette.cardBg }
          }
        }}
      >
        <DialogTitle sx={{ pb: 1, borderBottom: `1px solid ${palette.cardBorder}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, fontSize: '1.1rem' }}>
                Assignment Analysis & Extraction Inspector
              </Typography>
              <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                {activeAnalysisModal?.title} • {activeAnalysisModal?.source_filename}
              </Typography>
            </Box>
            {activeAnalysisModal?.status === 'awaiting_approval' && (
              <Chip
                icon={<Sparkles size={12} color="#92400e" />}
                label="Awaiting Approval"
                size="small"
                sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 700 }}
              />
            )}
          </Box>
        </DialogTitle>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, pt: 1 }}>
          <Tabs
            value={analysisModalTab}
            onChange={(e, val) => setAnalysisModalTab(val)}
            textColor="primary"
            indicatorColor="primary"
          >
            <Tab label="1. Raw Text (pypdf)" icon={<FileText size={15} />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 700 }} />
            <Tab label={`2. Parsed Problems (${activeAnalysisModal?.questions_summary?.length || 0})`} icon={<Code2 size={15} />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 700 }} />
            <Tab label={`3. Lecture Citations (${activeAnalysisModal?.citations?.length || 0})`} icon={<BookOpen size={15} />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 700 }} />
          </Tabs>
        </Box>

        <DialogContent sx={{ p: 3, maxHeight: '65vh' }}>
          {loadingAnalysis ? (
            <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <CircularProgress size={30} />
              <Typography variant="body2" sx={{ color: palette.textSecondary }}>
                Fetching raw text extraction & citations...
              </Typography>
            </Box>
          ) : analysisModalTab === 0 ? (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                  Extracted via <code>pypdf</code> with layout preservation. Inspect text, equations, or tabular records:
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={copiedRawText ? <Check size={13} color="#047857" /> : <Copy size={13} />}
                  onClick={() => handleCopyRawText(activeAnalysisModal?.raw_extracted_text)}
                  sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem', borderRadius: 1.5 }}
                >
                  {copiedRawText ? 'Copied to Clipboard' : 'Copy Raw Text'}
                </Button>
              </Box>

              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  bgcolor: '#0f172a',
                  color: '#f8fafc',
                  borderRadius: 2,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  lineHeight: 1.6,
                  maxHeight: '48vh',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  border: '1px solid #334155'
                }}
              >
                {activeAnalysisModal?.raw_extracted_text || 'No raw text stored or file is empty.'}
              </Paper>
            </Box>
          ) : analysisModalTab === 1 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(!activeAnalysisModal?.questions_summary || activeAnalysisModal.questions_summary.length === 0) ? (
                <Typography variant="body2" sx={{ color: palette.textSecondary, py: 4, textAlign: 'center' }}>
                  No discrete problems parsed.
                </Typography>
              ) : (
                activeAnalysisModal.questions_summary.map((q, qIdx) => (
                  <Paper
                    key={qIdx}
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: `1px solid ${palette.cardBorder}`,
                      bgcolor: 'rgba(0,0,0,0.01)'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary }}>
                        Problem {q.question_number || qIdx + 1}: {q.title || 'Question'}
                      </Typography>
                      {q.estimated_difficulty && (
                        <Chip
                          label={q.estimated_difficulty}
                          size="small"
                          sx={{ textTransform: 'capitalize', fontSize: '0.7rem', fontWeight: 700 }}
                        />
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ color: palette.textSecondary, fontSize: '0.84rem', mb: 1, whiteSpace: 'pre-wrap' }}>
                      {q.question_text || 'No question details.'}
                    </Typography>
                    {q.topics?.length > 0 && (
                      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mt: 1 }}>
                        {q.topics.map((t, tIdx) => (
                          <Chip key={tIdx} label={t} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />
                        ))}
                      </Box>
                    )}
                  </Paper>
                ))
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {(!activeAnalysisModal?.citations || activeAnalysisModal.citations.length === 0) ? (
                <Typography variant="body2" sx={{ color: palette.textSecondary, py: 4, textAlign: 'center' }}>
                  No lecture citations retrieved yet.
                </Typography>
              ) : (
                activeAnalysisModal.citations.map((c, cIdx) => (
                  <Paper
                    key={cIdx}
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: `1px solid ${palette.cardBorder}`,
                      bgcolor: '#f8fafc'
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1d4ed8', mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                      <BookOpen size={14} /> {c.lecture_title || 'Course Lecture'} {c.timestamp ? `at ${c.timestamp}` : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#475569', fontSize: '0.8rem', fontStyle: 'italic' }}>
                      "{c.snippet || 'Referenced lecture context'}"
                    </Typography>
                  </Paper>
                ))
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, px: 3, borderTop: `1px solid ${palette.cardBorder}`, justifyContent: 'space-between' }}>
          <Box>
            {activeAnalysisModal?.status === 'awaiting_approval' && (
              <Button
                variant="contained"
                size="small"
                disabled={approvingAsgnId === activeAnalysisModal.assignment_id}
                onClick={() => handleApproveSubmit(activeAnalysisModal.assignment_id)}
                startIcon={<Play size={14} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 800,
                  bgcolor: '#d97706',
                  color: '#ffffff',
                  '&:hover': { bgcolor: '#b45309' }
                }}
              >
                {approvingAsgnId === activeAnalysisModal.assignment_id ? 'Starting Sandbox...' : 'Approve & Execute Now'}
              </Button>
            )}
          </Box>
          <Button
            onClick={() => setActiveAnalysisModal(null)}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            Close Inspector
          </Button>
        </DialogActions>
      </Dialog>

      {/* EXECUTED NOTEBOOK PREVIEW MODAL */}
      <Dialog
        open={!!activeNotebookModal}
        onClose={() => setActiveNotebookModal(null)}
        maxWidth="lg"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              boxShadow: '0 20px 45px rgba(0,0,0,0.2)',
              overflow: 'hidden'
            }
          }
        }}
      >
        <DialogTitle sx={{ p: 2.5, px: 3, borderBottom: `1px solid ${palette.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#f8fafc' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Code2 size={20} color="#2563eb" />
              <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, fontSize: '1.1rem' }}>
                Executed Notebook Solution & Output Trace
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: palette.textSecondary }}>
              {activeNotebookModal?.title} • {activeNotebookModal?.source_filename || 'notebook.ipynb'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              icon={<CheckCircle2 size={13} color="#047857" />}
              label="Python 3 (ipykernel)"
              size="small"
              sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700 }}
            />
            {activeNotebookModal?.notebook?.cells && (
              <Chip
                label={`${activeNotebookModal.notebook.cells.length} Cells`}
                size="small"
                sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}
              />
            )}
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3, maxHeight: '72vh', bgcolor: '#f8fafc' }}>
          {loadingNotebook ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: 2 }}>
              <CircularProgress size={36} />
              <Typography variant="body2" sx={{ color: palette.textSecondary }}>
                Loading executed notebook cells, stdout logs, and rendered figures...
              </Typography>
            </Box>
          ) : activeNotebookModal?.error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {activeNotebookModal.error}
            </Alert>
          ) : !activeNotebookModal?.notebook?.cells || activeNotebookModal.notebook.cells.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body2" sx={{ color: palette.textSecondary }}>
                No cells found in this notebook.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {activeNotebookModal.notebook.cells.map((cell, cIdx) => {
                const isCode = cell.cell_type === 'code';
                const sourceText = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
                const outputs = cell.outputs || [];

                if (!isCode) {
                  return (
                    <Paper
                      key={cIdx}
                      elevation={0}
                      sx={{
                        p: 2.5,
                        borderRadius: 2,
                        bgcolor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderLeft: '4px solid #3b82f6'
                      }}
                    >
                      <Typography variant="caption" sx={{ color: '#2563eb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 1 }}>
                        Markdown / Problem Statement
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                        {sourceText}
                      </Typography>
                    </Paper>
                  );
                }

                return (
                  <Paper
                    key={cIdx}
                    elevation={0}
                    sx={{
                      p: 2.5,
                      borderRadius: 2,
                      bgcolor: '#ffffff',
                      border: '1px solid #cbd5e1'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Chip
                        label={`In [${cell.execution_count ?? cIdx + 1}]`}
                        size="small"
                        sx={{ bgcolor: '#e2e8f0', color: '#334155', fontWeight: 800, fontFamily: 'monospace', fontSize: '0.75rem' }}
                      />
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Code Cell
                      </Typography>
                    </Box>

                    {/* CODE SOURCE */}
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 2,
                        bgcolor: '#0f172a',
                        color: '#f8fafc',
                        borderRadius: 1.5,
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflowX: 'auto'
                      }}
                    >
                      {sourceText}
                    </Box>

                    {/* OUTPUTS */}
                    {outputs.length > 0 && (
                      <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Typography variant="caption" sx={{ color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Execution Outputs & Visualizations
                        </Typography>

                        {outputs.map((out, oIdx) => {
                          const oType = out.output_type;

                          if (oType === 'stream') {
                            const streamText = Array.isArray(out.text) ? out.text.join('') : String(out.text || '');
                            return (
                              <Box
                                key={oIdx}
                                component="pre"
                                sx={{
                                  m: 0,
                                  p: 2,
                                  bgcolor: '#f1f5f9',
                                  color: '#0f172a',
                                  borderRadius: 1.5,
                                  border: '1px solid #e2e8f0',
                                  borderLeft: '4px solid #10b981',
                                  fontFamily: 'monospace',
                                  fontSize: '0.8rem',
                                  lineHeight: 1.45,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  maxHeight: 280,
                                  overflowY: 'auto'
                                }}
                              >
                                {streamText}
                              </Box>
                            );
                          }

                          if (oType === 'display_data' || oType === 'execute_result') {
                            const imgB64 = out.data?.['image/png'];
                            const plainText = out.data?.['text/plain'];

                            if (imgB64) {
                              return (
                                <Box
                                  key={oIdx}
                                  sx={{
                                    textAlign: 'center',
                                    p: 2,
                                    bgcolor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 2,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                                  }}
                                >
                                  <img
                                    src={`data:image/png;base64,${imgB64}`}
                                    alt="Matplotlib / Seaborn Output"
                                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 4 }}
                                  />
                                </Box>
                              );
                            }

                            if (plainText) {
                              const textStr = Array.isArray(plainText) ? plainText.join('') : String(plainText);
                              return (
                                <Box
                                  key={oIdx}
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    p: 1.5,
                                    bgcolor: '#f8fafc',
                                    color: '#0f172a',
                                    borderRadius: 1.5,
                                    border: '1px solid #e2e8f0',
                                    fontFamily: 'monospace',
                                    fontSize: '0.8rem',
                                    whiteSpace: 'pre-wrap'
                                  }}
                                >
                                  {textStr}
                                </Box>
                              );
                            }
                          }

                          if (oType === 'error') {
                            const tb = Array.isArray(out.traceback) ? out.traceback.join('') : String(out.evalue || 'Error');
                            return (
                              <Box
                                key={oIdx}
                                component="pre"
                                sx={{
                                  m: 0,
                                  p: 2,
                                  bgcolor: '#fef2f2',
                                  color: '#b91c1c',
                                  borderRadius: 1.5,
                                  border: '1px solid #fecaca',
                                  fontFamily: 'monospace',
                                  fontSize: '0.8rem',
                                  whiteSpace: 'pre-wrap',
                                  overflowX: 'auto'
                                }}
                              >
                                {tb}
                              </Box>
                            );
                          }

                          return null;
                        })}
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, px: 3, borderTop: `1px solid ${palette.cardBorder}`, justifyContent: 'space-between', bgcolor: '#f8fafc' }}>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {activeNotebookModal?.assignment_id && (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Terminal size={14} />}
                  href={`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(activeNotebookModal.assignment_id)}/download?file_type=ipynb`}
                  download
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  Download .ipynb
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Download size={14} />}
                  href={`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(activeNotebookModal.assignment_id)}/download?file_type=pdf`}
                  download
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: '#2563eb' }}
                >
                  Download Solution PDF
                </Button>
              </>
            )}
          </Box>
          <Button
            onClick={() => setActiveNotebookModal(null)}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            Close Preview
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

