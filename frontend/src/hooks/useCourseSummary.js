import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export default function useCourseSummary(courseName) {
  const cleanCourse = (courseName || '').trim();
  const courseSlug = normalizeCourseSlug(cleanCourse);

  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastSlugRef = useRef('');

  const fetchSummary = useCallback(async (regenerate = false) => {
    if (!courseSlug) return;
    setLoading(true);
    setError(null);

    try {
      let res;
      if (regenerate) {
        res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regenerate: true })
        });
      } else {
        res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/summary`);
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      setSummaryData(data.summary || null);
    } catch (err) {
      console.error('Failed to load course summary:', err);
      setError(err.message || 'Unable to load course summary.');
    } finally {
      setLoading(false);
    }
  }, [courseSlug]);

  useEffect(() => {
    if (lastSlugRef.current !== courseSlug) {
      lastSlugRef.current = courseSlug;
      setSummaryData(null);
      setError(null);
      if (courseSlug) {
        fetchSummary(false);
      }
    }
  }, [courseSlug, fetchSummary]);

  return {
    summaryData,
    loading,
    error,
    fetchSummary,
    regenerateSummary: () => fetchSummary(true)
  };
}
