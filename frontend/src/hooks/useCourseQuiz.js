import { useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../utils/constants';

export default function useCourseQuiz(courseName, userEmail = null) {
  const [quizData, setQuizData] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});

  const cleanCourse = (courseName || '').trim();

  // Reset quiz state when switching to a different course
  useEffect(() => {
    setQuizData(null);
    setSelectedAnswers({});
    setQuizError(null);
  }, [cleanCourse]);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false, numQuestions = null) => {
    if (!cleanCourse) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const payload = { regenerate };
      if (numQuestions) {
        payload.num_questions = numQuestions;
      }
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz${emailParam}`, {
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
      setSelectedAnswers({});
    } catch (err) {
      console.error('Failed to generate course quiz:', err);
      setQuizError(err.message || 'Unable to generate course quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [cleanCourse, userEmail]);

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

  // Group performance breakdown by lecture
  const lectureBreakdown = (quizData?.questions || []).reduce((acc, q) => {
    const key = q.lecture_title || q.lecture_id || 'Course Concept';
    if (!acc[key]) {
      acc[key] = { total: 0, correct: 0, lecture_id: q.lecture_id };
    }
    acc[key].total += 1;
    if (selectedAnswers[q.id] === q.correct_index) {
      acc[key].correct += 1;
    }
    return acc;
  }, {});

  return {
    quizData,
    quizLoading,
    quizError,
    selectedAnswers,
    isCompleted,
    score,
    totalQuestions,
    answeredCount,
    lectureBreakdown,
    fetchOrGenerateQuiz,
    selectAnswer,
    resetQuiz
  };
}
