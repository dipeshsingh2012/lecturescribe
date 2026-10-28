import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '../utils/constants';
import { parseTimestampToSeconds, formatSecondsToTimestamp } from '../utils/formatters';

export function createHtml5VideoAdapter(videoEl) {
  const listeners = new Map();

  const wrapHandler = (event, fn) => {
    return () => {
      fn({ seconds: videoEl.currentTime, duration: videoEl.duration });
    };
  };

  const applyPendingResumeOnLoad = () => {
    const pending = (typeof videoEl.__pendingResumeSec === 'number' && videoEl.__pendingResumeSec > 0)
      ? videoEl.__pendingResumeSec
      : (typeof videoEl.__targetResumeSec === 'number' && videoEl.__targetResumeSec > 0 ? videoEl.__targetResumeSec : null);
    if (typeof pending === 'number' && pending > 0 && (videoEl.currentTime || 0) < 1) {
      try {
        videoEl.currentTime = pending;
        if (typeof CustomEvent === 'function') {
          videoEl.dispatchEvent(new CustomEvent('lecturescribe:seek', { detail: { seconds: pending } }));
        }
      } catch (_) {}
    }
  };

  videoEl.addEventListener('loadedmetadata', applyPendingResumeOnLoad);
  videoEl.addEventListener('canplay', applyPendingResumeOnLoad, { once: true });

  return {
    on(event, fn) {
      if (!listeners.has(event)) {
        listeners.set(event, new Map());
      }
      const wrapped = wrapHandler(event, fn);
      listeners.get(event).set(fn, wrapped);
      videoEl.addEventListener(event, wrapped);
    },
    off(event, fn) {
      const eventMap = listeners.get(event);
      if (eventMap && eventMap.has(fn)) {
        const wrapped = eventMap.get(fn);
        videoEl.removeEventListener(event, wrapped);
        eventMap.delete(fn);
      }
    },
    destroy() {
      videoEl.removeEventListener('loadedmetadata', applyPendingResumeOnLoad);
      videoEl.removeEventListener('canplay', applyPendingResumeOnLoad);
    },
    ready() {
      if (videoEl.readyState >= 1) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          videoEl.removeEventListener('loadedmetadata', finish);
          clearTimeout(fallbackTimer);
          resolve();
        };
        videoEl.addEventListener('loadedmetadata', finish);
        // Resolve after 150ms even if metadata is still buffering so DB progress fetch & cue sync never block
        const fallbackTimer = setTimeout(finish, 150);
      });
    },
    getDuration() {
      return Promise.resolve(videoEl.duration || 0);
    },
    getCurrentTime() {
      return Promise.resolve(videoEl.currentTime || 0);
    },
    setCurrentTime(sec) {
      try {
        if (videoEl.readyState === 0) {
          videoEl.__pendingResumeSec = sec;
        } else {
          videoEl.__pendingResumeSec = null;
        }
        try {
          videoEl.currentTime = sec;
        } catch (_) {}
        if (typeof CustomEvent === 'function') {
          videoEl.dispatchEvent(new CustomEvent('lecturescribe:seek', { detail: { seconds: sec } }));
        }
        return Promise.resolve(sec);
      } catch (err) {
        return Promise.reject(err);
      }
    },
    play() {
      const pending = videoEl.__pendingResumeSec;
      if (typeof pending === 'number' && pending > 0 && (videoEl.readyState >= 1 || typeof videoEl.readyState !== 'number')) {
        videoEl.__pendingResumeSec = null;
        if ((videoEl.currentTime || 0) < 1) {
          try {
            videoEl.currentTime = pending;
          } catch (_) {}
        }
      }
      if (typeof CustomEvent === 'function' && typeof videoEl.dispatchEvent === 'function') {
        videoEl.dispatchEvent(new CustomEvent('lecturescribe:wantplay', { detail: { playing: true } }));
      }
      return videoEl.play ? videoEl.play() : Promise.resolve();
    },
    pause() {
      if (typeof CustomEvent === 'function' && typeof videoEl.dispatchEvent === 'function') {
        videoEl.dispatchEvent(new CustomEvent('lecturescribe:wantplay', { detail: { playing: false } }));
      }
      if (typeof videoEl.pause === 'function') videoEl.pause();
      return Promise.resolve();
    },
    getPaused() {
      return Promise.resolve(Boolean(videoEl.paused || videoEl.ended));
    }
  };
}

