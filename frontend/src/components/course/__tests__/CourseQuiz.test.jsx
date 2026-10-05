import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseQuiz from '../CourseQuiz';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseQuiz Component', () => {
  it('renders initial state with Generate Course Quiz button and course name', () => {
    const fetchOrGenerateQuiz = vi.fn();
    render(
      <CourseQuiz
        courseName="Machine Learning"
        lectureCount={3}
        quizData={null}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{}}
        isCompleted={false}
        score={0}
        totalQuestions={0}
        answeredCount={0}
        lectureBreakdown={{}}
        fetchOrGenerateQuiz={fetchOrGenerateQuiz}
        selectAnswer={vi.fn()}
        resetQuiz={vi.fn()}
        handleSelectLecture={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Machine Learning Comprehensive Quiz')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Generate Course Quiz/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(fetchOrGenerateQuiz).toHaveBeenCalledWith(false);
  });

  it('renders loading spinner when quizLoading is true', () => {
    render(
      <CourseQuiz
        courseName="Machine Learning"
        lectureCount={3}
        quizData={null}
        quizLoading={true}
        quizError={null}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Synthesizing Course-Wide Quiz/i)).toBeInTheDocument();
  });

  it('renders question, lecture badge, options, and allows answering with lecture navigation', () => {
    const selectAnswer = vi.fn();
    const handleSelectLecture = vi.fn();

    const mockQuizData = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      lecture_count: 2,
      questions: [
        {
          id: 1,
          question: 'What is loss function $L(\\theta)$ in supervised learning?',
          options: [
            'Empirical risk measure',
            'Constant learning rate',
            'Determinant of weight matrix',
            'Initial bias term'
          ],
          correct_index: 0,
          explanation: 'Taught in Supervised Learning Foundations at [12:30].',
          lecture_id: 'vid_ml_1',
          lecture_title: 'Supervised Learning Foundations',
          timestamp: '12:30',
          difficulty: 'medium'
        }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        lectureCount={2}
        quizData={mockQuizData}
        quizLoading={false}
        quizError={null}
        selectedAnswers={{ 1: 0 }}
        isCompleted={true}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        lectureBreakdown={{
          'Supervised Learning Foundations': { total: 1, correct: 1, lecture_id: 'vid_ml_1' }
        }}
        fetchOrGenerateQuiz={vi.fn()}
        selectAnswer={selectAnswer}
        resetQuiz={vi.fn()}
        handleSelectLecture={handleSelectLecture}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getAllByText(/Supervised Learning Foundations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/12:30/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Correct!/i)).toBeInTheDocument();

    const openLectureBtn = screen.getByRole('button', { name: /Open Supervised Learning Foundations/i });
    expect(openLectureBtn).toBeInTheDocument();
    fireEvent.click(openLectureBtn);
    expect(handleSelectLecture).toHaveBeenCalledWith('vid_ml_1', 'Machine Learning');
  });
});
