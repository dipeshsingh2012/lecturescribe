import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';

export default function useLectureQuiz(activeData) {
  const videoId = activeData?.videoId || activeData?.video_id || '';

  const [quizData, setQuizData] = useState(() => {
    if (!videoId || typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem(`ls_lecture_quiz_${videoId}`);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);

  const [selectedAnswers, setSelectedAnswers] = useState(() => {
    if (!videoId || typeof window === 'undefined') return {};
    try {
      const cached = localStorage.getItem(`ls_lecture_quiz_answers_${videoId}`);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  const lastVidRef = useRef(videoId);

  // Reset/switch quiz state when switching to a different lecture
  useEffect(() => {
    if (lastVidRef.current !== videoId) {
      lastVidRef.current = videoId;
      if (!videoId) {
        setQuizData(null);
        setSelectedAnswers({});
        setQuizError(null);
      } else {
        try {
          const cachedQuiz = localStorage.getItem(`ls_lecture_quiz_${videoId}`);
          const cachedAns = localStorage.getItem(`ls_lecture_quiz_answers_${videoId}`);
          setQuizData(cachedQuiz ? JSON.parse(cachedQuiz) : null);
          setSelectedAnswers(cachedAns ? JSON.parse(cachedAns) : {});
        } catch {
          setQuizData(null);
          setSelectedAnswers({});
        }
        setQuizError(null);
      }
    }
  }, [videoId]);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false, numQuestions = null) => {
    if (!videoId) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const payload = { regenerate };
      if (numQuestions) {
        payload.num_questions = numQuestions;
      }
      const res = await fetch(`${API_BASE}/api/lecture/${videoId}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setQuizData(data);
      if (videoId && typeof window !== 'undefined') {
        try {
          localStorage.setItem(`ls_lecture_quiz_${videoId}`, JSON.stringify(data));
        } catch {}
      }

      if (regenerate) {
        setSelectedAnswers({});
        if (videoId && typeof window !== 'undefined') {
          try {
            localStorage.removeItem(`ls_lecture_quiz_answers_${videoId}`);
          } catch {}
        }
      }
    } catch (err) {
      console.error('Failed to generate quiz:', err);
      setQuizError(err.message || 'Unable to generate quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [videoId]);

  const selectAnswer = useCallback((questionId, optionIndex) => {
    setSelectedAnswers((prev) => {
      // Once answered, do not allow changing to preserve initial test score
      if (prev[questionId] !== undefined) return prev;
      const next = { ...prev, [questionId]: optionIndex };
      if (videoId && typeof window !== 'undefined') {
        try {
          localStorage.setItem(`ls_lecture_quiz_answers_${videoId}`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, [videoId]);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
    if (videoId && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`ls_lecture_quiz_answers_${videoId}`);
      } catch {}
    }
  }, [videoId]);

  const totalQuestions = quizData?.questions?.length || 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const isCompleted = totalQuestions > 0 && answeredCount === totalQuestions;

  const score = (quizData?.questions || []).reduce((acc, q) => {
    const userChoice = selectedAnswers[q.id];
    return userChoice === q.correct_index ? acc + 1 : acc;
  }, 0);

  return {
    quizData,
    quizLoading,
    quizError,
    selectedAnswers,
    isCompleted,
    score,
    totalQuestions,
    answeredCount,
    fetchOrGenerateQuiz,
    selectAnswer,
    resetQuiz
  };
}
