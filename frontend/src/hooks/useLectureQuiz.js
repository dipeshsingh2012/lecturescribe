import { useState, useCallback, useEffect } from 'react';

export default function useLectureQuiz(activeData) {
  const [quizData, setQuizData] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});

  const videoId = activeData?.videoId || activeData?.video_id || '';

  // Reset quiz state when switching to a different lecture
  useEffect(() => {
    setQuizData(null);
    setSelectedAnswers({});
    setQuizError(null);
  }, [videoId]);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false) => {
    if (!videoId) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await fetch(`/api/lecture/${videoId}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate, num_questions: 5 })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setQuizData(data);
      setSelectedAnswers({});
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
      return { ...prev, [questionId]: optionIndex };
    });
  }, []);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
  }, []);

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
