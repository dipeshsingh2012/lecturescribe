import React from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  Divider,
  Alert
} from '@mui/material';
import {
  Award,
  Video,
  ExternalLink,
  BookOpen,
  RotateCcw,
  Sparkles,
  AlertTriangle
} from 'lucide-react';

export default function QuizResultsSummary({
  score = 0,
  totalQuestions = 0,
  calcEarnedMarks = 0,
  calcTotalMarks = 0,
  marksPerQuestion = 0.5,
  autoSubmitted = false,
  lectureBreakdown = {},
  courseName,
  handleSelectLecture,
  setShowSummaryView,
  setReviewingQuestions,
  resetQuiz,
  setCurrentIdx,
  setLocalExamStarted,
  isTutor = true,
  fetchOrGenerateQuiz,
  themeStyles = {}
}) {
  const {
    cardBg = '#1e293b',
    cardBorder = 'rgba(255, 255, 255, 0.1)',
    primaryColor = '#6366f1',
    textPrimary = '#f8fafc',
    textSecondary = '#94a3b8',
    cardShadow = '0 8px 24px rgba(0,0,0,0.2)'
  } = themeStyles;

  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const isPassing = percentage >= 70;

  return (
    <Box sx={{ width: '100%', py: 4, px: { xs: 1.5, sm: 3 }, maxWidth: 1360, mx: 'auto' }}>
      {autoSubmitted && (
        <Alert
          severity="warning"
          icon={<AlertTriangle size={20} />}
          sx={{ mb: 3, textAlign: 'left', borderRadius: 2 }}
        >
          <strong>Time Expired (30:00 limit):</strong> The 30-minute exam time limit reached zero. Your answers were automatically submitted and graded.
        </Alert>
      )}

      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, sm: 5 },
          borderRadius: 3,
          bgcolor: cardBg,
          border: `1px solid ${cardBorder}`,
          textAlign: 'center',
          boxShadow: cardShadow
        }}
      >
        <Box
          sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            bgcolor: isPassing ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: isPassing ? '#22c55e' : '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 2.5
          }}
        >
          <Award size={44} />
        </Box>

        <Typography variant="h4" sx={{ fontWeight: 800, color: textPrimary, mb: 1 }}>
          {percentage}%
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mb: 1.5 }}>
          <Chip
            label={`Score: ${calcEarnedMarks} / ${calcTotalMarks} Marks (${marksPerQuestion} mark each)`}
            size="medium"
            sx={{
              fontWeight: 800,
              fontSize: '0.88rem',
              bgcolor: isPassing ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: isPassing ? '#22c55e' : '#ef4444'
            }}
          />
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 700, color: isPassing ? '#22c55e' : '#ef4444', mb: 1 }}>
          {percentage === 100
            ? 'Flawless Mastery!'
            : isPassing
            ? 'Great Job! Course Knowledge Verified'
            : 'Keep Practicing! Review the Lectures Below'}
        </Typography>
        <Typography variant="body2" sx={{ color: textSecondary, mb: 4 }}>
          You answered {score} out of {totalQuestions} questions correctly ({calcEarnedMarks} / {calcTotalMarks} marks) across all course lectures.
        </Typography>

        {/* Lecture Breakdown Section */}
        {Object.keys(lectureBreakdown).length > 0 && (
          <Box sx={{ textAlign: 'left', mb: 4 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary, mb: 1.5 }}>
              Lecture Performance Breakdown:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {Object.entries(lectureBreakdown).map(([lectTitle, stats]) => {
                const lectPct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
                return (
                  <Box
                    key={lectTitle}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: 'var(--bg-dark, #0f172a)',
                      border: `1px solid ${cardBorder}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 1
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 200 }}>
                      <Video size={16} color={primaryColor} />
                      <Typography variant="body2" sx={{ fontWeight: 600, color: textPrimary }}>
                        {lectTitle}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          color: lectPct >= 70 ? '#22c55e' : '#f59e0b',
                          bgcolor: lectPct >= 70 ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          px: 1.5,
                          py: 0.5,
                          borderRadius: 1.5
                        }}
                      >
                        {stats.correct} / {stats.total} correct ({lectPct}%)
                      </Typography>
                      {stats.lecture_id && handleSelectLecture && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ExternalLink size={13} />}
                          onClick={() => handleSelectLecture(stats.lecture_id, courseName)}
                          sx={{
                            textTransform: 'none',
                            fontSize: '0.75rem',
                            py: 0.3,
                            px: 1,
                            borderRadius: 1.5,
                            borderColor: cardBorder,
                            color: textSecondary,
                            '&:hover': { color: primaryColor, borderColor: primaryColor }
                          }}
                        >
                          Review Lecture
                        </Button>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <Divider sx={{ my: 3, borderColor: cardBorder }} />

        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() => {
              if (typeof setCurrentIdx === 'function') {
                setCurrentIdx(0);
              }
              setShowSummaryView(false);
              setReviewingQuestions(true);
            }}
            startIcon={<BookOpen size={16} />}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            Review Questions
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              if (typeof resetQuiz === 'function') resetQuiz();
              setCurrentIdx(0);
              setReviewingQuestions(false);
              setShowSummaryView(false);
              setLocalExamStarted(false);
            }}
            startIcon={<RotateCcw size={16} />}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            Retake Quiz
          </Button>
          {isTutor && (
            <Button
              variant="contained"
              onClick={() => {
                if (typeof fetchOrGenerateQuiz === 'function') fetchOrGenerateQuiz(true);
                setCurrentIdx(0);
                setReviewingQuestions(false);
                setShowSummaryView(false);
                setLocalExamStarted(false);
              }}
              startIcon={<Sparkles size={16} />}
              sx={{
                bgcolor: primaryColor,
                color: '#fff',
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 2
              }}
            >
              Generate New Quiz
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
