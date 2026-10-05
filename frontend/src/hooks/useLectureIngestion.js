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
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

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

  const handleTranscribe = async (
    targetUrl = urlInput,
    pushRoute = true,
    targetCourse = null,
    stayOnCoursePage = false
  ) => {
    const rawUrl = targetUrl || urlInput;
    if (!rawUrl.trim()) return;
    const vidId = extractVideoId(rawUrl);

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
        navigateTo(`/course/${normalizeCourseSlug(effectiveCourse)}/lecture/${vidId}`);
      } else {
        navigateTo(`/lecture/${vidId}`);
      }
    }

    if (!stayOnCoursePage && activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
      setCacheNotice("⚡ Video is already active. Transcripts and summary were reused.");
      return;
    }

    if (cachedVideos[vidId]) {
      const cached = cachedVideos[vidId];
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
        setActiveData({ ...cached, course_name: finalCourse, drive_folder_url: existingDriveUrl, driveFolderUrl: existingDriveUrl, cached: true });
        if (typeof initChatMessages === 'function') {
          initChatMessages(cached.title, vidId);
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
        const updated = { ...prev, [vidId]: { ...cached, course_name: finalCourse } };
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
          if (typeof initChatMessages === 'function') {
            initChatMessages(data.title, data.videoId);
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
    error,
    setError,
    cacheNotice,
    setCacheNotice,
    activeData,
    setActiveData,
    activeDataRef,
    handleTranscribe,
    handlePasteUrl
  };
}
