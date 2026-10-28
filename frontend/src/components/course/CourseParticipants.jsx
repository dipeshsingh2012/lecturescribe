import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  CircularProgress,
  TextField,
  Alert,
  IconButton,
  Avatar,
  Select,
  MenuItem
} from '@mui/material';
import {
  Users,
  Key,
  UserPlus,
  Copy,
  RefreshCw,
  Trash2,
  ShieldCheck,
  GraduationCap,
  Check
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import { getUserDisplayName } from '../../utils/formatters';

export default function CourseParticipants({
  courseName = 'Active Course',
  isTutor = false,
  userEmail = '',
  userName = '',
  currentTheme
}) {
  const courseSlug = normalizeCourseSlug(courseName);
  const [members, setMembers] = useState([]);
  const [keyRecord, setKeyRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Tutor manual enrollment / key rotation state
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('student');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [actionMsg, setActionMsg] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Student self-enrollment key input
  const [studentKeyInput, setStudentKeyInput] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const palette = currentTheme?.palette || {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  const fetchRosterAndKey = useCallback(async () => {
    if (!courseSlug) return;
    setLoading(true);
    try {
      const [memRes, keyRes] = await Promise.all([
        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/members`),
        fetch(
          `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/enrollment-key${
            userEmail ? `?actor_email=${encodeURIComponent(userEmail)}` : ''
          }`
        )
      ]);
      if (memRes.ok) {
        const memData = await memRes.json();
        setMembers(memData.members || []);
      }
      if (keyRes.ok) {
        const keyData = await keyRes.json();
        setKeyRecord(keyData.key_record || null);
      }
    } catch (e) {
      console.error('[CourseParticipants] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [courseSlug, userEmail]);

  useEffect(() => {
    fetchRosterAndKey();
  }, [fetchRosterAndKey]);

  const handleGenerateOrRotateKey = async () => {
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/enrollment-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_email: userEmail || undefined,
          custom_key: customKeyInput.trim() || undefined
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Could not generate key.');
      }
      const data = await res.json();
      setKeyRecord(data.key_record);
      setCustomKeyInput('');
      setActionMsg(`Active enrollment key updated to ${data.key_record?.enrollment_key}`);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleAddOrUpdateMember = async (targetEmail, targetRole) => {
    if (!targetEmail?.trim()) return;
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: targetEmail.trim(),
          course_role: targetRole,
          enrol_method: 'manual',
          actor_email: userEmail || undefined
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Could not update member.');
      }
      setNewMemberEmail('');
      setActionMsg(`Enrolled ${targetEmail.trim()} as ${targetRole}.`);
      await fetchRosterAndKey();
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleRemoveMember = async (targetEmail) => {
    setActionError(null);
    try {
      const actorParam = userEmail ? `?actor_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/members/${encodeURIComponent(targetEmail)}${actorParam}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.user_email !== targetEmail));
      }
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleStudentSelfEnrol = async () => {
    if (!studentKeyInput.trim()) return;
    setEnrolling(true);
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/course/enrol-by-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollment_key: studentKeyInput.trim(),
          user_email: userEmail || 'student@iiitdwd.ac.in',
          user_name: getUserDisplayName(userName, userEmail, 'Student')
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Invalid enrollment key.');
      }
      const data = await res.json();
      setStudentKeyInput('');
      setActionMsg(`Successfully enrolled in ${data.enrollment?.course_name || courseName}!`);
      await fetchRosterAndKey();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setEnrolling(false);
    }
  };

  const copyEnrollmentKey = () => {
    if (!keyRecord?.enrollment_key) return;
    navigator.clipboard?.writeText(keyRecord.enrollment_key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const tutorsCount = members.filter((m) => m.course_role === 'tutor').length;
  const studentsCount = members.filter((m) => m.course_role !== 'tutor').length;

  return (
    <Box sx={{ width: '100%', maxWidth: 1100, mx: 'auto', pb: 8 }}>
      {/* HEADER BANNER */}
      <Paper
        elevation={0}
        sx={{
          p: 3.5,
          mb: 3.5,
          borderRadius: 3,
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(59, 130, 246, 0.05) 100%)',
          border: `1px solid ${palette.cardBorder}`
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip
            icon={<Users size={14} color="#4f46e5" />}
            label="Moodle Course Roster & Enrollment Keys"
            size="small"
            sx={{ bgcolor: 'rgba(99, 102, 241, 0.14)', color: '#4f46e5', fontWeight: 700 }}
          />
          <Chip label={`${tutorsCount} Tutors`} size="small" sx={{ fontWeight: 700 }} />
          <Chip label={`${studentsCount} Students`} size="small" sx={{ fontWeight: 700 }} />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary }}>
          {courseName} • Participants & Enrollment
        </Typography>
        <Typography variant="body2" sx={{ color: palette.textSecondary, mt: 0.5 }}>
          {isTutor
            ? 'Manage course Tutors and Students, assign contextual roles, or share a self-enrollment key with your class.'
            : 'View your course instructors and classmates, or join a course using an Enrollment Key.'}
        </Typography>
      </Paper>

      {actionMsg && (
        <Alert severity="success" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setActionMsg(null)}>
          {actionMsg}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* ENROLLMENT KEY & ADD MEMBER PANEL */}
      {isTutor ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5, mb: 3.5 }}>
          {/* Shareable Enrollment Key Card */}
          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Key size={16} color="#4f46e5" /> Student Self-Enrollment Key
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: 'rgba(99, 102, 241, 0.08)',
                  border: '1px dashed rgba(99, 102, 241, 0.4)',
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  color: '#4338ca',
                  letterSpacing: 1
                }}
              >
                {keyRecord?.enrollment_key || 'NO-KEY-YET'}
              </Box>
              {keyRecord?.enrollment_key && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={copiedKey ? <Check size={14} /> : <Copy size={14} />}
                  onClick={copyEnrollmentKey}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  {copiedKey ? 'Copied' : 'Copy Key'}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                placeholder="Custom key (e.g. BIOSTAT-2026)"
                value={customKeyInput}
                onChange={(e) => setCustomKeyInput(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                size="small"
                startIcon={<RefreshCw size={14} />}
                onClick={handleGenerateOrRotateKey}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                {keyRecord?.enrollment_key ? 'Rotate Key' : 'Generate Key'}
              </Button>
            </Box>
          </Paper>

          {/* Direct Member Enrol Card */}
          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <UserPlus size={16} color="#2563eb" /> Enrol Participant by Email
            </Typography>
            <Typography variant="caption" sx={{ color: palette.textSecondary, display: 'block', mb: 1.5 }}>
              Directly add a Student or Co-Tutor to this course roster.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="user@iiitdwd.ac.in"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                sx={{ flex: 1, minWidth: 180 }}
              />
              <Select
                size="small"
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                sx={{ minWidth: 115 }}
              >
                <MenuItem value="student">Student</MenuItem>
                <MenuItem value="tutor">Tutor</MenuItem>
              </Select>
              <Button
                variant="contained"
                size="small"
                onClick={() => handleAddOrUpdateMember(newMemberEmail, newMemberRole)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                Enrol User
              </Button>
            </Box>
          </Paper>
        </Box>
      ) : (
        /* Student Self-Enrollment Key Box */
        <Paper elevation={0} sx={{ p: 2.5, mb: 3.5, borderRadius: 3, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Key size={16} color="#4f46e5" /> Join Course with Enrollment Key
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Enter Course Enrollment Key (e.g. STAT-2026)"
              value={studentKeyInput}
              onChange={(e) => setStudentKeyInput(e.target.value)}
              sx={{ minWidth: 280 }}
            />
            <Button
              variant="contained"
              disabled={enrolling}
              onClick={handleStudentSelfEnrol}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
            >
              {enrolling ? 'Enrolling...' : 'Enrol in Course'}
            </Button>
          </Box>
        </Paper>
      )}

      {/* PARTICIPANTS ROSTER LIST */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: `1px solid ${palette.cardBorder}`, bgcolor: palette.cardBg }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 2 }}>
          Enrolled Course Roster ({members.length})
        </Typography>

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <CircularProgress size={30} />
          </Box>
        ) : members.length === 0 ? (
          <Typography variant="body2" sx={{ color: palette.textSecondary, py: 3, textAlign: 'center' }}>
            No participants enrolled yet. Use the Enrollment Key or Email Enrol box above to add members.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
            {members.map((m) => {
              const isMemberTutor = m.course_role === 'tutor';
              return (
                <Box
                  key={m.user_email}
                  sx={{
                    p: 1.8,
                    borderRadius: 2,
                    border: `1px solid ${palette.cardBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1.5
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 36, height: 36, bgcolor: isMemberTutor ? '#4f46e5' : '#0ea5e9', fontSize: '0.9rem', fontWeight: 700 }}>
                      {(m.name || m.user_email || 'U')[0].toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: palette.textPrimary }}>
                        {getUserDisplayName(m.name, m.user_email, 'Student')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                        {m.user_email} • Joined via {m.enrol_method || 'manual'}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      icon={isMemberTutor ? <ShieldCheck size={13} /> : <GraduationCap size={13} />}
                      label={isMemberTutor ? 'Tutor' : 'Student'}
                      size="small"
                      sx={{
                        fontWeight: 700,
                        bgcolor: isMemberTutor ? 'rgba(79, 70, 229, 0.12)' : 'rgba(14, 165, 233, 0.12)',
                        color: isMemberTutor ? '#4338ca' : '#0369a1'
                      }}
                    />
                    {isTutor && (
                      <>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() =>
                            handleAddOrUpdateMember(m.user_email, isMemberTutor ? 'student' : 'tutor')
                          }
                          sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem' }}
                        >
                          Make {isMemberTutor ? 'Student' : 'Tutor'}
                        </Button>
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveMember(m.user_email)}
                          aria-label={`Remove ${m.user_email}`}
                          sx={{ color: '#94a3b8', '&:hover': { color: '#ef4444' } }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>
    </Box>
  );
}

