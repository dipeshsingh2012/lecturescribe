import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  CircularProgress,
  LinearProgress,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Layers,
  Sparkles,
  CheckCircle2,
  Circle,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Video,
  BookOpen,
  FileCode,
  Award,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';

export default function CourseSyllabusSpine({
  courseName,
  lectures = [],
  isTutor = false,
  userEmail = '',
  onSelectLecture,
  onNavigateTab,
  currentTheme
}) {
  const [sections, setSections] = useState([]);
  const [completionData, setCompletionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // New section form state (Tutor)
  const [showAddSection, setShowAddSection] = useState(false);
  const [secTitle, setSecTitle] = useState('');
  const [secSummary, setSecSummary] = useState('');
  const [secObjectives, setSecObjectives] = useState('');

  // Restrict Access rule form state (Tutor)
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [targetModuleId, setTargetModuleId] = useState('');
  const [requiredModuleIds, setRequiredModuleIds] = useState([]);
  const [minQuizScore, setMinQuizScore] = useState('');

  const effectiveEmail = userEmail || 'student@iiitdwd.ac.in';

  const fetchSyllabusAndCompletion = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    setError('');
    try {
      const [sylRes, compRes] = await Promise.all([
        fetch(`/api/course/${encodeURIComponent(courseName)}/syllabus`),
        fetch(`/api/course/${encodeURIComponent(courseName)}/completion?user_email=${encodeURIComponent(effectiveEmail)}`)
      ]);
      const sylJson = await sylRes.json();
      const compJson = await compRes.json();
      if (sylRes.ok) {
        setSections(sylJson.sections || []);
      }
      if (compRes.ok) {
        setCompletionData(compJson);
      }
    } catch (err) {
      setError(err.message || 'Failed to load syllabus and completion status.');
    } finally {
      setLoading(false);
    }
  }, [courseName, effectiveEmail]);

  useEffect(() => {
    fetchSyllabusAndCompletion();
  }, [fetchSyllabusAndCompletion]);

  const handleAutoOrganize = async () => {
    setOrganizing(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/syllabus/ai-organize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_email: userEmail || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to auto-organize syllabus');
      setSections(data.sections || []);
      setNotice(`Auto-organized ${data.count || (data.sections || []).length} weekly curriculum modules!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setOrganizing(false);
    }
  };

  const handleCreateSection = async (e) => {
    e.preventDefault();
    if (!secTitle.trim()) return;
    setError('');
    try {
      const objectivesList = secObjectives
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/syllabus/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: secTitle.trim(),
          summary: secSummary.trim(),
          learning_objectives: objectivesList,
          items: [],
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save section');
      setSecTitle('');
      setSecSummary('');
      setSecObjectives('');
      setShowAddSection(false);
      setNotice(`Added syllabus module "${data.section?.title}".`);
      fetchSyllabusAndCompletion();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteSection = async (sectionId) => {
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/syllabus/sections/${encodeURIComponent(sectionId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSections((prev) => prev.filter((s) => s.section_id !== sectionId));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleCompletion = async (mod) => {
    if (mod.is_locked) return;
    const nextDone = !mod.is_completed;
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/completion/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: effectiveEmail,
          module_id: mod.module_id,
          module_type: mod.module_type || 'lecture',
          module_title: mod.title || mod.module_id,
          is_completed: nextDone
        })
      });
      if (res.ok) {
        fetchSyllabusAndCompletion();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveAccessRule = async (e) => {
    e.preventDefault();
    if (!targetModuleId) return;
    try {
      const targetMod = (completionData?.modules || []).find((m) => m.module_id === targetModuleId);
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/access-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_module_id: targetModuleId,
          target_module_type: targetMod?.module_type || 'quiz',
          target_title: targetMod?.title || targetModuleId,
          required_module_ids: requiredModuleIds,
          min_quiz_score_pct: minQuizScore !== '' ? Number(minQuizScore) : null,
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save Restrict Access rule');
      setNotice(`Saved Restrict Access prerequisite rule for "${data.rule?.target_title}".`);
      setShowRuleForm(false);
      fetchSyllabusAndCompletion();
    } catch (err) {
      setError(err.message);
    }
  };

  const modules = completionData?.modules || [];
  const moduleById = {};
  modules.forEach((m) => {
    moduleById[m.module_id] = m;
  });

  const completionPct = completionData?.completion_percentage || 0;
  const completedCount = completionData?.completed_count || 0;
  const totalCount = completionData?.total_count || 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header & Course Completion Progress Bar (Wave 2 Option 1) */}
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
            <Layers size={22} color={currentTheme.palette.primary} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Modular Course Syllabus & Completion Tracker
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Weekly structured curriculum, activity completion tracking, and prerequisite gating for {courseName}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {isTutor && (
              <>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={organizing ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
                  disabled={organizing}
                  onClick={handleAutoOrganize}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: 2,
                    bgcolor: currentTheme.palette.primary,
                    color: '#fff'
                  }}
                >
                  AI Auto-Organize Weekly Syllabus
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Plus size={15} />}
                  onClick={() => setShowAddSection((v) => !v)}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  Add Module
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Lock size={15} />}
                  onClick={() => setShowRuleForm((v) => !v)}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  Restrict Access Rules
                </Button>
              </>
            )}
            <IconButton size="small" onClick={fetchSyllabusAndCompletion} aria-label="Refresh Syllabus">
              <RefreshCw size={16} color={currentTheme.palette.textSecondary} />
            </IconButton>
          </Box>
        </Box>

        {/* Overall Course Progress Bar */}
        <Box sx={{ mt: 1, p: 2, borderRadius: 2.5, bgcolor: 'rgba(99, 102, 241, 0.06)', border: `1px solid ${currentTheme.palette.cardBorder}` }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
              Course Activity Completion Progress
            </Typography>
            <Chip
              label={`${completionPct}% Complete (${completedCount}/${totalCount} activities)`}
              size="small"
              sx={{
                fontWeight: 800,
                bgcolor: completionPct >= 80 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(99, 102, 241, 0.16)',
                color: completionPct >= 80 ? '#10b981' : currentTheme.palette.primary
              }}
            />
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, Math.max(0, completionPct))}
            sx={{ height: 9, borderRadius: 4 }}
          />
        </Box>

        {notice && (
          <Typography variant="body2" sx={{ mt: 1.5, color: '#10b981', fontWeight: 600 }}>
            {notice}
          </Typography>
        )}
        {error && (
          <Typography variant="body2" sx={{ mt: 1.5, color: '#ef4444', fontWeight: 600 }}>
            {error}
          </Typography>
        )}
      </Box>

      {/* Tutor: Add Section Form */}
      {isTutor && showAddSection && (
        <Box
          component="form"
          onSubmit={handleCreateSection}
          sx={{
            p: 2.5,
            borderRadius: 3,
            bgcolor: currentTheme.palette.cardBg,
            border: `1px solid ${currentTheme.palette.primary}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
            Create Weekly / Topic Curriculum Section
          </Typography>
          <TextField
            size="small"
            label="Module Title (e.g., Week 1: Linear Models & Least Squares)"
            value={secTitle}
            onChange={(e) => setSecTitle(e.target.value)}
            required
            fullWidth
          />
          <TextField
            size="small"
            label="Section Summary"
            value={secSummary}
            onChange={(e) => setSecSummary(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="Learning Objectives (one per line)"
            value={secObjectives}
            onChange={(e) => setSecObjectives(e.target.value)}
            multiline
            rows={2}
            fullWidth
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" onClick={() => setShowAddSection(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 700 }}>
              Save Section
            </Button>
          </Box>
        </Box>
      )}

      {/* Tutor: Restrict Access Rule Builder */}
      {isTutor && showRuleForm && (
        <Box
          component="form"
          onSubmit={handleSaveAccessRule}
          sx={{
            p: 2.5,
            borderRadius: 3,
            bgcolor: currentTheme.palette.cardBg,
            border: `1px solid #f59e0b`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShieldAlert size={18} color="#f59e0b" />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
              Configure Prerequisite Access Rule ("Restrict Access")
            </Typography>
          </Box>
          <TextField
            select
            size="small"
            label="Target Activity to Gate"
            value={targetModuleId}
            onChange={(e) => setTargetModuleId(e.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            required
          >
            <option value="">-- Select Target Activity --</option>
            {modules.map((m) => (
              <option key={m.module_id} value={m.module_id}>
                [{m.module_type.toUpperCase()}] {m.title}
              </option>
            ))}
          </TextField>

          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: currentTheme.palette.textSecondary, display: 'block', mb: 1 }}>
              Prerequisite Activities Required Before Unlocking:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {modules
                .filter((m) => m.module_id !== targetModuleId)
                .map((m) => {
                  const selected = requiredModuleIds.includes(m.module_id);
                  return (
                    <Chip
                      key={m.module_id}
                      label={m.title}
                      size="small"
                      onClick={() => {
                        setRequiredModuleIds((prev) =>
                          prev.includes(m.module_id) ? prev.filter((id) => id !== m.module_id) : [...prev, m.module_id]
                        );
                      }}
                      sx={{
                        cursor: 'pointer',
                        fontWeight: 700,
                        bgcolor: selected ? currentTheme.palette.primary : currentTheme.palette.badgeBg,
                        color: selected ? '#fff' : currentTheme.palette.textPrimary
                      }}
                    />
                  );
                })}
            </Box>
          </Box>

          <TextField
            size="small"
            type="number"
            label="Minimum Course Quiz Score % Required (optional)"
            value={minQuizScore}
            onChange={(e) => setMinQuizScore(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" onClick={() => setShowRuleForm(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 700 }}>
              Save Access Rule
            </Button>
          </Box>
        </Box>
      )}

      {/* Weekly / Topic Syllabus Spine Cards (Wave 2 Option 3) */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <>
          {sections.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sections.map((sec) => (
                <Box
                  key={sec.section_id}
                  sx={{
                    p: 2.5,
                    borderRadius: 3,
                    bgcolor: currentTheme.palette.cardBg,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    boxShadow: currentTheme.palette.cardShadow
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                        {sec.title}
                      </Typography>
                      {sec.summary && (
                        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, mt: 0.4 }}>
                          {sec.summary}
                        </Typography>
                      )}
                    </Box>
                    {isTutor && (
                      <Tooltip title="Delete Section">
                        <IconButton size="small" onClick={() => handleDeleteSection(sec.section_id)}>
                          <Trash2 size={15} color="#ef4444" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {/* Learning Objectives */}
                  {Array.isArray(sec.learning_objectives) && sec.learning_objectives.length > 0 && (
                    <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {sec.learning_objectives.map((obj, idx) => (
                        <Chip
                          key={idx}
                          label={`🎯 ${obj}`}
                          size="small"
                          sx={{
                            fontSize: '0.75rem',
                            bgcolor: 'rgba(16, 185, 129, 0.1)',
                            color: '#10b981',
                            fontWeight: 600
                          }}
                        />
                      ))}
                    </Box>
                  )}

                  {/* Section Items */}
                  {Array.isArray(sec.items) && sec.items.length > 0 && (
                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sec.items.map((item, idx) => {
                        const modState = moduleById[item.item_id] || {
                          module_id: item.item_id,
                          module_type: item.item_type || 'lecture',
                          title: item.title,
                          is_completed: false,
                          is_locked: false,
                          lock_reasons: []
                        };
                        return (
                          <Box
                            key={item.item_id || idx}
                            sx={{
                              p: 1.5,
                              borderRadius: 2,
                              border: `1px solid ${currentTheme.palette.cardBorder}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1.5,
                              opacity: modState.is_locked ? 0.65 : 1
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                              {item.item_type === 'lecture' && <Video size={16} color={currentTheme.palette.primary} />}
                              {item.item_type === 'reading' && <BookOpen size={16} color="#10b981" />}
                              {item.item_type === 'assignment' && <FileCode size={16} color="#f59e0b" />}
                              {item.item_type === 'quiz' && <Award size={16} color="#8b5cf6" />}
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  color: currentTheme.palette.textPrimary,
                                  cursor: !modState.is_locked ? 'pointer' : 'not-allowed'
                                }}
                                onClick={() => {
                                  if (modState.is_locked) return;
                                  if (item.item_type === 'lecture' && item.video_id && onSelectLecture) {
                                    onSelectLecture(item.video_id, courseName);
                                  } else if (item.item_type === 'quiz' && onNavigateTab) {
                                    onNavigateTab('quiz');
                                  } else if (item.item_type === 'reading' && onNavigateTab) {
                                    onNavigateTab('library');
                                  }
                                }}
                              >
                                {item.title}
                              </Typography>
                              {modState.is_locked && (
                                <Chip
                                  icon={<Lock size={12} />}
                                  label={modState.lock_reasons?.join(', ') || 'Prerequisite required'}
                                  size="small"
                                  sx={{ bgcolor: 'rgba(239, 68, 68, 0.14)', color: '#ef4444', fontWeight: 700, fontSize: '0.7rem' }}
                                />
                              )}
                            </Box>

                            <Button
                              size="small"
                              variant={modState.is_completed ? 'contained' : 'outlined'}
                              disabled={modState.is_locked}
                              startIcon={modState.is_completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                              onClick={() => handleToggleCompletion(modState)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                fontSize: '0.75rem',
                                borderRadius: 2,
                                ...(modState.is_completed
                                  ? { bgcolor: '#10b981', color: '#fff' }
                                  : {})
                              }}
                            >
                              {modState.is_completed ? 'Done' : 'Mark as Done'}
                            </Button>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {/* Activity Completion & Prerequisite Checklist (Always visible for all course modules) */}
          <Box
            sx={{
              p: 2.5,
              borderRadius: 3,
              bgcolor: currentTheme.palette.cardBg,
              border: `1px solid ${currentTheme.palette.cardBorder}`,
              boxShadow: currentTheme.palette.cardShadow
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, mb: 1.5 }}>
              Course Activity Completion & Prerequisite Checklist
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {modules.map((mod) => (
                <Box
                  key={mod.module_id}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1.5
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap' }}>
                    {mod.is_locked ? (
                      <Lock size={16} color="#ef4444" />
                    ) : (
                      <Unlock size={16} color="#10b981" />
                    )}
                    <Chip
                      label={mod.module_type?.toUpperCase() || 'MODULE'}
                      size="small"
                      sx={{ fontWeight: 700, fontSize: '0.68rem' }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                      {mod.title}
                    </Typography>
                    {mod.is_locked && mod.lock_reasons?.length > 0 && (
                      <Chip
                        label={`Locked: ${mod.lock_reasons.join(' • ')}`}
                        size="small"
                        sx={{ bgcolor: 'rgba(239, 68, 68, 0.14)', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem' }}
                      />
                    )}
                  </Box>

                  <Button
                    size="small"
                    variant={mod.is_completed ? 'contained' : 'outlined'}
                    disabled={mod.is_locked}
                    startIcon={mod.is_completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    onClick={() => handleToggleCompletion(mod)}
                    aria-label={`${mod.is_completed ? 'Done' : 'Mark as Done'}: ${mod.title}`}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.76rem',
                      borderRadius: 2,
                      ...(mod.is_completed ? { bgcolor: '#10b981', color: '#fff' } : {})
                    }}
                  >
                    {mod.is_completed ? 'Done' : 'Mark as Done'}
                  </Button>
                </Box>
              ))}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}

