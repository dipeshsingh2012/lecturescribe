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

  it('fetchOrGenerateQuiz fetches course quiz from API and updates state', async () => {
    const mockQuiz = {
      course_name: 'Applied Mathematics',
      course_slug: 'applied-mathematics',
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
    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/course/Applied%20Mathematics/quiz?email=student%40example.com',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ regenerate: false })
      })
    );

    // Test answer selection and lecture breakdown
    act(() => {
      result.current.selectAnswer(1, 0); // Correct
      result.current.selectAnswer(2, 1); // Incorrect
    });

    expect(result.current.score).toBe(1);
    expect(result.current.isCompleted).toBe(true);
    expect(result.current.lectureBreakdown['Session 1: Vectors'].correct).toBe(1);
    expect(result.current.lectureBreakdown['Session 2: Matrices'].correct).toBe(0);
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
});
