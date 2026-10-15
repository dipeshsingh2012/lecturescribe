import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Download,
  X,
  Sparkles,
  AlertCircle,
  FileText,
  Volume2
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { formatSecondsToTimestamp } from '../../utils/formatters';

export default function LecturePodcastPlayer({
  videoId,
  title,
  mode = 'study',
  summaryText = '',
  onClose
}) {
  const [podcastData, setPodcastData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showScript, setShowScript] = useState(false);

  const audioRef = useRef(null);

  // Fetch status of cached podcast audio for this lecture and mode, polling every 5 seconds if generating
  useEffect(() => {
    let isMounted = true;
    let pollInterval = null;
    if (!videoId) return;

    const checkPodcastStatus = async (isBackgroundPoll = false) => {
      if (!isBackgroundPoll) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/lectures/${encodeURIComponent(videoId)}/podcast?mode=${encodeURIComponent(mode)}`);
        if (res.ok) {
          const body = await res.json();
          const pod = body?.data;
          if (isMounted) {
            if (pod?.exists && pod?.status === 'ready') {
              setPodcastData(pod);
              setGenerating(false);
              return true; // Completed
            } else if (pod?.status === 'generating') {
              setGenerating(true);
              setPodcastData(null);
              return false; // Still generating
            } else {
              setPodcastData(null);
              return false;
            }
          }
        }
      } catch (err) {
        if (isMounted && !isBackgroundPoll) {
          console.warn('[LecturePodcastPlayer] Status check warning:', err);
        }
      } finally {
        if (isMounted && !isBackgroundPoll) setLoading(false);
      }
      return false;
    };

    checkPodcastStatus().then((isReady) => {
      if (!isReady && isMounted) {
        pollInterval = setInterval(async () => {
          const ready = await checkPodcastStatus(true);
          if (ready && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }, 5000);
      }
    });

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, [videoId, mode]);

  // Generate single-narrator podcast audio
  const handleGeneratePodcast = async (force = false) => {
    if (!videoId) return;
    setGenerating(true);
    setError(null);
    try {
      const payload = {
        video_id: videoId,
        title: title || 'Lecture Summary',
        text: summaryText,
        mode: mode,
        force_refresh: force
      };
      const res = await fetch(`${API_BASE}/api/lectures/${encodeURIComponent(videoId)}/podcast/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned error status ${res.status}`);
      }
      const data = await res.json();
      if (data?.data?.exists && data?.data?.status === 'ready') {
        setPodcastData(data.data);
        setGenerating(false);
        // Autoplay once generated
        setTimeout(() => {
          if (audioRef.current) {
            try {
              const p = audioRef.current.play();
              if (p && typeof p.catch === 'function') {
                p.catch(() => {});
              }
            } catch {}
          }
        }, 100);
      } else if (data?.data?.status === 'generating') {
        setGenerating(true);
      }
    } catch (err) {
      console.error('[LecturePodcastPlayer] Generation error:', err);
      setError(err.message || 'Failed to synthesize podcast audio.');
      setGenerating(false);
    }
  };

  // Playback handlers
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      try {
        const p = audioRef.current.play();
        if (p && typeof p.catch === 'function') {
          p.catch((e) => console.warn('Audio play prevented:', e));
        }
      } catch (err) {
        console.warn('Audio play error:', err);
      }
    }
  };

  const handleSkip = (seconds) => {
    if (!audioRef.current) return;
    const newTime = Math.min(Math.max(0, audioRef.current.currentTime + seconds), duration || 9999);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIndex];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const audioStreamUrl = `${API_BASE}/api/lectures/${encodeURIComponent(videoId)}/podcast/stream?mode=${encodeURIComponent(mode)}`;

  return (
    <div
      className="lecture-podcast-player-card"
      data-testid="lecture-podcast-player"
      style={{
        background: 'linear-gradient(135deg, rgba(31, 111, 235, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
        border: '1px solid rgba(0, 117, 237, 0.35)',
        borderRadius: '12px',
        padding: '14px 18px',
        marginBottom: '16px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        position: 'relative',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Top Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: 'var(--theme-primary)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Volume2 size={14} />
          </div>
          <div>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Podcast Audio Recap
            </span>
            <span style={{
              marginLeft: '8px',
              fontSize: '0.7rem',
              color: 'var(--theme-primary)',
              background: 'rgba(0, 117, 237, 0.12)',
              padding: '2px 7px',
              borderRadius: '10px',
              fontWeight: 600
            }}>
              Single Narrator • Google TTS
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {podcastData?.script && (
            <button
              type="button"
              onClick={() => setShowScript(!showScript)}
              title={showScript ? 'Hide narration transcript' : 'View narration transcript'}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <FileText size={12} />
              <span>{showScript ? 'Hide Script' : 'Transcript'}</span>
            </button>
          )}

          {podcastData && (
            <a
              href={audioStreamUrl}
              download={`${videoId}_${mode}_podcast.mp3`}
              title="Download podcast audio file"
              aria-label="Download podcast audio"
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'none'
              }}
            >
              <Download size={12} />
              <span>MP3</span>
            </a>
          )}

          {typeof onClose === 'function' && (
            <button
              type="button"
              onClick={onClose}
              title="Close audio player"
              aria-label="Close audio player"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '6px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          fontSize: '0.78rem',
          marginBottom: '10px'
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => handleGeneratePodcast(true)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#ef4444',
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: '0.75rem'
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* State A: Loading status */}
      {loading ? (
        <div style={{ padding: '12px 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Checking audio podcast availability...
        </div>
      ) : generating ? (
        /* State B: Synthesizing */
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 14px',
          borderRadius: '8px',
          background: 'var(--card-bg)'
        }}>
          <Sparkles size={18} color="var(--theme-primary)" className="loading-pulse" />
          <div>
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Synthesizing Single-Narrator Podcast...
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              Translating formulas, key themes, and academic prose into natural Google Cloud audio speech.
            </div>
          </div>
        </div>
      ) : !podcastData ? (
        /* State C: Not yet generated */
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'var(--card-bg)'
        }}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Listen to an engaging audio monologue translating this {mode === 'submission' ? 'assignment prose' : 'lecture study guide'} into spoken explanations.
          </p>
          <button
            type="button"
            onClick={() => handleGeneratePodcast(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              background: 'var(--theme-primary)',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 117, 237, 0.25)'
            }}
          >
            <Sparkles size={13} />
            <span>Generate Podcast Audio</span>
          </button>
        </div>
      ) : (
        /* State D: Audio Player Ready */
        <div>
          <audio
            ref={audioRef}
            src={audioStreamUrl}
            preload="metadata"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onLoadedMetadata={() => {
              setDuration(audioRef.current?.duration || 0);
              if (audioRef.current) {
                audioRef.current.playbackRate = playbackRate;
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
          />

          {/* Player Controls Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '4px 0'
          }}>
            {/* Play / Pause Button */}
            <button
              type="button"
              onClick={togglePlayPause}
              title={isPlaying ? 'Pause' : 'Play podcast'}
              aria-label={isPlaying ? 'Pause podcast' : 'Play podcast'}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'var(--theme-primary)',
                border: 'none',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0, 117, 237, 0.3)',
                flexShrink: 0
              }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: '2px' }} />}
            </button>

            {/* Skip Back 10s */}
            <button
              type="button"
              onClick={() => handleSkip(-10)}
              title="Skip back 10 seconds"
              aria-label="Skip back 10 seconds"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <RotateCcw size={14} />
            </button>

            {/* Skip Forward 10s */}
            <button
              type="button"
              onClick={() => handleSkip(10)}
              title="Skip forward 10 seconds"
              aria-label="Skip forward 10 seconds"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <RotateCw size={14} />
            </button>

            {/* Timeline Progress Slider */}
            <div style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="0"
                max={duration || 100}
                step="0.1"
                value={currentTime}
                onChange={handleSeek}
                aria-label="Podcast audio scrubber"
                style={{
                  width: '100%',
                  accentColor: 'var(--theme-primary)',
                  cursor: 'pointer'
                }}
              />
              <span style={{
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap'
              }}>
                {formatSecondsToTimestamp(currentTime)} / {formatSecondsToTimestamp(duration)}
              </span>
            </div>

            {/* Playback Speed Toggle */}
            <button
              type="button"
              onClick={cyclePlaybackRate}
              title="Cycle playback speed"
              aria-label={`Playback speed ${playbackRate}x`}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              {playbackRate}x
            </button>
          </div>

          {/* Optional Collapsible Narrator Transcript */}
          {showScript && podcastData?.script && (
            <div style={{
              marginTop: '12px',
              padding: '12px 14px',
              borderRadius: '8px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              maxHeight: '160px',
              overflowY: 'auto',
              fontSize: '0.8rem',
              lineHeight: '1.6',
              color: 'var(--text-secondary)'
            }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)', fontSize: '0.76rem' }}>
                🎙️ Spoken Narration Script:
              </div>
              {podcastData.script}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
