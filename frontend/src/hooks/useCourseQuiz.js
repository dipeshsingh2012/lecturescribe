import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export default function useCourseQuiz(courseName, userEmail = null) {
  const cleanCourse = (courseName || '').trim();
  const courseSlug = normalizeCourseSlug(cleanCourse);

  const [quizData, setQuizData] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});

  const lastSlugRef = useRef(courseSlug);

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

      if (regenerate) {
        setSelectedAnswers({});
        // Reset answers in database if regenerating
        const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
        fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers${delEmail}`, {
          method: 'DELETE'
        }).catch(() => {});
      } else if (data.user_answers && Object.keys(data.user_answers).length > 0) {
        // Restore user's persisted answers directly from database
        setSelectedAnswers(data.user_answers);
      }
    } catch (err) {
      console.error('Failed to retrieve course quiz from database:', err);
      setQuizError(err.message || 'Unable to load course quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [cleanCourse, userEmail]);

  // Switch quiz state ONLY when truly switching to a different course
  useEffect(() => {
    if (lastSlugRef.current !== courseSlug) {
      lastSlugRef.current = courseSlug;
      setQuizData(null);
      setSelectedAnswers({});
      setQuizError(null);
      if (courseSlug) {
        fetchOrGenerateQuiz(false);
      }
    }
  }, [courseSlug, fetchOrGenerateQuiz]);

  const selectAnswer = useCallback((questionId, optionIndex) => {
    setSelectedAnswers((prev) => {
      // Once answered, do not allow changing to preserve initial test score
      if (prev[questionId] !== undefined) return prev;
      const next = { ...prev, [questionId]: optionIndex };

      // Persist directly to Relational Database
      if (cleanCourse) {
        const total = quizData?.questions?.length || 0;
        const currentScore = (quizData?.questions || []).reduce((acc, q) => {
          const choice = next[q.id];
          return choice === q.correct_index ? acc + 1 : acc;
        }, 0);
        const isDone = total > 0 && Object.keys(next).length === total;

        fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: userEmail || 'anonymous',
            answers: next,
            score: currentScore,
            completed: isDone
          })
        }).catch((e) => console.warn('Database answer save error:', e));
      }

      return next;
    });
  }, [cleanCourse, quizData, userEmail]);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
    if (cleanCourse) {
      const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers${delEmail}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  }, [cleanCourse, userEmail]);

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
