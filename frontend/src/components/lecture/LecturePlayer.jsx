import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
  Tooltip,
  Alert,
  CircularProgress,
  Menu,
  MenuItem,
  Slider
} from '@mui/material';
import {
  Folder,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  AudioLines,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Subtitles,
  PictureInPicture,
  Check,
  CloudUpload,
  Loader2,
  AlertCircle,
  Copy,
  Search
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';
import { formatSecondsToTimestamp, parseTimestampToSeconds, isGcsSignedUrlFresh } from '../../utils/formatters';
import { sortLectures, getLectureTitle } from '../../utils/lectureSort';
import { getVideoSourceInfo } from '../../utils/publisherDetect';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import LectureResourcesShelf from './LectureResourcesShelf';

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

export default function LecturePlayer({
  activeData,
  activeCourseData,
  selectedCourse,
  setSelectedCourse,
  userLibrary = [],
  effectiveCourses = [],
  setActiveData,
  navigateTo,
  handleTranscribe,
  iframeRef,
  copied,
  handleCopyTranscript,
  googleUser,
  openUploadModal,
  openPreviewModal,
  lectureResources = [],
  lectureResourcesLoading,
  handleDeleteResource,
  currentTheme,
  handleGenerateTranscript,
  transcriptionLoading = false,
  transcriptionError = null,
  transcriptionStage = null
}) {
  if (!activeData) return null;

  const driveFolderUrl = (
    activeData.drive_folder_url ||
    activeData.driveFolderUrl ||
    userLibrary?.find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    userLibrary?.find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl ||
    effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl ||
    activeCourseData?.lectures?.find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    activeCourseData?.lectures?.find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl
  );
  const hasTranscript = Array.isArray(activeData.cues) &&
    activeData.cues.some((cue) => String(cue?.text || '').trim());
  const rawGcsVideoUrl = activeData.gcs_video_url || activeData.gcsVideoUrl;
  const freshGcsVideoUrl = isGcsSignedUrlFresh(rawGcsVideoUrl) ? rawGcsVideoUrl : null;
  const [videoCollapsed, setVideoCollapsed] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState(false);

  useEffect(() => {
    setVideoError(false);
    setCopiedTitle(false);
  }, [activeData?.videoId]);

  const courseName = (
    activeCourseData?.course_name ||
    activeData.course_name ||
    selectedCourse ||
    ''
  );

  const courseLectures = useMemo(() => {
    let list = [];
    if (Array.isArray(activeCourseData?.lectures) && activeCourseData.lectures.length > 0) {
      list = activeCourseData.lectures;
    } else if (courseName && Array.isArray(effectiveCourses)) {
      const slug = normalizeCourseSlug(courseName);
      const matched = effectiveCourses.find(c =>
        c.course_name === courseName ||
        normalizeCourseSlug(c.course_name || '') === slug ||
        c.course_slug === slug
      );
      if (matched && Array.isArray(matched.lectures) && matched.lectures.length > 0) {
        list = matched.lectures;
      }
    }

    if (list.length === 0 && courseName && Array.isArray(userLibrary)) {
      const slug = normalizeCourseSlug(courseName);
      list = userLibrary.filter(l =>
        l.course_name === courseName ||
        normalizeCourseSlug(l.course_name || '') === slug
      );
    }

    if (list.length === 0 && Array.isArray(userLibrary) && userLibrary.length > 0) {
      list = userLibrary;
    }

    const seen = new Set();
    const deduped = [];
    for (const item of list) {
      const id = String(item?.video_id || item?.videoId || '');
      if (id && !seen.has(id)) {
        seen.add(id);
        deduped.push(item);
      }
    }

    const activeVid = String(activeData.videoId || activeData.video_id || '');
    if (activeVid && !seen.has(activeVid)) {
      deduped.push({
        video_id: activeVid,
        title: activeData.title || activeVid,
        course_name: courseName,
        ...activeData
      });
    }

    return sortLectures(deduped, 'title_asc');
  }, [activeCourseData, courseName, effectiveCourses, userLibrary, activeData]);

  const activeVid = String(activeData.videoId || activeData.video_id || '');
  const currentIndex = courseLectures.findIndex(l => String(l.video_id || l.videoId) === activeVid);
  const prevLecture = currentIndex > 0 ? courseLectures[currentIndex - 1] : null;
  const nextLecture = (currentIndex >= 0 && currentIndex < courseLectures.length - 1) ? courseLectures[currentIndex + 1] : null;
  const totalLectures = courseLectures.length;

  const handleNavigateLecture = (targetLecture) => {
    if (!targetLecture) return;
    const targetId = targetLecture.video_id || targetLecture.videoId;
    if (!targetId || targetId === activeData?.videoId) return;

    const targetCourse = targetLecture.course_name || courseName;
    const courseSlug = targetCourse ? normalizeCourseSlug(targetCourse) : '';
    const path = courseSlug ? `/course/${courseSlug}/lecture/${targetId}` : `/lecture/${targetId}`;

    if (typeof handleTranscribe === 'function') {
      handleTranscribe(targetId, true, targetCourse);
    } else if (typeof navigateTo === 'function') {
      navigateTo(path);
    }
  };

  const [gcsUploadState, setGcsUploadState] = useState({
    isUploading: Boolean(activeData.is_uploading),
    stage: activeData.upload_stage || 'Processing video stream...',
    syncedToGcs: Boolean(freshGcsVideoUrl)
  });

  // Track & poll Cloud Storage video upload status
  useEffect(() => {
    const vid = activeData?.videoId;
    if (!vid) return;

    if (freshGcsVideoUrl) {
      setGcsUploadState({
        isUploading: false,
        stage: 'Complete',
        syncedToGcs: true
      });
      return;
    }

    let isMounted = true;
    let pollTimer = null;

    const checkGcsStatus = async () => {
      try {
        const base = API_BASE || (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.startsWith('null') ? window.location.origin : 'http://localhost');
        const res = await fetch(`${base}/api/videos/${encodeURIComponent(vid)}/status`).catch(() => null);
        if (!res || !res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        if (data.synced_to_gcs && data.view_url) {
          setGcsUploadState({
            isUploading: false,
            stage: 'Complete',
            syncedToGcs: true
          });
          if (typeof setActiveData === 'function') {
            setActiveData(prev => prev ? {
              ...prev,
              gcs_video_url: data.view_url,
              gcsVideoUrl: data.view_url,
              video_source: 'gcs'
            } : prev);
          }
        } else if (data.is_uploading) {
          setGcsUploadState({
            isUploading: true,
            stage: data.upload_stage || 'Uploading video to Cloud Storage...',
            syncedToGcs: false
          });
          pollTimer = setTimeout(checkGcsStatus, 3500);
        } else {
          setGcsUploadState(prev => ({
            ...prev,
            isUploading: false,
            stage: data.upload_stage || prev.stage,
            syncedToGcs: false
          }));
        }
      } catch (_) {}
    };

    checkGcsStatus();

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [activeData?.videoId, freshGcsVideoUrl, setActiveData]);

  const [triggeringSync, setTriggeringSync] = useState(false);

  const handleTriggerGcsSync = async () => {
    const vid = activeData?.videoId;
    if (!vid || triggeringSync) return;

    setTriggeringSync(true);
    setGcsUploadState(prev => ({
      ...prev,
      isUploading: true,
      stage: 'Contacting server to start Cloud Storage sync...'
    }));

    try {
      const base = API_BASE || (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.startsWith('null') ? window.location.origin : 'http://localhost');
      const res = await fetch(`${base}/api/videos/${encodeURIComponent(vid)}/sync-gcs`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.synced_to_gcs && data.view_url) {
          setGcsUploadState({
            isUploading: false,
            stage: 'Complete',
            syncedToGcs: true
          });
          if (typeof setActiveData === 'function') {
            setActiveData(prev => prev ? {
              ...prev,
              gcs_video_url: data.view_url,
              gcsVideoUrl: data.view_url,
              video_source: 'gcs'
            } : prev);
          }
        } else {
          setGcsUploadState(prev => ({
            ...prev,
            isUploading: true,
            stage: data.upload_stage || 'Cloud Storage upload started in background...'
          }));
        }
      }
    } catch (err) {
      console.warn('Could not trigger GCS sync:', err);
    } finally {
      setTriggeringSync(false);
    }
  };

  // Custom Player Controls State (Full parity)
  const containerRef = useRef(null);
  const wantPlayRef = useRef(false);
  const targetSeekRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => {
    const prog = activeData?.progress;
    if (!prog) return 0;
    const sec = (typeof prog.last_seconds === 'number' && prog.last_seconds > 2)
      ? prog.last_seconds
      : parseTimestampToSeconds(prog.last_timestamp);
    const dur = Number(prog.duration_seconds || activeData?.duration_seconds || activeData?.total_duration_seconds || 0) || parseTimestampToSeconds(activeData?.duration);
    const pct = typeof prog.progress_percent === 'number' ? prog.progress_percent : 0;
    const isCompleted = pct >= 98 || (dur > 0 && (sec / dur) >= 0.98);
    const initialSec = !isCompleted && sec > 2 ? sec : 0;
    targetSeekRef.current = initialSec;
    return initialSec;
  });
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [speedMenuAnchor, setSpeedMenuAnchor] = useState(null);
  const hideControlsTimerRef = useRef(null);

  useEffect(() => {
    wantPlayRef.current = false;
  }, [activeData?.videoId]);

  useEffect(() => {
    const prog = activeData?.progress;
    if (!prog) return;
    const sec = (typeof prog.last_seconds === 'number' && prog.last_seconds > 2)
      ? prog.last_seconds
      : parseTimestampToSeconds(prog.last_timestamp);
    const dur = Number(prog.duration_seconds || activeData?.duration_seconds || activeData?.total_duration_seconds || 0) || parseTimestampToSeconds(activeData?.duration);
    const pct = typeof prog.progress_percent === 'number' ? prog.progress_percent : 0;
    const isCompleted = pct >= 98 || (dur > 0 && (sec / dur) >= 0.98);
    if (!isCompleted && sec > 2) {
      if (targetSeekRef.current <= 0) {
        targetSeekRef.current = sec;
      }
      setCurrentTime(prev => (prev < 1 ? sec : prev));
    }
  }, [activeData?.videoId, activeData?.progress]);

  useEffect(() => {
    const video = iframeRef?.current;
    if (video && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lecturescribe:videomounted', { detail: { element: video } }));
    }
  }, [activeData?.videoId, gcsUploadState.isUploading]);

  useEffect(() => {
    const video = iframeRef?.current;
    if (!video || typeof video.addEventListener !== 'function') return;
    const onCustomSeek = (e) => {
      const sec = e?.detail?.seconds;
      if (typeof sec === 'number' && !isNaN(sec) && !isScrubbing) {
        targetSeekRef.current = sec;
        setCurrentTime(sec);
      }
    };
    const onWantPlay = (e) => {
      wantPlayRef.current = Boolean(e?.detail?.playing);
    };
    video.addEventListener('lecturescribe:seek', onCustomSeek);
    video.addEventListener('lecturescribe:wantplay', onWantPlay);
    return () => {
      video.removeEventListener('lecturescribe:seek', onCustomSeek);
      video.removeEventListener('lecturescribe:wantplay', onWantPlay);
    };
  }, [activeData?.videoId, gcsUploadState.isUploading, isScrubbing]);

  // Re-sync video playback time when window regains focus or tab becomes visible
  useEffect(() => {
    const handleSyncOnVisible = () => {
      const video = iframeRef?.current;
      if (video && !video.paused) {
        handleTimeUpdate();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleSyncOnVisible);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleSyncOnVisible);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleSyncOnVisible);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleSyncOnVisible);
      }
    };
  }, []);

  // Video event handlers
  const handleTimeUpdate = () => {
    const video = iframeRef?.current;
    if (!video || isScrubbing) return;
    const nextSec = video.currentTime || 0;
    const pending = (typeof video.__pendingResumeSec === 'number' && video.__pendingResumeSec > 2)
      ? video.__pendingResumeSec
      : targetSeekRef.current;
    if (nextSec < 1 && video.paused && pending > 2) {
      setCurrentTime(pending);
    } else {
      if (nextSec >= 1 && !video.paused) {
        targetSeekRef.current = 0;
      }
      setCurrentTime(nextSec);
    }
    if (video.duration && !isNaN(video.duration)) {
      setDuration(video.duration);
    }
    if (video.buffered && video.buffered.length > 0) {
      try {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      } catch (_) {}
    }
  };

  const handleLoadedMetadata = () => {
    const video = iframeRef?.current;
    if (!video) return;
    if (video.duration && !isNaN(video.duration)) {
      setDuration(video.duration);
    }
    const pending = (typeof video.__pendingResumeSec === 'number' && video.__pendingResumeSec > 0)
      ? video.__pendingResumeSec
      : targetSeekRef.current;
    if (typeof pending === 'number' && pending > 0) {
      video.__pendingResumeSec = null;
      targetSeekRef.current = 0;
      if ((video.currentTime || 0) < 1) {
        try {
          video.currentTime = pending;
        } catch (_) {}
      }
      setCurrentTime(video.currentTime || pending);
    } else if ((video.currentTime || 0) > 0) {
      setCurrentTime(video.currentTime);
    }
    setVolume(video.volume);
    setIsMuted(video.muted);
    setPlaybackRate(video.playbackRate || 1);
    if (wantPlayRef.current && video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  };

  const handlePlayStateChange = (playing) => {
    if (playing) {
      wantPlayRef.current = true;
    }
    setIsPlaying(playing);
    if (!playing) {
      setShowControls(true);
    }
  };

  const togglePlay = () => {
    const video = iframeRef?.current;
    if (!video) return;
    if (video.paused || video.ended) {
      wantPlayRef.current = true;
      const pending = (typeof video.__pendingResumeSec === 'number' && video.__pendingResumeSec > 0)
        ? video.__pendingResumeSec
        : targetSeekRef.current;
      if (typeof pending === 'number' && pending > 0) {
        if ((video.currentTime || 0) < 1 && (video.readyState >= 1 || typeof video.readyState !== 'number')) {
          video.__pendingResumeSec = null;
          targetSeekRef.current = 0;
          try {
            video.currentTime = pending;
          } catch (_) {}
        }
      }
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          if (err?.name !== 'AbortError') {
            wantPlayRef.current = false;
          }
        });
      }
    } else {
      wantPlayRef.current = false;
      video.pause();
    }
  };

  const skipSeconds = (sec) => {
    const video = iframeRef?.current;
    if (!video) return;
    video.__pendingResumeSec = null;
    targetSeekRef.current = 0;
    const baseTime = video.currentTime || currentTime || 0;
    const newTime = Math.min(Math.max(0, baseTime + sec), duration || video.duration || Infinity);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (newVal) => {
    const video = iframeRef?.current;
    if (!video) return;
    video.__pendingResumeSec = null;
    targetSeekRef.current = newVal;
    video.currentTime = newVal;
    setCurrentTime(newVal);
  };

  const handleVolumeChange = (newVal) => {
    const video = iframeRef?.current;
    if (!video) return;
    video.volume = newVal;
    setVolume(newVal);
    if (newVal === 0) {
      video.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      video.muted = false;
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    const video = iframeRef?.current;
    if (!video) return;
    const nextMute = !isMuted;
    video.muted = nextMute;
    setIsMuted(nextMute);
    if (!nextMute && volume === 0) {
      video.volume = 0.5;
      setVolume(0.5);
    }
  };

  const handleSpeedSelect = (rate) => {
    const video = iframeRef?.current;
    if (video) {
      video.playbackRate = rate;
      setPlaybackRate(rate);
    }
    setSpeedMenuAnchor(null);
  };

  const toggleSubtitles = () => {
    const video = iframeRef?.current;
    if (!video) return;
    const nextVal = !showSubtitles;
    setShowSubtitles(nextVal);
    if (video.textTracks && video.textTracks.length > 0) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = nextVal ? 'showing' : 'hidden';
      }
    }
  };

  const togglePiP = async () => {
    const video = iframeRef?.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn("Picture-in-picture error:", e);
    }
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Keyboard navigation & controls
  const handleKeyDown = (e) => {
    // If typing in input, textarea, or contentEditable, ignore
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
      return;
    }
    const key = e.key.toLowerCase();
    if (e.code === 'Space' || key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (key === 'arrowleft' || key === 'j') {
      e.preventDefault();
      skipSeconds(-10);
    } else if (key === 'arrowright' || key === 'l') {
      e.preventDefault();
      skipSeconds(10);
    } else if (key === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'arrowup') {
      e.preventDefault();
      handleVolumeChange(Math.min(1, volume + 0.1));
    } else if (key === 'arrowdown') {
      e.preventDefault();
      handleVolumeChange(Math.max(0, volume - 0.1));
    } else if (e.shiftKey && key === 'n') {
      if (nextLecture) {
        e.preventDefault();
        handleNavigateLecture(nextLecture);
      }
    } else if (e.shiftKey && key === 'p') {
      if (prevLecture) {
        e.preventDefault();
        handleNavigateLecture(prevLecture);
      }
    }
  };

  // Hover inactivity timeout to auto-hide controls while playing
  const triggerUserActivity = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="lecture-player-panel">
      {/* Top Header Row: Breadcrumb Navigation & Prev/Next Lecture Arrows */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          width: '100%',
          flexShrink: 0,
          py: 0.75,
          mb: 1.25,
          zIndex: 1
        }}
      >
        {/* Breadcrumb Navigation */}
        <Box
          component="nav"
          aria-label="Breadcrumbs"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'nowrap',
            overflow: 'hidden',
            minWidth: 0,
            flexShrink: 1
          }}
        >
          <Tooltip title="All Courses" arrow placement="top" enterDelay={200}>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSelectedCourse(null);
                setActiveData(null);
                navigateTo('/');
              }}
              startIcon={<Folder size={15} color={currentTheme.palette.primary} />}
              sx={{
                p: 0,
                minWidth: 'auto',
                flexShrink: 0,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.84rem',
                color: currentTheme.palette.textSecondary,
                '&:hover': { color: currentTheme.palette.primary, bgcolor: 'transparent' }
              }}
            >
              Courses
            </Button>
          </Tooltip>

          <ChevronRight size={13} color={currentTheme.palette.textSecondary} style={{ opacity: 0.5, flexShrink: 0 }} />

          {(() => {
            const displayCourseName = (
              activeCourseData?.course_name ||
              activeData.course_name ||
              selectedCourse ||
              ''
            );
            const courseSlug = (
              activeCourseData?.course_slug ||
              activeData.course_slug ||
              normalizeCourseSlug(displayCourseName)
            );
            return (
              <Tooltip title={displayCourseName} arrow placement="top" enterDelay={150}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    setSelectedCourse(displayCourseName);
                    setActiveData(null);
                    navigateTo(`/course/${courseSlug}`);
                  }}
                  sx={{
                    p: 0,
                    minWidth: 0,
                    maxWidth: { xs: 130, sm: 200, md: 280 },
                    flexShrink: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    color: currentTheme.palette.primary,
                    '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' }
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                      maxWidth: '100%'
                    }}
                  >
                    {displayCourseName}
                  </Box>
                </Button>
              </Tooltip>
            );
          })()}

          <ChevronRight size={13} color={currentTheme.palette.textSecondary} style={{ opacity: 0.5, flexShrink: 0 }} />

          <Tooltip title={activeData.title} arrow placement="top" enterDelay={150}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                fontSize: '0.84rem',
                color: currentTheme.palette.textPrimary,
                minWidth: 0,
                flexShrink: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'default'
              }}
            >
              {activeData.title}
            </Typography>
          </Tooltip>
        </Box>

        {/* Previous & Next Lecture Navigation */}
        {totalLectures > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              bgcolor: 'var(--card-bg, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              borderRadius: '8px',
              p: '2px 4px'
            }}
          >
            <Tooltip
              title={prevLecture ? `Previous: ${getLectureTitle(prevLecture)}` : 'First lecture in course'}
              arrow
              placement="bottom"
            >
              <span>
                <IconButton
                  size="small"
                  aria-label="Previous Lecture"
                  disabled={!prevLecture}
                  onClick={() => handleNavigateLecture(prevLecture)}
                  sx={{
                    p: 0.5,
                    color: currentTheme.palette.textPrimary,
                    '&.Mui-disabled': {
                      opacity: 0.35,
                      color: currentTheme.palette.textSecondary
                    },
                    '&:hover': {
                      bgcolor: 'var(--hover-bg, rgba(255, 255, 255, 0.08))',
                      color: currentTheme.palette.primary
                    }
                  }}
                >
                  <ChevronLeft size={16} />
                </IconButton>
              </span>
            </Tooltip>

            {totalLectures > 1 && currentIndex >= 0 && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: currentTheme.palette.textSecondary,
                  px: 0.5,
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  display: { xs: 'none', sm: 'inline-block' }
                }}
              >
                {currentIndex + 1} of {totalLectures}
              </Typography>
            )}

            <Tooltip
              title={nextLecture ? `Next: ${getLectureTitle(nextLecture)}` : 'Last lecture in course'}
              arrow
              placement="bottom"
            >
              <span>
                <IconButton
                  size="small"
                  aria-label="Next Lecture"
                  disabled={!nextLecture}
                  onClick={() => handleNavigateLecture(nextLecture)}
                  sx={{
                    p: 0.5,
                    color: currentTheme.palette.textPrimary,
                    '&.Mui-disabled': {
                      opacity: 0.35,
                      color: currentTheme.palette.textSecondary
                    },
                    '&:hover': {
                      bgcolor: 'var(--hover-bg, rgba(255, 255, 255, 0.08))',
                      color: currentTheme.palette.primary
                    }
                  }}
                >
                  <ChevronRight size={16} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Video Player Container with Custom Controls */}
      <Box
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseMove={triggerUserActivity}
        onMouseEnter={triggerUserActivity}
        sx={{
          display: { xs: videoCollapsed ? 'none' : 'block', md: 'block' },
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#000',
          borderRadius: '12px',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          border: '1px solid var(--border-color)',
          flexShrink: 0,
          outline: 'none',
          userSelect: 'none',
          '&:focus-visible': {
            boxShadow: '0 0 0 2px var(--theme-primary)'
          }
        }}
      >
        {(() => {
          const hasGcsStream = Boolean(freshGcsVideoUrl);
          if (gcsUploadState.isUploading && !hasGcsStream) {
            return (
              <Box
                data-testid="gcs-uploading-overlay"
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
                  color: '#fff',
                  p: 3,
                  textAlign: 'center',
                  userSelect: 'none'
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    width: 72,
                    height: 72,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2
                  }}
                >
                  <CircularProgress
                    size={72}
                    thickness={2.5}
                    sx={{ color: 'var(--theme-primary, #3b82f6)', position: 'absolute' }}
                  />
                  <CloudUpload size={32} color="#60a5fa" />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '1rem', sm: '1.15rem' }, mb: 1 }}>
                  Uploading Video to Cloud Storage...
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.75)', maxWidth: 460, mb: 2, fontSize: '0.85rem' }}>
                  {gcsUploadState.stage || 'Synchronizing high-definition lecture stream to Google Cloud Storage. Player will auto-load as soon as transfer finishes.'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 12px',
                      borderRadius: '16px',
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      color: '#93c5fd',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}
                  >
                    <Loader2 size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                    <span>Sync in Progress</span>
                  </span>
                </Box>
              </Box>
            );
          }

          if (videoError && !freshGcsVideoUrl && !gcsUploadState.isUploading) {
            const rawSource = activeData.source_url || activeData.sourceUrl || activeData.moodle_url || activeData.moodleUrl || '';
            const sourceInfo = getVideoSourceInfo(rawSource, courseName);
            const sourceDirectUrl = (sourceInfo && sourceInfo.url && !sourceInfo.url.includes('video.lecturescribe.local')) ? sourceInfo.url : null;
            const sourcePlatformLabel = sourceInfo?.label || 'Original Platform';
            const moodleSearchUrl = courseName ? `https://learning.iiitdwd.ac.in/course/search.php?search=${encodeURIComponent(courseName)}` : 'https://learning.iiitdwd.ac.in/';

            return (
              <Box
                data-testid="broken-video-moodle-fallback"
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 1) 100%)',
                  color: '#fff',
                  p: { xs: 2, sm: 3 },
                  textAlign: 'center',
                  userSelect: 'none',
                  zIndex: 10
                }}
              >
                <Box
                  sx={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    bgcolor: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 1.5,
                    color: '#f59e0b'
                  }}
                >
                  <AlertCircle size={28} />
                </Box>

                <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '0.95rem', sm: '1.15rem' }, mb: 0.75 }}>
                  Video Stream Not Synced to Cloud Storage
                </Typography>

                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', maxWidth: 480, mb: 2.5, fontSize: '0.82rem', lineHeight: 1.5 }}>
                  This recording is hosted on {sourcePlatformLabel}. You can view the original stream directly on {sourcePlatformLabel}, or sync it to Cloud Storage for native in-app playback.
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center', alignItems: 'center' }}>
                  {sourceDirectUrl && (
                    <Button
                      variant="contained"
                      size="small"
                      component="a"
                      href={sourceDirectUrl}
                      target="_blank"
                      rel="noreferrer"
                      startIcon={<ExternalLink size={14} />}
                      sx={{
                        bgcolor: sourceInfo?.color || '#f59e0b',
                        color: sourceInfo?.platform === 'youtube' ? '#fff' : '#000',
                        fontWeight: 700,
                        textTransform: 'none',
                        fontSize: '0.78rem',
                        '&:hover': { filter: 'brightness(0.9)' }
                      }}
                    >
                      {sourceInfo?.platform === 'moodle' ? 'Open Video on Moodle' : `Open Video on ${sourcePlatformLabel}`}
                    </Button>
                  )}

                  <Button
                    variant="outlined"
                    size="small"
                    component="a"
                    href={moodleSearchUrl}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<Search size={14} />}
                    sx={{
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                      color: '#fff',
                      fontWeight: 600,
                      textTransform: 'none',
                      fontSize: '0.78rem',
                      '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255, 255, 255, 0.05)' }
                    }}
                  >
                    Search Course on Moodle
                  </Button>

                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      if (activeData?.title) {
                        navigator.clipboard?.writeText(activeData.title);
                        setCopiedTitle(true);
                        setTimeout(() => setCopiedTitle(false), 2500);
                      }
                    }}
                    startIcon={copiedTitle ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    sx={{
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                      color: copiedTitle ? '#10b981' : '#fff',
                      fontWeight: 600,
                      textTransform: 'none',
                      fontSize: '0.78rem',
                      '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255, 255, 255, 0.05)' }
                    }}
                  >
                    {copiedTitle ? 'Title Copied!' : 'Copy Session Title'}
                  </Button>

                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleTriggerGcsSync}
                    disabled={triggeringSync}
                    startIcon={<CloudUpload size={14} />}
                    sx={{
                      bgcolor: 'var(--theme-primary, #3b82f6)',
                      fontWeight: 600,
                      textTransform: 'none',
                      fontSize: '0.78rem',
                      '&:hover': { bgcolor: '#2563eb' }
                    }}
                  >
                    {triggeringSync ? 'Starting Sync…' : 'Sync to Cloud Storage'}
                  </Button>

                  <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                      setVideoError(false);
                      const v = iframeRef?.current;
                      if (v) v.load();
                    }}
                    startIcon={<RotateCcw size={14} />}
                    sx={{
                      color: 'rgba(255, 255, 255, 0.65)',
                      textTransform: 'none',
                      fontSize: '0.78rem',
                      '&:hover': { color: '#fff' }
                    }}
                  >
                    Retry Stream
                  </Button>
                </Box>
              </Box>
            );
          }

          const streamUrl = freshGcsVideoUrl || `${API_BASE || ''}/api/videos/${encodeURIComponent(activeData.videoId)}/stream`;
          const rawCaptionsUrl = activeData.captions_vtt_url || activeData.captionsUrl;
          const freshCaptionsUrl = isGcsSignedUrlFresh(rawCaptionsUrl) ? rawCaptionsUrl : null;
          const fallbackDuration =
            (typeof activeData.duration === 'number' && activeData.duration > 0 ? activeData.duration : 0) ||
            Number(activeData.duration_seconds || activeData.total_duration_seconds || activeData.progress?.duration_seconds || 0) ||
            parseTimestampToSeconds(activeData.duration) ||
            (Array.isArray(activeData.cues) && activeData.cues.length > 0
              ? parseTimestampToSeconds(activeData.cues[activeData.cues.length - 1]?.time) + 30
              : 0);
          const effectiveDuration = duration || fallbackDuration;
          const bufferedPercent = effectiveDuration > 0 ? Math.min(100, (bufferedEnd / effectiveDuration) * 100) : 0;
          const currentPercent = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

          return (
            <>
              <video
                ref={iframeRef}
                src={streamUrl}
                playsInline
                preload="metadata"
                onLoadedData={() => setVideoError(false)}
                onTimeUpdate={handleTimeUpdate}
                onSeeked={handleTimeUpdate}
                onSeeking={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onCanPlay={() => {
                  setVideoError(false);
                  const v = iframeRef?.current;
                  if (v && wantPlayRef.current && v.paused) {
                    const p = v.play();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                  }
                }}
                onError={() => {
                  if (freshGcsVideoUrl && typeof setActiveData === 'function') {
                    setActiveData(prev => prev ? {
                      ...prev,
                      gcs_video_url: null,
                      gcsVideoUrl: null
                    } : prev);
                  } else {
                    setVideoError(true);
                  }
                }}
                onPlay={() => handlePlayStateChange(true)}
                onPause={() => handlePlayStateChange(false)}
                onEnded={() => {
                  wantPlayRef.current = false;
                  handlePlayStateChange(false);
                }}
                onClick={togglePlay}
                style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, objectFit: 'contain', cursor: 'pointer' }}
                title={activeData.title}
              >
                {freshCaptionsUrl && (
                  <track
                    kind="subtitles"
                    src={freshCaptionsUrl}
                    srcLang="en"
                    label="English"
                    default
                  />
                )}
                Your browser does not support the video tag.
              </video>

              {/* Background Cloud Storage Uploading Overlay */}
              {gcsUploadState.isUploading && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
                    color: '#fff',
                    p: 3,
                    textAlign: 'center',
                    zIndex: 15
                  }}
                >
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      bgcolor: 'rgba(59, 130, 246, 0.15)',
                      border: '2px solid rgba(59, 130, 246, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 2,
                      position: 'relative'
                    }}
                  >
                    <CloudUpload size={32} color="#60a5fa" />
                    <CircularProgress
                      size={72}
                      thickness={2.5}
                      sx={{
                        color: '#3b82f6',
                        position: 'absolute',
                        top: -6,
                        left: -6
                      }}
                    />
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5, fontSize: { xs: '0.95rem', sm: '1.1rem' } }}>
                    Syncing Video to Cloud Storage
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', maxWidth: 440, mb: 2, fontSize: '0.82rem' }}>
                    {gcsUploadState.stage || 'Transferring lecture stream to Google Cloud Storage for high-speed playback...'}
                  </Typography>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.8,
                      py: 0.5,
                      borderRadius: 4,
                      bgcolor: 'rgba(59, 130, 246, 0.2)',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      fontSize: '0.76rem',
                      color: '#93c5fd'
                    }}
                  >
                    <Loader2 size={13} style={{ animation: 'spin 1.5s linear infinite' }} />
                    <span>Upload in progress • Transcripts & AI Tutor are ready below</span>
                  </Box>
                </Box>
              )}

              {/* Big Center Play / Pause Indicator on Video Click */}
              {!isPlaying && !gcsUploadState.isUploading && (
                <Box
                  component="button"
                  type="button"
                  onClick={togglePlay}
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: { xs: 54, sm: 64 },
                    height: { xs: 54, sm: 64 },
                    borderRadius: '50%',
                    bgcolor: 'rgba(0, 0, 0, 0.65)',
                    border: '2px solid rgba(255, 255, 255, 0.4)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    color: '#fff',
                    '&:hover': {
                      transform: 'translate(-50%, -50%) scale(1.08)',
                      bgcolor: 'rgba(0, 117, 237, 0.85)',
                      borderColor: '#fff'
                    }
                  }}
                  aria-label="Play Video"
                >
                  <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />
                </Box>
              )}

              {/* Custom Player Controls Bar (Docked at bottom) */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 70%, transparent 100%)',
                  padding: { xs: '8px 12px 6px', sm: '12px 16px 8px' },
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  opacity: (showControls || !isPlaying) && !gcsUploadState.isUploading ? 1 : 0,
                  pointerEvents: (showControls || !isPlaying) && !gcsUploadState.isUploading ? 'auto' : 'none',
                  transition: 'opacity 0.25s ease',
                  zIndex: 10
                }}
              >
                {/* Progress Bar / Scrubber */}
                <Box
                  sx={{
                    position: 'relative',
                    width: '100%',
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    '&:hover .scrubber-thumb': { transform: 'scale(1.2)' }
                  }}
                >
                  <Slider
                    size="small"
                    value={currentTime}
                    min={0}
                    max={effectiveDuration || 100}
                    step={0.1}
                    onChange={(_, val) => {
                      setIsScrubbing(true);
                      setCurrentTime(val);
                    }}
                    onChangeCommitted={(_, val) => {
                      setIsScrubbing(false);
                      handleSeek(val);
                    }}
                    aria-label="Video scrubber timeline"
                    sx={{
                      color: currentTheme.palette.primary || '#0075ed',
                      height: 4,
                      p: 0,
                      '& .MuiSlider-rail': {
                        bgcolor: 'rgba(255, 255, 255, 0.25)',
                        opacity: 1
                      },
                      '& .MuiSlider-track': {
                        bgcolor: currentTheme.palette.primary || '#0075ed',
                        border: 'none'
                      },
                      '& .MuiSlider-thumb': {
                        width: 12,
                        height: 12,
                        bgcolor: '#fff',
                        transition: 'transform 0.15s ease',
                        boxShadow: '0 0 6px rgba(0,0,0,0.6)',
                        '&:hover, &.Mui-focusVisible': {
                          boxShadow: '0 0 0 6px rgba(0, 117, 237, 0.3)'
                        }
                      }
                    }}
                  />
                  {/* Buffer indicator bar beneath slider track */}
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: `${bufferedPercent}%`,
                      height: 4,
                      bgcolor: 'rgba(255, 255, 255, 0.35)',
                      borderRadius: 1,
                      pointerEvents: 'none',
                      zIndex: 0
                    }}
                  />
                </Box>

                {/* Control Action Buttons Row */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', width: '100%' }}>
                  {/* Left Controls: Play, Skip, Time, Volume */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
                    {/* Play/Pause */}
                    <Tooltip title={isPlaying ? "Pause (k / Space)" : "Play (k / Space)"} arrow placement="top">
                      <IconButton
                        size="small"
                        onClick={togglePlay}
                        aria-label={isPlaying ? "Pause" : "Play"}
                        sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                      >
                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                      </IconButton>
                    </Tooltip>

                    {/* Skip -10s */}
                    <Tooltip title="Rewind 10s (j / ←)" arrow placement="top">
                      <IconButton
                        size="small"
                        onClick={() => skipSeconds(-10)}
                        aria-label="Rewind 10 seconds"
                        sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                      >
                        <RotateCcw size={16} />
                      </IconButton>
                    </Tooltip>

                    {/* Skip +10s */}
                    <Tooltip title="Fast-forward 10s (l / →)" arrow placement="top">
                      <IconButton
                        size="small"
                        onClick={() => skipSeconds(10)}
                        aria-label="Fast forward 10 seconds"
                        sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                      >
                        <RotateCw size={16} />
                      </IconButton>
                    </Tooltip>

                    {/* Volume & Mute */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Tooltip title={isMuted ? "Unmute (m)" : "Mute (m)"} arrow placement="top">
                        <IconButton
                          size="small"
                          onClick={toggleMute}
                          aria-label={isMuted ? "Unmute" : "Mute"}
                          sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                        >
                          {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </IconButton>
                      </Tooltip>
                      <Box sx={{ width: { xs: 45, sm: 65 }, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', mr: 1 }}>
                        <Slider
                          size="small"
                          value={isMuted ? 0 : volume}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(_, val) => handleVolumeChange(val)}
                          aria-label="Volume"
                          sx={{
                            color: '#fff',
                            height: 3,
                            '& .MuiSlider-thumb': { width: 10, height: 10, bgcolor: '#fff' }
                          }}
                        />
                      </Box>
                    </Box>

                    {/* Current Time / Duration */}
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'rgba(255, 255, 255, 0.9)',
                        fontWeight: 500,
                        fontSize: { xs: '0.72rem', sm: '0.78rem' },
                        fontVariantNumeric: 'tabular-nums',
                        ml: { xs: 0.5, sm: 1 },
                        userSelect: 'none'
                      }}
                    >
                      {formatSecondsToTimestamp(currentTime)} / {formatSecondsToTimestamp(effectiveDuration)}
                    </Typography>
                  </Box>

                  {/* Right Controls: Speed, CC, PiP, Fullscreen */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 0.75 } }}>
                    {/* Playback Speed selector */}
                    <Tooltip title="Playback Speed" arrow placement="top">
                      <Button
                        size="small"
                        onClick={(e) => setSpeedMenuAnchor(e.currentTarget)}
                        aria-label="Playback speed"
                        sx={{
                          color: '#fff',
                          minWidth: 'auto',
                          px: 0.75,
                          py: 0.25,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'none',
                          borderRadius: '4px',
                          bgcolor: 'rgba(255, 255, 255, 0.1)',
                          '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.2)' }
                        }}
                      >
                        {playbackRate}x
                      </Button>
                    </Tooltip>

                    <Menu
                      anchorEl={speedMenuAnchor}
                      open={Boolean(speedMenuAnchor)}
                      onClose={() => setSpeedMenuAnchor(null)}
                      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                      PaperProps={{
                        sx: {
                          bgcolor: 'rgba(24, 24, 27, 0.95)',
                          backdropFilter: 'blur(8px)',
                          color: '#fff',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: 2,
                          minWidth: 110
                        }
                      }}
                    >
                      {PLAYBACK_RATES.map((rate) => (
                        <MenuItem
                          key={rate}
                          selected={playbackRate === rate}
                          onClick={() => handleSpeedSelect(rate)}
                          sx={{
                            fontSize: '0.8rem',
                            fontWeight: playbackRate === rate ? 700 : 400,
                            display: 'flex',
                            justifyContent: 'space-between',
                            '&.Mui-selected': { bgcolor: 'rgba(0, 117, 237, 0.35)' },
                            '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.1)' }
                          }}
                        >
                          <span>{rate}x</span>
                          {playbackRate === rate && <Check size={14} color="#0075ed" />}
                        </MenuItem>
                      ))}
                    </Menu>

                    {/* Subtitles (CC) Toggle */}
                    {(activeData.captions_vtt_url || activeData.captionsUrl) && (
                      <Tooltip title={showSubtitles ? "Disable Subtitles" : "Enable Subtitles"} arrow placement="top">
                        <IconButton
                          size="small"
                          onClick={toggleSubtitles}
                          aria-label={showSubtitles ? "Disable Subtitles" : "Enable Subtitles"}
                          sx={{
                            color: showSubtitles ? (currentTheme.palette.primary || '#0075ed') : 'rgba(255, 255, 255, 0.7)',
                            p: 0.75,
                            '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' }
                          }}
                        >
                          <Subtitles size={17} />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* Picture in Picture */}
                    {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
                      <Tooltip title="Picture in Picture" arrow placement="top">
                        <IconButton
                          size="small"
                          onClick={togglePiP}
                          aria-label="Picture in Picture"
                          sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                        >
                          <PictureInPicture size={17} />
                        </IconButton>
                      </Tooltip>
                    )}

                    {/* Fullscreen Toggle */}
                    <Tooltip title={isFullscreen ? "Exit Fullscreen (f)" : "Fullscreen (f)"} arrow placement="top">
                      <IconButton
                        size="small"
                        onClick={toggleFullscreen}
                        aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        sx={{ color: '#fff', p: 0.75, '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)' } }}
                      >
                        {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Box>
            </>
          );
        })()}
      </Box>

      {/* Minimized Video Bar on Mobile */}
      {videoCollapsed && (
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: 'var(--card-bg)',
            p: 1,
            px: 1.5,
            borderRadius: 2,
            border: '1px solid var(--border-color)'
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
            Video player minimized
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setVideoCollapsed(false)}
            sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.72rem' }}
          >
            Show Video
          </Button>
        </Box>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <h1 className="lecture-title">
          {activeData.title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => setVideoCollapsed(prev => !prev)}
            sx={{
              display: { xs: 'inline-flex', md: 'none' },
              textTransform: 'none',
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              py: 0.2,
              px: 0.8
            }}
          >
            {videoCollapsed ? 'Show Video' : 'Minimize Video'}
          </Button>
          {gcsUploadState.isUploading && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '16px',
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                color: '#3b82f6',
                fontSize: '0.78rem',
                fontWeight: 600,
                flexShrink: 0
              }}
              title="Lecture video is being uploaded to Google Cloud Storage"
            >
              <CircularProgress size={10} thickness={5} sx={{ color: '#3b82f6' }} />
              <span>Uploading to Cloud Storage...</span>
            </span>
          )}
          {!(activeData.gcs_video_url || activeData.gcsVideoUrl) && !gcsUploadState.isUploading && (
            <button
              type="button"
              onClick={handleTriggerGcsSync}
              disabled={triggeringSync}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                background: 'rgba(0, 117, 237, 0.1)',
                border: '1px solid rgba(0, 117, 237, 0.35)',
                color: 'var(--theme-primary, #0075ed)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: triggeringSync ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                transition: 'all 0.2s ease'
              }}
              title="Click to trigger high-definition video transfer to Google Cloud Storage"
            >
              <CloudUpload size={13} />
              <span>{triggeringSync ? 'Starting Sync…' : 'Sync to Cloud Storage'}</span>
            </button>
          )}
          {driveFolderUrl && (
            <a
              href={driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Saved in Google Drive"
              title="Open lecture bundle in Google Drive"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                background: 'var(--highlight-bg)',
                border: '1px solid var(--badge-border)',
                color: 'var(--theme-primary)',
                fontSize: '0.78rem',
                fontWeight: 600,
                textDecoration: 'none',
                flexShrink: 0,
                transition: 'all 0.2s ease'
              }}
            >
              <GoogleDriveIcon size={15} />
              <span>Saved in Drive</span>
              <ExternalLink size={12} style={{ opacity: 0.8 }} />
            </a>
          )}
          {(() => {
            const rawSource = activeData.source_url || activeData.sourceUrl || activeData.moodle_url || activeData.moodleUrl || '';
            const sourceInfo = getVideoSourceInfo(rawSource, courseName);
            if (!sourceInfo?.url) return null;
            return (
              <a
                href={sourceInfo.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`View on ${sourceInfo.label}`}
                title={sourceInfo.title || `Open original lecture session on ${sourceInfo.label}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  background: sourceInfo.bg || 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${sourceInfo.border || 'rgba(245, 158, 11, 0.35)'}`,
                  color: sourceInfo.color || '#f59e0b',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  flexShrink: 0,
                  transition: 'all 0.2s ease'
                }}
              >
                <span>{sourceInfo.label}</span>
                <ExternalLink size={12} style={{ opacity: 0.8 }} />
              </a>
            );
          })()}
        </div>
      </div>

      {!hasTranscript && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <Button
            variant="contained"
            onClick={handleGenerateTranscript}
            disabled={!handleGenerateTranscript || transcriptionLoading}
            startIcon={transcriptionLoading
              ? <CircularProgress size={16} color="inherit" />
              : <AudioLines size={17} />}
          >
            {transcriptionLoading ? 'Generating transcript…' : 'Generate transcript'}
          </Button>
          {transcriptionError && (
            <Alert severity="error" role="alert">{transcriptionError}</Alert>
          )}
          {transcriptionLoading && (
            <Alert severity="info" role="status">
              {transcriptionStage === 'queued' || transcriptionStage === 'starting'
                ? 'Transcript job queued. Waiting for a worker…'
                : transcriptionStage === 'indexing'
                  ? 'Transcript saved. Updating lecture search and tutor data…'
                  : 'Generating transcript…'}
            </Alert>
          )}
        </Box>
      )}

      {/* Lecture Resources Shelf */}
      <div className="desktop-only-shelf">
        <LectureResourcesShelf
          lectureResources={lectureResources}
          lectureResourcesLoading={lectureResourcesLoading}
          googleUser={googleUser}
          handleDeleteResource={handleDeleteResource}
          activeData={activeData}
          activeCourseData={activeCourseData}
          selectedCourse={selectedCourse}
          openPreviewModal={openPreviewModal}
          openUploadModal={openUploadModal}
        />
      </div>
    </div>
  );
}
