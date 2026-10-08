import { useState, useRef, useEffect, useMemo } from 'react';
import Player from '@vimeo/player';
import { API_BASE } from '../utils/constants';
import { parseTimestampToSeconds, formatSecondsToTimestamp } from '../utils/formatters';

export function useLecturePlayer(activeData, userEmail = null) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeCueIdx, setActiveCueIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const lastSavedSecRef = useRef(0);
  const currentSecRef = useRef(0);
  const activeCueIdxRef = useRef(0);
  const durationRef = useRef(0);
  const saveDebounceTimerRef = useRef(null);

  // Instant Search Handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
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
          setSearchResults(data.hits || data.results || []);
        }
      } catch (err) {
        console.error("Search API Error:", err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, activeData]);

  // Connect Vimeo Player SDK to track current playhead timestamp and sync progress
  useEffect(() => {
    if (iframeRef.current && activeData) {
      try {
        if (!durationRef.current) {
          if (typeof activeData.duration === 'number' && activeData.duration > 0) {
            durationRef.current = activeData.duration;
          } else if (typeof activeData.duration === 'string') {
            const parsed = parseTimestampToSeconds(activeData.duration);
            if (parsed > 0) durationRef.current = parsed;
          } else if (activeData.cues && activeData.cues.length > 0) {
            const lastCue = activeData.cues[activeData.cues.length - 1];
            if (lastCue?.time) {
              const cueSec = parseTimestampToSeconds(lastCue.time);
              if (cueSec > 0) durationRef.current = cueSec;
            }
          }
        }

        const player = new Player(iframeRef.current);
        playerRef.current = player;

        const saveProgressToDb = async (sec, cueIdx) => {
          if (!activeData?.videoId) return;
          const safeSec = typeof sec === 'number' && !isNaN(sec) ? Math.max(0, sec) : currentSecRef.current;
          const safeIdx = typeof cueIdx === 'number' ? cueIdx : activeCueIdxRef.current;
          lastSavedSecRef.current = safeSec;

          const timestampStr = formatSecondsToTimestamp(safeSec);
          const dur = durationRef.current || 0;

          try {
            await fetch(`${API_BASE}/api/progress/lecture`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                video_id: activeData.videoId,
                user_email: userEmail || 'anonymous',
                last_timestamp: timestampStr,
                last_seconds: safeSec,
                duration_seconds: dur,
                active_cue_idx: safeIdx
              })
            });
          } catch (err) {
            console.warn("Failed to persist lecture progress:", err);
          }
        };

        const scheduleProgressSave = (sec, cueIdx) => {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
          }
          saveDebounceTimerRef.current = setTimeout(() => {
            saveProgressToDb(sec, cueIdx);
          }, 3000);
        };

        const updateCueFromSeconds = (currentSec) => {
          if (typeof currentSec !== 'number') return 0;
          const cues = activeData.cues || [];
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

        const handleTimeChange = (data) => {
          const sec = (data && typeof data.seconds === 'number') ? data.seconds : null;
          if (sec !== null) {
            currentSecRef.current = sec;
            const newCueIdx = updateCueFromSeconds(sec);
            if (Math.abs(sec - lastSavedSecRef.current) >= 5) {
              scheduleProgressSave(sec, newCueIdx);
            }
          } else if (player && typeof player.getCurrentTime === 'function') {
            player.getCurrentTime().then(updateCueFromSeconds).catch(() => {});
          }
        };

        const handlePauseOrSeeked = (data) => {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
          }
          const sec = (data && typeof data.seconds === 'number') ? data.seconds : currentSecRef.current;
          if (sec > 0) {
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
                  player.setCurrentTime(sec).catch(() => {});
                  updateCueFromSeconds(sec);
                  currentSecRef.current = sec;
                  restored = true;
                }
              }
            }

            // Silent auto-resume from database if not explicitly set via URL
            if (!restored && activeData?.videoId) {
              try {
                const emailParam = userEmail ? `&user_email=${encodeURIComponent(userEmail)}` : '';
                const res = await fetch(`${API_BASE}/api/progress/lecture?video_id=${encodeURIComponent(activeData.videoId)}${emailParam}`);
                if (res.ok) {
                  const resData = await res.json();
                  const prog = resData?.progress;
                  if (prog && typeof prog.last_seconds === 'number' && prog.last_seconds > 2) {
                    if (prog.duration_seconds && prog.duration_seconds > 0 && !durationRef.current) {
                      durationRef.current = prog.duration_seconds;
                    }
                    const dur = prog.duration_seconds || durationRef.current || 0;
                    const isCompleted = dur > 0 && (prog.last_seconds / dur) >= 0.98;
                    if (!isCompleted) {
                      await player.setCurrentTime(prog.last_seconds).catch(() => {});
                      if (typeof prog.active_cue_idx === 'number' && prog.active_cue_idx >= 0) {
                        setActiveCueIdx(prog.active_cue_idx);
                        activeCueIdxRef.current = prog.active_cue_idx;
                      } else {
                        updateCueFromSeconds(prog.last_seconds);
                      }
                      currentSecRef.current = prog.last_seconds;
                      lastSavedSecRef.current = prog.last_seconds;
                      restored = true;
                    }
                  }
                }
              } catch (err) {
                console.warn("Could not restore lecture progress from DB:", err);
              }
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
          if (activeData?.videoId && currentSecRef.current > 0) {
            saveProgressToDb(currentSecRef.current, activeCueIdxRef.current);
          }
          if (typeof player.off === 'function') {
            player.off('timeupdate', handleTimeChange);
            player.off('seeking', handleTimeChange);
            player.off('seeked', handlePauseOrSeeked);
            player.off('play', handleTimeChange);
            player.off('pause', handlePauseOrSeeked);
          }
        };
      } catch (err) {
        console.warn("Vimeo Player SDK init warning:", err);
      }
    }
  }, [activeData, userEmail]);

  // Jump to specific timestamp when cue or citation is clicked
  const handleCueClick = (timestampStr) => {
    const secs = parseTimestampToSeconds(timestampStr);
    const cues = activeData?.cues || [];
    const clickedIdx = cues.findIndex(c => c.time === timestampStr);
    const targetIdx = clickedIdx !== -1 ? clickedIdx : 0;
    setActiveCueIdx(targetIdx);
    activeCueIdxRef.current = targetIdx;
    currentSecRef.current = secs;
    if (playerRef.current) {
      playerRef.current.setCurrentTime(secs).catch(err => console.log("Seek error:", err));
      playerRef.current.play().catch(err => console.log("Autoplay blocked:", err));
    }

    // Persist progress immediately on manual cue click
    if (activeData?.videoId) {
      fetch(`${API_BASE}/api/progress/lecture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: activeData.videoId,
          user_email: userEmail || 'anonymous',
          last_timestamp: timestampStr,
          last_seconds: secs,
          duration_seconds: durationRef.current || 0,
          active_cue_idx: targetIdx
        })
      }).catch(e => console.warn("Could not save progress on cue click:", e));
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
          let highlightHtml =
            h._highlightResult?.text?.value ||
            h._highlight_result?.text?.value ||
            h.highlightResult?.text?.value ||
            h.highlightHtml ||
            null;

          // Fallback: If backend didn't supply highlight tags, highlight search terms in text directly
          if (!highlightHtml || !/<mark|<em/i.test(highlightHtml)) {
            const rawText = h.text || '';
            const words = searchQuery.trim().split(/\s+/).filter(Boolean);
            if (words.length > 0) {
              const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
              highlightHtml = rawText.replace(new RegExp(`(${pattern})`, 'gi'), "<mark class='algolia-highlight'>$1</mark>");
            }
          }

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
    activeCueIdx: effectiveActiveCueIdx,
    copied,
    iframeRef,
    playerRef,
    displayCues,
    handleCueClick,
    handleCopyTranscript
  };
}
