import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLectureQuiz from '../useLectureQuiz';

describe('useLectureQuiz hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default empty state', () => {
    const { result } = renderHook(() => useLectureQuiz(null));
    expect(result.current.quizData).toBeNull();
    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBeNull();
    expect(result.current.selectedAnswers).toEqual({});
    expect(result.current.score).toBe(0);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.detailedExplanations).toEqual({});
    expect(result.current.explanationLoading).toEqual({});
  });

  it('hydrates persisted quiz and user answers from API response', async () => {
    const mockQuizWithAttempts = {
      video_id: 'vid123',
      lecture_title: 'Vector Spaces',
      questions: [
        {
          id: 1,
          question: 'What is a basis?',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correct_index: 0,
          explanation: 'Explained at [01:32:00].',
          timestamp: '01:32:00'
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

    const { result } = renderHook(() => useLectureQuiz({ videoId: 'vid123' }, 'student@example.com'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.quizData).toEqual(mockQuizWithAttempts);
    expect(result.current.selectedAnswers).toEqual({ 1: 0 });
    expect(result.current.score).toBe(1);
    expect(result.current.isCompleted).toBe(true);
  });

  it('fetchOrGenerateQuiz fetches quiz from API and updates state', async () => {
    const mockQuiz = {
      video_id: 'vid123',
      lecture_title: 'Vector Spaces',
      questions: [
        {
          id: 1,
          question: 'What is a basis?',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correct_index: 0,
          explanation: 'Explained at [01:32:00].',
          timestamp: '01:32:00'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    const { result } = renderHook(() => useLectureQuiz({ videoId: 'vid123' }));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.quizData).toEqual(mockQuiz);
    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lecture/vid123/quiz'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ regenerate: false })
      })
    );
  });

  it('does not request quiz generation when transcript is unavailable', async () => {
    global.fetch = vi.fn();
    const { result } = renderHook(() => useLectureQuiz({
      videoId: 'vid-no-captions',
      cues: [],
      transcript_available: false
    }));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.quizData).toBeNull();
    expect(result.current.quizError).toBeNull();
    expect(result.current.quizLoading).toBe(false);
  });

  it('handles API error gracefully in fetchOrGenerateQuiz', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'LLM generation failed' })
    });

    const { result } = renderHook(() => useLectureQuiz({ videoId: 'vid123' }));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(true);
    });

    expect(result.current.quizLoading).toBe(false);
    expect(result.current.quizError).toBe('LLM generation failed');
    expect(result.current.quizData).toBeNull();
  });

  it('selectAnswer records answers and tracks score and completion, syncing with DB', async () => {
    const mockQuiz = {
      video_id: 'vid123',
      questions: [
        { id: 1, question: 'Q1', options: ['A', 'B', 'C', 'D'], correct_index: 1 },
        { id: 2, question: 'Q2', options: ['A', 'B', 'C', 'D'], correct_index: 2 }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuiz
    });

    const { result } = renderHook(() => useLectureQuiz({ videoId: 'vid123' }, 'student@example.com'));

    await act(async () => {
      await result.current.fetchOrGenerateQuiz(false);
    });

    expect(result.current.isCompleted).toBe(false);

    // Answer Q1 correctly (index 1)
    act(() => {
      result.current.selectAnswer(1, 1);
    });

    expect(result.current.selectedAnswers).toEqual({ 1: 1 });
    expect(result.current.score).toBe(1);
    expect(result.current.answeredCount).toBe(1);
    expect(result.current.isCompleted).toBe(false);

    // Verify DB sync call was made
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lecture/vid123/quiz/answers'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: 'student@example.com',
          answers: { 1: 1 },
          score: 1,
          completed: false
        })
      })
    );

    // Answer Q2 incorrectly (index 0 instead of 2)
    act(() => {
      result.current.selectAnswer(2, 0);
    });

    expect(result.current.selectedAnswers).toEqual({ 1: 1, 2: 0 });
    expect(result.current.score).toBe(1);
    expect(result.current.answeredCount).toBe(2);
    expect(result.current.isCompleted).toBe(true);

    // Attempting to change an already selected answer should be ignored
    act(() => {
      result.current.selectAnswer(1, 3);
    });
    expect(result.current.selectedAnswers[1]).toBe(1);

    // Resetting quiz clears answers and calls DELETE on DB endpoint
    await act(async () => {
      await result.current.resetQuiz();
    });
    expect(result.current.selectedAnswers).toEqual({});
    expect(result.current.score).toBe(0);
    expect(result.current.isCompleted).toBe(false);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lecture/vid123/quiz/answers?email=student%40example.com'),
      expect.objectContaining({
        method: 'DELETE'
      })
    );
  });

  it('fetches detailed explanation for a question', async () => {
    const mockExplanation = {
      detailed_explanation: '**Question Analysis**\n\nThis question tests...',
      model: 'Groq llama-3.3-70b-versatile',
      generated_at: '2026-10-06T12:00:00Z'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockExplanation
    });

    const { result } = renderHook(() => useLectureQuiz({ videoId: 'vid123' }, 'student@example.com'));

    const questionData = {
      id: 1,
      question: 'What is a basis?',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct_index: 0,
      explanation: 'Explained at [01:32:00].',
      timestamp: '01:32:00'
    };

    await act(async () => {
      await result.current.fetchDetailedExplanation(1, questionData);
    });

    expect(result.current.detailedExplanations[1]).toBe(mockExplanation.detailed_explanation);
    expect(result.current.explanationLoading[1]).toBe(false);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lecture/vid123/quiz/explanation'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: 1,
          question: 'What is a basis?',
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correct_index: 0,
          explanation: 'Explained at [01:32:00].',
          timestamp: '01:32:00',
          regenerate: false
        })
      })
    );
  });
});
