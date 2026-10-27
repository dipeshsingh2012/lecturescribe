import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  IconButton
} from '@mui/material';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Users
} from 'lucide-react';

export default function CourseAnalytics({
  courseName,
  currentTheme
}) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [copiedEmail, setCopiedEmail] = useState('');

  const fetchAnalytics = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/analytics`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load learning analytics');
      setAnalytics(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [courseName]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleCopyOutreach = (studentEmail, message) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(message).catch(() => {});
    }
    setCopiedEmail(studentEmail);
    setTimeout(() => setCopiedEmail(''), 2000);
  };

  const summary = analytics?.summary || {
    total_students: 0,
    at_risk_high_count: 0,
    at_risk_medium_count: 0,
    on_track_count: 0,
    avg_engagement_score: 0,
    avg_completion_percentage: 0,
    total_forum_posts: 0
  };

  const allStudents = analytics?.students || [];
  const filteredStudents =
    riskFilter === 'all'
      ? allStudents
      : allStudents.filter((s) => s.risk_level === riskFilter);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header & KPI Cards */}
      <Box
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Activity size={22} color={currentTheme.palette.primary} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                Learning Analytics & At-Risk AI Early-Warning Dashboard
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Real-time student engagement telemetry, completion velocity, and AI-drafted outreach for {courseName}
              </Typography>
            </Box>
          </Box>

          <IconButton size="small" onClick={fetchAnalytics} aria-label="Refresh Analytics">
            <RefreshCw size={16} color={currentTheme.palette.textSecondary} />
          </IconButton>
        </Box>

        {/* KPI Grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
            gap: 2
          }}
        >
          <Box sx={{ p: 2, borderRadius: 2.5, border: `1px solid ${currentTheme.palette.cardBorder}` }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 700 }}>
              Total Roster
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Users size={18} color={currentTheme.palette.primary} />
              <Typography variant="h5" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                {summary.total_students}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ p: 2, borderRadius: 2.5, border: '1px solid rgba(239, 68, 68, 0.35)', bgcolor: 'rgba(239, 68, 68, 0.06)' }}>
            <Typography variant="caption" sx={{ color: '#ef4444', fontWeight: 700 }}>
              High-Risk Early Warnings
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <AlertTriangle size={18} color="#ef4444" />
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#ef4444', fontVariantNumeric: 'tabular-nums' }}>
                {summary.at_risk_high_count}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ p: 2, borderRadius: 2.5, border: `1px solid ${currentTheme.palette.cardBorder}` }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 700 }}>
              Avg Engagement Index
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: currentTheme.palette.primary, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
              {summary.avg_engagement_score}/100
            </Typography>
          </Box>

          <Box sx={{ p: 2, borderRadius: 2.5, border: `1px solid ${currentTheme.palette.cardBorder}` }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 700 }}>
              Avg Module Completion
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#10b981', mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
              {summary.avg_completion_percentage}%
            </Typography>
          </Box>
        </Box>

        {/* Risk Filter Pills */}
        <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All Students (${summary.total_students})` },
            { id: 'high', label: `High Risk (${summary.at_risk_high_count})` },
            { id: 'medium', label: `Medium Risk (${summary.at_risk_medium_count})` },
            { id: 'low', label: `On Track (${summary.on_track_count})` }
          ].map((pill) => (
            <Chip
              key={pill.id}
              label={pill.label}
              size="small"
              onClick={() => setRiskFilter(pill.id)}
              sx={{
                cursor: 'pointer',
                fontWeight: 700,
                bgcolor: riskFilter === pill.id ? currentTheme.palette.primary : currentTheme.palette.badgeBg,
                color: riskFilter === pill.id ? '#fff' : currentTheme.palette.textPrimary
              }}
            />
          ))}
        </Box>

        {error && (
          <Typography variant="body2" sx={{ mt: 1.5, color: '#ef4444', fontWeight: 600 }}>
            {error}
          </Typography>
        )}
      </Box>

      {/* Per-Student Diagnostic & AI Early-Warning Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Box
          sx={{
            borderRadius: 3,
            bgcolor: currentTheme.palette.cardBg,
            border: `1px solid ${currentTheme.palette.cardBorder}`,
            boxShadow: currentTheme.palette.cardShadow,
            overflowX: 'auto'
          }}
        >
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <Box component="thead">
              <Box component="tr" sx={{ borderBottom: `1px solid ${currentTheme.palette.cardBorder}` }}>
                {['Student', 'Risk Status', 'Engagement', 'Completion', 'Grade Avg', 'Signals & AI Early-Warning Copilot'].map((h) => (
                  <Box
                    key={h}
                    component="th"
                    sx={{
                      p: 2,
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: currentTheme.palette.textSecondary
                    }}
                  >
                    {h}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {filteredStudents.map((st) => {
                const riskColor =
                  st.risk_level === 'high' ? '#ef4444' : st.risk_level === 'medium' ? '#f59e0b' : '#10b981';
                return (
                  <Box
                    key={st.student_email}
                    component="tr"
                    sx={{ borderBottom: `1px solid ${currentTheme.palette.cardBorder}` }}
                  >
                    <Box component="td" sx={{ p: 2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                        {st.student_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                        {st.student_email}
                      </Typography>
                    </Box>

                    <Box component="td" sx={{ p: 2 }}>
                      <Chip
                        icon={st.risk_level === 'low' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                        label={st.risk_level.toUpperCase()}
                        size="small"
                        sx={{
                          fontWeight: 800,
                          fontSize: '0.7rem',
                          bgcolor: `${riskColor}22`,
                          color: riskColor
                        }}
                      />
                    </Box>

                    <Box component="td" sx={{ p: 2, minWidth: 130, fontVariantNumeric: 'tabular-nums' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                        {st.engagement_score} / 100
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, Math.max(0, st.engagement_score))}
                        sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
                      />
                    </Box>

                    <Box component="td" sx={{ p: 2, fontVariantNumeric: 'tabular-nums' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                        {st.completion_percentage}%
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                        {st.assignments_submitted}/{st.assignments_total} asgn • {st.forum_posts} posts
                      </Typography>
                    </Box>

                    <Box component="td" sx={{ p: 2, fontVariantNumeric: 'tabular-nums' }}>
                      <Typography variant="body2" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                        {st.overall_grade_percentage}% ({st.letter_grade})
                      </Typography>
                    </Box>

                    <Box component="td" sx={{ p: 2, minWidth: 320 }}>
                      {st.risk_factors?.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 1 }}>
                          {st.risk_factors.map((rf, idx) => (
                            <Chip
                              key={idx}
                              label={rf}
                              size="small"
                              sx={{ fontSize: '0.68rem', fontWeight: 600 }}
                            />
                          ))}
                        </Box>
                      )}
                      <Box
                        sx={{
                          p: 1.2,
                          borderRadius: 2,
                          bgcolor: 'rgba(99, 102, 241, 0.06)',
                          border: `1px solid ${currentTheme.palette.cardBorder}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
                          <Sparkles size={14} color={currentTheme.palette.primary} style={{ flexShrink: 0, marginTop: 2 }} />
                          <Typography variant="caption" sx={{ color: currentTheme.palette.textPrimary }}>
                            {st.ai_intervention_message}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={copiedEmail === st.student_email ? <Check size={13} /> : <Copy size={13} />}
                          onClick={() => handleCopyOutreach(st.student_email, st.ai_intervention_message)}
                          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', flexShrink: 0 }}
                        >
                          {copiedEmail === st.student_email ? 'Copied' : 'Copy AI Outreach'}
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

