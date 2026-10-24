import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCourseQuiz from '../useCourseQuiz';

describe('useCourseQuiz hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default empty state', () => {
    const { result } = renderHook(() => useCourseQuiz(null));
    expect(result.current.quizData).toBeNull();
    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBeNull();
    expect(result.current.selectedAnswers).toEqual({});
    expect(result.current.score).toBe(0);
    expect(result.current.isCompleted).toBe(false);
  });

  it('hydrates persisted quiz and user answers from API response', async () => {
    const mockQuizWithAttempts = {
      course_name: 'Applied Mathematics',
      course_slug: 'applied-mathematics',
      lecture_count: 1,
      questions: [
        {
          id: 1,
          question: 'What is a vector space?',
          options: ['A set closed under addition and scaling', 'A number', 'A single point', 'None'],
          correct_index: 0,
          lecture_id: 'vid1',
          lecture_title: 'Session 1',
          timestamp: '00:00'
        }
      ],
      user_answers: { 1: 0 },
      user_score: 1,
      is_completed: true
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuizWithAttempts
    });

    const { result } = renderHook(() => useCourseQuiz('Applied Mathematics', 'student@example.com'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.quizData).toEqual(mockQuizWithAttempts);
    expect(result.current.selectedAnswers).toEqual({ 1: 0 });
    expect(result.current.score).toBe(1);
    expect(result.current.isCompleted).toBe(true);
  });

  it('syncs answers and score to backend database API on selectAnswer and deletes on resetQuiz', async () => {
    const mockQuiz = {
      course_name: 'Applied Mathematics',
      course_slug: 'applied-mathematics',
      quiz_id: 'quiz-app-math-1',
      lecture_count: 2,
      questions: [
        {
          id: 1,
          question: 'What is vector rank?',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correct_index: 0,
          explanation: 'Discussed in Session 1.',
          lecture_id: 'vid_1',
          lecture_title: 'Session 1: Vectors',
          timestamp: '15:00'
        },
        {
          id: 2,
          question: 'What is matrix trace?',
          options: ['Sum of diags', 'Det', 'Rank', 'Dimension'],
          correct_index: 0,
          explanation: 'Discussed in Session 2.',
          lecture_id: 'vid_2',
          lecture_title: 'Session 2: Matrices',
          timestamp: '25:00'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    const { result } = renderHook(() => useCourseQuiz('Applied Mathematics', 'student@example.com'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.quizData).toEqual(mockQuiz);

    // Answer Q1 correctly
    act(() => {
      result.current.selectAnswer(1, 0);
    });

    expect(result.current.selectedAnswers).toEqual({ 1: 0 });
    expect(result.current.score).toBe(1);
    expect(result.current.isCompleted).toBe(false);

    // Verify DB sync call was made for Q1
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/course/applied-mathematics/quiz/answers'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: 'student@example.com',
          answers: { 1: 0 },
          score: 1,
          completed: false,
          quiz_id: 'quiz-app-math-1'
        })
      })
    );

    // Answer Q2 incorrectly
    act(() => {
      result.current.selectAnswer(2, 1);
    });

    expect(result.current.selectedAnswers).toEqual({ 1: 0, 2: 1 });
    expect(result.current.score).toBe(1);
    expect(result.current.isCompleted).toBe(true);
    expect(result.current.lectureBreakdown['Session 1: Vectors'].correct).toBe(1);
    expect(result.current.lectureBreakdown['Session 2: Matrices'].correct).toBe(0);

    // Reset quiz
    await act(async () => {
      await result.current.resetQuiz();
    });

    expect(result.current.selectedAnswers).toEqual({});
    expect(result.current.score).toBe(0);
    expect(result.current.isCompleted).toBe(false);

    // Verify DB delete call was made
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/course/applied-mathematics/quiz/answers?email=student%40example.com'),
      expect.objectContaining({
        method: 'DELETE'
      })
    );
  });

  it('handles API error gracefully in fetchOrGenerateQuiz', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Course quiz generation failed' })
    });

    const { result } = renderHook(() => useCourseQuiz('Physics 101'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(true);
    });

    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBe('Course quiz generation failed');
    expect(result.current.quizData).toBeNull();
  });

  it('fetches detailed AI explanation and caches in detailedExplanations', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        detailed_explanation: '### Comprehensive Breakdown\nThe derivative follows from definition.'
      })
    });

    const { result } = renderHook(() => useCourseQuiz('Calculus 1', 'student@example.com'));

    await act(async () => {
      await result.current.fetchDetailedExplanation(1, {
        question: 'What is limit?',
        options: ['A', 'B', 'C', 'D'],
        correct_index: 0,
        explanation: 'Intro',
        timestamp: '10:00',
        lecture_id: 'calc_1'
      });
    });

    expect(result.current.detailedExplanations[1]).toBe('### Comprehensive Breakdown\nThe derivative follows from definition.');
    expect(result.current.explanationLoading['1']).toBe(false);
  });

  it('loads past quiz in review mode and replay mode', async () => {
    const mockPastRun = {
      quiz_id: 'cquiz_999',
      course_name: 'Calculus 1',
      score: 5,
      total_questions: 5,
      answers: { 1: 0, 2: 1 },
      completed: true,
      quiz_json: {
        quiz_id: 'cquiz_999',
        questions: [{ id: 1, question: 'Q1' }, { id: 2, question: 'Q2' }]
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPastRun
    });

    const { result } = renderHook(() => useCourseQuiz('Calculus 1'));

    // Load in review mode
    await act(async () => {
      await result.current.loadPastQuiz('cquiz_999', false);
    });

    expect(result.current.quizData.quiz_id).toBe('cquiz_999');
    expect(result.current.selectedAnswers).toEqual({ 1: 0, 2: 1 });
    expect(result.current.reviewMode).toBe(true);
    expect(result.current.replayingQuizId).toBe(null);

    // Load in replay mode
    await act(async () => {
      await result.current.loadPastQuiz('cquiz_999', true);
    });

    expect(result.current.quizData.quiz_id).toBe('cquiz_999');
    expect(result.current.selectedAnswers).toEqual({});
    expect(result.current.reviewMode).toBe(false);
    expect(result.current.replayingQuizId).toBe('cquiz_999');
    expect(result.current.isReplaying).toBe(true);

    // Exit replay mode returns to active quiz
    await act(async () => {
      await result.current.exitReplay();
    });
    expect(result.current.replayingQuizId).toBe(null);
    expect(result.current.isReplaying).toBe(false);
  });

  it('finishQuiz triggers completion persistence and history refresh', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' })
    });

    const { result } = renderHook(() => useCourseQuiz('Calculus 1', 'student@example.com'));

    act(() => {
      result.current.finishQuiz();
    });

    expect(global.fetch).not.toHaveBeenCalled(); // No quizData yet

    // With quiz data
    const mockQuiz = {
      quiz_id: 'cquiz_100',
      questions: [{ id: 1, correct_index: 0 }]
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    await act(async () => {
      result.current.finishQuiz();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/course/calculus-1/quiz/answers'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"completed":true')
      })
    );
  });

  it('calculates 0.5 marks per question and total marks correctly', async () => {
    const mockQuiz = {
      course_name: 'Machine Learning',
      questions: [
        { id: 1, correct_index: 0 },
        { id: 2, correct_index: 1 },
        { id: 3, correct_index: 2 },
        { id: 4, correct_index: 3 }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    const { result } = renderHook(() => useCourseQuiz('Machine Learning'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    // 4 questions => 4 * 0.5 = 2.0 total marks
    expect(result.current.marksPerQuestion).toBe(0.5);
    expect(result.current.totalMarks).toBe(2.0);
    expect(result.current.earnedMarks).toBe(0.0);

    // Answer Q1 correctly
    act(() => {
      result.current.selectAnswer(1, 0);
    });

    expect(result.current.score).toBe(1);
    expect(result.current.earnedMarks).toBe(0.5);

    // Answer Q2 correctly
    act(() => {
      result.current.selectAnswer(2, 1);
    });

    expect(result.current.score).toBe(2);
    expect(result.current.earnedMarks).toBe(1.0);
  });

  it('runs 30-minute countdown timer and auto-submits quiz when timer reaches zero', async () => {
    vi.useFakeTimers();

    const mockQuiz = {
      quiz_id: 'cquiz_timed',
      course_name: 'Machine Learning',
      questions: [
        { id: 1, correct_index: 0 },
        { id: 2, correct_index: 1 }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    const { result } = renderHook(() => useCourseQuiz('Machine Learning'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.timeLeft).toBe(1800);
    expect(result.current.autoSubmitted).toBe(false);
    expect(result.current.examStarted).toBe(false);

    // Timer does NOT auto-start before startExam() is called
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.timeLeft).toBe(1800);

    // Start the exam
    act(() => {
      result.current.startExam();
    });
    expect(result.current.examStarted).toBe(true);

    // Advance 5 seconds after starting exam
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.timeLeft).toBe(1795);

    // Fast-forward to 1 second remaining
    await act(async () => {
      vi.advanceTimersByTime(1794 * 1000);
    });
    expect(result.current.timeLeft).toBe(1);
    expect(result.current.isCompleted).toBe(false);

    // Final second: triggers timer expiry and auto-submission
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.timeLeft).toBe(0);
    expect(result.current.autoSubmitted).toBe(true);
    expect(result.current.isCompleted).toBe(true);

    vi.useRealTimers();
  });

  it('deletes quiz history attempt via deleteQuizHistory', async () => {
    const mockHistory = [
      { quiz_id: 'quiz-1', score: 5, total_questions: 10 },
      { quiz_id: 'quiz-2', score: 8, total_questions: 10 }
    ];

    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ history: mockHistory })
      });
    });

    const { result } = renderHook(() => useCourseQuiz('Machine Learning', 'student@example.com'));

    await act(async () => {
      await result.current.fetchQuizHistory();
    });

    expect(result.current.quizHistory).toHaveLength(2);

    let success = false;
    await act(async () => {
      success = await result.current.deleteQuizHistory('quiz-1');
    });

    expect(success).toBe(true);
    expect(result.current.quizHistory).toHaveLength(1);
    expect(result.current.quizHistory[0].quiz_id).toBe('quiz-2');
  });
});
