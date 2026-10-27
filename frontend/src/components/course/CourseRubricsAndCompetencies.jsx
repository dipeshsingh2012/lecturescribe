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
  Grid,
  Award,
  Sparkles,
  Plus,
  CheckCircle2,
  RefreshCw,
  Target
} from 'lucide-react';

export default function CourseRubricsAndCompetencies({
  courseName,
  assignments = [],
  isTutor = false,
  userEmail = '',
  currentTheme
}) {
  const [rubrics, setRubrics] = useState([]);
  const [competencies, setCompetencies] = useState([]);
  const [studentMatrix, setStudentMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatingRubric, setGeneratingRubric] = useState(false);
  const [extractingComp, setExtractingComp] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Interactive 2D Rubric cell selection state: { [rubricId_criterionId]: points }
  const [selectedCells, setSelectedCells] = useState({});

  // New Competency Form
  const [showAddComp, setShowAddComp] = useState(false);
  const [compCode, setCompCode] = useState('CLO-4');
  const [compTitle, setCompTitle] = useState('');
  const [compDesc, setCompDesc] = useState('');

  const fetchAll = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    setError('');
    try {
      const studentParam = !isTutor && userEmail ? `?student_email=${encodeURIComponent(userEmail)}` : '';
      const [rubRes, compRes] = await Promise.all([
        fetch(`/api/course/${encodeURIComponent(courseName)}/rubrics`),
        fetch(`/api/course/${encodeURIComponent(courseName)}/competencies${studentParam}`)
      ]);
      const rubJson = await rubRes.json();
      const compJson = await compRes.json();
      if (rubRes.ok) setRubrics(rubJson.rubrics || []);
      if (compRes.ok) {
        setCompetencies(compJson.competencies || []);
        setStudentMatrix(compJson.students || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load rubrics and competencies.');
    } finally {
      setLoading(false);
    }
  }, [courseName, isTutor, userEmail]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleGenerateRubric = async () => {
    setGeneratingRubric(true);
    setError('');
    setNotice('');
    try {
      const firstAsgn = assignments[0] || {};
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/rubrics/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignment_id: firstAsgn.assignment_id || '',
          title: firstAsgn.title || `${courseName} Problem Set`,
          max_marks: firstAsgn.max_marks || 50,
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to generate rubric');
      setNotice(`Generated 2D Grading Rubric: "${data.rubric?.title}"!`);
      fetchAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingRubric(false);
    }
  };

  const handleExtractCompetencies = async () => {
    setExtractingComp(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/competencies/ai-extract`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to extract competencies');
      setNotice(`Extracted ${data.count || (data.competencies || []).length} Course Learning Outcomes!`);
      fetchAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setExtractingComp(false);
    }
  };

  const handleSaveCompetency = async (e) => {
    e.preventDefault();
    if (!compTitle.trim()) return;
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/competencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: compCode.trim(),
          title: compTitle.trim(),
          description: compDesc.trim(),
          linked_module_ids: [],
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save competency');
      setCompTitle('');
      setCompDesc('');
      setShowAddComp(false);
      setNotice(`Added competency ${data.competency?.code}: ${data.competency?.title}`);
      fetchAll();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Section 1: 2D Grading Rubrics (Wave 3 Option 1) */}
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
            <Grid size={22} color={currentTheme.palette.primary} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                2D Criterion × Level Grading Rubrics
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Interactive multi-criterion rubrics for transparent grading and AI SpeedGrader evaluation
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isTutor && (
              <Button
                variant="contained"
                size="small"
                disabled={generatingRubric}
                startIcon={generatingRubric ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
                onClick={handleGenerateRubric}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 2,
                  bgcolor: currentTheme.palette.primary,
                  color: '#fff'
                }}
              >
                AI Generate 2D Rubric
              </Button>
            )}
            <IconButton size="small" onClick={fetchAll} aria-label="Refresh Rubrics and Competencies">
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

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={26} />
          </Box>
        ) : rubrics.length === 0 ? (
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
            No 2D rubrics created yet. {isTutor ? 'Click "AI Generate 2D Rubric" above to build one automatically.' : ''}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {rubrics.map((rub) => {
              const criteria = rub.criteria || [];
              const activeTotal = criteria.reduce((acc, c) => {
                const key = `${rub.rubric_id}_${c.criterion_id}`;
                return acc + (selectedCells[key] !== undefined ? Number(selectedCells[key]) : Number(c.max_points || 0));
              }, 0);

              return (
                <Box
                  key={rub.rubric_id}
                  sx={{
                    p: 2,
                    borderRadius: 2.5,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    overflowX: 'auto'
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                      {rub.title}
                    </Typography>
                    <Chip
                      label={`Selected Rubric Score: ${activeTotal} / ${rub.total_points || 50} pts`}
                      size="small"
                      sx={{ fontWeight: 800, bgcolor: 'rgba(16, 185, 129, 0.14)', color: '#10b981' }}
                    />
                  </Box>

                  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <Box component="tbody">
                      {criteria.map((crit) => {
                        const cellKey = `${rub.rubric_id}_${crit.criterion_id}`;
                        const chosenPts = selectedCells[cellKey];
                        return (
                          <Box
                            key={crit.criterion_id}
                            component="tr"
                            sx={{ borderBottom: `1px solid ${currentTheme.palette.cardBorder}` }}
                          >
                            <Box component="td" sx={{ p: 1.5, minWidth: 190, fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                              {crit.title}
                              <Typography variant="caption" sx={{ display: 'block', color: currentTheme.palette.textSecondary }}>
                                Max: {crit.max_points} pts
                              </Typography>
                            </Box>
                            {(crit.levels || []).map((lvl, lIdx) => {
                              const isChosen =
                                chosenPts !== undefined ? Number(chosenPts) === Number(lvl.points) : lIdx === 0;
                              return (
                                <Box
                                  key={lIdx}
                                  component="td"
                                  onClick={() => setSelectedCells((prev) => ({ ...prev, [cellKey]: lvl.points }))}
                                  sx={{
                                    p: 1.2,
                                    minWidth: 150,
                                    cursor: 'pointer',
                                    borderLeft: `1px solid ${currentTheme.palette.cardBorder}`,
                                    bgcolor: isChosen ? 'rgba(99, 102, 241, 0.12)' : 'transparent'
                                  }}
                                >
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.4 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                                      {lvl.label}
                                    </Typography>
                                    <Chip label={`${lvl.points} pts`} size="small" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />
                                  </Box>
                                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block' }}>
                                    {lvl.description}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Section 2: Course Competency & Skill Mastery Matrix (Wave 3 Option 2) */}
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
            <Target size={22} color="#10b981" />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Course Competency & Skill Mastery Matrix
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Course Learning Outcomes (CLOs) mapped to student evidence across lectures, assignments, and exams
              </Typography>
            </Box>
          </Box>

          {isTutor && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Plus size={15} />}
                onClick={() => setShowAddComp((v) => !v)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                Add Competency
              </Button>
              <Button
                variant="contained"
                size="small"
                disabled={extractingComp}
                startIcon={extractingComp ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
                onClick={handleExtractCompetencies}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: 2,
                  bgcolor: '#10b981',
                  color: '#fff'
                }}
              >
                AI Extract Course Competencies
              </Button>
            </Box>
          )}
        </Box>

        {isTutor && showAddComp && (
          <Box
            component="form"
            onSubmit={handleSaveCompetency}
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
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField
                size="small"
                label="Code (e.g. CLO-4)"
                value={compCode}
                onChange={(e) => setCompCode(e.target.value)}
                sx={{ width: 140 }}
                required
              />
              <TextField
                size="small"
                label="Competency Title"
                value={compTitle}
                onChange={(e) => setCompTitle(e.target.value)}
                fullWidth
                required
              />
            </Box>
            <TextField
              size="small"
              label="Competency Description"
              value={compDesc}
              onChange={(e) => setCompDesc(e.target.value)}
              fullWidth
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={() => setShowAddComp(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 700 }}>
                Save Competency
              </Button>
            </Box>
          </Box>
        )}

        {/* Competency Cards */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5, mb: 2.5 }}>
          {competencies.map((c) => (
            <Box
              key={c.competency_id}
              sx={{
                p: 2,
                borderRadius: 2.5,
                border: `1px solid ${currentTheme.palette.cardBorder}`,
                bgcolor: 'rgba(16, 185, 129, 0.04)'
              }}
            >
              <Chip label={c.code} size="small" sx={{ fontWeight: 800, mb: 1, bgcolor: 'rgba(16, 185, 129, 0.16)', color: '#10b981' }} />
              <Typography variant="body2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                {c.title}
              </Typography>
              {c.description && (
                <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block', mt: 0.5 }}>
                  {c.description}
                </Typography>
              )}
            </Box>
          ))}
        </Box>

        {/* Mastery Matrix Table */}
        {studentMatrix.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <Box component="thead">
                <Box component="tr" sx={{ borderBottom: `1px solid ${currentTheme.palette.cardBorder}` }}>
                  <Box component="th" sx={{ p: 1.5, fontSize: '0.75rem', fontWeight: 800, color: currentTheme.palette.textSecondary }}>
                    Learner
                  </Box>
                  {competencies.map((c) => (
                    <Box key={c.competency_id} component="th" sx={{ p: 1.5, fontSize: '0.75rem', fontWeight: 800, color: currentTheme.palette.textSecondary }}>
                      {c.code}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {studentMatrix.map((row) => (
                  <Box key={row.student_email} component="tr" sx={{ borderBottom: `1px solid ${currentTheme.palette.cardBorder}` }}>
                    <Box component="td" sx={{ p: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                        {row.student_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                        {row.student_email}
                      </Typography>
                    </Box>
                    {competencies.map((c) => {
                      const cell = (row.competencies || {})[c.competency_id] || {
                        score_percentage: 0,
                        mastery_level: 'Initiating'
                      };
                      const badgeColor =
                        cell.mastery_level === 'Mastered'
                          ? '#10b981'
                          : cell.mastery_level === 'Proficient'
                            ? '#3b82f6'
                            : cell.mastery_level === 'Developing'
                              ? '#f59e0b'
                              : '#64748b';
                      return (
                        <Box key={c.competency_id} component="td" sx={{ p: 1.5, fontVariantNumeric: 'tabular-nums' }}>
                          <Chip
                            icon={cell.mastery_level === 'Mastered' ? <CheckCircle2 size={13} /> : <Award size={13} />}
                            label={`${cell.mastery_level} (${cell.score_percentage}%)`}
                            size="small"
                            sx={{
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              bgcolor: `${badgeColor}20`,
                              color: badgeColor
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

