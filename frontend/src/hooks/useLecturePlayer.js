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
          setSearchResults(data.results || []);
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

        const onTimeUpdate = (data) => {
          const currentSec = data.seconds;
          const cues = activeData.cues || [];
          for (let i = cues.length - 1; i >= 0; i--) {
            const cueSec = parseTimestampToSeconds(cues[i].time);
            if (currentSec >= cueSec) {
              setActiveCueIdx(i);
              break;
            }
          }
        };

        player.on('timeupdate', onTimeUpdate);
        return () => {
          player.off('timeupdate', onTimeUpdate);
        };
      } catch (err) {
        console.warn("Vimeo Player SDK init warning:", err);
      }
    }
  }, [activeData]);

  // Jump to specific timestamp when cue or citation is clicked
  const handleCueClick = (timestampStr) => {
    const secs = parseTimestampToSeconds(timestampStr);
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
    if (searchQuery.trim() && searchResults.length > 0) {
      return searchResults.map(h => ({
        time: h.timestamp,
        text: h.text,
        highlightHtml: h._highlightResult?.text?.value
      }));
    }
    return activeData?.cues || [];
  }, [searchQuery, searchResults, activeData]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    activeCueIdx,
    copied,
    iframeRef,
    playerRef,
    displayCues,
    handleCueClick,
    handleCopyTranscript
  };
}
