import { useState, useRef, useEffect, useMemo } from 'react';
import Player from '@vimeo/player';
import { API_BASE } from '../utils/constants';
import { parseTimestampToSeconds } from '../utils/formatters';

export function useLecturePlayer(activeData) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeCueIdx, setActiveCueIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const iframeRef = useRef(null);
  const playerRef = useRef(null);

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

  // Connect Vimeo Player SDK to track current playhead timestamp
  useEffect(() => {
    if (iframeRef.current && activeData) {
      try {
        const player = new Player(iframeRef.current);
        playerRef.current = player;

        const updateCueFromSeconds = (currentSec) => {
          if (typeof currentSec !== 'number') return;
          const cues = activeData.cues || [];
          if (!cues.length) return;
          let matchIdx = -1;
          for (let i = cues.length - 1; i >= 0; i--) {
            const cueSec = parseTimestampToSeconds(cues[i].time);
            if (currentSec >= cueSec) {
              matchIdx = i;
              break;
            }
          }
          if (matchIdx !== -1) {
            setActiveCueIdx(matchIdx);
          } else {
            setActiveCueIdx(0);
          }
        };

        const handleTimeChange = (data) => {
          if (data && typeof data.seconds === 'number') {
            updateCueFromSeconds(data.seconds);
          } else if (player && typeof player.getCurrentTime === 'function') {
            player.getCurrentTime().then(updateCueFromSeconds).catch(() => {});
          }
        };

        player.on('timeupdate', handleTimeChange);
        player.on('seeking', handleTimeChange);
        player.on('seeked', handleTimeChange);
        player.on('play', handleTimeChange);
        player.on('pause', handleTimeChange);

        if (typeof player.ready === 'function') {
          player.ready().then(() => {
            if (typeof window !== 'undefined') {
              const urlParams = new URLSearchParams(window.location.search);
              const tParam = urlParams.get('t') || (window.location.hash.startsWith('#t=') ? window.location.hash.slice(3) : null);
              if (tParam) {
                const sec = isNaN(tParam) ? parseTimestampToSeconds(tParam) : Number(tParam);
                if (sec > 0) {
                  player.setCurrentTime(sec).catch(() => {});
                  updateCueFromSeconds(sec);
                }
              }
            }
            if (typeof player.getCurrentTime === 'function') {
              player.getCurrentTime().then(updateCueFromSeconds).catch(() => {});
            }
          }).catch(() => {});
        }

        return () => {
          if (typeof player.off === 'function') {
            player.off('timeupdate', handleTimeChange);
            player.off('seeking', handleTimeChange);
            player.off('seeked', handleTimeChange);
            player.off('play', handleTimeChange);
            player.off('pause', handleTimeChange);
          }
        };
      } catch (err) {
        console.warn("Vimeo Player SDK init warning:", err);
      }
    }
  }, [activeData]);

  // Jump to specific timestamp when cue or citation is clicked
  const handleCueClick = (timestampStr) => {
    const secs = parseTimestampToSeconds(timestampStr);
    const cues = activeData?.cues || [];
    const clickedIdx = cues.findIndex(c => c.time === timestampStr);
    if (clickedIdx !== -1) {
      setActiveCueIdx(clickedIdx);
    }
    if (playerRef.current) {
      playerRef.current.setCurrentTime(secs).catch(err => console.log("Seek error:", err));
      playerRef.current.play().catch(err => console.log("Autoplay blocked:", err));
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
