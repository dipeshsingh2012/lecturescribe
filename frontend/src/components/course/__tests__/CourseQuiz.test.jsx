import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CourseQuiz from '../CourseQuiz';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

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
    expect(handleSelectLecture).toHaveBeenCalledWith('vid_ml_1', 'Machine Learning', '12:30');
  });

  it('clicking timestamp badge in header navigates with lecture and timestamp', () => {
    const handleSelectLecture = vi.fn();
    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{}}
        examStarted={true}
        handleSelectLecture={handleSelectLecture}
        currentTheme={mockTheme}
      />
    );

    const tsChip = screen.getByText('12:30');
    fireEvent.click(tsChip);
    expect(handleSelectLecture).toHaveBeenCalledWith('vid_ml_1', 'Machine Learning', '12:30');
  });

  it('clicking Finish Quiz calls finishQuiz and opens Summary View', () => {
    const finishQuiz = vi.fn();
    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{ 1: 0 }}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        finishQuiz={finishQuiz}
        currentTheme={mockTheme}
      />
    );

    const finishBtn = screen.getByRole('button', { name: /Finish Quiz/i });
    expect(finishBtn).toBeInTheDocument();
    fireEvent.click(finishBtn);
    expect(finishQuiz).toHaveBeenCalled();
    expect(screen.getByText(/100%/i)).toBeInTheDocument();
  });

  it('renders Detailed AI Explanation accordion and triggers fetchDetailedExplanation on click', () => {
    const fetchDetailedExplanation = vi.fn();
    const setExpandedExplanation = vi.fn();
    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{ 1: 0 }}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        fetchDetailedExplanation={fetchDetailedExplanation}
        setExpandedExplanation={setExpandedExplanation}
        currentTheme={mockTheme}
      />
    );

    const accordion = screen.getByText(/Detailed AI Explanation/i);
    expect(accordion).toBeInTheDocument();
    fireEvent.click(accordion);
    expect(fetchDetailedExplanation).toHaveBeenCalledWith(1, mockQuizData.questions[0]);
  });

  it('renders Past Course Quizzes section and allows Review, Replay, and Delete', async () => {
    const loadPastQuiz = vi.fn();
    const deleteQuizHistory = vi.fn().mockResolvedValue(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const mockHistory = [
      {
        quiz_id: 'cquiz_123',
        created_at: '2026-10-08T06:00:00Z',
        score: 4,
        total_questions: 5,
        completed: true
      }
    ];

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{}}
        quizHistory={mockHistory}
        loadPastQuiz={loadPastQuiz}
        deleteQuizHistory={deleteQuizHistory}
        currentTheme={mockTheme}
      />
    );

    const accordionSummary = screen.getByText(/Past Course Quizzes/i);
    expect(accordionSummary).toBeInTheDocument();
    fireEvent.click(accordionSummary);

    expect(screen.getByText(/4 \/ 5 \(80%\)/i)).toBeInTheDocument();

    const reviewBtn = screen.getByRole('button', { name: /Review/i });
    fireEvent.click(reviewBtn);
    expect(loadPastQuiz).toHaveBeenCalledWith('cquiz_123', false);

    const replayBtn = screen.getByRole('button', { name: /Replay/i });
    fireEvent.click(replayBtn);
    expect(loadPastQuiz).toHaveBeenCalledWith('cquiz_123', true);

    const deleteBtn = screen.getByLabelText(/Delete quiz attempt/i);
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteQuizHistory).toHaveBeenCalledWith('cquiz_123');
  });

  it('renders replay mode banner and triggers exitReplay', () => {
    const exitReplay = vi.fn();

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{}}
        examStarted={true}
        replayingQuizId="cquiz_123"
        exitReplay={exitReplay}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Replaying past quiz attempt/i)).toBeInTheDocument();
    const returnBtn = screen.getByRole('button', { name: /Return to Current Quiz/i });
    expect(returnBtn).toBeInTheDocument();
    fireEvent.click(returnBtn);
    expect(exitReplay).toHaveBeenCalledTimes(1);
  });

  it('renders fill in the blank question badge and correct term on answer', () => {
    const mockFitbQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        {
          id: 10,
          type: 'fill_in_the_blank',
          question: 'In deep learning, the gradient of the loss is propagated via _____.',
          blank_answer: 'backpropagation',
          options: ['backpropagation', 'feedforward', 'dropout', 'pooling'],
          correct_index: 0,
          explanation: 'Backpropagation computes gradients using the chain rule.',
          lecture_id: 'vid_ml_2',
          difficulty: 'medium'
        }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockFitbQuiz}
        quizLoading={false}
        selectedAnswers={{ 10: 0 }}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/fill in the blank/i)).toBeInTheDocument();
    expect(screen.getAllByText('backpropagation').length).toBeGreaterThan(0);
  });

  it('supports single-question pagination with Previous/Next buttons and 0.5 Mark badges', () => {
    const multiQuestionQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        {
          id: 1,
          question: 'Question 1: What is linear regression?',
          options: ['A line', 'A circle', 'A tree', 'A network'],
          correct_index: 0
        },
        {
          id: 2,
          question: 'Question 2: What is logistic regression?',
          options: ['Sigmoid classifier', 'Clustering', 'Sorting', 'Hashing'],
          correct_index: 0
        }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={multiQuestionQuiz}
        quizLoading={false}
        selectedAnswers={{}}
        totalQuestions={2}
        answeredCount={0}
        timeLeft={1800}
        examStarted={true}
        currentTheme={mockTheme}
      />
    );

    // Initial page shows Question 1
    expect(screen.getByText(/Question 1: What is linear regression\?/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Question 1 of 2/i).length).toBeGreaterThan(0);
    expect(screen.getByText('0.5 Mark')).toBeInTheDocument();

    // Previous button is disabled on page 1
    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    expect(prevBtn).toBeDisabled();

    // Next button advances to Question 2
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeEnabled();
    fireEvent.click(nextBtn);

    expect(screen.getByText(/Question 2: What is logistic regression\?/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Question 2 of 2/i).length).toBeGreaterThan(0);
    expect(prevBtn).toBeEnabled();
  });

  it('renders collapsible question palette sidebar showing Marked and Remaining counts, and toggles visibility', () => {
    const multiQuestionQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        { id: 1, question: 'Question 1', options: ['A', 'B'], correct_index: 0 },
        { id: 2, question: 'Question 2', options: ['C', 'D'], correct_index: 1 },
        { id: 3, question: 'Question 3', options: ['E', 'F'], correct_index: 0 }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={multiQuestionQuiz}
        quizLoading={false}
        selectedAnswers={{ 1: 0 }} // 1 marked, 2 remaining
        totalQuestions={3}
        answeredCount={1}
        timeLeft={1740} // 29m 00s
        marksPerQuestion={0.5}
        totalMarks={1.5}
        currentTheme={mockTheme}
      />
    );

    // Verify Timer and Palette metrics
    expect(screen.getAllByText(/29:00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remaining').length).toBeGreaterThan(0);
    expect(screen.getByText(/Total 1.5 Marks/i)).toBeInTheDocument();
    expect(screen.getByText('Exam Overview')).toBeInTheDocument();

    // Clicking palette button 3 jumps straight to question 3
    const q3PaletteBtn = screen.getByRole('button', { name: '3' });
    fireEvent.click(q3PaletteBtn);
    expect(screen.getAllByText(/Question 3 of 3/i).length).toBeGreaterThan(0);

    // Toggle sidebar visibility
    const hideSidebarBtn = screen.getByRole('button', { name: /Hide Overview/i });
    fireEvent.click(hideSidebarBtn);
    expect(screen.queryByText('Exam Overview')).not.toBeInTheDocument();

    // Show sidebar again
    const showSidebarBtn = screen.getByRole('button', { name: /Overview/i });
    fireEvent.click(showSidebarBtn);
    expect(screen.getByText('Exam Overview')).toBeInTheDocument();
  });

  it('displays auto-submission timeout banner when time expires', () => {
    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{}}
        isCompleted={true}
        score={0}
        totalQuestions={1}
        answeredCount={0}
        autoSubmitted={true}
        earnedMarks={0.0}
        totalMarks={0.5}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Time Expired/i)).toBeInTheDocument();
    expect(screen.getByText(/The 30-minute exam time limit reached zero/i)).toBeInTheDocument();
    expect(screen.getByText(/Score: 0 \/ 0.5 Marks/i)).toBeInTheDocument();
  });

  it('allows clicking Review Questions after autoSubmitted to inspect questions', () => {
    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={mockQuizData}
        quizLoading={false}
        selectedAnswers={{ 1: 0 }}
        isCompleted={true}
        score={1}
        totalQuestions={1}
        answeredCount={1}
        autoSubmitted={true}
        earnedMarks={0.5}
        totalMarks={0.5}
        currentTheme={mockTheme}
      />
    );

    // Initial view shows summary view due to autoSubmitted
    expect(screen.getByText(/Time Expired/i)).toBeInTheDocument();
    const reviewBtn = screen.getByRole('button', { name: /Review Questions/i });
    expect(reviewBtn).toBeInTheDocument();

    // Clicking Review Questions reveals question card and review banner
    fireEvent.click(reviewBtn);
    expect(screen.getByText(/What is loss function/i)).toBeInTheDocument();
    expect(screen.getByText(/Viewing graded exam answers/i)).toBeInTheDocument();
  });

  it('supports keyboard ArrowLeft and ArrowRight navigation between questions', () => {
    const multiQuestionQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        { id: 1, question: 'Question 1', options: ['A', 'B'], correct_index: 0 },
        { id: 2, question: 'Question 2', options: ['C', 'D'], correct_index: 1 }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={multiQuestionQuiz}
        quizLoading={false}
        selectedAnswers={{}}
        totalQuestions={2}
        answeredCount={0}
        examStarted={true}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getAllByText(/Question 1 of 2/i).length).toBeGreaterThan(0);

    // ArrowRight advances to Question 2
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getAllByText(/Question 2 of 2/i).length).toBeGreaterThan(0);

    // ArrowLeft goes back to Question 1
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getAllByText(/Question 1 of 2/i).length).toBeGreaterThan(0);
  });

  it('renders Clear Selection button and invokes clearAnswer', () => {
    const clearAnswer = vi.fn();
    const multiQuestionQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        { id: 1, question: 'Question 1', options: ['A', 'B'], correct_index: 0 },
        { id: 2, question: 'Question 2', options: ['C', 'D'], correct_index: 1 }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={multiQuestionQuiz}
        quizLoading={false}
        selectedAnswers={{ 1: 0 }}
        totalQuestions={2}
        answeredCount={1}
        clearAnswer={clearAnswer}
        currentTheme={mockTheme}
      />
    );

    const clearBtn = screen.getByRole('button', { name: /Clear Selection/i });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(clearAnswer).toHaveBeenCalledWith(1);
  });

  it('renders exam briefing screen with Start Exam button, and clicking Start Exam begins the exam', () => {
    const startExam = vi.fn();
    const multiQuestionQuiz = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      questions: [
        { id: 1, question: 'Question 1: What is ML?', options: ['A', 'B'], correct_index: 0 },
        { id: 2, question: 'Question 2: What is DL?', options: ['C', 'D'], correct_index: 1 }
      ]
    };

    render(
      <CourseQuiz
        courseName="Machine Learning"
        quizData={multiQuestionQuiz}
        quizLoading={false}
        selectedAnswers={{}}
        totalQuestions={2}
        answeredCount={0}
        examStarted={false}
        startExam={startExam}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Machine Learning Comprehensive Exam/i)).toBeInTheDocument();
    expect(screen.getByText('30 Minutes')).toBeInTheDocument();
    expect(screen.getByText('2 Questions')).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: /Start Exam/i });
    expect(startBtn).toBeInTheDocument();

    fireEvent.click(startBtn);
    expect(startExam).toHaveBeenCalled();
    expect(screen.getByText(/Question 1: What is ML\?/i)).toBeInTheDocument();
  });
});
