import React from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Divider,
  Paper
} from '@mui/material';
import {
  PanelRightClose,
  Clock,
  Award
} from 'lucide-react';

export default function QuizQuestionPalette({
  sidebarOpen,
  setSidebarOpen,
  reviewMode = false,
  timeLeft = 1800,
  formatTime,
  answeredCount = 0,
  totalQuestions = 0,
  calcTotalMarks = 0,
  questions = [],
  currentIdx = 0,
  setCurrentIdx,
  selectedAnswers = {},
  isGradedReview = false,
  finishQuiz,
  setReviewingQuestions,
  setShowSummaryView,
  themeStyles = {}
}) {
  if (!sidebarOpen) return null;

  const {
    cardBg = '#1e293b',
    cardBorder = 'rgba(255, 255, 255, 0.1)',
    primaryColor = '#6366f1',
    textPrimary = '#f8fafc',
    textSecondary = '#94a3b8',
    cardShadow = '0 4px 20px rgba(0,0,0,0.1)'
  } = themeStyles;

  return (
    <Paper
      elevation={0}
      sx={{
        width: { xs: '100%', md: 320, lg: 340 },
        flexShrink: 0,
        p: { xs: 2.5, sm: 3 },
        borderRadius: 3,
        bgcolor: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: cardShadow,
        position: { md: 'sticky' },
        top: { md: 24 }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: textPrimary }}>
          Exam Overview
        </Typography>
        <IconButton size="small" onClick={() => setSidebarOpen(false)} sx={{ color: textSecondary }}>
          <PanelRightClose size={15} />
        </IconButton>
      </Box>

      {/* 30-Minute Timer Box */}
      {!reviewMode && (
        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: timeLeft <= 300 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(99, 102, 241, 0.08)',
            border: `1px solid ${timeLeft <= 300 ? 'rgba(239, 68, 68, 0.3)' : cardBorder}`,
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Clock size={16} color={timeLeft <= 300 ? '#ef4444' : primaryColor} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: timeLeft <= 300 ? '#ef4444' : textSecondary }}>
              Time Left
            </Typography>
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, fontFamily: 'monospace', color: timeLeft <= 300 ? '#ef4444' : textPrimary, fontSize: '0.95rem' }}>
            {typeof formatTime === 'function' ? formatTime(timeLeft) : timeLeft}
          </Typography>
        </Box>
      )}

      {/* Marked vs Remaining Stats */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
        <Box sx={{ flex: 1, p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: '#22c55e', fontWeight: 800, display: 'block', fontSize: '0.7rem' }}>
            Marked
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, color: '#22c55e' }}>
            {answeredCount}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 700, display: 'block', fontSize: '0.7rem' }}>
            Remaining
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 800, color: textPrimary }}>
            {totalQuestions - answeredCount}
          </Typography>
        </Box>
      </Box>

      <Typography variant="caption" sx={{ color: textSecondary, display: 'block', mb: 2, textAlign: 'center', fontWeight: 600 }}>
        0.5 Mark each • Total {calcTotalMarks} Marks
      </Typography>

      <Divider sx={{ mb: 2, borderColor: cardBorder }} />

      {/* Interactive Question Palette Grid */}
      <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 1.5 }}>
        Question Palette
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, mb: 2.5 }}>
        {questions.map((q, idx) => {
          const ans = selectedAnswers[q.id];
          const hasAnswered = ans !== undefined;
          const wasCorrect = ans === q.correct_index;
          const isSelected = idx === currentIdx;

          return (
            <Button
              key={q.id}
              size="small"
              onClick={() => setCurrentIdx(idx)}
              sx={{
                minWidth: 0,
                height: 36,
                p: 0,
                borderRadius: 1.5,
                fontWeight: 700,
                fontSize: '0.75rem',
                border: isSelected ? `2px solid ${primaryColor}` : `1px solid ${cardBorder}`,
                bgcolor: hasAnswered
                  ? isGradedReview
                    ? wasCorrect
                      ? 'rgba(34, 197, 94, 0.25)'
                      : 'rgba(239, 68, 68, 0.25)'
                    : 'rgba(34, 197, 94, 0.2)'
                  : isSelected
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'rgba(255, 255, 255, 0.03)',
                color: hasAnswered
                  ? isGradedReview
                    ? wasCorrect
                      ? '#22c55e'
                      : '#ef4444'
                    : '#22c55e'
                  : isSelected
                  ? primaryColor
                  : textSecondary,
                '&:hover': {
                  bgcolor: 'rgba(99, 102, 241, 0.2)'
                }
              }}
            >
              {idx + 1}
            </Button>
          );
        })}
      </Box>

      {/* Legend */}
      {isGradedReview ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', mb: 2.5, px: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e' }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Correct</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef4444' }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Incorrect</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: primaryColor }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Current</Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', mb: 2.5, px: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e' }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Marked</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: primaryColor }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Current</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.2)' }} />
            <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.68rem' }}>Remaining</Typography>
          </Box>
        </Box>
      )}

      {/* Submit Exam / View Summary Button */}
      {isGradedReview ? (
        <Button
          variant="outlined"
          fullWidth
          onClick={() => {
            setReviewingQuestions(false);
            setShowSummaryView(true);
          }}
          startIcon={<Award size={15} />}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.82rem',
            borderRadius: 2,
            borderColor: cardBorder,
            color: textPrimary,
            py: 1,
            '&:hover': { borderColor: primaryColor, color: primaryColor }
          }}
        >
          View Score Summary
        </Button>
      ) : (
        <Button
          variant="contained"
          fullWidth
          onClick={() => {
            if (typeof finishQuiz === 'function') finishQuiz();
            setReviewingQuestions(false);
            setShowSummaryView(true);
          }}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.82rem',
            borderRadius: 2,
            bgcolor: primaryColor,
            color: '#fff',
            py: 1,
            boxShadow: 'none',
            '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
          }}
        >
          Submit Exam
        </Button>
      )}
    </Paper>
  );
}
