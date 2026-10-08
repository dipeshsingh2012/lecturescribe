import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/constants';
import { extractVideoId } from '../utils/formatters';
import { normalizeCourseSlug } from '../utils/routing';

export function useLectureIngestion({
  userEmail,
  selectedCourse,
  setSelectedCourse,
  activeCourseData,
  effectiveCourses = [],
  fetchUserLibrary,
  navigateTo,
  initChatMessages,
  onLectureIngested
}) {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [transcriptionLoading, setTranscriptionLoading] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);
  const [transcriptionStage, setTranscriptionStage] = useState(null);
  const [error, setError] = useState(null);
  const [cacheNotice, setCacheNotice] = useState(null);
  const [activeData, setActiveData] = useState(null);

  const [cachedVideos, setCachedVideos] = useState(() => {
    try {
      const stored = localStorage.getItem('lecturescribe_cached_videos');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const activeDataRef = useRef(activeData);
  const transcriptionControllerRef = useRef(null);
  const resumedJobRef = useRef(null);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  useEffect(() => {
    transcriptionControllerRef.current?.abort();
    setTranscriptionError(null);
    setTranscriptionLoading(false);
    setTranscriptionStage(null);
  }, [activeData?.videoId]);

  useEffect(() => () => transcriptionControllerRef.current?.abort(), []);

  useEffect(() => {
    if (error || cacheNotice) {
      const timer = setTimeout(() => {
        setError(null);
        setCacheNotice(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [error, cacheNotice]);

  const handlePasteUrl = (e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted.trim()) {
      const vidId = extractVideoId(pasted);
      if (activeData && activeData.videoId === vidId) {
        setCacheNotice("⚡ Video is already active. Transcripts and summary will be reused.");
      } else if (cachedVideos[vidId]) {
        setCacheNotice("⚡ Pasted video is already cached! Transcripts and summary will load instantly.");
      }
    }
  };

  const saveTranscriptionJob = (videoId, job) => {
    try {
      const stored = JSON.parse(localStorage.getItem('lecturescribe_transcription_jobs') || '{}');
      if (job) stored[videoId] = job;
      else delete stored[videoId];
      localStorage.setItem('lecturescribe_transcription_jobs', JSON.stringify(stored));
    } catch {}
  };

  const pollTranscriptionJob = async (jobId, videoId, controller) => {
    let delayMs = 1000;
    let consecutiveErrors = 0;
    while (!controller.signal.aborted) {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      try {
        const response = await fetch(
          `${API_BASE}/api/lecture/transcription-jobs/${encodeURIComponent(jobId)}${emailParam}`,
          { signal: controller.signal }
        );
        const status = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(status.detail || `Server returned status ${response.status}`);
        }
        consecutiveErrors = 0;
        setTranscriptionStage(status.stage || status.status);
        saveTranscriptionJob(videoId, { job_id: jobId, status: status.status });

        if (status.status === 'failed') {
          saveTranscriptionJob(videoId, null);
          const failure = new Error(status.error || 'Transcript generation failed.');
          failure.permanent = true;
          throw failure;
        }
        if (status.status === 'completed') {
          const lectureResponse = await fetch(
            `${API_BASE}/api/lecture/${encodeURIComponent(videoId)}${emailParam}`,
            { signal: controller.signal }
          );
          const lecture = await lectureResponse.json().catch(() => ({}));
          if (!lectureResponse.ok) {
            throw new Error(lecture.detail || `Server returned status ${lectureResponse.status}`);
          }
          if (!Array.isArray(lecture.cues) ||
              !lecture.cues.some((cue) => String(cue?.text || '').trim())) {
            throw new Error('Transcription completed, but the saved lecture has no transcript cues.');
          }
          setActiveData((current) => current?.videoId === videoId ? { ...current, ...lecture } : current);
          setCachedVideos((previous) => {
            const updated = { ...previous, [videoId]: { ...previous[videoId], ...lecture } };
            try {
              localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(updated));
            } catch {}
            return updated;
          });
          saveTranscriptionJob(videoId, null);
          if (activeDataRef.current?.videoId === videoId &&
              typeof initChatMessages === 'function') {
            initChatMessages(
              lecture.title || activeDataRef.current?.title,
              videoId,
              lecture.cues,
              { preserveCleared: true }
            );
          }
          setTranscriptionStage('completed');
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err.permanent) throw err;
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          throw err;
        }
      }

      await new Promise((resolve) => {
        const onAbort = () => {
          clearTimeout(timeout);
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const timeout = setTimeout(() => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      delayMs = Math.min(Math.round(delayMs * 1.7), 10000);
    }
  };

  useEffect(() => {
    const videoId = activeData?.videoId;
    if (!videoId || resumedJobRef.current === videoId) return;
    let storedJobs;
    try {
      storedJobs = JSON.parse(localStorage.getItem('lecturescribe_transcription_jobs') || '{}');
    } catch {
      return;
    }
    const job = storedJobs[videoId];
    if (!job?.job_id) return;
    resumedJobRef.current = videoId;
    const controller = new AbortController();
    transcriptionControllerRef.current = controller;
    setTranscriptionLoading(true);
    pollTranscriptionJob(job.job_id, videoId, controller)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setTranscriptionError(err.message || 'Failed to retrieve transcript status.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranscriptionLoading(false);
      });
    return () => controller.abort();
  }, [activeData?.videoId]);

  const handleGenerateTranscript = async () => {
    const videoId = activeData?.videoId;
    if (!videoId || transcriptionLoading) return;

    transcriptionControllerRef.current?.abort();
    const controller = new AbortController();
    transcriptionControllerRef.current = controller;
    setTranscriptionLoading(true);
    setTranscriptionError(null);
    setTranscriptionStage('queued');
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const response = await fetch(
        `${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/transcribe${emailParam}`,
        { method: 'POST', signal: controller.signal }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || `Server returned status ${response.status}`);
      }
      if (data.job_id) {
        saveTranscriptionJob(videoId, { job_id: data.job_id, status: data.status });
        await pollTranscriptionJob(data.job_id, videoId, controller);
        return;
      }

      setActiveData((current) => current?.videoId === videoId ? { ...current, ...data } : current);
      setCachedVideos((previous) => {
        const updated = { ...previous, [videoId]: { ...previous[videoId], ...data } };
        try {
          localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(updated));
        } catch {}
        return updated;
      });
      if (typeof initChatMessages === 'function') {
        initChatMessages(data.title || activeData.title, videoId, data.cues);
      }
      setTranscriptionStage('completed');
    } catch (err) {
      if (!controller.signal.aborted) {
        setTranscriptionError(err.message || 'Failed to generate a transcript for this video.');
      }
    } finally {
      if (!controller.signal.aborted) setTranscriptionLoading(false);
    }
  };

  const handleTranscribe = async (
    targetUrl = urlInput,
    pushRoute = true,
    targetCourse = null,
    stayOnCoursePage = false,
    seekTimestamp = null
  ) => {
    const rawUrl = targetUrl || urlInput;
    if (!rawUrl.trim()) return;
    const vidId = extractVideoId(rawUrl);

    let targetSeek = seekTimestamp;
    if (!targetSeek && rawUrl.includes('?t=')) {
      const match = rawUrl.match(/[?&]t=([^&#]+)/);
      if (match) targetSeek = decodeURIComponent(match[1]);
    }
    const timeParam = targetSeek ? `?t=${encodeURIComponent(targetSeek)}` : '';

    let effectiveCourse = targetCourse || activeCourseData?.course_name || selectedCourse || null;
    if (effectiveCourse) {
      const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(effectiveCourse));
      if (match) {
        effectiveCourse = match.course_name;
      } else if (effectiveCourse.includes('-') && effectiveCourse === effectiveCourse.toLowerCase()) {
        effectiveCourse = effectiveCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }

    if (!stayOnCoursePage && pushRoute && vidId) {
      if (effectiveCourse) {
        setSelectedCourse(effectiveCourse);
        navigateTo(`/course/${normalizeCourseSlug(effectiveCourse)}/lecture/${vidId}${timeParam}`);
      } else {
        navigateTo(`/lecture/${vidId}${timeParam}`);
      }
    }

    if (!stayOnCoursePage && activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
      if (targetSeek) {
        const coursePath = effectiveCourse
          ? `/course/${normalizeCourseSlug(effectiveCourse)}/lecture/${vidId}${timeParam}`
          : `/lecture/${vidId}${timeParam}`;
        navigateTo(coursePath, true);
      }
      setCacheNotice("⚡ Video is already active. Transcripts and summary were reused.");
      return;
    }

    if (cachedVideos[vidId]) {
      const cached = cachedVideos[vidId];
      const transcriptAvailable = Array.isArray(cached.cues) &&
        cached.cues.some((cue) => String(cue?.text || '').trim().length > 0);
      const cachedTranscriptMessage = transcriptAvailable
        ? null
        : 'This video was imported, but no transcript or captions are available.';
      let finalCourse = effectiveCourse || cached.course_name;
      if (finalCourse) {
        const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(finalCourse));
        if (match) finalCourse = match.course_name;
        if (!stayOnCoursePage) {
          setSelectedCourse(finalCourse);
          if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/lecture/') || window.location.pathname.includes('%20') || window.location.pathname.includes(' '))) {
            navigateTo(`/course/${normalizeCourseSlug(finalCourse)}/lecture/${vidId}`, true);
          }
        }
      }
      const existingDriveUrl = cached.drive_folder_url || cached.driveFolderUrl || effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id || l.videoId) === String(vidId))?.drive_folder_url || effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id || l.videoId) === String(vidId))?.driveFolderUrl;
      
      if (!stayOnCoursePage) {
        setActiveData({
          ...cached,
          course_name: finalCourse,
          drive_folder_url: existingDriveUrl,
          driveFolderUrl: existingDriveUrl,
          cached: true,
          transcript_available: transcriptAvailable,
          transcript_message: cachedTranscriptMessage
        });
        if (transcriptAvailable && typeof initChatMessages === 'function') {
          initChatMessages(cached.title, vidId, cached.cues);
        }
      }
      setUrlInput('');

      const payload = {
        user_email: userEmail || 'anonymous',
        email: userEmail || 'anonymous',
        video_id: vidId,
        title: cached.title,
        video_title: cached.title,
        source_url: cached.sourceUrl || rawUrl,
        video_url: cached.sourceUrl || rawUrl,
        duration: cached.duration || '',
        duration_seconds: cached.duration || null,
        course_name: finalCourse
      };

      if (userEmail) {
        fetch(`${API_BASE}/api/user/library/record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(() => {
          if (typeof fetchUserLibrary === 'function') fetchUserLibrary(userEmail);
        }).catch(() => {});
      }

      setCachedVideos((prev) => {
        const updated = {
          ...prev,
          [vidId]: {
            ...cached,
            course_name: finalCourse,
            transcript_available: transcriptAvailable,
            transcript_message: cachedTranscriptMessage
          }
        };
        try {
          localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      if (stayOnCoursePage) {
        setCacheNotice(`⚡ Lecture "${cached.title || vidId}" added to ${finalCourse || 'course'} successfully!`);
        if (typeof onLectureIngested === 'function') {
          onLectureIngested(finalCourse, vidId, payload);
        }
      } else {
        setCacheNotice("⚡ Pasted video is already cached! Transcripts and summary will load instantly.");
      }
      return;
    }

    setLoading(true);
    setError(null);
    setCacheNotice(null);

    try {
      const userParam = userEmail ? `&email=${encodeURIComponent(userEmail)}` : '';
      const courseParam = effectiveCourse ? `&course_name=${encodeURIComponent(effectiveCourse)}` : '';
      const res = await fetch(`${API_BASE}/api/transcript?url=${encodeURIComponent(rawUrl)}${userParam}${courseParam}`);
      if (res.ok) {
        const data = await res.json();
        let finalCourse = effectiveCourse || data.course_name;
        if (finalCourse) {
          const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(finalCourse));
          if (match) finalCourse = match.course_name;
          if (!stayOnCoursePage) {
            setSelectedCourse(finalCourse);
            if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/lecture/') || window.location.pathname.includes('%20') || window.location.pathname.includes(' '))) {
              navigateTo(`/course/${normalizeCourseSlug(finalCourse)}/lecture/${data.videoId}`, true);
            }
          }
        }
        const existingDriveUrl = data.drive_folder_url || data.driveFolderUrl || effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id || l.videoId) === String(data.videoId))?.drive_folder_url || effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id || l.videoId) === String(data.videoId))?.driveFolderUrl;
        const enrichedData = { ...data, course_name: finalCourse, drive_folder_url: existingDriveUrl || data.drive_folder_url, driveFolderUrl: existingDriveUrl || data.driveFolderUrl };
        
        if (!stayOnCoursePage) {
          setActiveData(enrichedData);
          if (Array.isArray(data.cues) &&
              data.cues.some((cue) => String(cue?.text || '').trim()) &&
              typeof initChatMessages === 'function') {
            initChatMessages(data.title, data.videoId, data.cues);
          }
        }
        setUrlInput('');

        setCachedVideos((prev) => {
          const updated = { ...prev, [data.videoId]: enrichedData };
          try {
            localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(updated));
          } catch {}
          return updated;
        });

        if (userEmail && typeof fetchUserLibrary === 'function') {
          fetchUserLibrary(userEmail);
        }

        if (stayOnCoursePage) {
          setCacheNotice(`⚡ Lecture "${data.title || data.videoId}" added to ${finalCourse || 'course'} successfully!`);
          if (typeof onLectureIngested === 'function') {
            onLectureIngested(finalCourse, data.videoId, enrichedData);
          }
        } else if (data.cached) {
          setCacheNotice("⚡ Retrieved from Database Cache! Transcripts and summary were not regenerated.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned status ${res.status}`);
      }
    } catch (err) {
      console.error("API Call Error:", err);
      setError(err.message || "Failed to fetch lecture transcript. Please check the backend connection and URL.");
    } finally {
      setLoading(false);
    }
  };

  return {
    urlInput,
    setUrlInput,
    loading,
    setLoading,
    transcriptionLoading,
    transcriptionError,
    transcriptionStage,
    error,
    setError,
    cacheNotice,
    setCacheNotice,
    activeData,
    setActiveData,
    activeDataRef,
    handleTranscribe,
    handleGenerateTranscript,
    handlePasteUrl
  };
}