export function createIframeVideoAdapter(iframeEl) {
  if (iframeEl && iframeEl.__playerAdapter) {
    return typeof iframeEl.__playerAdapter === 'function' ? iframeEl.__playerAdapter(iframeEl) : iframeEl.__playerAdapter;
  }
  const listeners = new Map();
  const trigger = (event, data) => {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach(fn => fn(data));
    }
  };
  const adapter = {
    on(event, fn) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(fn);
    },
    off(event, fn) {
      const set = listeners.get(event);
      if (set) {
        set.delete(fn);
      }
    },
    ready() {
      return Promise.resolve();
    },
    getDuration() {
      return Promise.resolve(0);
    },
    getCurrentTime() {
      return Promise.resolve(0);
    },
    setCurrentTime(sec) {
      trigger('seeked', { seconds: sec });
      return Promise.resolve(sec);
    },
    play() {
      trigger('play', {});
      return Promise.resolve();
    },
    pause() {
      trigger('pause', {});
      return Promise.resolve();
    },
    destroy() {
      listeners.clear();
    },
    _trigger: trigger
  };
  if (iframeEl) {
    iframeEl.__playerAdapter = adapter;
  }
  return adapter;
}

export function useLecturePlayer(activeData, userEmail = null) {
  const effectiveUserEmail = useMemo(() => {
    if (userEmail && typeof userEmail === 'string' && userEmail.trim()) {
      return userEmail.trim();
    }
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('lecturescribe_google_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.email && parsed.email !== 'Google User') {
            return parsed.email.trim();
          }
        }
      } catch {}
    }
    return null;
  }, [userEmail]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [searchError, setSearchError] = useState(null);
  const [activeCueIdx, setActiveCueIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const iframeRef = useRef(null);
  const [mediaMounted, setMediaMounted] = useState(0);
  const fetchedProgressVidRef = useRef(null);
  const activeDataRef = useRef(activeData);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  const playerRef = useRef(null);
  const lastSavedSecRef = useRef(0);
  const currentSecRef = useRef(0);
  const activeCueIdxRef = useRef(0);
  const durationRef = useRef(0);
  const saveDebounceTimerRef = useRef(null);
  const targetResumeSecRef = useRef(0);
  const prevVideoIdRef = useRef(null);

  // Listen for video mount notifications
  useEffect(() => {
    const handleMounted = () => {
      setMediaMounted(prev => prev + 1);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('lecturescribe:videomounted', handleMounted);
      return () => window.removeEventListener('lecturescribe:videomounted', handleMounted);
    }
  }, []);

  // Instant Search Handler strictly via Algolia Cloud
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setSearchAvailable(true);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, video_id: activeData?.videoId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.available === false) {
            setSearchAvailable(false);
            setSearchError(data.error || 'Transcript search is currently unavailable.');
            setSearchResults([]);
          } else {
            setSearchAvailable(true);
            setSearchError(null);
            setSearchResults(data.hits || data.results || []);
          }
        } else {
          setSearchAvailable(false);
          setSearchError('Transcript search is currently unavailable.');
          setSearchResults([]);
        }
      } catch (err) {
        console.error("Search API Error:", err);
        setSearchAvailable(false);
        setSearchError('Transcript search is currently unavailable.');
        setSearchResults([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, activeData]);

  // Connect Video Player SDK or HTML5 Video adapter to track current playhead timestamp and sync progress
  useEffect(() => {
    const vidId = activeData?.videoId;
    if (vidId && prevVideoIdRef.current !== vidId) {
      prevVideoIdRef.current = vidId;
      fetchedProgressVidRef.current = null;
      targetResumeSecRef.current = 0;
      currentSecRef.current = 0;
      lastSavedSecRef.current = 0;
      durationRef.current = 0;
    }

    const currentMediaEl = iframeRef.current || (typeof document !== 'undefined' ? (document.querySelector('video') || document.querySelector('iframe')) : null);

    const updateCueFromSeconds = (currentSec) => {
      if (typeof currentSec !== 'number' || isNaN(currentSec)) return 0;
      const cues = activeData?.cues || [];
      if (!cues.length) return 0;
      let matchIdx = -1;
      for (let i = cues.length - 1; i >= 0; i--) {
        const cueSec = parseTimestampToSeconds(cues[i].time);
        if (currentSec >= cueSec) {
          matchIdx = i;
          break;
        }
      }
      const finalIdx = matchIdx !== -1 ? matchIdx : 0;
      setActiveCueIdx(finalIdx);
      activeCueIdxRef.current = finalIdx;
      return finalIdx;
    };

    const resolveResumeFromProgress = (prog) => {
      if (!prog) return 0;
      if (prog.duration_seconds && prog.duration_seconds > 0 && !durationRef.current) {
        durationRef.current = Number(prog.duration_seconds);
      }
      const rawSec = (typeof prog.last_seconds === 'number' && prog.last_seconds > 2)
        ? prog.last_seconds
        : (Number(prog.last_seconds) > 2
          ? Number(prog.last_seconds)
          : parseTimestampToSeconds(prog.last_timestamp));
      if (!rawSec || rawSec <= 2) return 0;
      const dur = Number(prog.duration_seconds) || durationRef.current || 0;
      const pct = typeof prog.progress_percent === 'number' ? prog.progress_percent : 0;
      const isCompleted = pct >= 98 || (dur > 0 && (rawSec / dur) >= 0.98);
      return isCompleted ? 0 : rawSec;
    };

    const applyResumePosition = (sec, progCueIdx = null, playerInstance = null) => {
      if (!sec || sec <= 0) return false;
      targetResumeSecRef.current = sec;
      currentSecRef.current = sec;
      lastSavedSecRef.current = sec;

      const computedCueIdx = updateCueFromSeconds(sec);
      if (computedCueIdx === 0 && typeof progCueIdx === 'number' && progCueIdx > 0) {
        setActiveCueIdx(progCueIdx);
        activeCueIdxRef.current = progCueIdx;
      }

      const activePlayer = playerInstance || playerRef.current;
      const targetEl = playerInstance?.element || currentMediaEl || iframeRef.current;
      if (activePlayer && typeof activePlayer.setCurrentTime === 'function') {
        activePlayer.setCurrentTime(sec).catch(() => {});
      } else if (targetEl && targetEl.tagName === 'VIDEO') {
        try {
          targetEl.__targetResumeSec = sec;
          if (targetEl.readyState >= 1 || typeof targetEl.readyState !== 'number') {
            targetEl.__pendingResumeSec = null;
            targetEl.currentTime = sec;
          } else {
            targetEl.__pendingResumeSec = sec;
            try {
              targetEl.currentTime = sec;
            } catch (_) {}
          }
          if (typeof CustomEvent === 'function') {
            targetEl.dispatchEvent(new CustomEvent('lecturescribe:seek', { detail: { seconds: sec } }));
          }
        } catch (_) {}
      }
      return true;
    };

    // Immediately restore transcript cue and target time from URL ?t= or preloaded activeData.progress
    // even before the video element finishes loading metadata
    if (activeData) {
      let immediateRestored = false;
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const tParam = urlParams.get('t') || (window.location.hash.startsWith('#t=') ? window.location.hash.slice(3) : null);
        if (tParam) {
          const sec = isNaN(tParam) ? parseTimestampToSeconds(tParam) : Number(tParam);
          if (sec > 0) {
            immediateRestored = applyResumePosition(sec);
          }
        }
      }
      if (!immediateRestored && activeData.progress && targetResumeSecRef.current <= 0) {
        const progSec = resolveResumeFromProgress(activeData.progress);
        if (progSec > 2) {
          applyResumePosition(progSec, activeData.progress.active_cue_idx);
        }
      }
    }

    if (currentMediaEl && activeData) {
      try {
        if (!durationRef.current) {
          if (typeof activeData.duration === 'number' && activeData.duration > 0) {
            durationRef.current = activeData.duration;
          } else if (typeof activeData.duration === 'string') {
            const parsed = parseTimestampToSeconds(activeData.duration);
            if (parsed > 0) durationRef.current = parsed;
          } else if (currentMediaEl.duration && !isNaN(currentMediaEl.duration) && currentMediaEl.duration > 0) {
            durationRef.current = currentMediaEl.duration;
          } else if (activeData.cues && activeData.cues.length > 0) {
            const lastCue = activeData.cues[activeData.cues.length - 1];
            if (lastCue?.time) {
              const cueSec = parseTimestampToSeconds(lastCue.time);
              if (cueSec > 0) durationRef.current = cueSec;
            }
          }
        }

        const player = currentMediaEl.tagName === 'VIDEO'
          ? createHtml5VideoAdapter(currentMediaEl)
          : createIframeVideoAdapter(currentMediaEl);
        playerRef.current = player;

        // If we already resolved a target resume timestamp (e.g. from activeData.progress or previous render before GCS URL updated), apply it to the player immediately
        if (targetResumeSecRef.current > 0) {
          applyResumePosition(targetResumeSecRef.current, activeCueIdxRef.current, player);
        }

        const saveProgressToDb = async (sec, cueIdx) => {
          if (!activeData?.videoId) return;
          const safeSec = typeof sec === 'number' && !isNaN(sec) ? Math.max(0, sec) : currentSecRef.current;
          if (safeSec <= 1 && targetResumeSecRef.current > 2) return;
          const safeIdx = typeof cueIdx === 'number' ? cueIdx : activeCueIdxRef.current;
          lastSavedSecRef.current = safeSec;

          const timestampStr = formatSecondsToTimestamp(safeSec);
          const dur = durationRef.current ||
            (currentMediaEl?.duration && !isNaN(currentMediaEl.duration) && currentMediaEl.duration > 0 ? currentMediaEl.duration : 0) ||
            (typeof activeData.duration === 'number' ? activeData.duration : parseTimestampToSeconds(activeData.duration)) ||
            0;
          if (dur > 0 && !durationRef.current) {
            durationRef.current = dur;
          }

          try {
            await fetch(`${API_BASE}/api/progress/lecture`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              keepalive: true,
              body: JSON.stringify({
                video_id: activeData.videoId,
                user_email: effectiveUserEmail || 'anonymous',
                last_timestamp: timestampStr,
                last_seconds: safeSec,
                duration_seconds: dur,
                active_cue_idx: safeIdx
              })
            });

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('lecturescribe:progressupdated', {
                detail: {
                  video_id: activeData.videoId,
                  progress: {
                    last_timestamp: timestampStr,
                    last_seconds: safeSec,
                    duration_seconds: dur,
                    active_cue_idx: safeIdx
                  }
                }
              }));
            }
          } catch (err) {
            console.warn("Failed to persist lecture progress:", err);
          }
        };

        const handleTimeChange = (data) => {
          const sec = (data && typeof data.seconds === 'number') ? data.seconds : null;
          if (sec !== null) {
            // Ignore initial 0s timeupdate emitted when video element mounts or switches src before seek completes
            if (sec < 1 && targetResumeSecRef.current > 2) {
              return;
            }
            const isVideoPlaying = currentMediaEl?.tagName === 'VIDEO' ? !currentMediaEl.paused : false;
            if (isVideoPlaying && targetResumeSecRef.current > 0 && sec >= 1) {
              if (currentMediaEl) currentMediaEl.__pendingResumeSec = null;
              targetResumeSecRef.current = 0;
            }
            currentSecRef.current = sec;
            const newCueIdx = updateCueFromSeconds(sec);

            // Periodically persist progress every 10 seconds of active playback
            if (Math.abs(sec - lastSavedSecRef.current) >= 10) {
              lastSavedSecRef.current = sec;
              saveProgressToDb(sec, newCueIdx);
            } else {
              // Debounced fallback to save when stopping or pausing on short segments
              if (saveDebounceTimerRef.current) {
                clearTimeout(saveDebounceTimerRef.current);
              }
              saveDebounceTimerRef.current = setTimeout(() => {
                if (Math.abs(currentSecRef.current - lastSavedSecRef.current) >= 2) {
                  lastSavedSecRef.current = currentSecRef.current;
                  saveProgressToDb(currentSecRef.current, activeCueIdxRef.current);
                }
              }, 4000);
            }
          } else if (player && typeof player.getCurrentTime === 'function') {
            player.getCurrentTime().then(s => {
              if (s < 1 && targetResumeSecRef.current > 2) return;
              updateCueFromSeconds(s);
            }).catch(() => {});
          }
        };

        const handlePauseOrSeeked = (data) => {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
          }
          const sec = (data && typeof data.seconds === 'number') ? data.seconds : currentSecRef.current;
          if (sec < 1 && targetResumeSecRef.current > 2) {
            return;
          }
          if (sec > 0) {
            if (targetResumeSecRef.current > 0 && Math.abs(sec - targetResumeSecRef.current) > 2) {
              targetResumeSecRef.current = 0;
              if (currentMediaEl) currentMediaEl.__pendingResumeSec = null;
            }
            currentSecRef.current = sec;
            updateCueFromSeconds(sec);
            saveProgressToDb(sec, activeCueIdxRef.current);
          }
        };

        player.on('timeupdate', handleTimeChange);
        player.on('seeking', handleTimeChange);
        player.on('seeked', handlePauseOrSeeked);
        player.on('play', handleTimeChange);
        player.on('pause', handlePauseOrSeeked);

        // Instantly re-sync cue with current video playback time when window regains focus or tab becomes visible,
        // and instantly persist progress when tab is hidden or page is about to unload
        const handleWindowSync = () => {
          if (currentMediaEl && currentMediaEl.tagName === 'VIDEO') {
            const isPlaying = !currentMediaEl.paused;
            const sec = currentMediaEl.currentTime;
            if (isPlaying && typeof sec === 'number' && !isNaN(sec) && sec >= 0) {
              currentSecRef.current = sec;
              updateCueFromSeconds(sec);
            }
          }
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === 'hidden') {
            const sec = (currentMediaEl && typeof currentMediaEl.currentTime === 'number' && currentMediaEl.currentTime > 0)
              ? currentMediaEl.currentTime
              : currentSecRef.current;
            if (activeData?.videoId && sec > 2) {
              currentSecRef.current = sec;
              saveProgressToDb(sec, activeCueIdxRef.current);
            }
          } else {
            handleWindowSync();
          }
        };

        const handlePageUnload = () => {
          const sec = (currentMediaEl && typeof currentMediaEl.currentTime === 'number' && currentMediaEl.currentTime > 0)
            ? currentMediaEl.currentTime
            : currentSecRef.current;
          if (activeData?.videoId && sec > 2) {
            currentSecRef.current = sec;
            saveProgressToDb(sec, activeCueIdxRef.current);
          }
        };

        if (typeof window !== 'undefined') {
          window.addEventListener('focus', handleWindowSync);
          window.addEventListener('beforeunload', handlePageUnload);
          window.addEventListener('pagehide', handlePageUnload);
        }
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        if (typeof player.ready === 'function') {
          player.ready().then(async () => {
            if (typeof player.getDuration === 'function') {
              player.getDuration().then(d => {
                if (typeof d === 'number' && d > 0) durationRef.current = d;
              }).catch(() => {});
            }

            let restored = false;
            if (typeof window !== 'undefined') {
              const urlParams = new URLSearchParams(window.location.search);
              const tParam = urlParams.get('t') || (window.location.hash.startsWith('#t=') ? window.location.hash.slice(3) : null);
              if (tParam) {
                const sec = isNaN(tParam) ? parseTimestampToSeconds(tParam) : Number(tParam);
                if (sec > 0) {
                  applyResumePosition(sec, null, player);
                  restored = true;
                }
              }
            }

            // Silent auto-resume from database if not explicitly set via URL
            if (!restored && activeData?.videoId && fetchedProgressVidRef.current !== activeData.videoId) {
              fetchedProgressVidRef.current = activeData.videoId;
              try {
                const emailParam = effectiveUserEmail ? `&user_email=${encodeURIComponent(effectiveUserEmail)}` : '';
                const res = await fetch(`${API_BASE}/api/progress/lecture?video_id=${encodeURIComponent(activeData.videoId)}${emailParam}`);
                if (res && res.ok) {
                  const resData = await res.json();
                  const prog = resData?.progress;
                  const progSec = resolveResumeFromProgress(prog);
                  if (progSec > 2) {
                    applyResumePosition(progSec, prog?.active_cue_idx, player);
                    restored = true;
                  }
                }
              } catch (err) {
                console.warn("Could not restore lecture progress from DB:", err);
              }
            }

            if (!restored && targetResumeSecRef.current > 2) {
              applyResumePosition(targetResumeSecRef.current, activeCueIdxRef.current, player);
              restored = true;
            }

            if (!restored && typeof player.getCurrentTime === 'function') {
              player.getCurrentTime().then(updateCueFromSeconds).catch(() => {});
            }
          }).catch(() => {});
        }

        return () => {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
          }
          if (activeData?.videoId && currentSecRef.current > 2 && Math.abs(currentSecRef.current - lastSavedSecRef.current) >= 1) {
            saveProgressToDb(currentSecRef.current, activeCueIdxRef.current);
          }
          if (typeof window !== 'undefined') {
            window.removeEventListener('focus', handleWindowSync);
            window.removeEventListener('beforeunload', handlePageUnload);
            window.removeEventListener('pagehide', handlePageUnload);
          }
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
          }
          if (typeof player.off === 'function') {
            player.off('timeupdate', handleTimeChange);
            player.off('seeking', handleTimeChange);
            player.off('seeked', handlePauseOrSeeked);
            player.off('play', handleTimeChange);
            player.off('pause', handlePauseOrSeeked);
          }
          if (typeof player.destroy === 'function') {
            player.destroy();
          }
        };
      } catch (err) {
        console.warn("Video Player SDK init warning:", err);
      }
    }
  }, [activeData?.videoId, effectiveUserEmail, mediaMounted]);

  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const el = iframeRef.current || (typeof document !== 'undefined' ? (document.querySelector('video') || document.querySelector('iframe')) : null);
    if (!el || el.tagName !== 'VIDEO') return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    setIsPlaying(!el.paused);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
    };
  }, [activeData?.videoId, mediaMounted]);

  const handleTogglePlayPause = useCallback(() => {
    const video = (iframeRef?.current && iframeRef.current.tagName === 'VIDEO')
      ? iframeRef.current
      : (typeof document !== 'undefined' ? document.querySelector('video') : null);
    if (video && typeof video.pause === 'function') {
      if (video.paused || video.ended) {
        if (playerRef.current && typeof playerRef.current.play === 'function') {
          const res = playerRef.current.play();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } else if (typeof video.play === 'function') {
          const res = video.play();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        }
        setIsPlaying(true);
      } else {
        if (playerRef.current && typeof playerRef.current.pause === 'function') {
          const res = playerRef.current.pause();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } else {
          video.pause();
        }
        setIsPlaying(false);
      }
      return;
    }

    if (playerRef.current && typeof playerRef.current.getPaused === 'function') {
      playerRef.current.getPaused().then(paused => {
        if (paused) {
          playerRef.current.play().catch(() => {});
          setIsPlaying(true);
        } else {
          playerRef.current.pause().catch(() => {});
          setIsPlaying(false);
        }
      }).catch(() => {
        playerRef.current.pause().catch(() => {});
        setIsPlaying(false);
      });
      return;
    }

    const iframe = iframeRef?.current?.tagName === 'IFRAME' ? iframeRef.current : document.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
      const msg = isPlaying ? '{"method":"pause"}' : '{"method":"play"}';
      iframe.contentWindow.postMessage(msg, '*');
      setIsPlaying(prev => !prev);
    }
  }, [isPlaying, iframeRef]);

  const handlePauseVideo = useCallback(() => {
    if (playerRef.current && typeof playerRef.current.pause === 'function') {
      playerRef.current.pause().catch(() => {});
      setIsPlaying(false);
      return;
    }
    const video = iframeRef?.current || document.querySelector('video');
    if (video && typeof video.pause === 'function') {
      video.pause();
      setIsPlaying(false);
      return;
    }
    const iframe = iframeRef?.current?.tagName === 'IFRAME' ? iframeRef.current : document.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage('{"method":"pause"}', '*');
      setIsPlaying(false);
    }
  }, [iframeRef]);

  // Jump to specific timestamp when cue or citation is clicked
  const handleCueClick = (timestampStr) => {
    const secs = parseTimestampToSeconds(timestampStr);
    const cues = activeData?.cues || [];
    const clickedIdx = cues.findIndex(c => c.time === timestampStr);
    const targetIdx = clickedIdx !== -1 ? clickedIdx : 0;
    setActiveCueIdx(targetIdx);
    activeCueIdxRef.current = targetIdx;
    currentSecRef.current = secs;
    targetResumeSecRef.current = secs;
    if (playerRef.current) {
      playerRef.current.setCurrentTime(secs).catch(err => console.log("Seek error:", err));
      playerRef.current.play().catch(err => console.log("Autoplay blocked:", err));
    } else if (iframeRef.current && iframeRef.current.tagName === 'VIDEO') {
      try {
        iframeRef.current.__pendingResumeSec = secs;
        iframeRef.current.currentTime = secs;
        if (typeof CustomEvent === 'function') {
          iframeRef.current.dispatchEvent(new CustomEvent('lecturescribe:seek', { detail: { seconds: secs } }));
        }
        if (typeof iframeRef.current.play === 'function') {
          iframeRef.current.play().catch(() => {});
        }
      } catch (_) {}
    }

    // Persist progress immediately on manual cue click
    if (activeData?.videoId) {
      try {
        const dur = durationRef.current || 0;
        const p = fetch(`${API_BASE}/api/progress/lecture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            video_id: activeData.videoId,
            user_email: effectiveUserEmail || 'anonymous',
            last_timestamp: timestampStr,
            last_seconds: secs,
            duration_seconds: dur,
            active_cue_idx: targetIdx
          })
        });
        if (p && typeof p.catch === 'function') {
          p.catch(e => console.warn("Could not save progress on cue click:", e));
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lecturescribe:progressupdated', {
            detail: {
              video_id: activeData.videoId,
              progress: {
                last_timestamp: timestampStr,
                last_seconds: secs,
                duration_seconds: dur,
                active_cue_idx: targetIdx
              }
            }
          }));
        }
      } catch (e) {
        console.warn("Could not save progress on cue click:", e);
      }
    }
  };

  const handleCopyTranscript = () => {
    if (!activeData) return;
    let md = `# ${activeData.title}\nSource: ${activeData.sourceUrl}\n\n`;
    (activeData.cues || []).forEach(c => {
      md += `**[${c.time}]** ${c.text}\n\n`;
    });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayCues = useMemo(() => {
    if (searchQuery.trim()) {
      if (searchResults.length > 0) {
        return searchResults.map(h => {
          const highlightHtml =
            h._highlightResult?.text?.value ||
            h._highlight_result?.text?.value ||
            h.highlightResult?.text?.value ||
            h.highlightHtml ||
            null;

          return {
            time: h.timestamp || h.time || '00:00',
            text: h.text,
            highlightHtml
          };
        });
      }
      return [];
    }
    return activeData?.cues || [];
  }, [searchQuery, searchResults, activeData]);

  // When search query is active, resolve the active cue index relative to displayCues
  const effectiveActiveCueIdx = useMemo(() => {
    if (!searchQuery.trim()) return activeCueIdx;
    const currentActiveCue = activeData?.cues?.[activeCueIdx];
    if (!currentActiveCue) return -1;
    return displayCues.findIndex(c => c.time === currentActiveCue.time);
  }, [searchQuery, activeCueIdx, activeData, displayCues]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searchAvailable,
    searchError,
    activeCueIdx: effectiveActiveCueIdx,
    copied,
    iframeRef,
    playerRef,
    displayCues,
    handleCueClick,
    handleCopyTranscript,
    isPlaying,
    handleTogglePlayPause,
    handlePauseVideo
  };
}
