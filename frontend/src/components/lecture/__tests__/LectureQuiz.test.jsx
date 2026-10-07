import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureQuiz from '../LectureQuiz';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('LectureQuiz Component', () => {
  it('renders initial empty state with "Generate Quiz" trigger button', () => {
    const fetchOrGenerateQuiz = vi.fn();
    render(
      <LectureQuiz
        quizData={null}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{}}
        isCompleted={false}
        score={0}
        totalQuestions={0}
        answeredCount={0}
        fetchOrGenerateQuiz={fetchOrGenerateQuiz}
        selectAnswer={vi.fn()}
        resetQuiz={vi.fn()}
        handleCueClick={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Lecture Practice Quiz')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Generate Quiz/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(fetchOrGenerateQuiz).toHaveBeenCalledWith(false);
  });

  it('renders loading spinner when quizLoading is true', () => {
    render(
      <LectureQuiz
        quizData={null}
        quizLoading={true}
        quizError={null}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Synthesizing Lecture Quiz/i)).toBeInTheDocument();
  });

  it('explains quiz generation is unavailable without transcript and disables generation', () => {
    render(
      <LectureQuiz
        quizData={null}
        quizLoading={false}
        quizError={null}
        fetchOrGenerateQuiz={vi.fn()}
        transcriptAvailable={false}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/quiz generation requires transcript text/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Quiz/i })).toBeDisabled();
  });

  it('renders questions and allows selecting an answer with instant feedback and timestamp button', () => {
    const selectAnswer = vi.fn();
    const handleCueClick = vi.fn();
    const fetchOrGenerateQuiz = vi.fn();
    const resetQuiz = vi.fn();

    const mockQuizData = {
      video_id: 'vid123',
      lecture_title: 'Linear Algebra',
      questions: [
        {
          id: 1,
          question: 'What is the formula for energy?',
          options: ['$E = mc^2$', '$F = ma$', '$a^2 + b^2 = c^2$', '$PV = nRT$'],
          correct_index: 0,
          explanation: 'At [43:34], the professor notes $E = mc^2$.',
          timestamp: '43:34',
          difficulty: 'medium'
        }
      ]
    };

    const { rerender } = render(
      <LectureQuiz
        quizData={mockQuizData}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{}}
        isCompleted={false}
        score={0}
        totalQuestions={1}
        answeredCount={0}
        fetchOrGenerateQuiz={fetchOrGenerateQuiz}
        selectAnswer={selectAnswer}
        resetQuiz={resetQuiz}
        handleCueClick={handleCueClick}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Practice Quiz')).toBeInTheDocument();
    expect(screen.getByText('0 / 1 Answered')).toBeInTheDocument();
    expect(screen.getByText('43:34')).toBeInTheDocument();

    // Select the first option
    const optionBtn = screen.getByText('A').closest('button');
    expect(optionBtn).toBeInTheDocument();
    fireEvent.click(optionBtn);
    expect(selectAnswer).toHaveBeenCalledWith(1, 0);

    // Re-render with answer selected
    rerender(
      <LectureQuiz
        quizData={mockQuizData}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{ 1: 0 }}
        isCompleted={true}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        fetchOrGenerateQuiz={fetchOrGenerateQuiz}
        selectAnswer={selectAnswer}
        resetQuiz={resetQuiz}
        handleCueClick={handleCueClick}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/🎉 Correct!/i)).toBeInTheDocument();
    expect(screen.getByText(/the professor notes/i)).toBeInTheDocument();

    // Verify timestamp jump button in explanation
    const watchBtn = screen.getByText(/Watch explanation at 43:34/i).closest('button');
    expect(watchBtn).toBeInTheDocument();
    fireEvent.click(watchBtn);
    expect(handleCueClick).toHaveBeenCalledWith('43:34');

    // Verify completion scorecard
    expect(screen.getByText(/Quiz Complete! You scored 1 out of 1/i)).toBeInTheDocument();
  });
});
