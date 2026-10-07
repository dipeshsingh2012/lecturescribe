import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';

export default function useLectureQuiz(activeData, userEmail = null) {
  const videoId = activeData?.videoId || activeData?.video_id || '';
  const email = userEmail || activeData?.user_email || null;

  const [quizData, setQuizData] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [detailedExplanations, setDetailedExplanations] = useState({});
  const [explanationLoading, setExplanationLoading] = useState({});

  const lastVidRef = useRef(videoId);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false, numQuestions = null) => {
    if (!videoId) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const payload = { regenerate };
      if (numQuestions) {
        payload.num_questions = numQuestions;
      }
      const emailParam = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await fetch(`${API_BASE}/api/lecture/${videoId}/quiz${emailParam}`, {
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
        const delEmail = email ? `?email=${encodeURIComponent(email)}` : '';
        fetch(`${API_BASE}/api/lecture/${videoId}/quiz/answers${delEmail}`, {
          method: 'DELETE'
        }).catch(() => {});
      } else if (data.user_answers && Object.keys(data.user_answers).length > 0) {
        // Restore user's persisted answers directly from database
        setSelectedAnswers(data.user_answers);
      }
    } catch (err) {
      console.error('Failed to retrieve lecture quiz from database:', err);
      setQuizError(err.message || 'Unable to load quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  }, [videoId, email]);

  // Reset/switch quiz state when switching to a different lecture
  useEffect(() => {
    if (lastVidRef.current !== videoId) {
      lastVidRef.current = videoId;
      setQuizData(null);
      setSelectedAnswers({});
      setQuizError(null);
    }
  }, [videoId]);

  const selectAnswer = useCallback((questionId, optionIndex) => {
    setSelectedAnswers((prev) => {
      // Once answered, do not allow changing to preserve initial test score
      if (prev[questionId] !== undefined) return prev;
      const next = { ...prev, [questionId]: optionIndex };

      // Persist directly to Relational Database
      if (videoId) {
        const total = quizData?.questions?.length || 0;
        const currentScore = (quizData?.questions || []).reduce((acc, q) => {
          const choice = next[q.id];
          return choice === q.correct_index ? acc + 1 : acc;
        }, 0);
        const isDone = total > 0 && Object.keys(next).length === total;

        fetch(`${API_BASE}/api/lecture/${videoId}/quiz/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: email || 'anonymous',
            answers: next,
            score: currentScore,
            completed: isDone
          })
        }).catch((e) => console.warn('Database lecture answer save error:', e));
      }

      return next;
    });
  }, [videoId, email, quizData]);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
    setDetailedExplanations({});
    if (videoId) {
      const delEmail = email ? `?email=${encodeURIComponent(email)}` : '';
      fetch(`${API_BASE}/api/lecture/${videoId}/quiz/answers${delEmail}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  }, [videoId, email]);

  const fetchDetailedExplanation = useCallback(async (questionId, questionData) => {
    if (!videoId || !questionData) return;

    const loadingKey = `${questionId}`;
    setExplanationLoading(prev => ({ ...prev, [loadingKey]: true }));

    try {
      const emailParam = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await fetch(`${API_BASE}/api/lecture/${videoId}/quiz/explanation${emailParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          question: questionData.question,
          options: questionData.options,
          correct_index: questionData.correct_index,
          explanation: questionData.explanation,
          timestamp: questionData.timestamp,
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
      console.error('Failed to fetch detailed explanation:', err);
    } finally {
      setExplanationLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  }, [videoId, email]);

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
    resetQuiz,
    detailedExplanations,
    explanationLoading,
    fetchDetailedExplanation
  };
}
