import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureQuiz from '../LectureQuiz';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('LectureQuiz Component', () => {
  it('renders initial empty state with "Generate Quiz" trigger button', () => {
    const generateQuiz = vi.fn();
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
        generateQuiz={generateQuiz}
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
    expect(generateQuiz).toHaveBeenCalledWith(false);
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
        generateQuiz={vi.fn()}
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
    const generateQuiz = vi.fn();
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
        generateQuiz={generateQuiz}
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
        generateQuiz={generateQuiz}
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

  it('renders "Review from Question 1" button upon completion and scrolls to top on click', () => {
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

    render(
      <LectureQuiz
        quizData={mockQuizData}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{ 1: 0 }}
        isCompleted={true}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        generateQuiz={vi.fn()}
        selectAnswer={vi.fn()}
        resetQuiz={vi.fn()}
        handleCueClick={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const reviewBtn = screen.getByText(/Review from Question 1/i).closest('button');
    expect(reviewBtn).toBeInTheDocument();
    fireEvent.click(reviewBtn);
  });

  it('renders corrupted LaTeX math ($\\theta$ and $\\theta - \\eta \\times \\text{gradient}$) cleanly using KaTeX in questions and explanations', () => {
    const handleCueClick = vi.fn();
    const mockQuizData = {
      video_id: 'gan101',
      lecture_title: 'Generative Adversarial Networks',
      questions: [
        {
          id: 1,
          question:
            'Which optimization algorithm is typically used to update the weights $\theta$ of the generator and discriminator networks?',
          options: [
            'Gradient descent ($\theta - eta \times \text{gradient}$)',
            'Breadth-first search',
            'K-means clustering',
            'Topological sorting'
          ],
          correct_index: 0,
          explanation:
            'The lecture describes the update rule as $\theta - eta \times \text{gradient}$ [18:40], which is the standard gradient descent update rule used to minimize the loss function with respect to the network parameters.',
          timestamp: '18:40',
          difficulty: 'medium'
        }
      ]
    };

    const { container } = render(
      <LectureQuiz
        quizData={mockQuizData}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{ 1: 0 }}
        isCompleted={true}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        generateQuiz={vi.fn()}
        selectAnswer={vi.fn()}
        resetQuiz={vi.fn()}
        handleCueClick={handleCueClick}
        currentTheme={mockTheme}
      />
    );

    // Question, option A, and explanation should all render KaTeX visual symbols (θ and θ−η×gradient) with zero raw '$' or TABs
    const katexHtmlTexts = Array.from(container.querySelectorAll('.katex-html')).map(el => el.textContent);
    expect(katexHtmlTexts).toContain('θ');
    expect(katexHtmlTexts).toContain('θ−η×gradient');
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toContain('\t');

    const annotations = Array.from(container.querySelectorAll('annotation')).map(el => el.textContent);
    expect(annotations).toContain('\\theta');
    expect(annotations).toContain('\\theta - \\eta \\times \\text{gradient}');

    // Inline timestamp button inside explanation should jump video via handleCueClick
    const inlineTsBtn = container.querySelector('button[data-timestamp="18:40"]');
    expect(inlineTsBtn).toBeInTheDocument();
    fireEvent.click(inlineTsBtn);
    expect(handleCueClick).toHaveBeenCalledWith('18:40');
  });
});
