import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  CircularProgress,
  TextField,
  Divider,
  Alert,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell
} from '@mui/material';
import {
  Award,
  Download,
  PlusCircle,
  CheckCircle2,
  Clock,
  Send,
  FileText,
  BarChart3
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';

export default function CourseGrades({
  courseName = 'Active Course',
  isTutor = false,
  userEmail = '',
  userName = '',
  currentTheme
}) {
  const courseSlug = normalizeCourseSlug(courseName);
  const [gradebook, setGradebook] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Tutor override form state
  const [overrideStudentEmail, setOverrideStudentEmail] = useState('');
  const [overrideItemId, setOverrideItemId] = useState('');
  const [overrideItemTitle, setOverrideItemTitle] = useState('');
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideMaxMarks, setOverrideMaxMarks] = useState('100');
  const [overrideFeedback, setOverrideFeedback] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  // Student assignment submission state
  const [submittingAsgnId, setSubmittingAsgnId] = useState(null);
  const [studentDrafts, setStudentDrafts] = useState({});
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState('');

  const palette = currentTheme?.palette || {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  const fetchGradebookAndAssignments = useCallback(async () => {
    if (!courseSlug) return;
    setLoading(true);
    setError(null);
    try {
      const studentFilter = !isTutor && userEmail ? `?student_email=${encodeURIComponent(userEmail)}` : '';
      const [gbRes, asgnRes] = await Promise.all([
        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/gradebook${studentFilter}`),
        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments`)
      ]);

      if (gbRes.ok) {
        const gbData = await gbRes.json();
        setGradebook(gbData);
      }
      if (asgnRes.ok) {
        const asgnData = await asgnRes.json();
        setAssignments(asgnData.assignments || []);
      }
    } catch (err) {
      console.error('[CourseGrades] fetch error:', err);
      setError('Failed to load course gradebook.');
    } finally {
      setLoading(false);
    }
  }, [courseSlug, isTutor, userEmail]);

  useEffect(() => {
    fetchGradebookAndAssignments();
  }, [fetchGradebookAndAssignments]);

  const handleSaveOverride = async () => {
    if (!overrideStudentEmail.trim() || !overrideItemId.trim() || overrideScore === '') return;
    setSavingOverride(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/gradebook/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_email: overrideStudentEmail.trim(),
          item_id: overrideItemId.trim(),
          item_title: overrideItemTitle.trim() || overrideItemId.trim(),
          item_type: 'manual',
          score: Number(overrideScore),
          max_marks: Number(overrideMaxMarks || 100),
          feedback: overrideFeedback.trim(),
          actor_email: userEmail || undefined
        })
      });
      if (res.ok) {
        setOverrideScore('');
        setOverrideFeedback('');
        await fetchGradebookAndAssignments();
      }
    } catch (e) {
      console.error('Save gradebook override error:', e);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleStudentSubmitAssignment = async (assignmentId) => {
    const draft = studentDrafts[assignmentId] || {};
    if (!draft.text?.trim() && !draft.fileName?.trim()) return;
    setSubmittingAsgnId(assignmentId);
    setSubmitSuccessMsg('');
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_email: userEmail || 'student@iiitdwd.ac.in',
            student_name: userName || (userEmail ? userEmail.split('@')[0] : 'Student'),
            submission_text: draft.text || '',
            file_name: draft.fileName || ''
          })
        }
      );
      if (res.ok) {
        setStudentDrafts((prev) => ({ ...prev, [assignmentId]: { text: '', fileName: '' } }));
        setSubmitSuccessMsg('Assignment submitted! Your grade report has been updated.');
        await fetchGradebookAndAssignments();
      }
    } catch (e) {
      console.error('Student assignment submission error:', e);
    } finally {
      setSubmittingAsgnId(null);
    }
  };

  const handleExportCsv = () => {
    if (!gradebook) return;
    const cols = gradebook.columns || [];
    const headers = [
      'Student Name',
      'Student Email',
      ...cols.map((c) => `${c.title} (/ ${c.max_marks})`),
      'Total Earned',
      'Total Possible',
      'Overall %',
      'Letter Grade'
    ];
    const rows = (gradebook.students || []).map((st) => [
      `"${(st.student_name || '').replace(/"/g, '""')}"`,
      `"${st.student_email}"`,
      ...cols.map((c) => {
        const g = st.grades?.[c.item_id];
        return g && g.score !== null && g.score !== undefined ? g.score : '';
      }),
      st.total_earned,
      st.total_possible,
      st.overall_percentage,
      st.letter_grade
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${courseSlug}_gradebook.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = gradebook?.columns || [];
  const students = gradebook?.students || [];
  const summary = gradebook?.summary || {};
  const personalRow = students[0] || null;

  return (
    <Box sx={{ width: '100%', maxWidth: 1150, mx: 'auto', pb: 8 }}>
      {/* HEADER BANNER */}
      <Paper
        elevation={0}
        sx={{
          p: 3.5,
          mb: 3.5,
          borderRadius: 3,
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.06) 100%)',
          border: `1px solid ${palette.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Chip
              icon={<Award size={14} color="#047857" />}
              label={isTutor ? 'Tutor Class Grader Matrix' : 'Student Gradebook & Submissions'}
              size="small"
              sx={{ bgcolor: 'rgba(16, 185, 129, 0.14)', color: '#047857', fontWeight: 700 }}
            />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary }}>
            {courseName} • Course Gradebook
          </Typography>
          <Typography variant="body2" sx={{ color: palette.textSecondary, mt: 0.5 }}>
            {isTutor
              ? 'Unified grading across Course AI Quizzes, Assignments, and Manual Viva/Exam items with instant CSV export.'
              : 'Track your quiz and assignment grades, instructor feedback, and submit pending homework.'}
          </Typography>
        </Box>

        {isTutor && (
          <Button
            variant="outlined"
            startIcon={<Download size={16} />}
            onClick={handleExportCsv}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
          >
            Export Gradebook CSV
          </Button>
        )}
      </Paper>

      {/* SUMMARY KPI STRIP */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3.5
        }}
      >
        {isTutor ? (
          <>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>ENROLLED STUDENTS</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mt: 0.5 }}>{summary.student_count ?? 0}</Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>ASSESSMENT ITEMS</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mt: 0.5 }}>{summary.assessment_count ?? 0}</Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>CLASS AVERAGE</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#2563eb', mt: 0.5 }}>{summary.class_average_percentage ?? 0}%</Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>HIGHEST SCORE</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#047857', mt: 0.5 }}>{summary.highest_percentage ?? 0}%</Typography>
            </Paper>
          </>
        ) : (
          <>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>OVERALL PERCENTAGE</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#2563eb', mt: 0.5 }}>{personalRow?.overall_percentage ?? 0}%</Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>LETTER GRADE</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#047857', mt: 0.5 }}>{personalRow?.letter_grade ?? 'N/A'}</Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>TOTAL MARKS EARNED</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mt: 0.5 }}>
                {personalRow?.total_earned ?? 0} / {personalRow?.total_possible ?? 0}
              </Typography>
            </Paper>
            <Paper elevation={0} sx={{ p: 2.2, borderRadius: 2.5, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
              <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>COURSE ASSESSMENTS</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary, mt: 0.5 }}>{columns.length}</Typography>
            </Paper>
          </>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {/* TUTOR SCORE OVERRIDE / MANUAL ITEM BAR */}
      {isTutor && (
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mb: 3.5,
            borderRadius: 3,
            border: `1px solid ${palette.cardBorder}`,
            bgcolor: palette.cardBg
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PlusCircle size={16} color="#2563eb" /> Add Manual Grade Item or Override Score
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              label="Student Email"
              placeholder="student@iiitdwd.ac.in"
              value={overrideStudentEmail}
              onChange={(e) => setOverrideStudentEmail(e.target.value)}
              sx={{ minWidth: 210 }}
            />
            <TextField
              size="small"
              label="Item ID"
              placeholder="e.g. midterm_viva"
              value={overrideItemId}
              onChange={(e) => setOverrideItemId(e.target.value)}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              label="Assessment Title"
              placeholder="e.g. Midterm Viva"
              value={overrideItemTitle}
              onChange={(e) => setOverrideItemTitle(e.target.value)}
              sx={{ width: 170 }}
            />
            <TextField
              type="number"
              size="small"
              label="Score"
              value={overrideScore}
              onChange={(e) => setOverrideScore(e.target.value)}
              sx={{ width: 95 }}
            />
            <TextField
              type="number"
              size="small"
              label="Max Marks"
              value={overrideMaxMarks}
              onChange={(e) => setOverrideMaxMarks(e.target.value)}
              sx={{ width: 105 }}
            />
            <TextField
              size="small"
              label="Feedback"
              value={overrideFeedback}
              onChange={(e) => setOverrideFeedback(e.target.value)}
              sx={{ flex: 1, minWidth: 160 }}
            />
            <Button
              variant="contained"
              disabled={savingOverride}
              onClick={handleSaveOverride}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
            >
              {savingOverride ? 'Saving...' : 'Save Grade'}
            </Button>
          </Box>
        </Paper>
      )}

      {/* GRADEBOOK TABLE */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3,
          border: `1px solid ${palette.cardBorder}`,
          bgcolor: palette.cardBg,
          overflowX: 'auto',
          mb: 4
        }}
      >
        {loading ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={32} />
          </Box>
        ) : isTutor ? (
          <Box sx={{ minWidth: isTutor ? 720 : 'auto', overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <TableCell sx={{
                    fontWeight: 800,
                    position: isTutor ? 'sticky' : 'static',
                    left: 0,
                    bgcolor: palette.cardBg,
                    zIndex: 2
                  }}>Student</TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.item_id} align="center" sx={{ fontWeight: 800 }}>
                      {col.title}
                      <Typography variant="caption" sx={{ display: 'block', color: palette.textSecondary }}>
                        /{col.max_marks} ({col.item_type})
                      </Typography>
                    </TableCell>
                  ))}
                  <TableCell align="center" sx={{ fontWeight: 800 }}>Total</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 800 }}>Overall %</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 800 }}>Grade</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {students.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 4} align="center" sx={{ py: 4, color: palette.textSecondary }}>
                      No student grades recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  students.map((st) => (
                    <TableRow key={st.student_email} hover>
                      <TableCell sx={{
                        position: isTutor ? 'sticky' : 'static',
                        left: 0,
                        bgcolor: palette.cardBg,
                        zIndex: 1
                      }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{st.student_name}</Typography>
                        <Typography variant="caption" sx={{ color: palette.textSecondary }}>{st.student_email}</Typography>
                      </TableCell>
                      {columns.map((col) => {
                        const cell = st.grades?.[col.item_id];
                        return (
                          <TableCell key={col.item_id} align="center">
                            {cell && cell.score !== null && cell.score !== undefined ? (
                              <Chip
                                label={`${cell.score} / ${cell.max_marks}`}
                                size="small"
                                sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700 }}
                              />
                            ) : cell?.status === 'submitted' ? (
                              <Chip label="Submitted" size="small" sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} />
                            ) : (
                              <Typography variant="caption" sx={{ color: palette.textSecondary }}>—</Typography>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell align="center" sx={{ fontWeight: 700 }}>
                        {st.total_earned} / {st.total_possible}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 800, color: '#2563eb' }}>
                        {st.overall_percentage}%
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={st.letter_grade} size="small" sx={{ fontWeight: 800 }} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Box>
        ) : (
          /* STUDENT PERSONAL GRADE REPORT (Desktop Table + Mobile Cards) */
          <>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                    <TableCell sx={{ fontWeight: 800 }}>Assessment Item</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Category</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 800 }}>Status</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 800 }}>Score</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 800 }}>Percentage</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Feedback</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {columns.map((col) => {
                    const g = personalRow?.grades?.[col.item_id] || {};
                    return (
                      <TableRow key={col.item_id} hover>
                        <TableCell sx={{ fontWeight: 700 }}>{col.title}</TableCell>
                        <TableCell>
                          <Chip label={col.item_type} size="small" sx={{ textTransform: 'capitalize', fontWeight: 600 }} />
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={g.status || 'missing'}
                            size="small"
                            sx={{
                              textTransform: 'capitalize',
                              fontWeight: 700,
                              bgcolor: g.score !== null && g.score !== undefined ? '#ecfdf5' : '#f8fafc',
                              color: g.score !== null && g.score !== undefined ? '#047857' : '#64748b'
                            }}
                          />
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700 }}>
                          {g.score !== null && g.score !== undefined ? `${g.score} / ${g.max_marks}` : `— / ${col.max_marks}`}
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 800, color: '#2563eb' }}>
                          {g.percentage !== null && g.percentage !== undefined ? `${g.percentage}%` : '—'}
                        </TableCell>
                        <TableCell sx={{ color: palette.textSecondary, fontSize: '0.82rem' }}>
                          {g.feedback || '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>

            {/* Mobile Grade Cards on < 900px */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 1.5, p: 1.5 }}>
              {columns.map((col) => {
                const g = personalRow?.grades?.[col.item_id] || {};
                const hasScore = g.score !== null && g.score !== undefined;
                return (
                  <Box
                    key={col.item_id}
                    sx={{
                      p: 1.8,
                      borderRadius: 2.5,
                      border: `1px solid ${palette.cardBorder}`,
                      bgcolor: 'rgba(0,0,0,0.01)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: palette.textPrimary }}>
                          {col.title}
                        </Typography>
                        <Chip
                          label={col.item_type}
                          size="small"
                          sx={{ height: 20, fontSize: '0.68rem', textTransform: 'capitalize', mt: 0.5 }}
                        />
                      </Box>
                      <Chip
                        label={hasScore ? `${g.score} / ${g.max_marks}` : `— / ${col.max_marks}`}
                        size="small"
                        sx={{
                          fontWeight: 800,
                          bgcolor: hasScore ? '#ecfdf5' : '#f8fafc',
                          color: hasScore ? '#047857' : palette.textSecondary
                        }}
                      />
                    </Box>

                    {hasScore && g.percentage !== null && g.percentage !== undefined && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 700 }}>
                          Percentage
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 800, color: '#2563eb' }}>
                          {g.percentage}%
                        </Typography>
                      </Box>
                    )}

                    {g.feedback && (
                      <Typography variant="caption" sx={{ color: palette.textSecondary, bgcolor: 'var(--highlight-bg)', p: 1, borderRadius: 1.5 }}>
                        <strong>Feedback:</strong> {g.feedback}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </>
        )}
      </Paper>

      {/* STUDENT HOMEWORK SUBMISSION PORTAL (Option 1 accessible directly inside Student Gradebook) */}
      {!isTutor && assignments.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: 3,
            border: `1px solid ${palette.cardBorder}`,
            bgcolor: palette.cardBg
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FileText size={19} color="#2563eb" /> Course Assignments & Submission Portal
          </Typography>
          <Typography variant="body2" sx={{ color: palette.textSecondary, mb: 2.5 }}>
            Submit your assignment solutions below. Once graded by your instructor or AI SpeedGrader, your scores automatically appear in the Grade Report above.
          </Typography>

          {submitSuccessMsg && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
              {submitSuccessMsg}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {assignments.map((asgn) => {
              const draft = studentDrafts[asgn.assignment_id] || {};
              return (
                <Paper
                  key={asgn.assignment_id}
                  elevation={0}
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    border: `1px solid ${palette.cardBorder}`
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{asgn.title}</Typography>
                      <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                        {asgn.due_date ? `Due: ${new Date(asgn.due_date).toLocaleString()}` : 'Open submission'} • Max Marks: {asgn.max_marks || 100}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                    <TextField
                      multiline
                      minRows={2}
                      size="small"
                      placeholder="Enter your solution derivation, code, or notebook link..."
                      value={draft.text || ''}
                      onChange={(e) =>
                        setStudentDrafts((prev) => ({
                          ...prev,
                          [asgn.assignment_id]: { ...(prev[asgn.assignment_id] || {}), text: e.target.value }
                        }))
                      }
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        placeholder="Attachment filename (e.g. hw1_solution.ipynb)"
                        value={draft.fileName || ''}
                        onChange={(e) =>
                          setStudentDrafts((prev) => ({
                            ...prev,
                            [asgn.assignment_id]: { ...(prev[asgn.assignment_id] || {}), fileName: e.target.value }
                          }))
                        }
                        sx={{ minWidth: 240 }}
                      />
                      <Button
                        variant="contained"
                        size="small"
                        disabled={submittingAsgnId === asgn.assignment_id}
                        startIcon={<Send size={14} />}
                        onClick={() => handleStudentSubmitAssignment(asgn.assignment_id)}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                      >
                        {submittingAsgnId === asgn.assignment_id ? 'Submitting...' : 'Submit Solution'}
                      </Button>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        </Paper>
      )}
    </Box>
  );
}

