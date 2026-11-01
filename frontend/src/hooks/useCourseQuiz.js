import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function filterAcademicQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  const bannedPatterns = [
    /\bmid-?semester\s+(?:exam|examination)\b/i,
    /\bmid-?term\s+(?:exam|examination)\b/i,
    /\bend-?semester\s+(?:exam|examination)\b/i,
    /\bquestion\s+format\b/i,
    /\bexam(?:ination)?\s+format\b/i,
    /\bexam(?:ination)?\s+pattern\b/i,
    /\bexam(?:ination)?\s+syllabus\b/i,
    /\bsyllabus\s+covers?\b/i,
    /\bsyllabus\s+coverage\b/i,
    /\bsyllabus\s+for\s+the\s+(?:mid|exam|final|test)\b/i,
    /\bnegative\s+marking\b/i,
    /\bmarking\s+scheme\b/i,
    /\bsubmission\s+deadline\b/i,
    /\bcourse\s+portal\b/i
  ];
  return questions.filter((q) => {
    if (!q || typeof q !== 'object') return false;
    const qText = String(q.question || '');
    return !bannedPatterns.some((pattern) => pattern.test(qText));
  });
}

export function sanitizeCourseQuizData(quizData) {
  if (!quizData || !Array.isArray(quizData.questions)) return quizData;
  const filtered = filterAcademicQuestions(quizData.questions);
  if (filtered.length === quizData.questions.length) return quizData;
  return {
    ...quizData,
    questions: filtered.map((q, idx) => ({ ...q, id: idx + 1 })),
    total_questions: filtered.length
  };
}

