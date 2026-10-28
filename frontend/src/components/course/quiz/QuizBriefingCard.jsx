import React from 'react';
import {
  Box,
  Typography,
  Button,
  Alert
} from '@mui/material';
import {
  Award,
  Sparkles,
  Clock,
  BookOpen,
  AlertTriangle,
  Play
} from 'lucide-react';

export default function QuizBriefingCard({
  courseName,
  lectureCount = 0,
  totalQuestions = 0,
  calcTotalMarks = 0,
  quizError = null,
  fetchOrGenerateQuiz,
  handleStartExam,
  isInitialEmptyState = false,
  themeStyles = {}
}) {
  const {
    cardBg = '#1e293b',
    cardBorder = 'rgba(255, 255, 255, 0.1)',
    primaryColor = '#6366f1',
    textPrimary = '#f8fafc',
    textSecondary = '#94a3b8',
    cardShadow = '0 8px 32px rgba(0, 0, 0, 0.25)'
  } = themeStyles;

  if (isInitialEmptyState) {
    return (
      <Box
        sx={{
          maxWidth: 640,
          mx: 'auto',
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
            width: 68,
            height: 68,
            borderRadius: '50%',
            bgcolor: 'rgba(99, 102, 241, 0.15)',
            color: primaryColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 2.5
          }}
        >
          <Award size={38} />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 800, color: textPrimary, mb: 1 }}>
          {courseName} Comprehensive Quiz
        </Typography>
        <Typography variant="body2" sx={{ color: textSecondary, mb: 3.5, lineHeight: 1.6, maxWidth: 480, mx: 'auto' }}>
          Test your overall knowledge across all {lectureCount > 0 ? lectureCount : ''} lectures in this course.
          Questions test definitions, theorems, and proofs with LaTeX formulas and direct citations to lecture segments.
        </Typography>

        {quizError && (
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {quizError}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          onClick={() => fetchOrGenerateQuiz && fetchOrGenerateQuiz(false)}
          startIcon={<Sparkles size={18} />}
          sx={{
            bgcolor: primaryColor,
            color: '#fff',
            fontWeight: 700,
            textTransform: 'none',
            px: 4,
            py: 1.4,
            borderRadius: 2.5,
            fontSize: '0.95rem',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
            '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
          }}
        >
          Generate Course Quiz
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        maxWidth: 680,
        mx: 'auto',
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
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: 'rgba(99, 102, 241, 0.15)',
          color: primaryColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 2.5
        }}
      >
        <Award size={40} />
      </Box>

      <Typography variant="h5" sx={{ fontWeight: 800, color: textPrimary, mb: 1 }}>
        {courseName} Comprehensive Exam
      </Typography>
      <Typography variant="body2" sx={{ color: textSecondary, mb: 3.5, lineHeight: 1.6, maxWidth: 500, mx: 'auto' }}>
        The exam covers key theories, formulas, and proofs across all {lectureCount > 0 ? lectureCount : ''} lectures.
        The 30-minute timer will begin only when you click <strong>Start Exam</strong> below.
      </Typography>

      {/* 4 Feature Pill Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
          mb: 4,
          textAlign: 'left'
        }}
      >
        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Clock size={20} color={primaryColor} />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Duration</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>30 Minutes</Typography>
          </Box>
        </Box>

        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <BookOpen size={20} color={primaryColor} />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Total Questions</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>{totalQuestions} Questions</Typography>
          </Box>
        </Box>

        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Award size={20} color="#10b981" />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Marking Scheme</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>0.5 Mark each ({calcTotalMarks} Total)</Typography>
          </Box>
        </Box>

        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <AlertTriangle size={20} color="#f59e0b" />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Submission</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>Auto-submits on timeout</Typography>
          </Box>
        </Box>
      </Box>

      <Button
        variant="contained"
        size="large"
        onClick={handleStartExam}
        startIcon={<Play size={20} />}
        sx={{
          bgcolor: primaryColor,
          color: '#fff',
          fontWeight: 800,
          textTransform: 'none',
          px: 5,
          py: 1.5,
          borderRadius: 2.5,
          fontSize: '1rem',
          boxShadow: '0 4px 18px rgba(99, 102, 241, 0.45)',
          '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
        }}
      >
        Start Exam
      </Button>
    </Box>
  );
}
