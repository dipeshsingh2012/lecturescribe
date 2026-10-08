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

  // Deep Explainer states
  const [detailedExplanations, setDetailedExplanations] = useState({});
  const [explanationLoading, setExplanationLoading] = useState({});
  const [expandedExplanation, setExpandedExplanation] = useState({});

  // History & Review/Replay states
  const [quizHistory, setQuizHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);

  const lastSlugRef = useRef(courseSlug);

  const fetchQuizHistory = useCallback(async () => {
    if (!cleanCourse) return;
    setHistoryLoading(true);
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/history${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        setQuizHistory(data.history || []);
      }
    } catch (err) {
      console.warn('Failed to fetch quiz history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [cleanCourse, userEmail]);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false, numQuestions = null) => {
    if (!cleanCourse) return;
    setQuizLoading(true);
    setQuizError(null);
    setReviewMode(false);
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
        setDetailedExplanations({});
        // Reset answers in database if regenerating
        const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
        fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers${delEmail}`, {
          method: 'DELETE'
        }).catch(() => {});
      } else if (data.user_answers && Object.keys(data.user_answers).length > 0) {
        // Restore user's persisted answers directly from database
        setSelectedAnswers(data.user_answers);
      }
      fetchQuizHistory();
    } catch (err) {
      console.error('Failed to retrieve course quiz from database:', err);
      setQuizError(err.message || 'Unable to load course quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [cleanCourse, userEmail, fetchQuizHistory]);

  // Switch quiz state ONLY when truly switching to a different course
  useEffect(() => {
    if (lastSlugRef.current !== courseSlug) {
      lastSlugRef.current = courseSlug;
      setQuizData(null);
      setSelectedAnswers({});
      setDetailedExplanations({});
      setQuizError(null);
      setReviewMode(false);
      if (courseSlug) {
        fetchOrGenerateQuiz(false);
        fetchQuizHistory();
      }
    }
  }, [courseSlug, fetchOrGenerateQuiz, fetchQuizHistory]);

  const fetchDetailedExplanation = useCallback(async (questionId, questionData) => {
    if (!cleanCourse || !questionData) return;

    const loadingKey = `${questionId}`;
    setExplanationLoading(prev => ({ ...prev, [loadingKey]: true }));

    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/explanation${emailParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          question: questionData.question,
          options: questionData.options,
          correct_index: questionData.correct_index,
          explanation: questionData.explanation,
          timestamp: questionData.timestamp,
          lecture_id: questionData.lecture_id,
          course_name: cleanCourse,
          regenerate: false
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setDetailedExplanations(prev => ({
        ...prev,
        [questionId]: data.detailed_explanation
      }));
    } catch (err) {
      console.error('Failed to fetch detailed course quiz explanation:', err);
    } finally {
      setExplanationLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  }, [cleanCourse, userEmail]);

  const selectAnswer = useCallback((questionId, optionIndex) => {
    setSelectedAnswers((prev) => {
      // Once answered, do not allow changing to preserve initial test score
      if (prev[questionId] !== undefined) return prev;
      const next = { ...prev, [questionId]: optionIndex };

      // Persist directly to Relational Database and history
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
            completed: isDone,
            quiz_id: quizData?.quiz_id
          })
        }).then(() => {
          if (isDone) fetchQuizHistory();
        }).catch((e) => console.warn('Database answer save error:', e));
      }

      return next;
    });
  }, [cleanCourse, quizData, userEmail, fetchQuizHistory]);

  const finishQuiz = useCallback(() => {
    if (!cleanCourse || !quizData) return;
    const currentScore = (quizData?.questions || []).reduce((acc, q) => {
      const choice = selectedAnswers[q.id];
      return choice === q.correct_index ? acc + 1 : acc;
    }, 0);

    fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: userEmail || 'anonymous',
        answers: selectedAnswers,
        score: currentScore,
        completed: true,
        quiz_id: quizData?.quiz_id
      })
    }).then(() => fetchQuizHistory()).catch(() => {});
  }, [cleanCourse, quizData, selectedAnswers, userEmail, fetchQuizHistory]);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
    setReviewMode(false);
    if (cleanCourse) {
      const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/answers${delEmail}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  }, [cleanCourse, userEmail]);

  const loadPastQuiz = useCallback(async (quizId, forReplay = false) => {
    if (!cleanCourse || !quizId) return;
    setQuizLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(cleanCourse)}/quiz/history/${encodeURIComponent(quizId)}`);
      if (!res.ok) throw new Error('Unable to load past quiz');
      const data = await res.json();
      const quizJson = data.quiz_json || {};
      setQuizData({
        ...quizJson,
        quiz_id: quizId
      });
      if (forReplay) {
        setSelectedAnswers({});
        setReviewMode(false);
      } else {
        setSelectedAnswers(data.answers || {});
        setReviewMode(true);
      }
    } catch (err) {
      console.error('Failed to load past quiz run:', err);
      setQuizError(err.message || 'Unable to open past quiz');
    } finally {
      setQuizLoading(false);
    }
  }, [cleanCourse]);

  const totalQuestions = quizData?.questions?.length || 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const isCompleted = totalQuestions > 0 && (answeredCount === totalQuestions || reviewMode);

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
    finishQuiz,
    resetQuiz,
    detailedExplanations,
    explanationLoading,
    expandedExplanation,
    setExpandedExplanation,
    fetchDetailedExplanation,
    quizHistory,
    historyLoading,
    fetchQuizHistory,
    loadPastQuiz,
    reviewMode,
    setReviewMode
  };
}
