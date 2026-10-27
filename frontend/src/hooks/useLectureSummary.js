import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';

export default function useLectureSummary(activeData, userEmail = null) {
  const videoId = activeData?.videoId || activeData?.video_id || '';
  const email = userEmail || activeData?.user_email || null;

  const [summaries, setSummaries] = useState({});
  const [activeSummaryType, setActiveSummaryType] = useState('comprehensive');
  const [viewMode, setViewMode] = useState('study'); // 'study' | 'submission'
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  const inFlightFetchRef = useRef(null);
  const inFlightGenerateRef = useRef(null);
  const currentVideoIdRef = useRef(null);

  const transcriptAvailable = activeData?.transcript_available !== false &&
    Array.isArray(activeData?.cues) &&
    activeData.cues.some(c => String(c?.text || '').trim().length > 0);

  const fetchSummaries = useCallback(async (vid = videoId, forceEmail = email) => {
    if (!vid || vid === 'active') {
      setSummaries({});
      return;
    }

    const inFlightKey = `${vid}:${forceEmail || ''}`;
    if (inFlightFetchRef.current === inFlightKey) return;
    inFlightFetchRef.current = inFlightKey;
    setLoading(true);
    setError(null);

    try {
      const emailParam = forceEmail ? `&user_email=${encodeURIComponent(forceEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/summary/lecture?video_id=${encodeURIComponent(vid)}${emailParam}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch summaries (status ${res.status})`);
      }
      const data = await res.json();
      setSummaries(data.summaries || {});
    } catch (err) {
      console.warn('Could not fetch lecture summaries:', err);
      setError(err.message || 'Failed to load summaries');
    } finally {
      if (inFlightFetchRef.current === inFlightKey) {
        inFlightFetchRef.current = null;
      }
      setLoading(false);
    }
  }, [videoId, email]);

  const generateSummary = useCallback(async (summaryType = activeSummaryType, bypassCache = true) => {
    if (!videoId || videoId === 'active') return;
    if (!transcriptAvailable) {
      setError('Transcript unavailable for this lecture');
      return;
    }

    const genKey = `${videoId}:${summaryType}`;
    if (inFlightGenerateRef.current === genKey) return;
    inFlightGenerateRef.current = genKey;

    setGenerating(true);
    setError(null);

    try {
      const payload = {
        video_id: videoId,
        summary_type: summaryType,
        video_title: activeData?.title || '',
        cues: activeData?.cues || [],
        user_email: email,
        bypass_cache: bypassCache
      };

      const res = await fetch(`${API_BASE}/api/summary/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Generation failed (status ${res.status})`);
      }

      const data = await res.json();
      if (data.summary) {
        setSummaries(prev => ({
          ...prev,
          [summaryType]: data.summary
        }));
        setIsOutdated(false);
      }
    } catch (err) {
      console.error('Error generating lecture summary:', err);
      setError(err.message || 'Failed to generate summary');
    } finally {
      if (inFlightGenerateRef.current === genKey) {
        inFlightGenerateRef.current = null;
      }
      setGenerating(false);
    }
  }, [videoId, activeSummaryType, transcriptAvailable, activeData, email]);

  // Synchronize on video or email change
  useEffect(() => {
    if (videoId) {
      const fetchKey = `${videoId}:${email || ''}`;
      if (currentVideoIdRef.current !== fetchKey) {
        currentVideoIdRef.current = fetchKey;
        fetchSummaries(videoId, email);
      }
    } else {
      currentVideoIdRef.current = null;
      setSummaries({});
      setError(null);
    }
  }, [videoId, email, fetchSummaries]);

  const copyText = useCallback((text, field = 'submission') => {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  }, []);

  const [isOutdated, setIsOutdated] = useState(false);

  const rawSummary = summaries[activeSummaryType] || summaries['comprehensive'] || summaries['15_min'] || null;
  const currentSummary = (rawSummary && (rawSummary.markdownText?.trim() || rawSummary.submissionText?.trim()))
    ? rawSummary
    : null;

  useEffect(() => {
    if (activeData?.is_outdated || activeData?.summary_outdated || currentSummary?.isOutdated) {
      setIsOutdated(true);
    }
  }, [activeData?.is_outdated, activeData?.summary_outdated, currentSummary?.isOutdated]);

  const markOutdated = useCallback(() => {
    setIsOutdated(true);
  }, []);

  const clearOutdated = useCallback(async () => {
    setIsOutdated(false);
    if (activeData) {
      activeData.is_outdated = false;
      activeData.summary_outdated = false;
    }
    setSummaries(prev => {
      const updated = { ...prev };
      for (const k of Object.keys(updated)) {
        if (updated[k]) {
          updated[k] = { ...updated[k], isOutdated: false };
        }
      }
      return updated;
    });
    if (videoId && videoId !== 'active') {
      try {
        await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/summary/clear-outdated`, {
          method: 'POST'
        });
      } catch (err) {
        console.warn('Failed to clear outdated summary flag on server:', err);
      }
    }
  }, [videoId, activeData]);

  const saveCustomSummary = useCallback(async ({ markdownText, submissionText, summaryType = activeSummaryType }) => {
    if (!videoId || videoId === 'active') return;
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/summary/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          summary_type: summaryType,
          markdown_text: markdownText,
          submission_text: submissionText,
          user_email: email
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to save custom summary (${res.status})`);
      }
      const data = await res.json();
      if (data?.summary) {
        setSummaries(prev => ({
          ...prev,
          [summaryType]: data.summary
        }));
        setIsOutdated(false);
        setError(null);
        return data.summary;
      }
    } catch (err) {
      console.error('Error saving custom summary:', err);
      setError(err.message || 'Failed to save custom summary');
      throw err;
    } finally {
      setGenerating(false);
    }
  }, [videoId, email, activeSummaryType]);

  return {
    summaries,
    currentSummary,
    activeSummaryType,
    setActiveSummaryType,
    viewMode,
    setViewMode,
    loading,
    generating,
    error,
    copiedField,
    copyText,
    fetchSummaries,
    generateSummary,
    saveCustomSummary,
    transcriptAvailable,
    isOutdated,
    markOutdated,
    clearOutdated,
    setIsOutdated
  };
}

