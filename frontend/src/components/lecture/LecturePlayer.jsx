import React, { useState, useEffect, useRef } from 'react';
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
  Check
} from 'lucide-react';
import { normalizeCourseSlug } from '../../utils/routing';
import { formatSecondsToTimestamp } from '../../utils/formatters';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import LectureResourcesShelf from './LectureResourcesShelf';

export default function LecturePlayer({
  activeData,
  activeCourseData,
  selectedCourse,
  setSelectedCourse,
  userLibrary = [],
  effectiveCourses = [],
  setActiveData,
  navigateTo,
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
  const [videoCollapsed, setVideoCollapsed] = useState(false);

  // Custom Player Controls State (Vimeo-level parity)
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
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

  // Video event handlers
  const handleTimeUpdate = () => {
    const video = iframeRef?.current;
    if (!video || isScrubbing) return;
    setCurrentTime(video.currentTime || 0);
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
    setVolume(video.volume);
    setIsMuted(video.muted);
    setPlaybackRate(video.playbackRate || 1);
  };

  const handlePlayStateChange = (playing) => {
    setIsPlaying(playing);
    if (!playing) {
      setShowControls(true);
    }
  };

  const togglePlay = () => {
    const video = iframeRef?.current;
    if (!video) return;
    if (video.paused || video.ended) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const skipSeconds = (sec) => {
    const video = iframeRef?.current;
    if (!video) return;
    const newTime = Math.min(Math.max(0, (video.currentTime || 0) + sec), duration || video.duration || 0);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (newVal) => {
    const video = iframeRef?.current;
    if (!video) return;
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
          width: '100%',
          flexShrink: 0,
          py: 0.75,
          mb: 1.25,
          zIndex: 1
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
            effectiveCourses.find(c => c.course_slug === activeData.course_slug || normalizeCourseSlug(c.course_name) === normalizeCourseSlug(selectedCourse))?.course_name ||
            userLibrary.find(l => String(l.video_id) === String(activeData.videoId))?.course_name ||
            selectedCourse ||
            'General Lectures'
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

      {/* Video Player Container with Custom Controls (Vimeo parity) */}
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
          const streamUrl = activeData.gcs_video_url || activeData.gcsVideoUrl || `/api/videos/${encodeURIComponent(activeData.videoId)}/stream`;
          const effectiveDuration = duration || (typeof activeData.duration === 'number' ? activeData.duration : 0);
          const bufferedPercent = effectiveDuration > 0 ? Math.min(100, (bufferedEnd / effectiveDuration) * 100) : 0;
          const currentPercent = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

          return (
            <>
              <video
                ref={iframeRef}
                src={streamUrl}
                playsInline
                preload="metadata"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => handlePlayStateChange(true)}
                onPause={() => handlePlayStateChange(false)}
                onEnded={() => handlePlayStateChange(false)}
                onClick={togglePlay}
                style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, objectFit: 'contain', cursor: 'pointer' }}
                title={activeData.title}
              >
                {(activeData.captions_vtt_url || activeData.captionsUrl) && (
                  <track
                    kind="subtitles"
                    src={activeData.captions_vtt_url || activeData.captionsUrl}
                    srcLang="en"
                    label="English"
                    default
                  />
                )}
                Your browser does not support the video tag.
              </video>

              {/* Big Center Play / Pause Indicator on Video Click */}
              {!isPlaying && (
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
                  opacity: showControls || !isPlaying ? 1 : 0,
                  pointerEvents: showControls || !isPlaying ? 'auto' : 'none',
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
                      {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
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
          {(activeData.gcs_video_url || activeData.gcsVideoUrl) && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '16px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#16a34a',
                fontSize: '0.78rem',
                fontWeight: 600,
                flexShrink: 0
              }}
              title="Streaming high-speed video directly from Google Cloud Storage"
            >
              <span>● Cloud Storage Video</span>
            </span>
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
