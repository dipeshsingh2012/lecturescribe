import React from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  Clock,
  Award
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function LectureQuiz({
  quizData,
  quizLoading,
  quizError,
  selectedAnswers = {},
  isCompleted,
  score = 0,
  totalQuestions = 0,
  answeredCount = 0,
  fetchOrGenerateQuiz,
  selectAnswer,
  resetQuiz,
  handleCueClick,
  currentTheme
}) {
  const primaryColor = currentTheme?.palette?.primary || '#6366f1';
  const cardBg = currentTheme?.palette?.cardBg || '#1e293b';
  const cardBorder = currentTheme?.palette?.cardBorder || 'rgba(255, 255, 255, 0.1)';
  const textPrimary = currentTheme?.palette?.textPrimary || '#f8fafc';
  const textSecondary = currentTheme?.palette?.textSecondary || '#94a3b8';

  const OPTION_LABELS = ['A', 'B', 'C', 'D'];

  // 1. Initial State: No quiz generated yet
  if (!quizData && !quizLoading) {
    return (
      <Box
        sx={{
          flex: 1,
          height: '100%',
          overflowY: 'auto',
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'var(--bg-dark, #0f172a)'
        }}
      >
        <Box
          sx={{
            maxWidth: 500,
            width: '100%',
            p: 4,
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)'
          }}
        >
          <Box
            sx={{
              width: 64,
              height: 64,
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
            <HelpCircle size={36} />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: textPrimary, mb: 1 }}>
            Lecture Practice Quiz
          </Typography>
          <Typography variant="body2" sx={{ color: textSecondary, mb: 3, lineHeight: 1.6 }}>
            Generate a personalized 5-question multiple-choice quiz grounded in the professor's explanations, mathematical proofs, and timestamps.
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
              background: `linear-gradient(135deg, ${primaryColor}, #8b5cf6)`,
              color: '#ffffff',
              fontWeight: 700,
              px: 4,
              py: 1.2,
              borderRadius: 2,
              textTransform: 'none',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              '&:hover': {
                filter: 'brightness(1.1)'
              }
            }}
          >
            Generate Quiz
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
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          bgcolor: 'var(--bg-dark, #0f172a)'
        }}
      >
        <CircularProgress size={48} sx={{ color: primaryColor, mb: 3 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, color: textPrimary, mb: 1 }}>
          Synthesizing Lecture Quiz...
        </Typography>
        <Typography variant="body2" sx={{ color: textSecondary, maxWidth: 360, textAlign: 'center' }}>
          Extracting key theorems, definitions, and mathematical equations directly from the transcript.
        </Typography>
      </Box>
    );
  }

  const questions = quizData?.questions || [];
  const percentScore = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  return (
    <Box
      sx={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        p: { xs: 2, sm: 3 },
        bgcolor: 'var(--bg-dark, #0f172a)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5
      }}
    >
      {/* Top Banner / Controls */}
      <Box
        sx={{
          p: 2.5,
          borderRadius: 2,
          bgcolor: cardBg,
          border: `1px solid ${cardBorder}`,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { sm: 'center' },
          justifyContent: 'space-between',
          gap: 2
        }}
      >
        <div>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: textPrimary }}>
              Practice Quiz
            </Typography>
            <Chip
              label={`${answeredCount} / ${totalQuestions} Answered`}
              size="small"
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.08)',
                color: textSecondary,
                fontWeight: 600,
                fontSize: '0.75rem'
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: textSecondary }}>
            {quizData?.lecture_title || 'Lecture Concepts & Formulas'}
          </Typography>
        </div>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={resetQuiz}
            disabled={answeredCount === 0}
            startIcon={<RotateCcw size={14} />}
            sx={{
              borderColor: cardBorder,
              color: textPrimary,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.8rem',
              '&:hover': { borderColor: primaryColor }
            }}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => fetchOrGenerateQuiz(true)}
            startIcon={<Sparkles size={14} />}
            sx={{
              background: primaryColor,
              color: '#ffffff',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.8rem',
              '&:hover': { filter: 'brightness(1.1)' }
            }}
          >
            Regenerate
          </Button>
        </Box>
      </Box>

      {/* Completion Scorecard Banner */}
      {isCompleted && (
        <Box
          sx={{
            p: 3,
            borderRadius: 2,
            background: percentScore >= 70
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.25))'
              : 'linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(202, 138, 4, 0.25))',
            border: percentScore >= 70 ? '1px solid #10b981' : '1px solid #eab308',
            display: 'flex',
            alignItems: 'center',
            gap: 2.5
          }}
        >
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              bgcolor: percentScore >= 70 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(234, 179, 8, 0.25)',
              color: percentScore >= 70 ? '#10b981' : '#eab308',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Award size={30} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Quiz Complete! You scored {score} out of {totalQuestions} ({percentScore}%)
            </Typography>
            <Typography variant="body2" sx={{ color: textSecondary, mt: 0.5 }}>
              {percentScore >= 80
                ? 'Excellent mastery of the lecture materials and mathematical concepts!'
                : percentScore >= 60
                ? 'Solid understanding! Review the timestamps for any missed questions.'
                : 'Keep practicing! Click the timestamp buttons below each explanation to review key segments.'}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Questions List */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pb: 4 }}>
        {questions.map((q, qIndex) => {
          const isAnswered = selectedAnswers[q.id] !== undefined;
          const userChoice = selectedAnswers[q.id];
          const isCorrect = userChoice === q.correct_index;

          return (
            <Box
              key={q.id || qIndex}
              sx={{
                p: { xs: 2, sm: 2.5 },
                borderRadius: 2,
                bgcolor: cardBg,
                border: `1px solid ${cardBorder}`,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
              }}
            >
              {/* Question Header */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      bgcolor: 'rgba(99, 102, 241, 0.15)',
                      color: primaryColor,
                      fontWeight: 700
                    }}
                  >
                    Question {qIndex + 1}
                  </Typography>
                  {q.difficulty && (
                    <Chip
                      label={q.difficulty.toUpperCase()}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        bgcolor: q.difficulty === 'hard'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : q.difficulty === 'easy'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(234, 179, 8, 0.15)',
                        color: q.difficulty === 'hard'
                          ? '#ef4444'
                          : q.difficulty === 'easy'
                          ? '#10b981'
                          : '#eab308'
                      }}
                    />
                  )}
                </Box>

                {q.timestamp && (
                  <Chip
                    icon={<Clock size={12} />}
                    label={q.timestamp}
                    size="small"
                    onClick={() => handleCueClick && handleCueClick(q.timestamp)}
                    clickable
                    sx={{
                      height: 22,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      bgcolor: 'rgba(255, 255, 255, 0.06)',
                      color: textSecondary,
                      '&:hover': {
                        bgcolor: 'rgba(99, 102, 241, 0.2)',
                        color: primaryColor
                      }
                    }}
                  />
                )}
              </Box>

              {/* Question Text */}
              <Box sx={{ mb: 2, color: textPrimary, fontSize: '0.95rem', fontWeight: 600 }}>
                <MarkdownWithTimestamps
                  content={q.question}
                  onTimestampClick={handleCueClick}
                />
              </Box>

              {/* Options */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(q.options || []).map((optionText, optIdx) => {
                  const isSelected = userChoice === optIdx;
                  const isThisOptionCorrect = optIdx === q.correct_index;

                  let optionBorder = cardBorder;
                  let optionBg = 'rgba(255, 255, 255, 0.03)';
                  let optionTextColor = textPrimary;
                  let icon = null;

                  if (isAnswered) {
                    if (isThisOptionCorrect) {
                      optionBorder = '#10b981';
                      optionBg = 'rgba(16, 185, 129, 0.15)';
                      icon = <CheckCircle2 size={18} color="#10b981" />;
                    } else if (isSelected && !isThisOptionCorrect) {
                      optionBorder = '#ef4444';
                      optionBg = 'rgba(239, 68, 68, 0.15)';
                      icon = <XCircle size={18} color="#ef4444" />;
                    } else {
                      optionTextColor = textSecondary;
                      optionBg = 'transparent';
                    }
                  }

                  return (
                    <Box
                      key={optIdx}
                      component="button"
                      onClick={() => !isAnswered && selectAnswer(q.id, optIdx)}
                      disabled={isAnswered}
                      sx={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1.5,
                        p: 1.5,
                        borderRadius: 1.5,
                        bgcolor: optionBg,
                        border: `1.5px solid ${optionBorder}`,
                        color: optionTextColor,
                        cursor: isAnswered ? 'default' : 'pointer',
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          bgcolor: !isAnswered ? 'rgba(99, 102, 241, 0.1)' : optionBg,
                          borderColor: !isAnswered ? primaryColor : optionBorder
                        }
                      }}
                    >
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: isAnswered && isThisOptionCorrect
                            ? '#10b981'
                            : isAnswered && isSelected
                            ? '#ef4444'
                            : 'rgba(255, 255, 255, 0.1)',
                          color: (isAnswered && (isThisOptionCorrect || isSelected)) ? '#ffffff' : textSecondary,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          flexShrink: 0,
                          mt: 0.2
                        }}
                      >
                        {OPTION_LABELS[optIdx] || optIdx + 1}
                      </Box>
                      <Box sx={{ flex: 1, fontSize: '0.9rem', lineHeight: 1.5 }}>
                        <MarkdownWithTimestamps
                          content={optionText}
                          onTimestampClick={handleCueClick}
                        />
                      </Box>
                      {icon && <Box sx={{ flexShrink: 0, mt: 0.3 }}>{icon}</Box>}
                    </Box>
                  );
                })}
              </Box>

              {/* Immediate Feedback Card */}
              {isAnswered && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    borderRadius: 1.5,
                    bgcolor: isCorrect ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    border: `1px solid ${isCorrect ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontWeight: 800,
                      color: isCorrect ? '#10b981' : '#ef4444',
                      mb: 0.75
                    }}
                  >
                    {isCorrect ? '🎉 Correct!' : '❌ Incorrect'}
                  </Typography>

                  <Box sx={{ color: textPrimary, fontSize: '0.86rem', lineHeight: 1.6, mb: 1.5 }}>
                    <MarkdownWithTimestamps
                      content={q.explanation}
                      onTimestampClick={handleCueClick}
                    />
                  </Box>

                  {q.timestamp && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Clock size={13} />}
                      onClick={() => handleCueClick && handleCueClick(q.timestamp)}
                      sx={{
                        borderColor: isCorrect ? '#10b981' : primaryColor,
                        color: isCorrect ? '#10b981' : primaryColor,
                        textTransform: 'none',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        borderRadius: 1,
                        py: 0.4,
                        px: 1.2
                      }}
                    >
                      Watch explanation at {q.timestamp}
                    </Button>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
