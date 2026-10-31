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
  Collapse
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
  Users
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import { getUserDisplayName } from '../../utils/formatters';
import AssignmentStudio from './AssignmentStudio';

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
    try {
      const emailParam = userEmail ? `?actor_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submissionId)}/ai-grade${emailParam}`,
        { method: 'POST' }
      );
      if (res.ok) {
        const data = await res.json();
        const sub = data.submission;
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.8 }}>
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
                      {isCompleted && (
                        <Chip
                          icon={<CheckCircle2 size={13} color="#047857" />}
                          label="Ready"
                          size="small"
                          sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700, fontSize: '0.72rem' }}
                        />
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
                                  <strong>AI SpeedGrader Suggestion:</strong> {sub.ai_suggested_score} / {sub.max_marks} — {sub.ai_feedback}
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
    </Box>
  );
}