export default function useCourseQuiz(courseName, userEmail = null) {
  const cleanCourse = (courseName || '').trim();
  const courseSlug = normalizeCourseSlug(cleanCourse);

  const [quizData, setQuizData] = useState(null);
  const [quizResponseTimeMs, setQuizResponseTimeMs] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizGenerating, setQuizGenerating] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState({});

  // Deep Explainer states
  const [detailedExplanations, setDetailedExplanations] = useState({});
  const [explanationResponseTimes, setExplanationResponseTimes] = useState({});
  const [explanationLoading, setExplanationLoading] = useState({});
  const [expandedExplanation, setExpandedExplanation] = useState({});

  // History & Review/Replay states
  const [quizHistory, setQuizHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [replayingQuizId, setReplayingQuizId] = useState(null);

  // Quiz Complexity & Settings state
  const [quizSettings, setQuizSettings] = useState({
    difficulty: 'medium', // 'easy' | 'medium' | 'hard' | 'mixed'
    numQuestions: 30,     // 10 | 20 | 30
    questionTypes: 'mixed', // 'mixed' | 'mcq' | 'fill_in_the_blank'
    timed: true,
    timeLimitMinutes: 30
  });

  const updateQuizSettings = useCallback((newSettings) => {
    setQuizSettings((prev) => ({
      ...prev,
      ...newSettings
    }));
  }, []);

  // Timer & Auto-Submit states
  const [timeLeft, setTimeLeft] = useState(1800); // 30 minutes in seconds
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const startExam = useCallback(() => {
    setExamStarted(true);
  }, []);

  const lastSlugRef = useRef(courseSlug);

  const fetchQuizHistory = useCallback(async () => {
    if (!courseSlug) return;
    setHistoryLoading(true);
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/history${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        setQuizHistory(data.history || []);
      }
    } catch (err) {
      console.warn('Failed to fetch quiz history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [courseSlug, userEmail]);

  const fetchOrGenerateQuiz = useCallback(async (regenerate = false, settingsOrNumQuestions = null, generate = true) => {
    if (!courseSlug) return;
    setQuizLoading(true);
    setQuizGenerating(Boolean(generate));
    setQuizError(null);
    setReviewMode(false);
    setReplayingQuizId(null);
    setQuizSubmitted(false);
    setAutoSubmitted(false);

    // Support both legacy numeric count and rich settings object
    const appliedSettings = typeof settingsOrNumQuestions === 'number'
      ? { ...quizSettings, numQuestions: settingsOrNumQuestions }
      : (settingsOrNumQuestions && typeof settingsOrNumQuestions === 'object'
          ? { ...quizSettings, ...settingsOrNumQuestions }
          : quizSettings);

    const isTimed = appliedSettings.timed !== false;
    const initialSeconds = isTimed ? ((appliedSettings.timeLimitMinutes || appliedSettings.numQuestions || 20) * 60) : null;

    if (regenerate) {
      setTimeLeft(initialSeconds);
    }
    const t0 = performance.now();
    try {
      const payload = !generate
        ? { regenerate, generate }
        : {
            regenerate,
            generate,
            num_questions: appliedSettings.numQuestions,
            difficulty: appliedSettings.difficulty,
            question_types: appliedSettings.questionTypes,
            timed: isTimed,
            time_limit_minutes: appliedSettings.timeLimitMinutes
          };
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const generateQuery = `generate=${generate}`;
      const url = `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz${emailParam ? emailParam + '&' + generateQuery : '?' + generateQuery}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      const sanitized = sanitizeCourseQuizData(data);
      if (!sanitized || !sanitized.questions || sanitized.questions.length === 0) {
        setQuizData(null);
        setSelectedAnswers({});
        setExamStarted(false);
        fetchQuizHistory();
        return;
      }

      // If user has already completed this quiz and we are NOT actively generating:
      // Don't force them into the recent completed quiz questions on page load. Instead, show the Generate Course Quiz briefing card.
      if (!generate && (data.user_completed || data.is_completed)) {
        setQuizData(null);
        setSelectedAnswers({});
        setExamStarted(false);
        setQuizSubmitted(false);
        fetchQuizHistory();
        return;
      }

      if (sanitized.difficulty) {
        setQuizSettings((prev) => ({
          ...prev,
          difficulty: sanitized.difficulty || prev.difficulty,
          numQuestions: sanitized.total_questions || prev.numQuestions,
          questionTypes: sanitized.question_types || prev.questionTypes,
          timed: sanitized.timed !== undefined ? sanitized.timed : prev.timed,
          timeLimitMinutes: sanitized.duration_minutes || sanitized.time_limit_minutes || prev.timeLimitMinutes
        }));
      }

      const elapsedQuizMs =
        sanitized.response_time_ms ??
        data.response_time_ms ??
        (generate ? Math.max(1, Math.round(performance.now() - t0)) : null);
      setQuizResponseTimeMs(elapsedQuizMs);
      setQuizData(sanitized);

      if (regenerate) {
        setSelectedAnswers({});
        setDetailedExplanations({});
        setExplanationResponseTimes({});
        setQuizSubmitted(false);
        setAutoSubmitted(false);
        setExamStarted(false);
        setTimeLeft(initialSeconds);
        // Reset answers in database if regenerating
        const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/answers${delEmail}`, {
          method: 'DELETE'
        }).catch(() => {});
      } else if (data.user_answers && Object.keys(data.user_answers).length > 0) {
        // Restore user's persisted answers directly from database
        setSelectedAnswers(data.user_answers);
        setExamStarted(true);
        if (data.user_completed || data.is_completed) {
          setQuizSubmitted(true);
        }
      } else {
        setSelectedAnswers({});
        setExamStarted(false);
      }
      fetchQuizHistory();
    } catch (err) {
      console.error('Failed to retrieve course quiz from database:', err);
      setQuizError(err.message || 'Unable to load course quiz. Please try again.');
    } finally {
      setQuizLoading(false);
      setQuizGenerating(false);
      setHasFetched(true);
    }
  }, [courseSlug, userEmail, fetchQuizHistory, quizSettings]);

  // Switch quiz state ONLY when truly switching to a different course
  useEffect(() => {
    if (lastSlugRef.current !== courseSlug) {
      lastSlugRef.current = courseSlug;
      setQuizData(null);
      setSelectedAnswers({});
      setDetailedExplanations({});
      setQuizError(null);
      setReviewMode(false);
      setReplayingQuizId(null);
      setHasFetched(false);
      if (courseSlug) {
        fetchQuizHistory();
      }
    }
  }, [courseSlug, fetchQuizHistory]);

  const fetchDetailedExplanation = useCallback(async (questionId, questionData) => {
    if (!cleanCourse || !questionData) return;

    const loadingKey = `${questionId}`;
    setExplanationLoading(prev => ({ ...prev, [loadingKey]: true }));

    const t0 = performance.now();
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/explanation${emailParam}`, {
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
      const elapsedMs = data.response_time_ms ?? (!data.cached ? Math.max(1, Math.round(performance.now() - t0)) : null);
      setDetailedExplanations(prev => ({
        ...prev,
        [questionId]: data.detailed_explanation
      }));
      if (elapsedMs) {
        setExplanationResponseTimes(prev => ({
          ...prev,
          [questionId]: elapsedMs
        }));
      }
    } catch (err) {
      console.error('Failed to fetch detailed course quiz explanation:', err);
    } finally {
      setExplanationLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  }, [courseSlug, cleanCourse, userEmail]);

  const selectAnswer = useCallback((questionId, optionIndex) => {
    // If the quiz is submitted or in review mode, answers are locked
    if (quizSubmitted || autoSubmitted || reviewMode) return;

    setSelectedAnswers((prev) => {
      if (prev[questionId] === optionIndex) return prev;
      const next = { ...prev, [questionId]: optionIndex };

      // Persist directly to Relational Database and history
      if (courseSlug) {
        const total = quizData?.questions?.length || 0;
        const currentScore = (quizData?.questions || []).reduce((acc, q) => {
          const choice = next[q.id];
          return choice === q.correct_index ? acc + 1 : acc;
        }, 0);
        const isDone = total > 0 && Object.keys(next).length === total;

        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: userEmail || 'anonymous',
            answers: next,
            score: currentScore,
            completed: isDone,
            quiz_id: quizData?.quiz_id || replayingQuizId
          })
        }).then(() => {
          if (isDone) fetchQuizHistory();
        }).catch((e) => console.warn('Database answer save error:', e));
      }

      return next;
    });
  }, [courseSlug, quizData, replayingQuizId, userEmail, fetchQuizHistory, quizSubmitted, autoSubmitted, reviewMode]);

  const clearAnswer = useCallback((questionId) => {
    if (quizSubmitted || autoSubmitted || reviewMode) return;
    setSelectedAnswers((prev) => {
      if (prev[questionId] === undefined) return prev;
      const next = { ...prev };
      delete next[questionId];

      if (courseSlug) {
        const currentScore = (quizData?.questions || []).reduce((acc, q) => {
          const choice = next[q.id];
          return choice === q.correct_index ? acc + 1 : acc;
        }, 0);

        fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: userEmail || 'anonymous',
            answers: next,
            score: currentScore,
            completed: false,
            quiz_id: quizData?.quiz_id || replayingQuizId
          })
        }).catch((e) => console.warn('Database answer save error:', e));
      }

      return next;
    });
  }, [courseSlug, quizData, replayingQuizId, userEmail, quizSubmitted, autoSubmitted, reviewMode]);

  const finishQuiz = useCallback(() => {
    if (!courseSlug || !quizData) return;
    setQuizSubmitted(true);
    const currentScore = (quizData?.questions || []).reduce((acc, q) => {
      const choice = selectedAnswers[q.id];
      return choice === q.correct_index ? acc + 1 : acc;
    }, 0);

    fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: userEmail || 'anonymous',
        answers: selectedAnswers,
        score: currentScore,
        completed: true,
        quiz_id: quizData?.quiz_id || replayingQuizId
      })
    }).then(() => fetchQuizHistory()).catch(() => {});
  }, [courseSlug, quizData, replayingQuizId, selectedAnswers, userEmail, fetchQuizHistory]);

  const resetQuiz = useCallback(() => {
    setSelectedAnswers({});
    setReviewMode(false);
    setQuizSubmitted(false);
    setAutoSubmitted(false);
    setExamStarted(false);
    setQuizData(null);
    const initialSeconds = quizSettings.timed !== false ? ((quizSettings.timeLimitMinutes || quizSettings.numQuestions || 20) * 60) : null;
    setTimeLeft(initialSeconds);
    if (courseSlug) {
      const delEmail = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/answers${delEmail}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  }, [courseSlug, userEmail, quizSettings]);

  const exitReplay = useCallback(() => {
    setReplayingQuizId(null);
    setReviewMode(false);
    setQuizSubmitted(false);
    setAutoSubmitted(false);
    setExamStarted(false);
    const initialSeconds = quizSettings.timed !== false ? ((quizSettings.timeLimitMinutes || quizSettings.numQuestions || 20) * 60) : null;
    setTimeLeft(initialSeconds);
    fetchOrGenerateQuiz(false);
  }, [fetchOrGenerateQuiz, quizSettings]);

  const deleteQuizHistory = useCallback(async (quizId) => {
    if (!courseSlug || !quizId) return false;
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/history/${encodeURIComponent(quizId)}${emailParam}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error('Failed to delete quiz history');
      }
      setQuizHistory((prev) => prev.filter((item) => item.quiz_id !== quizId));
      if (replayingQuizId === quizId) {
        exitReplay();
      }
      return true;
    } catch (err) {
      console.error('Failed to delete quiz attempt:', err);
      return false;
    }
  }, [courseSlug, userEmail, replayingQuizId, exitReplay]);

  const loadPastQuiz = useCallback(async (quizId, forReplay = false) => {
    if (!courseSlug || !quizId) return;
    setQuizLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/quiz/history/${encodeURIComponent(quizId)}`);
      if (!res.ok) throw new Error('Unable to load past quiz');
      const data = await res.json();
      const quizJson = data.quiz_json || (data.questions ? data : {});
      const sanitized = sanitizeCourseQuizData({
        ...quizJson,
        quiz_id: quizId
      });
      if (sanitized.difficulty) {
        setQuizSettings((prev) => ({
          ...prev,
          difficulty: sanitized.difficulty || prev.difficulty,
          numQuestions: sanitized.total_questions || prev.numQuestions,
          questionTypes: sanitized.question_types || prev.questionTypes,
          timed: sanitized.timed !== undefined ? sanitized.timed : prev.timed,
          timeLimitMinutes: sanitized.duration_minutes || sanitized.time_limit_minutes || prev.timeLimitMinutes
        }));
      }
      setQuizData(sanitized);
      const isPastTimed = sanitized.timed !== false;
      const pastSeconds = isPastTimed ? ((sanitized.duration_minutes || sanitized.time_limit_minutes || 20) * 60) : null;

      if (forReplay) {
        setReplayingQuizId(quizId);
        setSelectedAnswers({});
        setReviewMode(false);
        setQuizSubmitted(false);
        setAutoSubmitted(false);
        setExamStarted(false);
        setTimeLeft(pastSeconds);
      } else {
        setReplayingQuizId(null);
        setSelectedAnswers(data.answers || {});
        setReviewMode(true);
        setExamStarted(true);
      }
    } catch (err) {
      console.error('Failed to load past quiz run:', err);
      setQuizError(err.message || 'Unable to open past quiz');
    } finally {
      setQuizLoading(false);
    }
  }, [courseSlug]);

  const totalQuestions = quizData?.questions?.length || 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const isCompleted = totalQuestions > 0 && (answeredCount === totalQuestions || reviewMode || quizSubmitted || autoSubmitted);

  // Countdown Timer & Auto-Submit on Expiry (active in timed mode)
  useEffect(() => {
    if (!examStarted || !quizData || !quizData.questions?.length || isCompleted || reviewMode) {
      return;
    }

    if (timeLeft === null || timeLeft === undefined) {
      return; // Untimed practice mode
    }

    if (timeLeft <= 0) {
      if (!isCompleted && !quizSubmitted) {
        setAutoSubmitted(true);
        finishQuiz();
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setAutoSubmitted(true);
          finishQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStarted, quizData, isCompleted, reviewMode, timeLeft, quizSubmitted, finishQuiz]);

  const score = (quizData?.questions || []).reduce((acc, q) => {
    const userChoice = selectedAnswers[q.id];
    return userChoice === q.correct_index ? acc + 1 : acc;
  }, 0);

  const marksPerQuestion = 0.5;
  const totalMarks = Number((totalQuestions * marksPerQuestion).toFixed(1));
  const earnedMarks = Number((score * marksPerQuestion).toFixed(1));

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
    quizGenerating,
    quizError,
    selectedAnswers,
    isCompleted,
    score,
    totalQuestions,
    answeredCount,
    lectureBreakdown,
    fetchOrGenerateQuiz,
    selectAnswer,
    clearAnswer,
    finishQuiz,
    resetQuiz,
    detailedExplanations,
    explanationResponseTimes,
    quizResponseTimeMs,
    explanationLoading,
    expandedExplanation,
    setExpandedExplanation,
    fetchDetailedExplanation,
    quizHistory,
    historyLoading,
    fetchQuizHistory,
    loadPastQuiz,
    deleteQuizHistory,
    reviewMode,
    setReviewMode,
    replayingQuizId,
    isReplaying: Boolean(replayingQuizId),
    exitReplay,
    timeLeft,
    setTimeLeft,
    autoSubmitted,
    quizSubmitted,
    examStarted,
    startExam,
    setExamStarted,
    marksPerQuestion,
    totalMarks,
    earnedMarks,
    hasFetched,
    quizSettings,
    setQuizSettings,
    updateQuizSettings
  };
}
