import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Copy, Check, ChevronDown, ChevronUp, Volume2, X } from 'lucide-react';

export default function TranscriptSearch({
  displayCues = [],
  searchQuery,
  setSearchQuery,
  handleCueClick,
  activeCueIdx,
  copied = false,
  handleCopyTranscript,
  transcriptAvailable = true
}) {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(displayCues.length > 6);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollContainerRef = useRef(null);
  const transcriptStartRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const cueRefs = useRef([]);
  const prevActiveCueRef = useRef(activeCueIdx);

  // Auto-scroll active cue into center view as video plays (Webex style)
  useEffect(() => {
    if (!autoScroll) return;
    if (activeCueIdx >= 0 && cueRefs.current[activeCueIdx] && scrollContainerRef.current) {
      const activeEl = cueRefs.current[activeCueIdx];
      const container = scrollContainerRef.current;
      const isJump = Math.abs(activeCueIdx - (prevActiveCueRef.current ?? activeCueIdx)) > 1;
      const scrollBehavior = isJump ? 'auto' : 'smooth';
      prevActiveCueRef.current = activeCueIdx;

      // Calculate relative offset within the scrollable container so parent window never scrolls
      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: scrollBehavior
        });
      } else {
        container.scrollTop = Math.max(0, targetTop);
      }
      if (typeof activeEl?.scrollIntoView === 'function') {
        activeEl.scrollIntoView({
          behavior: scrollBehavior,
          block: 'center'
        });
      }
    }
  }, [activeCueIdx, autoScroll]);

  const onCueClick = (cueTime, idx) => {
    setAutoScroll(true);
    handleCueClick(cueTime);
    if (cueRefs.current[idx] && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const targetTop = cueRefs.current[idx].offsetTop - (container.clientHeight / 2) + (cueRefs.current[idx].clientHeight / 2);
      try {
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      } catch {
        container.scrollTop = Math.max(0, targetTop);
      }
    }
  };

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      setShowScrollTop(el.scrollTop > 60);
      const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
      setShowScrollBottom(isUp);
    }
  }, []);

  const handleScroll = (e) => {
    const el = e.currentTarget;
    setShowScrollTop(el.scrollTop > 60);
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
    setShowScrollBottom(isUp);
  };

  useEffect(() => {
    checkScroll();
  }, [displayCues, checkScroll]);

  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      if (typeof scrollContainerRef.current.scrollTo === 'function') {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
    if (typeof transcriptStartRef.current?.scrollIntoView === 'function') {
      transcriptStartRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      if (typeof scrollContainerRef.current.scrollTo === 'function') {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      } else {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }
    if (typeof transcriptEndRef.current?.scrollIntoView === 'function') {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      background: 'var(--panel-bg)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: '100%',
      overflow: 'hidden',
      position: 'relative'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        flex: 1
      }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Search size={15} color="var(--theme-primary)" /> Instant Transcript Search
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setAutoScroll(prev => !prev)}
                title={autoScroll ? "Auto-scroll enabled (click to pause)" : "Auto-scroll paused (click to resume)"}
                aria-label={autoScroll ? "Pause auto-scroll sync" : "Resume auto-scroll sync"}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: autoScroll ? 'rgba(0, 117, 237, 0.1)' : 'var(--card-bg)',
                  color: autoScroll ? 'var(--theme-primary)' : 'var(--text-secondary)',
                  border: autoScroll ? '1px solid rgba(0, 117, 237, 0.35)' : '1px solid var(--border-color)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: autoScroll ? '#10b981' : '#9ca3af',
                  boxShadow: autoScroll ? '0 0 6px #10b981' : 'none'
                }} />
                <span>Sync {autoScroll ? 'ON' : 'OFF'}</span>
              </button>

              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Showing {displayCues.length} hits</span>
              {displayCues.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <button
                    onClick={scrollToTop}
                    title="Move to start of transcript"
                    aria-label="Move to start of transcript"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--theme-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <span>Start</span>
                    <ChevronUp size={13} />
                  </button>
                  <button
                    onClick={scrollToBottom}
                    title="Move to end of transcript"
                    aria-label="Move to end of transcript"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--theme-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <span>End</span>
                    <ChevronDown size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                placeholder={transcriptAvailable ? 'Search transcript by keywords or topics...' : 'Transcript unavailable'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={!transcriptAvailable}
                style={{
                  width: '100%',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  padding: searchQuery ? '7px 32px 7px 32px' : '7px 12px 7px 32px',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.84rem',
                  outline: 'none'
                }}
              />
              {Boolean(searchQuery) && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear transcript search"
                  title="Clear search"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    padding: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.background = 'rgba(100, 116, 139, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {handleCopyTranscript && (
              <button
                onClick={handleCopyTranscript}
                disabled={!transcriptAvailable}
                title="Copy entire lecture transcript to clipboard"
                aria-label="Copy Transcript"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  background: 'var(--card-bg)',
                  color: copied ? 'var(--theme-primary)' : 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  padding: '7px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s ease',
                  flexShrink: 0
                }}
              >
                {copied ? <Check size={14} color="var(--theme-primary)" /> : <Copy size={14} />}
                <span>{copied ? 'Copied Transcript!' : 'Copy Transcript'}</span>
              </button>
            )}
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '6px 10px',
            position: 'relative',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y'
          }}
        >
          <div ref={transcriptStartRef} />
          {!transcriptAvailable ? (
            <div
              role="status"
              style={{
                margin: '24px auto',
                maxWidth: '520px',
                padding: '14px 16px',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                borderRadius: '8px',
                background: 'rgba(234, 179, 8, 0.08)',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
                lineHeight: 1.5
              }}
            >
              This video was imported, but no transcript or captions are available. Transcript search requires transcript text.
            </div>
          ) : displayCues.map((cue, idx) => {
            const isActive = activeCueIdx === idx;
            return (
              <div
                key={idx}
                ref={(el) => { cueRefs.current[idx] = el; }}
                onClick={() => onCueClick(cue.time, idx)}
                className={`transcript-cue-row ${isActive ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  backgroundColor: isActive ? 'var(--highlight-bg)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--theme-primary)' : '3px solid transparent',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  minWidth: '58px',
                  flexShrink: 0
                }}>
                  {isActive && (
                    <Volume2
                      size={12}
                      color="var(--theme-primary)"
                      className="active-speaker-icon"
                      aria-label="Current playback cue"
                    />
                  )}
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: '0.76rem',
                    color: isActive ? 'var(--theme-primary)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3
                  }}>[{cue.time}]</span>
                </div>
                
                {cue.highlightHtml ? (
                  <span
                    className="transcript-cue"
                    style={{
                      fontSize: '0.84rem',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                      lineHeight: 1.3
                    }}
                    dangerouslySetInnerHTML={{ __html: cue.highlightHtml }}
                  />
                ) : (
                  <span
                    className="transcript-cue"
                    style={{
                      fontSize: '0.84rem',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                      lineHeight: 1.3
                    }}
                  >{cue.text}</span>
                )}
              </div>
            );
          })}
          <div ref={transcriptEndRef} />
        </div>

        {/* Floating Scroll Controls */}
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '20px',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          {showScrollTop && (
            <button
              onClick={scrollToTop}
              title="Move to start of transcript"
              aria-label="Move to start of transcript"
              style={{
                background: 'var(--card-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '20px',
                padding: '5px 12px',
                fontSize: '0.76rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-primary)';
                e.currentTarget.style.color = 'var(--theme-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
            >
              <span>Start</span>
              <ChevronUp size={14} color="var(--theme-primary)" />
            </button>
          )}

          {showScrollBottom && (
            <button
              onClick={scrollToBottom}
              title="Move to end of transcript"
              aria-label="Move to end of transcript"
              style={{
                background: 'var(--card-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '20px',
                padding: '5px 12px',
                fontSize: '0.76rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-primary)';
                e.currentTarget.style.color = 'var(--theme-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
            >
              <span>End</span>
              <ChevronDown size={14} color="var(--theme-primary)" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
