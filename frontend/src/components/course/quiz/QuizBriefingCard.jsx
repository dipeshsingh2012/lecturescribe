import React from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Alert
} from '@mui/material';
import {
  Award,
  Sparkles,
  Clock,
  BookOpen,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders
} from 'lucide-react';
import QuizSettingsSelector from './QuizSettingsSelector';
import ResponseTimeBadge from '../../common/ResponseTimeBadge';

export default function QuizBriefingCard({
  courseName,
  lectureCount = 0,
  totalQuestions = 0,
  calcTotalMarks = 0,
  quizError = null,
  fetchOrGenerateQuiz,
  handleStartExam,
  isInitialEmptyState = false,
  hasPastQuizzes = false,
  quizSettings = {
    difficulty: 'medium',
    numQuestions: 20,
    questionTypes: 'mixed',
    timed: true,
    timeLimitMinutes: 20
  },
  onUpdateSettings,
  handleBackToOverview,
  responseTimeMs = null,
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
          maxWidth: 720,
          mx: 'auto',
          p: { xs: 3, sm: 4.5 },
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
        <Typography variant="body2" sx={{ color: textSecondary, mb: 2, lineHeight: 1.6, maxWidth: 540, mx: 'auto' }}>
          Test your overall knowledge across all {lectureCount > 0 ? lectureCount : ''} lectures in this course.
          Configure the complexity, volume, and time limit to match your study goals.
        </Typography>

        {/* Interactive Complexity & Quiz Settings Controls */}
        <QuizSettingsSelector
          settings={quizSettings}
          onUpdateSettings={onUpdateSettings}
          themeStyles={themeStyles}
        />

        {quizError && (
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {quizError}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          onClick={() => fetchOrGenerateQuiz && fetchOrGenerateQuiz(true, quizSettings)}
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
          {hasPastQuizzes ? 'Generate New Quiz' : 'Generate Course Quiz'}
        </Button>
      </Box>
    );
  }

  const isTimed = quizSettings?.timed !== false;
  const durationLabel = isTimed ? `${quizSettings?.timeLimitMinutes || totalQuestions || 30} Minutes` : 'Untimed Practice';

  return (
    <Box
      sx={{
        maxWidth: 720,
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
      {Boolean(responseTimeMs) && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <ResponseTimeBadge ms={responseTimeMs} size="sm" prefix="Generated in" />
        </Box>
      )}
      <Typography variant="body2" sx={{ color: textSecondary, mb: 3.5, lineHeight: 1.6, maxWidth: 520, mx: 'auto' }}>
        The exam covers key theories, formulas, and proofs across all {lectureCount > 0 ? lectureCount : ''} lectures.
        {isTimed
          ? ` The ${durationLabel} timer will begin only when you click Start Exam below.`
          : ' You are in untimed practice mode. Complete questions at your own pace.'}
      </Typography>

      {/* 4 Feature Pill Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
          mb: 3.5,
          textAlign: 'left'
        }}
      >
        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Clock size={20} color={primaryColor} />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Duration</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>{durationLabel}</Typography>
          </Box>
        </Box>

        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.03)', border: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <BookOpen size={20} color={primaryColor} />
          <Box>
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Total Questions</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>{totalQuestions} Questions</Typography>
              {quizSettings?.difficulty && (
                <Chip
                  label={quizSettings.difficulty.toUpperCase()}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    bgcolor:
                      quizSettings.difficulty === 'easy'
                        ? 'rgba(34, 197, 94, 0.15)'
                        : quizSettings.difficulty === 'hard'
                        ? 'rgba(239, 68, 68, 0.15)'
                        : 'rgba(245, 158, 11, 0.15)',
                    color:
                      quizSettings.difficulty === 'easy'
                        ? '#22c55e'
                        : quizSettings.difficulty === 'hard'
                        ? '#ef4444'
                        : '#f59e0b'
                  }}
                />
              )}
            </Box>
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
            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', fontWeight: 600 }}>Format & Mode</Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>
              {quizSettings?.questionTypes === 'mcq'
                ? 'MCQ Only'
                : quizSettings?.questionTypes === 'fill_in_the_blank'
                ? 'Fill-in-Blank'
                : 'MCQ & Fill-in Mix'}
              {isTimed ? ' • Auto-submits' : ' • Self-Paced'}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
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

        {typeof handleBackToOverview === 'function' && (
          <Button
            variant="outlined"
            size="large"
            onClick={handleBackToOverview}
            startIcon={<RotateCcw size={18} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2.5,
              borderColor: cardBorder,
              color: textSecondary,
              '&:hover': { borderColor: primaryColor, color: primaryColor }
            }}
          >
            Reconfigure Settings
          </Button>
        )}
      </Box>
    </Box>
  );
}
