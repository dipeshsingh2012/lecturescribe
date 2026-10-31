import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuestionFeedback from '../QuestionFeedback';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

const mockQuestion = {
  id: 1,
  question: 'What is the role of the loss function?',
  options: ['Measure empirical risk', 'Set learning rate', 'Initialize weights', 'Count epochs'],
  correct_index: 0,
  explanation: 'Loss function measures empirical discrepancy.'
};

describe('QuestionFeedback Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Question Quality & Calibration section with thumbs up and thumbs down buttons', () => {
    render(
      <QuestionFeedback
        quizType="course"
        targetId="machine-learning"
        questionId={1}
        question={mockQuestion}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Question Quality & Calibration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Helpful question/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Report question issue/i })).toBeInTheDocument();
  });

  it('submits positive feedback when thumbs up is clicked', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Feedback recorded',
        feedback: { rating: 'positive' }
      })
    });

    const onFeedbackSubmitted = vi.fn();

    render(
      <QuestionFeedback
        quizType="course"
        targetId="machine-learning"
        questionId={1}
        question={mockQuestion}
        currentTheme={mockTheme}
        onFeedbackSubmitted={onFeedbackSubmitted}
      />
    );

    const upBtn = screen.getByRole('button', { name: /Helpful question/i });
    fireEvent.click(upBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/quiz/feedback'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"rating":"positive"')
        })
      );
    });

    expect(await screen.findByText(/Marked as helpful\. Thank you!/i)).toBeInTheDocument();
    expect(onFeedbackSubmitted).toHaveBeenCalled();
  });

  it('expands calibration panel on thumbs down, allows selecting issue tags and submitting critique', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Critique saved',
        feedback: {
          rating: 'negative',
          issue_tags: ['ambiguous_wording', 'incorrect_answer'],
          comment: 'Option A and C are both mathematically correct.'
        }
      })
    });

    render(
      <QuestionFeedback
        quizType="course"
        targetId="machine-learning"
        questionId={1}
        question={mockQuestion}
        currentTheme={mockTheme}
      />
    );

    const downBtn = screen.getByRole('button', { name: /Report question issue/i });
    fireEvent.click(downBtn);

    // Calibration panel appears
    expect(screen.getByText(/What should be calibrated for this question\?/i)).toBeInTheDocument();
    const ambiguousChip = screen.getByText('Ambiguous wording');
    const incorrectChip = screen.getByText('Incorrect answer key');

    fireEvent.click(ambiguousChip);
    fireEvent.click(incorrectChip);

    // Enter comment
    const input = screen.getByPlaceholderText(/Tell us what was incorrect/i);
    fireEvent.change(input, { target: { value: 'Option A and C are both mathematically correct.' } });

    // Submit critique
    const submitBtn = screen.getByRole('button', { name: /Submit Calibration Critique/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/quiz/feedback'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"ambiguous_wording"')
        })
      );
    });

    expect(await screen.findByText(/Critique saved\. This will recalibrate future quiz generations!/i)).toBeInTheDocument();
  });

  it('renders pre-existing positive rating state', () => {
    render(
      <QuestionFeedback
        quizType="lecture"
        targetId="vid_123"
        questionId={2}
        question={mockQuestion}
        initialFeedback={{ rating: 'positive' }}
        currentTheme={mockTheme}
      />
    );

    const upBtn = screen.getByRole('button', { name: /Helpful question/i });
    expect(upBtn).toBeInTheDocument();
  });
});

