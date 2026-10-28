import React from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress
} from '@mui/material';
import {
  Award,
  ChevronDown,
  RotateCcw,
  BookOpen,
  Trash2
} from 'lucide-react';

export default function PastQuizzesAccordion({
  quizHistory = [],
  pastQuizzesOpen,
  setPastQuizzesOpen,
  fetchQuizHistory,
  loadPastQuiz,
  handleDeleteQuiz,
  deletingQuizId,
  totalQuestions,
  setReviewingQuestions,
  setShowSummaryView,
  setCurrentIdx,
  themeStyles = {}
}) {
  if (!quizHistory || quizHistory.length === 0) return null;

  const {
    cardBg = '#1e293b',
    cardBorder = 'rgba(255, 255, 255, 0.1)',
    primaryColor = '#6366f1',
    textPrimary = '#f8fafc',
    textSecondary = '#94a3b8',
    cardShadow = '0 2px 12px rgba(0,0,0,0.06)'
  } = themeStyles;

  return (
    <Accordion
      expanded={pastQuizzesOpen}
      onChange={(_, isExpanded) => setPastQuizzesOpen(isExpanded)}
      slotProps={{ transition: { unmountOnExit: false } }}
      elevation={0}
      sx={{
        mb: 3,
        width: '100%',
        borderRadius: '12px !important',
        bgcolor: cardBg,
        border: `1px solid ${cardBorder}`,
        '&:before': { display: 'none' },
        overflow: 'hidden',
        boxShadow: cardShadow
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDown size={18} color={textSecondary} />}
        sx={{
          px: { xs: 2, sm: 2.5 },
          minHeight: 48,
          '&.Mui-expanded': { minHeight: 48, borderBottom: `1px solid ${cardBorder}` }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Award size={18} color={primaryColor} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: textPrimary, fontSize: '0.9rem' }}>
              Past Course Quizzes
            </Typography>
            <Chip
              label={`${quizHistory.length} attempt${quizHistory.length === 1 ? '' : 's'}`}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.7rem',
                fontWeight: 700,
                bgcolor: 'rgba(99, 102, 241, 0.12)',
                color: primaryColor
              }}
            />
          </Box>
          {typeof fetchQuizHistory === 'function' && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                fetchQuizHistory();
              }}
              sx={{ color: textSecondary, mr: 0.5 }}
              title="Refresh history"
            >
              <RotateCcw size={13} />
            </IconButton>
          )}
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: { xs: 2, sm: 2.5 }, pt: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {quizHistory.map((run, idx) => {
            const pct = run.total_questions > 0 ? Math.round((run.score / run.total_questions) * 100) : 0;
            const dateStr = run.created_at
              ? new Date(run.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : `Quiz #${quizHistory.length - idx}`;
            return (
              <Box
                key={run.quiz_id || idx}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${cardBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1.5
                }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: textPrimary }}>
                    {dateStr}
                  </Typography>
                  <Typography variant="caption" sx={{ color: textSecondary }}>
                    {run.total_questions || totalQuestions} Questions • {run.completed ? 'Completed' : 'In Progress'}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Chip
                    label={`${run.score} / ${run.total_questions || totalQuestions} (${pct}%)`}
                    size="small"
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      bgcolor: pct >= 70 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: pct >= 70 ? '#22c55e' : '#f59e0b'
                    }}
                  />

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {typeof loadPastQuiz === 'function' && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          loadPastQuiz(run.quiz_id, false);
                          setReviewingQuestions(true);
                          setShowSummaryView(false);
                          setCurrentIdx(0);
                        }}
                        startIcon={<BookOpen size={13} />}
                        sx={{
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          borderRadius: 1.5,
                          borderColor: cardBorder,
                          color: textPrimary,
                          '&:hover': { borderColor: primaryColor, color: primaryColor }
                        }}
                      >
                        Review
                      </Button>
                    )}
                    {typeof loadPastQuiz === 'function' && (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => {
                          loadPastQuiz(run.quiz_id, true);
                          setShowSummaryView(false);
                          setCurrentIdx(0);
                        }}
                        startIcon={<RotateCcw size={13} />}
                        sx={{
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          borderRadius: 1.5,
                          bgcolor: primaryColor,
                          color: '#fff',
                          '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
                        }}
                      >
                        Replay
                      </Button>
                    )}
                    <Tooltip title="Delete quiz attempt">
                      <IconButton
                        size="small"
                        aria-label="Delete quiz attempt"
                        onClick={() => handleDeleteQuiz(run.quiz_id)}
                        disabled={deletingQuizId === run.quiz_id}
                        sx={{
                          color: 'rgba(239, 68, 68, 0.75)',
                          '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' }
                        }}
                      >
                        {deletingQuizId === run.quiz_id ? (
                          <CircularProgress size={13} color="inherit" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
