import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  CircularProgress,
  IconButton
} from '@mui/material';
import {
  Megaphone,
  Users,
  Sparkles,
  Plus,
  Send,
  History,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';

export default function CourseWorkshopsAndAnnouncements({
  courseName,
  isTutor = false,
  userEmail = '',
  userName = '',
  currentTheme
}) {
  const [announcements, setAnnouncements] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Announcement broadcast form (Tutor)
  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPriority, setAnnPriority] = useState('important');

  // Workshop creation form (Tutor)
  const [showWsForm, setShowWsForm] = useState(false);
  const [wsTitle, setWsTitle] = useState('');
  const [wsInstructions, setWsInstructions] = useState('');

  // Student Workshop Submission inputs: { [workshopId]: { title, content } }
  const [subInputs, setSubInputs] = useState({});

  // Peer Review inputs: { [submissionId]: { score, feedback } }
  const [reviewInputs, setReviewInputs] = useState({});

  const effectiveEmail = userEmail || (isTutor ? 'prof@iiitdwd.ac.in' : 'student@iiitdwd.ac.in');
  const effectiveName = userName || (isTutor ? 'Course Instructor' : 'Student');

  const fetchAll = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    setError('');
    try {
      const [annRes, wsRes] = await Promise.all([
        fetch(`/api/course/${encodeURIComponent(courseName)}/announcements`),
        fetch(`/api/course/${encodeURIComponent(courseName)}/workshops`)
      ]);
      const annJson = await annRes.json();
      const wsJson = await wsRes.json();
      if (annRes.ok) {
        setAnnouncements(annJson.announcements || []);
        setAuditLogs(annJson.audit_logs || []);
      }
      if (wsRes.ok) {
        setWorkshops(wsJson.workshops || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load announcements and workshops.');
    } finally {
      setLoading(false);
    }
  }, [courseName]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleBroadcastAnnouncement = async (e) => {
    e.preventDefault();
    if (!annTitle.trim() || !annBody.trim()) return;
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: annTitle.trim(),
          body: annBody.trim(),
          priority: annPriority,
          author_email: effectiveEmail,
          author_name: effectiveName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to broadcast announcement');
      setAnnTitle('');
      setAnnBody('');
      setShowAnnForm(false);
      setNotice(`Broadcasted announcement "${data.announcement?.title}"!`);
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateWorkshop = async (e) => {
    e.preventDefault();
    if (!wsTitle.trim()) return;
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/workshops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wsTitle.trim(),
          instructions: wsInstructions.trim(),
          phase: 'submission',
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create workshop');
      setWsTitle('');
      setWsInstructions('');
      setShowWsForm(false);
      setNotice(`Created Peer Review Workshop "${data.workshop?.title}"!`);
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePhaseChange = async (ws, nextPhase) => {
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/workshops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workshop_id: ws.workshop_id,
          title: ws.title,
          instructions: ws.instructions,
          phase: nextPhase,
          actor_email: userEmail || undefined
        })
      });
      if (res.ok) {
        setNotice(`Advanced "${ws.title}" to ${nextPhase.toUpperCase()} phase.`);
        fetchAll();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmitArtifact = async (workshopId) => {
    const inp = subInputs[workshopId] || {};
    if (!inp.title || !inp.content) return;
    try {
      const res = await fetch(
        `/api/course/${encodeURIComponent(courseName)}/workshops/${encodeURIComponent(workshopId)}/submissions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_email: effectiveEmail,
            student_name: effectiveName,
            title: inp.title,
            content: inp.content
          })
        }
      );
      if (res.ok) {
        setSubInputs((prev) => ({ ...prev, [workshopId]: { title: '', content: '' } }));
        setNotice('Submitted workshop artifact for peer assessment!');
        fetchAll();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmitPeerReview = async (workshopId, submissionId) => {
    const rev = reviewInputs[submissionId] || {};
    if (rev.score === undefined || !rev.feedback) return;
    try {
      const res = await fetch(
        `/api/course/${encodeURIComponent(courseName)}/workshops/${encodeURIComponent(workshopId)}/reviews`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submission_id: submissionId,
            reviewer_email: effectiveEmail,
            reviewer_name: effectiveName,
            peer_score: Number(rev.score),
            feedback: rev.feedback
          })
        }
      );
      const data = await res.json();
      if (res.ok) {
        setReviewInputs((prev) => ({ ...prev, [submissionId]: { score: '', feedback: '' } }));
        setNotice(
          `Peer review recorded! AI Calibration Score: ${data.review?.ai_calibration_score}% (${data.review?.ai_calibration_note})`
        );
        fetchAll();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Section 1: Official Course Announcements Broadcast & Pedagogical Audit Log (Wave 3 Option 4) */}
      <Box
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Megaphone size={22} color={currentTheme.palette.primary} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Course Announcements & Pedagogical Activity Feed
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Official instructor broadcasts, exam alerts, and immutable Actor–Verb–Object audit logs
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isTutor && (
              <Button
                variant="contained"
                size="small"
                startIcon={<Plus size={15} />}
                onClick={() => setShowAnnForm((v) => !v)}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 2,
                  bgcolor: currentTheme.palette.primary,
                  color: '#fff'
                }}
              >
                Broadcast Announcement
              </Button>
            )}
            <IconButton size="small" onClick={fetchAll} aria-label="Refresh Announcements and Workshops">
              <RefreshCw size={16} color={currentTheme.palette.textSecondary} />
            </IconButton>
          </Box>
        </Box>

        {notice && (
          <Typography variant="body2" sx={{ mb: 1.5, color: '#10b981', fontWeight: 600 }}>
            {notice}
          </Typography>
        )}
        {error && (
          <Typography variant="body2" sx={{ mb: 1.5, color: '#ef4444', fontWeight: 600 }}>
            {error}
          </Typography>
        )}

        {isTutor && showAnnForm && (
          <Box
            component="form"
            onSubmit={handleBroadcastAnnouncement}
            sx={{
              mb: 2.5,
              p: 2,
              borderRadius: 2.5,
              border: `1px solid ${currentTheme.palette.primary}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5
            }}
          >
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="Announcement Title"
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                required
                sx={{ flex: 1, minWidth: 220 }}
              />
              <TextField
                select
                size="small"
                label="Priority"
                value={annPriority}
                onChange={(e) => setAnnPriority(e.target.value)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ width: 150 }}
              >
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </TextField>
            </Box>
            <TextField
              size="small"
              label="Announcement Message"
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              multiline
              rows={2}
              required
              fullWidth
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={() => setShowAnnForm(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" size="small" startIcon={<Send size={14} />} sx={{ fontWeight: 700 }}>
                Post Broadcast
              </Button>
            </Box>
          </Box>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={26} />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' }, gap: 2 }}>
            {/* Announcements Column */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Official Broadcasts ({announcements.length})
              </Typography>
              {announcements.length === 0 ? (
                <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                  No announcements broadcasted yet.
                </Typography>
              ) : (
                announcements.map((a) => {
                  const pColor = a.priority === 'urgent' ? '#ef4444' : a.priority === 'important' ? '#f59e0b' : '#3b82f6';
                  return (
                    <Box
                      key={a.announcement_id}
                      sx={{
                        p: 2,
                        borderRadius: 2.5,
                        border: `1px solid ${currentTheme.palette.cardBorder}`,
                        borderLeft: `4px solid ${pColor}`
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                          {a.title}
                        </Typography>
                        <Chip
                          label={(a.priority || 'normal').toUpperCase()}
                          size="small"
                          sx={{ height: 20, fontSize: '0.68rem', fontWeight: 800, bgcolor: `${pColor}20`, color: pColor }}
                        />
                      </Box>
                      <Typography variant="body2" sx={{ color: currentTheme.palette.textPrimary, mb: 0.6 }}>
                        {a.body}
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                        By {a.author_name || a.author_email}
                      </Typography>
                    </Box>
                  );
                })
              )}
            </Box>

            {/* Pedagogical Audit Stream Column */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                <History size={15} color={currentTheme.palette.textSecondary} />
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                  Pedagogical Event Audit Log
                </Typography>
              </Box>
              {auditLogs.length === 0 ? (
                <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                  No audit events logged yet.
                </Typography>
              ) : (
                auditLogs.slice(0, 6).map((log) => (
                  <Box
                    key={log.log_id}
                    sx={{
                      p: 1.2,
                      borderRadius: 2,
                      bgcolor: 'rgba(99, 102, 241, 0.05)',
                      border: `1px solid ${currentTheme.palette.cardBorder}`
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, display: 'block' }}>
                      {log.summary}
                    </Typography>
                    <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.68rem' }}>
                      {log.actor_email} • {log.verb}
                    </Typography>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Section 2: Peer Review Workshop & AI Calibration Engine (Wave 3 Option 3) */}
      <Box
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Users size={22} color="#8b5cf6" />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Peer Review Workshop & AI Calibration Engine
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Multi-phase Moodle Workshop (Submission → Peer Assessment → AI Calibration Check → Final Evaluation)
              </Typography>
            </Box>
          </Box>

          {isTutor && (
            <Button
              variant="contained"
              size="small"
              startIcon={<Plus size={15} />}
              onClick={() => setShowWsForm((v) => !v)}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 2,
                bgcolor: '#8b5cf6',
                color: '#fff'
              }}
            >
              Create Peer Review Workshop
            </Button>
          )}
        </Box>

        {isTutor && showWsForm && (
          <Box
            component="form"
            onSubmit={handleCreateWorkshop}
            sx={{
              mb: 2.5,
              p: 2,
              borderRadius: 2.5,
              border: '1px solid #8b5cf6',
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5
            }}
          >
            <TextField
              size="small"
              label="Workshop Title (e.g., Peer Review: Empirical Regression Study)"
              value={wsTitle}
              onChange={(e) => setWsTitle(e.target.value)}
              required
              fullWidth
            />
            <TextField
              size="small"
              label="Peer Assessment Instructions & Rubric Guidance"
              value={wsInstructions}
              onChange={(e) => setWsInstructions(e.target.value)}
              multiline
              rows={2}
              fullWidth
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={() => setShowWsForm(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 700 }}>
                Save Workshop
              </Button>
            </Box>
          </Box>
        )}

        {workshops.length === 0 ? (
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
            No peer review workshops active yet.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {workshops.map((ws) => {
              const curSub = subInputs[ws.workshop_id] || { title: '', content: '' };
              return (
                <Box
                  key={ws.workshop_id}
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    border: `1px solid ${currentTheme.palette.cardBorder}`
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                        {ws.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                        {ws.instructions}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                      {['submission', 'assessment', 'evaluation', 'closed'].map((ph) => (
                        <Chip
                          key={ph}
                          label={`Phase: ${ph.toUpperCase()}`}
                          size="small"
                          onClick={() => isTutor && handlePhaseChange(ws, ph)}
                          sx={{
                            cursor: isTutor ? 'pointer' : 'default',
                            fontWeight: 800,
                            bgcolor: ws.phase === ph ? '#8b5cf6' : currentTheme.palette.badgeBg,
                            color: ws.phase === ph ? '#fff' : currentTheme.palette.textPrimary
                          }}
                        />
                      ))}
                    </Box>
                  </Box>

                  {/* Submit Artifact Box */}
                  <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(139, 92, 246, 0.05)', mb: 2 }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, display: 'block', mb: 1 }}>
                      Submit Your Workshop Artifact
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        placeholder="Submission Title"
                        value={curSub.title}
                        onChange={(e) =>
                          setSubInputs((prev) => ({
                            ...prev,
                            [ws.workshop_id]: { ...curSub, title: e.target.value }
                          }))
                        }
                        sx={{ minWidth: 200 }}
                      />
                      <TextField
                        size="small"
                        placeholder="Paste your derivation, proof, or empirical summary..."
                        value={curSub.content}
                        onChange={(e) =>
                          setSubInputs((prev) => ({
                            ...prev,
                            [ws.workshop_id]: { ...curSub, content: e.target.value }
                          }))
                        }
                        sx={{ flex: 1, minWidth: 240 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSubmitArtifact(ws.workshop_id)}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Submit Artifact
                      </Button>
                    </Box>
                  </Box>

                  {/* Submissions & Peer Reviews */}
                  {(ws.submissions || []).map((sub) => {
                    const revInp = reviewInputs[sub.submission_id] || { score: '90', feedback: '' };
                    return (
                      <Box
                        key={sub.submission_id}
                        sx={{
                          p: 2,
                          mt: 1.5,
                          borderRadius: 2,
                          border: `1px solid ${currentTheme.palette.cardBorder}`
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                            {sub.title} — by {sub.student_name}
                          </Typography>
                          {sub.avg_peer_score !== null && sub.avg_peer_score !== undefined && (
                            <Chip
                              icon={<CheckCircle2 size={13} />}
                              label={`Avg Peer Score: ${sub.avg_peer_score} / 100`}
                              size="small"
                              sx={{ fontWeight: 800, bgcolor: 'rgba(16, 185, 129, 0.14)', color: '#10b981' }}
                            />
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, mb: 1.5 }}>
                          {sub.content}
                        </Typography>

                        {/* Existing Peer Reviews with AI Calibration Badges */}
                        {(sub.reviews || []).map((r) => (
                          <Box
                            key={r.review_id}
                            sx={{
                              p: 1.2,
                              mb: 1,
                              borderRadius: 1.5,
                              bgcolor: 'rgba(16, 185, 129, 0.06)',
                              border: `1px solid ${currentTheme.palette.cardBorder}`
                            }}
                          >
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                              <Typography variant="caption" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                                Peer Review by {r.reviewer_name}: {r.peer_score}/100
                              </Typography>
                              <Chip
                                icon={<Sparkles size={12} />}
                                label={`AI Calibration: ${r.ai_calibration_score}%`}
                                size="small"
                                sx={{ height: 20, fontSize: '0.68rem', fontWeight: 800, bgcolor: 'rgba(139, 92, 246, 0.16)', color: '#8b5cf6' }}
                              />
                            </Box>
                            <Typography variant="caption" sx={{ color: currentTheme.palette.textPrimary, display: 'block', mt: 0.4 }}>
                              {r.feedback}
                            </Typography>
                          </Box>
                        ))}

                        {/* Add Peer Review Row */}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                          <TextField
                            size="small"
                            type="number"
                            label="Score / 100"
                            value={revInp.score}
                            onChange={(e) =>
                              setReviewInputs((prev) => ({
                                ...prev,
                                [sub.submission_id]: { ...revInp, score: e.target.value }
                              }))
                            }
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ width: 110 }}
                          />
                          <TextField
                            size="small"
                            placeholder="Write constructive rubric-aligned peer feedback..."
                            value={revInp.feedback}
                            onChange={(e) =>
                              setReviewInputs((prev) => ({
                                ...prev,
                                [sub.submission_id]: { ...revInp, feedback: e.target.value }
                              }))
                            }
                            sx={{ flex: 1, minWidth: 220 }}
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleSubmitPeerReview(ws.workshop_id, sub.submission_id)}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            Submit Peer Review
                          </Button>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

