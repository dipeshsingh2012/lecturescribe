import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Chip,
  LinearProgress,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert
} from '@mui/material';
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  Award,
  Video,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BookOpen,
  PanelRightClose,
  PanelRightOpen,
  X
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';
import { formatSecondsToTimestamp } from '../../utils/formatters';
import PastQuizzesAccordion from './quiz/PastQuizzesAccordion';
import QuizBriefingCard from './quiz/QuizBriefingCard';
import QuizResultsSummary from './quiz/QuizResultsSummary';
import QuizQuestionPalette from './quiz/QuizQuestionPalette';

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
  clearAnswer,
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
  deleteQuizHistory,
  reviewMode = false,
  replayingQuizId = null,
  exitReplay,
  timeLeft = 1800,
  setTimeLeft,
  autoSubmitted = false,
  examStarted = false,
  startExam,
  marksPerQuestion = 0.5,
  totalMarks,
  earnedMarks,
  isTutor = true
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showSummaryView, setShowSummaryView] = useState(false);
  const [reviewingQuestions, setReviewingQuestions] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [localExamStarted, setLocalExamStarted] = useState(false);
  const [pastQuizzesOpen, setPastQuizzesOpen] = useState(false);
  const [deletingQuizId, setDeletingQuizId] = useState(null);
  const [replayBannerDismissed, setReplayBannerDismissed] = useState(false);

  React.useEffect(() => {
    setReplayBannerDismissed(false);
  }, [replayingQuizId]);

  const isStarted = examStarted || localExamStarted || Boolean(answeredCount > 0) || isCompleted || reviewMode || Boolean(replayingQuizId) || autoSubmitted;

  const handleStartExam = () => {
    if (typeof startExam === 'function') startExam();
    setLocalExamStarted(true);
    setShowSummaryView(false);
    setReviewingQuestions(false);
  };

  const handleDeleteQuiz = async (quizId) => {
    if (!quizId) return;
    if (window.confirm('Are you sure you want to delete this quiz attempt from your history?')) {
      setDeletingQuizId(quizId);
      try {
        if (typeof deleteQuizHistory === 'function') {
          await deleteQuizHistory(quizId);
        }
      } finally {
        setDeletingQuizId(null);
      }
    }
  };

  const isGradedReview = !replayingQuizId && (isCompleted || reviewMode || autoSubmitted);
  const isExamActive = !isGradedReview;
  const canSelectOption = (!reviewMode || Boolean(replayingQuizId)) && !autoSubmitted;

  const calcTotalMarks = totalMarks !== undefined ? totalMarks : Number((totalQuestions * marksPerQuestion).toFixed(1));
  const calcEarnedMarks = earnedMarks !== undefined ? earnedMarks : Number((score * marksPerQuestion).toFixed(1));

  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        setCurrentIdx((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIdx((prev) => Math.min(Math.max(0, totalQuestions - 1), prev + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalQuestions]);

  const formatTime = formatSecondsToTimestamp;

  const primaryColor = currentTheme?.palette?.primary || '#6366f1';
  const cardBg = currentTheme?.palette?.cardBg || '#1e293b';
  const cardBorder = currentTheme?.palette?.cardBorder || 'rgba(255, 255, 255, 0.1)';
  const textPrimary = currentTheme?.palette?.textPrimary || '#f8fafc';
  const textSecondary = currentTheme?.palette?.textSecondary || '#94a3b8';
  const cardShadow = currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.15)';

  const themeStyles = {
    cardBg,
    cardBorder,
    primaryColor,
    textPrimary,
    textSecondary,
    cardShadow
  };

  const OPTION_LABELS = ['A', 'B', 'C', 'D'];
  const questions = quizData?.questions || [];

  // Helper: render past quizzes accordion
  const renderPastQuizzes = () => (
    <PastQuizzesAccordion
      quizHistory={quizHistory}
      pastQuizzesOpen={pastQuizzesOpen}
      setPastQuizzesOpen={setPastQuizzesOpen}
      fetchQuizHistory={fetchQuizHistory}
      loadPastQuiz={loadPastQuiz}
      handleDeleteQuiz={handleDeleteQuiz}
      deletingQuizId={deletingQuizId}
      totalQuestions={totalQuestions}
      setReviewingQuestions={setReviewingQuestions}
      setShowSummaryView={setShowSummaryView}
      setCurrentIdx={setCurrentIdx}
      themeStyles={themeStyles}
    />
  );

  // 1. Initial State: No quiz generated yet
  if ((!quizData || questions.length === 0) && !quizLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 4,
          px: { xs: 1.5, sm: 3 },
          maxWidth: 1200,
          mx: 'auto'
        }}
      >
        {renderPastQuizzes()}
        <QuizBriefingCard
          courseName={courseName}
          lectureCount={lectureCount}
          totalQuestions={totalQuestions}
          calcTotalMarks={calcTotalMarks}
          quizError={quizError}
          fetchOrGenerateQuiz={fetchOrGenerateQuiz}
          handleStartExam={handleStartExam}
          isInitialEmptyState={true}
          themeStyles={themeStyles}
        />
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

  // 3. Exam Briefing / Start Screen (When quiz is ready but exam not yet started by user)
  if (!isStarted && !isCompleted && !reviewMode && !autoSubmitted) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 4,
          px: { xs: 1.5, sm: 3 },
          maxWidth: 1200,
          mx: 'auto'
        }}
      >
        {renderPastQuizzes()}
        <QuizBriefingCard
          courseName={courseName}
          lectureCount={lectureCount}
          totalQuestions={totalQuestions}
          calcTotalMarks={calcTotalMarks}
          quizError={quizError}
          fetchOrGenerateQuiz={fetchOrGenerateQuiz}
          handleStartExam={handleStartExam}
          isInitialEmptyState={false}
          themeStyles={themeStyles}
        />
      </Box>
    );
  }

  // 4. Summary / Completion View (Shown when Finish Quiz is clicked, auto-submitted on timeout, or results toggled)
  const shouldShowSummary = (showSummaryView || autoSubmitted) && !reviewingQuestions;
  if (shouldShowSummary) {
    return (
      <Box sx={{ width: '100%', py: 4, px: { xs: 1.5, sm: 3 }, maxWidth: 1360, mx: 'auto' }}>
        {renderPastQuizzes()}
        <QuizResultsSummary
          score={score}
          totalQuestions={totalQuestions}
          calcEarnedMarks={calcEarnedMarks}
          calcTotalMarks={calcTotalMarks}
          marksPerQuestion={marksPerQuestion}
          autoSubmitted={autoSubmitted}
          lectureBreakdown={lectureBreakdown}
          courseName={courseName}
          handleSelectLecture={handleSelectLecture}
          setShowSummaryView={setShowSummaryView}
          setReviewingQuestions={setReviewingQuestions}
          resetQuiz={resetQuiz}
          setCurrentIdx={setCurrentIdx}
          setLocalExamStarted={setLocalExamStarted}
          isTutor={isTutor}
          fetchOrGenerateQuiz={fetchOrGenerateQuiz}
          themeStyles={themeStyles}
        />
      </Box>
    );
  }

  // 5. Active Question View
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
    <Box sx={{ width: '100%', py: 3, px: { xs: 1, sm: 3 }, maxWidth: 1360, mx: 'auto' }}>
      {/* Top Collapsible Past Quizzes Accordion */}
      {renderPastQuizzes()}

      {/* Replay Mode Banner */}
      {replayingQuizId && !replayBannerDismissed && (
        <Alert
          severity="warning"
          sx={{
            mb: 2.5,
            borderRadius: 2,
            bgcolor: 'rgba(245, 158, 11, 0.12)',
            color: textPrimary,
            border: `1px solid ${cardBorder}`
          }}
          action={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  if (typeof exitReplay === 'function') {
                    exitReplay();
                  }
                }}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Return to Current Quiz
              </Button>
              <IconButton
                size="small"
                aria-label="Close replay banner"
                title="Dismiss banner"
                onClick={() => setReplayBannerDismissed(true)}
                sx={{
                  color: 'inherit',
                  p: 0.5,
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.1)' }
                }}
              >
                <X size={16} />
              </IconButton>
            </Box>
          }
        >
          Replaying past quiz attempt. Your score is tracked as a replay attempt without overwriting your active course quiz.
        </Alert>
      )}

      {/* Review Mode Banner */}
      {reviewMode && !replayingQuizId && (
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
            <Box sx={{ display: 'flex', gap: 1 }}>
              {typeof exitReplay === 'function' && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => exitReplay()}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Active Quiz
                </Button>
              )}
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
            </Box>
          }
        >
          Viewing past quiz attempt in review mode.
        </Alert>
      )}

      {/* Graded Review Mode Banner */}
      {isGradedReview && !replayingQuizId && !reviewMode && (
        <Alert
          severity="info"
          icon={<Award size={18} />}
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
                setReviewingQuestions(false);
                setShowSummaryView(true);
              }}
              startIcon={<Award size={14} />}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              View Results Summary
            </Button>
          }
        >
          {autoSubmitted
            ? 'Exam time expired (30:00 limit) • Viewing graded exam answers & explanations.'
            : `Exam completed • Score: ${calcEarnedMarks} / ${calcTotalMarks} Marks (${score}/${totalQuestions} correct) • Viewing graded exam answers & explanations.`}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: textPrimary }}>
              {courseName} Exam
            </Typography>
            <Chip
              label={`${lectureCount} lectures`}
              size="small"
              sx={{
                bgcolor: 'rgba(99, 102, 241, 0.12)',
                color: primaryColor,
                fontWeight: 700,
                fontSize: '0.72rem'
              }}
            />
            <Chip
              label="0.5 Mark / Q"
              size="small"
              sx={{
                bgcolor: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                fontWeight: 700,
                fontSize: '0.72rem'
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: textSecondary }}>
            Question {currentIdx + 1} of {totalQuestions} • {answeredCount} marked • {totalQuestions - answeredCount} remaining
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {/* 30-Minute Countdown Timer Chip */}
          {!reviewMode && (
            <Chip
              icon={<Clock size={14} style={{ color: timeLeft <= 300 ? '#ef4444' : primaryColor }} />}
              label={formatTime(timeLeft)}
              size="small"
              sx={{
                fontWeight: 800,
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                bgcolor: timeLeft <= 300 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(99, 102, 241, 0.12)',
                color: timeLeft <= 300 ? '#ef4444' : textPrimary,
                border: timeLeft <= 300 ? '1.5px solid rgba(239, 68, 68, 0.5)' : `1px solid ${cardBorder}`
              }}
            />
          )}

          {/* Toggle Collapsible Sidebar Button */}
          <Button
            size="small"
            variant="outlined"
            onClick={() => setSidebarOpen(prev => !prev)}
            startIcon={sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.78rem',
              borderRadius: 2,
              borderColor: cardBorder,
              color: textPrimary,
              '&:hover': { borderColor: primaryColor }
            }}
          >
            {sidebarOpen ? 'Hide Overview' : `Overview (${answeredCount}/${totalQuestions})`}
          </Button>

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
              onClick={() => fetchOrGenerateQuiz && fetchOrGenerateQuiz(true)}
              sx={{ color: textSecondary, '&:hover': { color: primaryColor } }}
            >
              <RotateCcw size={16} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Main 2-Column Responsive Body (Question Area + Collapsible Sidebar) */}
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Left Column: 1 Question Per Page */}
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
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

          {/* Question Card */}
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2.5, sm: 4 },
              borderRadius: 3,
              bgcolor: cardBg,
              border: `1px solid ${cardBorder}`,
              mb: 3,
              boxShadow: cardShadow
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

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label="0.5 Mark"
                  size="small"
                  sx={{
                    fontWeight: 800,
                    fontSize: '0.68rem',
                    bgcolor: 'rgba(99, 102, 241, 0.15)',
                    color: primaryColor
                  }}
                />
                {currentQ.type === 'fill_in_the_blank' && (
                  <Chip
                    label="Fill in the Blank"
                    size="small"
                    sx={{
                      textTransform: 'uppercase',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      bgcolor: 'rgba(168, 85, 247, 0.15)',
                      color: '#a855f7'
                    }}
                  />
                )}
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
                      bgcolor: isUserChoice && !isGradedReview ? primaryColor : 'rgba(255, 255, 255, 0.06)',
                      color: isUserChoice && !isGradedReview ? '#fff' : textSecondary,
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

                if (isGradedReview && isAnswered) {
                  if (isCorrectOption) {
                    optBg = 'rgba(34, 197, 94, 0.15)';
                    optBorder = '#22c55e';
                    iconComponent = <CheckCircle2 size={22} color="#22c55e" style={{ flexShrink: 0 }} />;
                  } else if (isUserChoice && !isCorrect) {
                    optBg = 'rgba(239, 68, 68, 0.15)';
                    optBorder = '#ef4444';
                    iconComponent = <XCircle size={22} color="#ef4444" style={{ flexShrink: 0 }} />;
                  }
                } else if (isUserChoice) {
                  optBg = 'rgba(99, 102, 241, 0.14)';
                  optBorder = primaryColor;
                }

                return (
                  <Box
                    key={optIdx}
                    onClick={() => {
                      if (canSelectOption && typeof selectAnswer === 'function') {
                        selectAnswer(currentQ.id, optIdx);
                      }
                    }}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: optBg,
                      border: `1.5px solid ${optBorder}`,
                      color: optColor,
                      cursor: canSelectOption ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        bgcolor: canSelectOption ? 'rgba(99, 102, 241, 0.12)' : optBg,
                        borderColor: canSelectOption ? primaryColor : optBorder
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

            {/* Clear Selection in Live Exam Mode */}
            {isExamActive && isAnswered && typeof clearAnswer === 'function' && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1.5, mb: 2 }}>
                <Button
                  size="small"
                  onClick={() => clearAnswer(currentQ.id)}
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.72rem',
                    color: textSecondary,
                    '&:hover': { color: textPrimary }
                  }}
                >
                  Clear Selection
                </Button>
              </Box>
            )}

            {/* Feedback & Static Explanation */}
            {isGradedReview && isAnswered && (
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
                    {isCorrect ? 'Correct! (+0.5 Mark)' : 'Incorrect'}
                  </Typography>
                </Box>

                {currentQ.type === 'fill_in_the_blank' && currentQ.blank_answer && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary }}>
                      Correct Term:
                    </Typography>
                    <Chip
                      label={currentQ.blank_answer}
                      size="small"
                      sx={{ bgcolor: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', fontWeight: 700, fontSize: '0.75rem' }}
                    />
                  </Box>
                )}

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

            {/* Detailed AI Explanation Accordion (Only displayed when entire quiz is completed) */}
            {isGradedReview && isAnswered && (
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

          {/* 1 Question Per Page Navigation Footer */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2.5 }}>
            <Button
              variant="outlined"
              disabled={currentIdx === 0}
              onClick={handlePrev}
              startIcon={<ChevronLeft size={16} />}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
            >
              Previous
            </Button>

            <Typography variant="body2" sx={{ fontWeight: 700, color: textSecondary }}>
              Question {currentIdx + 1} of {totalQuestions}
            </Typography>

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
                ? (reviewMode ? 'View Results' : 'Finish Quiz')
                : 'Next Question'}
            </Button>
          </Box>
        </Box>

        {/* Right Column: Collapsible Quiz Status Sidebar */}
        <QuizQuestionPalette
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          reviewMode={reviewMode}
          timeLeft={timeLeft}
          formatTime={formatTime}
          answeredCount={answeredCount}
          totalQuestions={totalQuestions}
          calcTotalMarks={calcTotalMarks}
          questions={questions}
          currentIdx={currentIdx}
          setCurrentIdx={setCurrentIdx}
          selectedAnswers={selectedAnswers}
          isGradedReview={isGradedReview}
          finishQuiz={finishQuiz}
          setReviewingQuestions={setReviewingQuestions}
          setShowSummaryView={setShowSummaryView}
          themeStyles={themeStyles}
        />
      </Box>
    </Box>
  );
}
