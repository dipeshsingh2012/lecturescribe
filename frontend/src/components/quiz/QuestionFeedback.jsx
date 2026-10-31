import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  TextField,
  Tooltip,
  Collapse,
  Alert
} from '@mui/material';
import {
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Check,
  AlertCircle
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

const ISSUE_OPTIONS = [
  { id: 'ambiguous_wording', label: 'Ambiguous wording' },
  { id: 'incorrect_answer', label: 'Incorrect answer key' },
  { id: 'too_easy', label: 'Too easy' },
  { id: 'too_hard', label: 'Too hard' },
  { id: 'bad_explanation', label: 'Inadequate explanation' },
  { id: 'formatting_error', label: 'LaTeX / formatting error' }
];

export default function QuestionFeedback({
  quizType = 'course',
  targetId,
  questionId,
  question = {},
  userEmail = 'anonymous',
  currentTheme,
  initialFeedback = null,
  onFeedbackSubmitted = null
}) {
  const [rating, setRating] = useState(initialFeedback?.rating || null);
  const [selectedTags, setSelectedTags] = useState(initialFeedback?.issue_tags || []);
  const [comment, setComment] = useState(initialFeedback?.comment || '');
  const [submitting, setSubmitting] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(Boolean(initialFeedback?.rating === 'negative'));

  const primaryColor = currentTheme?.palette?.primary || '#0075ed';
  const cardBorder = currentTheme?.palette?.border || 'rgba(255, 255, 255, 0.1)';
  const textPrimary = currentTheme?.palette?.textPrimary || '#f8fafc';
  const textSecondary = currentTheme?.palette?.textSecondary || '#94a3b8';

  const sendFeedback = async (voteRating, tags = selectedTags, userComment = comment) => {
    if (!targetId || questionId === undefined || questionId === null) return;
    setSubmitting(true);
    setSubmittedMessage(null);
    try {
      const payload = {
        quiz_type: quizType,
        target_id: targetId,
        question_id: questionId,
        rating: voteRating,
        issue_tags: tags,
        comment: userComment,
        user_email: userEmail || 'anonymous',
        question_text: question.question || '',
        options: question.options || [],
        correct_index: question.correct_index ?? 0
      };

      const res = await fetch(`${API_BASE}/api/quiz/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setRating(voteRating);
        if (voteRating === 'positive') {
          setSubmittedMessage('Marked as helpful. Thank you!');
          setIsPanelOpen(false);
        } else {
          setSubmittedMessage('Critique saved. This will recalibrate future quiz generations!');
        }
        if (typeof onFeedbackSubmitted === 'function') {
          onFeedbackSubmitted(data);
        }
      }
    } catch (err) {
      console.warn('Failed to submit question feedback:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleThumbUp = () => {
    if (rating === 'positive') return;
    setSelectedTags([]);
    setComment('');
    sendFeedback('positive', [], '');
  };

  const handleThumbDown = () => {
    if (rating === 'negative' && isPanelOpen) {
      setIsPanelOpen(false);
      return;
    }
    setRating('negative');
    setIsPanelOpen(true);
  };

  const toggleTag = (tagId) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const handleCritiqueSubmit = () => {
    sendFeedback('negative', selectedTags, comment);
  };

  return (
    <Box
      sx={{
        mt: 2,
        pt: 1.5,
        borderTop: `1px dashed ${cardBorder}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Sparkles size={14} color={primaryColor} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, fontSize: '0.78rem' }}>
            Question Quality & Calibration
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Helpful & conceptually clear">
            <IconButton
              size="small"
              onClick={handleThumbUp}
              disabled={submitting}
              aria-label="Helpful question"
              sx={{
                p: 0.6,
                color: rating === 'positive' ? '#10b981' : textSecondary,
                bgcolor: rating === 'positive' ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                border: `1px solid ${rating === 'positive' ? '#10b981' : 'transparent'}`,
                '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }
              }}
            >
              <ThumbsUp size={15} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Report an issue or suggest improvement">
            <IconButton
              size="small"
              onClick={handleThumbDown}
              disabled={submitting}
              aria-label="Report question issue"
              sx={{
                p: 0.6,
                color: rating === 'negative' ? '#f59e0b' : textSecondary,
                bgcolor: rating === 'negative' ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                border: `1px solid ${rating === 'negative' ? '#f59e0b' : 'transparent'}`,
                '&:hover': { bgcolor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }
              }}
            >
              <ThumbsDown size={15} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Success notification */}
      {submittedMessage && (
        <Alert
          severity="success"
          icon={<Check size={14} />}
          sx={{
            py: 0.2,
            px: 1.5,
            fontSize: '0.76rem',
            bgcolor: 'rgba(16, 185, 129, 0.1)',
            color: '#10b981',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            '& .MuiAlert-icon': { color: '#10b981', mr: 1 }
          }}
        >
          {submittedMessage}
        </Alert>
      )}

      {/* Expanded feedback details for negative rating */}
      <Collapse in={isPanelOpen}>
        <Box
          sx={{
            p: 1.8,
            borderRadius: 2,
            bgcolor: 'var(--highlight-bg, rgba(245, 158, 11, 0.05))',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            mt: 0.5
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <AlertCircle size={15} color="#f59e0b" />
            <Typography variant="caption" sx={{ fontWeight: 700, color: textPrimary, fontSize: '0.8rem' }}>
              What should be calibrated for this question?
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
            {ISSUE_OPTIONS.map(opt => {
              const isSelected = selectedTags.includes(opt.id);
              return (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  size="small"
                  onClick={() => toggleTag(opt.id)}
                  sx={{
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    bgcolor: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: isSelected ? '#f59e0b' : textSecondary,
                    border: `1px solid ${isSelected ? '#f59e0b' : cardBorder}`,
                    '&:hover': { bgcolor: 'rgba(245, 158, 11, 0.15)' }
                  }}
                />
              );
            })}
          </Box>

          <TextField
            size="small"
            placeholder="Tell us what was incorrect or how to improve this question stem, options, or explanation..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            rows={2}
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: '0.82rem',
                color: textPrimary,
                bgcolor: 'rgba(0, 0, 0, 0.15)',
                '& fieldset': { borderColor: cardBorder },
                '&:hover fieldset': { borderColor: primaryColor },
                '&.Mui-focused fieldset': { borderColor: primaryColor }
              }
            }}
          />

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button
              size="small"
              onClick={() => setIsPanelOpen(false)}
              sx={{ textTransform: 'none', color: textSecondary, fontSize: '0.78rem' }}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={submitting || (selectedTags.length === 0 && !comment.trim())}
              onClick={handleCritiqueSubmit}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.78rem',
                bgcolor: '#f59e0b',
                color: '#000',
                '&:hover': { bgcolor: '#d97706' }
              }}
            >
              {submitting ? 'Saving...' : 'Submit Calibration Critique'}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}

