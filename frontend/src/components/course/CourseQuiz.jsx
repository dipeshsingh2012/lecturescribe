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
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails
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
  ChevronDown,
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
  finishQuiz,
  resetQuiz,
  handleSelectLecture,
  currentTheme,
  detailedExplanations = {},
  explanationLoading = {},
  expandedExplanation = {},
  setExpandedExplanation,
  fetchDetailedExplanation,
  quizHistory = [],
  historyLoading = false,
  fetchQuizHistory,
  loadPastQuiz,
  reviewMode = false
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

  // Helper: Past Quizzes Component
  const renderPastQuizzes = () => {
    if (!quizHistory || quizHistory.length === 0) return null;
    return (
      <Paper
        elevation={0}
        sx={{
          mt: 4,
          p: { xs: 2.5, sm: 3 },
          borderRadius: 3,
          bgcolor: cardBg,
          border: `1px solid ${cardBorder}`,
          boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Award size={18} color={primaryColor} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Past Course Quizzes
            </Typography>
            <Chip
              label={`${quizHistory.length} attempts`}
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
            <IconButton size="small" onClick={() => fetchQuizHistory()} sx={{ color: textSecondary }}>
              <RotateCcw size={14} />
            </IconButton>
          )}
        </Box>

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

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {typeof loadPastQuiz === 'function' && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          loadPastQuiz(run.quiz_id, false);
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
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Paper>
    );
  };

  // 1. Initial State: No quiz generated yet
  if ((!quizData || questions.length === 0) && !quizLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 6,
          px: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: 860,
          mx: 'auto'
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

        {/* Show past quizzes list on initial landing if available */}
        <Box sx={{ width: '100%', maxWidth: 700 }}>
          {renderPastQuizzes()}
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

  // 3. Summary / Completion View (Shown when Finish Quiz is clicked or results toggled)
  if (showSummaryView) {
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

        {renderPastQuizzes()}
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
    } else {
      if (typeof finishQuiz === 'function') {
        finishQuiz();
      }
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
      {/* Review Mode Banner */}
      {reviewMode && (
        <Alert
          severity="info"
          sx={{
            mb: 2.5,
            borderRadius: 2,
            bgcolor: 'rgba(99, 102, 241, 0.12)',
            color: textPrimary,
            border: `1px solid ${cardBorder}`
          }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                if (quizData?.quiz_id && typeof loadPastQuiz === 'function') {
                  loadPastQuiz(quizData.quiz_id, true);
                } else {
                  resetQuiz();
                }
              }}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Replay this Quiz
            </Button>
          }
        >
          Viewing past quiz attempt in review mode.
        </Alert>
      )}

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
          {(isCompleted || answeredCount > 0) && (
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
          alignItems: 'center',
          gap: 1,
          mb: 3,
          overflowX: 'auto',
          py: 0.5,
          '&::-webkit-scrollbar': { height: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.2)', borderRadius: 2 }
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
        {/* Source Lecture Header & Clickable Timestamp */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              icon={<Video size={13} style={{ marginLeft: 6 }} />}
              label={currentQ.lecture_title || `Lecture ${currentQ.lecture_id}`}
              size="small"
              onClick={
                currentQ.lecture_id && handleSelectLecture
                  ? () => handleSelectLecture(currentQ.lecture_id, courseName, currentQ.timestamp)
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
                onClick={
                  currentQ.lecture_id && handleSelectLecture
                    ? () => handleSelectLecture(currentQ.lecture_id, courseName, currentQ.timestamp)
                    : undefined
                }
                sx={{
                  bgcolor: 'rgba(255, 255, 255, 0.08)',
                  color: textPrimary,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: currentQ.lecture_id && handleSelectLecture ? 'pointer' : 'default',
                  '&:hover': currentQ.lecture_id && handleSelectLecture ? { bgcolor: 'rgba(255, 255, 255, 0.16)' } : {}
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

        {/* Question Text with LaTeX rendering */}
        <Typography
          component="div"
          variant="h6"
          sx={{
            fontWeight: 700,
            color: textPrimary,
            fontSize: '1.05rem',
            lineHeight: 1.6,
            mb: 3
          }}
        >
          <MarkdownWithTimestamps
            content={currentQ.question}
            text={currentQ.question}
            onTimestampClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
            onCueClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
          />
        </Typography>

        {/* 4 Answer Options */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          {currentQ.options.map((optText, optIdx) => {
            const isUserChoice = currentChoice === optIdx;
            const isCorrectOption = optIdx === currentQ.correct_index;

            let optBg = 'rgba(255, 255, 255, 0.03)';
            let optBorder = cardBorder;
            let optColor = textPrimary;
            let iconComponent = (
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  bgcolor: 'rgba(255, 255, 255, 0.06)',
                  color: textSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  flexShrink: 0
                }}
              >
                {OPTION_LABELS[optIdx]}
              </Box>
            );

            if (isAnswered) {
              if (isCorrectOption) {
                optBg = 'rgba(34, 197, 94, 0.15)';
                optBorder = '#22c55e';
                iconComponent = <CheckCircle2 size={22} color="#22c55e" style={{ flexShrink: 0 }} />;
              } else if (isUserChoice && !isCorrect) {
                optBg = 'rgba(239, 68, 68, 0.15)';
                optBorder = '#ef4444';
                iconComponent = <XCircle size={22} color="#ef4444" style={{ flexShrink: 0 }} />;
              }
            }

            return (
              <Box
                key={optIdx}
                onClick={() => {
                  if (!isAnswered && !reviewMode) {
                    selectAnswer(currentQ.id, optIdx);
                  }
                }}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: optBg,
                  border: `1.5px solid ${optBorder}`,
                  color: optColor,
                  cursor: isAnswered || reviewMode ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    bgcolor: isAnswered || reviewMode ? optBg : 'rgba(99, 102, 241, 0.12)',
                    borderColor: isAnswered || reviewMode ? optBorder : primaryColor
                  }
                }}
              >
                {iconComponent}
                <Typography component="div" sx={{ fontSize: '0.92rem', lineHeight: 1.5, flex: 1 }}>
                  <MarkdownWithTimestamps
                    content={optText}
                    text={optText}
                    onTimestampClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
                    onCueClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
                  />
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Feedback & Static Explanation */}
        {isAnswered && (
          <Box
            sx={{
              mt: 3,
              p: 2.5,
              borderRadius: 2,
              bgcolor: isCorrect ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${isCorrect ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {isCorrect ? (
                <CheckCircle2 size={18} color="#22c55e" />
              ) : (
                <XCircle size={18} color="#ef4444" />
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
              <MarkdownWithTimestamps
                content={currentQ.explanation}
                text={currentQ.explanation}
                onTimestampClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
                onCueClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
              />
            </Typography>

            {currentQ.lecture_id && handleSelectLecture && (
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => handleSelectLecture(currentQ.lecture_id, courseName, currentQ.timestamp)}
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
                  Open {currentQ.lecture_title || 'Lecture'} {currentQ.timestamp ? `@ ${currentQ.timestamp}` : ''}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Detailed AI Explanation Accordion */}
        {isAnswered && (
          <Accordion
            expanded={expandedExplanation[currentQ.id] || false}
            onChange={(e, isExpanded) => {
              if (typeof setExpandedExplanation === 'function') {
                setExpandedExplanation(prev => ({ ...prev, [currentQ.id]: isExpanded }));
              }
              if (isExpanded && !detailedExplanations[currentQ.id] && !explanationLoading[currentQ.id]) {
                if (typeof fetchDetailedExplanation === 'function') {
                  fetchDetailedExplanation(currentQ.id, currentQ);
                }
              }
            }}
            sx={{
              mt: 2.5,
              bgcolor: 'rgba(99, 102, 241, 0.05)',
              border: `1px solid ${cardBorder}`,
              borderRadius: 1.5,
              '&:before': { display: 'none' },
              boxShadow: 'none'
            }}
          >
            <AccordionSummary
              expandIcon={<ChevronDown size={18} />}
              sx={{
                minHeight: 48,
                '& .MuiAccordionSummary-content': {
                  margin: '12px 0',
                  alignItems: 'center'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                <BookOpen size={18} color={primaryColor} />
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    color: textPrimary,
                    fontSize: '0.9rem'
                  }}
                >
                  Detailed AI Explanation
                </Typography>
                {explanationLoading[currentQ.id] && (
                  <CircularProgress size={14} sx={{ color: primaryColor }} />
                )}
                {detailedExplanations[currentQ.id] && !explanationLoading[currentQ.id] && (
                  <Chip
                    label="Ready"
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      bgcolor: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981'
                    }}
                  />
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Divider sx={{ mb: 2, borderColor: cardBorder }} />
              {explanationLoading[currentQ.id] ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
                  <CircularProgress size={20} sx={{ color: primaryColor }} />
                  <Typography variant="body2" sx={{ color: textSecondary }}>
                    Generating detailed explanation with cross-lecture context and transcript proofs...
                  </Typography>
                </Box>
              ) : detailedExplanations[currentQ.id] ? (
                <Box sx={{ color: textPrimary, fontSize: '0.9rem', lineHeight: 1.7 }}>
                  <MarkdownWithTimestamps
                    content={detailedExplanations[currentQ.id]}
                    text={detailedExplanations[currentQ.id]}
                    onTimestampClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
                    onCueClick={(ts) => handleSelectLecture && handleSelectLecture(currentQ.lecture_id, courseName, ts)}
                  />
                </Box>
              ) : (
                <Typography variant="body2" sx={{ color: textSecondary, fontStyle: 'italic' }}>
                  Click to generate a comprehensive explanation using lecture transcript, cross-lecture context, and academic formulas.
                </Typography>
              )}
            </AccordionDetails>
          </Accordion>
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
            currentIdx === totalQuestions - 1 ? (
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
            ? 'Finish Quiz'
            : 'Next Question'}
        </Button>
      </Box>

      {/* Past Quizzes History & Replay Section */}
      {renderPastQuizzes()}
    </Box>
  );
}
