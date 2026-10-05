import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Paper,
  Divider,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  Clock,
  Award,
  Video,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  BookOpen
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function CourseQuiz({
  courseName = 'Active Course',
  lectureCount = 0,
  quizData,
  quizLoading,
  quizError,
  selectedAnswers = {},
  isCompleted,
  score = 0,
  totalQuestions = 0,
  answeredCount = 0,
  lectureBreakdown = {},
  fetchOrGenerateQuiz,
  selectAnswer,
  resetQuiz,
  handleSelectLecture,
  currentTheme
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showSummaryView, setShowSummaryView] = useState(false);

  const primaryColor = currentTheme?.palette?.primary || '#6366f1';
  const cardBg = currentTheme?.palette?.cardBg || '#1e293b';
  const cardBorder = currentTheme?.palette?.cardBorder || 'rgba(255, 255, 255, 0.1)';
  const textPrimary = currentTheme?.palette?.textPrimary || '#f8fafc';
  const textSecondary = currentTheme?.palette?.textSecondary || '#94a3b8';

  const OPTION_LABELS = ['A', 'B', 'C', 'D'];
  const questions = quizData?.questions || [];

  // 1. Initial State: No quiz generated yet
  if ((!quizData || questions.length === 0) && !quizLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 8,
          px: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Box
          sx={{
            maxWidth: 580,
            width: '100%',
            p: { xs: 3, sm: 5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            textAlign: 'center',
            boxShadow: currentTheme?.palette?.cardShadow || '0 8px 32px rgba(0, 0, 0, 0.25)'
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
            onClick={() => fetchOrGenerateQuiz(false)}
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
      </Box>
    );
  }

  // 2. Loading State
  if (quizLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2.5
        }}
      >
        <CircularProgress size={44} sx={{ color: primaryColor }} />
        <Typography variant="h6" sx={{ fontWeight: 700, color: textPrimary }}>
          Synthesizing Course-Wide Quiz...
        </Typography>
        <Typography variant="body2" sx={{ color: textSecondary, maxWidth: 440, textAlign: 'center', lineHeight: 1.5 }}>
          Analyzing transcripts and formulas across all lectures in <strong>{courseName}</strong> to build balanced exam questions.
        </Typography>
      </Box>
    );
  }

  // 3. Summary / Completion View (Shown when completed or toggled)
  if (isCompleted && showSummaryView) {
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    const isPassing = percentage >= 70;

    return (
      <Box sx={{ width: '100%', py: 4, px: { xs: 1, sm: 3 }, maxWidth: 860, mx: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            textAlign: 'center',
            boxShadow: currentTheme?.palette?.cardShadow || '0 8px 24px rgba(0,0,0,0.2)'
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
          <Typography variant="h6" sx={{ fontWeight: 700, color: isPassing ? '#22c55e' : '#ef4444', mb: 1 }}>
            {percentage === 100
              ? 'Flawless Mastery!'
              : isPassing
              ? 'Great Job! Course Knowledge Verified'
              : 'Keep Practicing! Review the Lectures Below'}
          </Typography>
          <Typography variant="body2" sx={{ color: textSecondary, mb: 4 }}>
            You answered {score} out of {totalQuestions} questions correctly across all course lectures.
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
              onClick={() => setShowSummaryView(false)}
              startIcon={<BookOpen size={16} />}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              Review Questions
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                resetQuiz();
                setCurrentIdx(0);
                setShowSummaryView(false);
              }}
              startIcon={<RotateCcw size={16} />}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              Retake Quiz
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                fetchOrGenerateQuiz(true);
                setCurrentIdx(0);
                setShowSummaryView(false);
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
          </Box>
        </Paper>
      </Box>
    );
  }

  // 4. Active Question View
  const currentQ = questions[currentIdx] || questions[0];
  if (!currentQ) return null;

  const currentChoice = selectedAnswers[currentQ.id];
  const isAnswered = currentChoice !== undefined;
  const isCorrect = currentChoice === currentQ.correct_index;

  const handleNext = () => {
    if (currentIdx < totalQuestions - 1) {
      setCurrentIdx(currentIdx + 1);
    } else if (isCompleted) {
      setShowSummaryView(true);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
    }
  };

  return (
    <Box sx={{ width: '100%', py: 3, px: { xs: 1, sm: 2 }, maxWidth: 900, mx: 'auto' }}>
      {/* Header Bar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2.5,
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: textPrimary }}>
              {courseName} Exam
            </Typography>
            <Chip
              label={`${lectureCount} lectures covered`}
              size="small"
              sx={{
                bgcolor: 'rgba(99, 102, 241, 0.12)',
                color: primaryColor,
                fontWeight: 700,
                fontSize: '0.72rem'
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: textSecondary }}>
            Question {currentIdx + 1} of {totalQuestions} • {answeredCount} answered
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {answeredCount > 0 && (
            <Chip
              label={`Score: ${score} / ${answeredCount}`}
              size="small"
              sx={{
                bgcolor: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
                fontWeight: 700,
                fontSize: '0.78rem'
              }}
            />
          )}
          {isCompleted && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowSummaryView(true)}
              startIcon={<Award size={14} />}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.78rem',
                borderRadius: 2
              }}
            >
              View Results
            </Button>
          )}
          <Tooltip title="Generate fresh questions">
            <IconButton
              size="small"
              onClick={() => fetchOrGenerateQuiz(true)}
              sx={{ color: textSecondary, '&:hover': { color: primaryColor } }}
            >
              <RotateCcw size={16} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Linear Progress */}
      <LinearProgress
        variant="determinate"
        value={totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0}
        sx={{
          height: 6,
          borderRadius: 3,
          mb: 3,
          bgcolor: 'rgba(255, 255, 255, 0.08)',
          '& .MuiLinearProgress-bar': {
            bgcolor: primaryColor,
            borderRadius: 3
          }
        }}
      />

      {/* Stepper Dots / Chips Bar */}
      <Box
        sx={{
          display: 'flex',
          gap: 0.8,
          mb: 3,
          overflowX: 'auto',
          pb: 1,
          '::-webkit-scrollbar': { height: 4 }
        }}
      >
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
                minWidth: 34,
                height: 34,
                p: 0,
                borderRadius: '50%',
                fontWeight: 700,
                fontSize: '0.75rem',
                border: isSelected ? `2px solid ${primaryColor}` : `1px solid ${cardBorder}`,
                bgcolor: hasAnswered
                  ? wasCorrect
                    ? 'rgba(34, 197, 94, 0.2)'
                    : 'rgba(239, 68, 68, 0.2)'
                  : isSelected
                  ? 'rgba(99, 102, 241, 0.15)'
                  : cardBg,
                color: hasAnswered
                  ? wasCorrect
                    ? '#22c55e'
                    : '#ef4444'
                  : isSelected
                  ? primaryColor
                  : textSecondary,
                '&:hover': {
                  bgcolor: 'rgba(99, 102, 241, 0.25)'
                }
              }}
            >
              {idx + 1}
            </Button>
          );
        })}
      </Box>

      {/* Question Card */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, sm: 4 },
          borderRadius: 3,
          bgcolor: cardBg,
          border: `1px solid ${cardBorder}`,
          mb: 3,
          boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.15)'
        }}
      >
        {/* Source Lecture Header & Timestamp */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              icon={<Video size={13} style={{ marginLeft: 6 }} />}
              label={currentQ.lecture_title || `Lecture ${currentQ.lecture_id}`}
              size="small"
              onClick={
                currentQ.lecture_id && handleSelectLecture
                  ? () => handleSelectLecture(currentQ.lecture_id, courseName)
                  : undefined
              }
              sx={{
                bgcolor: 'rgba(99, 102, 241, 0.15)',
                color: primaryColor,
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: currentQ.lecture_id && handleSelectLecture ? 'pointer' : 'default',
                '&:hover': currentQ.lecture_id && handleSelectLecture ? { opacity: 0.85 } : {}
              }}
            />
            {currentQ.timestamp && (
              <Chip
                icon={<Clock size={12} style={{ marginLeft: 6 }} />}
                label={currentQ.timestamp}
                size="small"
                sx={{
                  bgcolor: 'rgba(255, 255, 255, 0.06)',
                  color: textSecondary,
                  fontSize: '0.72rem',
                  fontWeight: 600
                }}
              />
            )}
          </Box>

          <Chip
            label={currentQ.difficulty || 'medium'}
            size="small"
            sx={{
              textTransform: 'uppercase',
              fontSize: '0.65rem',
              fontWeight: 800,
              letterSpacing: '0.5px',
              bgcolor:
                currentQ.difficulty === 'easy'
                  ? 'rgba(34, 197, 94, 0.15)'
                  : currentQ.difficulty === 'hard'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(245, 158, 11, 0.15)',
              color:
                currentQ.difficulty === 'easy'
                  ? '#22c55e'
                  : currentQ.difficulty === 'hard'
                  ? '#ef4444'
                  : '#f59e0b'
            }}
          />
        </Box>

        {/* Question Text */}
        <Typography
          component="div"
          sx={{
            color: textPrimary,
            fontWeight: 600,
            fontSize: { xs: '1rem', sm: '1.12rem' },
            lineHeight: 1.6,
            mb: 3
          }}
        >
          <MarkdownWithTimestamps content={currentQ.question} text={currentQ.question} />
        </Typography>

        {/* Options Grid */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          {currentQ.options.map((optText, optIdx) => {
            const isThisChosen = currentChoice === optIdx;
            const isThisCorrect = optIdx === currentQ.correct_index;

            let optBg = 'rgba(255, 255, 255, 0.03)';
            let optBorder = cardBorder;
            let optColor = textPrimary;
            let iconComponent = null;

            if (isAnswered) {
              if (isThisCorrect) {
                optBg = 'rgba(34, 197, 94, 0.12)';
                optBorder = '#22c55e';
                optColor = '#22c55e';
                iconComponent = <CheckCircle2 size={18} color="#22c55e" />;
              } else if (isThisChosen) {
                optBg = 'rgba(239, 68, 68, 0.12)';
                optBorder = '#ef4444';
                optColor = '#ef4444';
                iconComponent = <XCircle size={18} color="#ef4444" />;
              } else {
                optColor = textSecondary;
              }
            }

            return (
              <Box
                key={optIdx}
                onClick={() => !isAnswered && selectAnswer(currentQ.id, optIdx)}
                sx={{
                  p: 2,
                  borderRadius: 2.5,
                  bgcolor: optBg,
                  border: `1.5px solid ${optBorder}`,
                  cursor: isAnswered ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  transition: 'all 0.15s ease-in-out',
                  '&:hover': !isAnswered
                    ? {
                        bgcolor: 'rgba(99, 102, 241, 0.08)',
                        borderColor: primaryColor
                      }
                    : {}
                }}
              >
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    bgcolor: isAnswered && isThisCorrect
                      ? 'rgba(34, 197, 94, 0.2)'
                      : isAnswered && isThisChosen
                      ? 'rgba(239, 68, 68, 0.2)'
                      : 'rgba(255, 255, 255, 0.08)',
                    color: optColor
                  }}
                >
                  {OPTION_LABELS[optIdx]}
                </Box>

                <Box sx={{ flex: 1, pt: 0.2 }}>
                  <Typography
                    component="div"
                    sx={{
                      color: optColor,
                      fontSize: '0.92rem',
                      lineHeight: 1.5,
                      fontWeight: isThisChosen || (isAnswered && isThisCorrect) ? 600 : 400
                    }}
                  >
                    <MarkdownWithTimestamps content={optText} text={optText} />
                  </Typography>
                </Box>

                {iconComponent && <Box sx={{ pt: 0.3 }}>{iconComponent}</Box>}
              </Box>
            );
          })}
        </Box>

        {/* Pedagogical Explanation Box */}
        {isAnswered && (
          <Box
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              bgcolor: isCorrect ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${isCorrect ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {isCorrect ? (
                <CheckCircle2 size={16} color="#22c55e" />
              ) : (
                <XCircle size={16} color="#ef4444" />
              )}
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  color: isCorrect ? '#22c55e' : '#ef4444'
                }}
              >
                {isCorrect ? 'Correct!' : 'Incorrect'}
              </Typography>
            </Box>

            <Typography component="div" sx={{ color: textPrimary, fontSize: '0.88rem', lineHeight: 1.6 }}>
              <MarkdownWithTimestamps content={currentQ.explanation} text={currentQ.explanation} />
            </Typography>

            {currentQ.lecture_id && handleSelectLecture && (
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => handleSelectLecture(currentQ.lecture_id, courseName)}
                  startIcon={<Video size={14} />}
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    borderRadius: 1.5,
                    borderColor: cardBorder,
                    color: textPrimary,
                    '&:hover': { borderColor: primaryColor, color: primaryColor }
                  }}
                >
                  Open {currentQ.lecture_title || 'Lecture'}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* Navigation Footer */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button
          variant="outlined"
          disabled={currentIdx === 0}
          onClick={handlePrev}
          startIcon={<ChevronLeft size={16} />}
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
        >
          Previous
        </Button>

        <Button
          variant="contained"
          onClick={handleNext}
          endIcon={
            currentIdx === totalQuestions - 1 && isCompleted ? (
              <Award size={16} />
            ) : (
              <ChevronRight size={16} />
            )
          }
          sx={{
            bgcolor: primaryColor,
            color: '#fff',
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: 2,
            px: 3,
            '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
          }}
        >
          {currentIdx === totalQuestions - 1
            ? isCompleted
              ? 'View Results'
              : 'Finish Quiz'
            : 'Next Question'}
        </Button>
      </Box>
    </Box>
  );
}
