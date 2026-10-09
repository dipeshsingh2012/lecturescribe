import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Volume2,
  X,
  Edit2,
  Sparkles,
  BookOpen,
  MessageSquare,
  LocateFixed
} from 'lucide-react';
import katex from 'katex';
import { API_BASE } from '../../utils/constants';
import TranscriptReviewDrawer from './TranscriptReviewDrawer';
import TranscriptAnnotationsDrawer from './TranscriptAnnotationsDrawer';
import TextSelectionToolbar from './TextSelectionToolbar';

export default function TranscriptSearch({
  displayCues = [],
  searchQuery,
  setSearchQuery,
  handleCueClick,
  activeCueIdx,
  copied = false,
  handleCopyTranscript,
  transcriptAvailable = true,
  activeData = null,
  setActiveData = null,
  summaryHook = null,
  googleUser = null
}) {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(displayCues.length > 6);
  const [autoScroll, setAutoScroll] = useState(true);

  // Manual Cue Editing state
  const [editingCueIdx, setEditingCueIdx] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [isSavingCue, setIsSavingCue] = useState(false);
  const [hoveredCueIdx, setHoveredCueIdx] = useState(null);

  // Drawers and Annotations state
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);
  const [showAnnotationsDrawer, setShowAnnotationsDrawer] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [reviewJob, setReviewJob] = useState(null);
  const [annotations, setAnnotations] = useState([]);

  // Floating Selection Toolbar state
  const [selectionToolbar, setSelectionToolbar] = useState(null);

  const scrollContainerRef = useRef(null);
  const transcriptStartRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const cueRefs = useRef([]);
  const prevActiveCueRef = useRef(activeCueIdx);
  const pollIntervalRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  const videoId = activeData?.videoId;

  // Cleanup polling and scroll timers on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Fetch initial review status and annotations when videoId changes
  useEffect(() => {
    if (!videoId) return;

    fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/review/status`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setReviewJob(data.job || null);
          setSuggestions(data.suggestions || []);
          if (data.job?.status === 'running') {
            setReviewLoading(true);
            startPollingReview(videoId);
          }
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.annotations) {
          setAnnotations(data.annotations);
        }
      })
      .catch(() => {});
  }, [videoId]);

  const startPollingReview = (vid) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(vid)}/review/status`);
        if (res.ok) {
          const data = await res.json();
          setReviewJob(data.job || null);
          setSuggestions(data.suggestions || []);
          if (data.job?.status === 'completed' || data.job?.status === 'failed') {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setReviewLoading(false);
            if (data.job.status === 'failed') {
              setReviewError(data.job.error_message || 'Review failed');
            }
          }
        }
      } catch {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setReviewLoading(false);
      }
    }, 2000);
  };

  const handleTriggerReview = async () => {
    if (!videoId) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/review`, {
        method: 'POST'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to start AI review');
      }
      const data = await res.json();
      setReviewJob(data.job);
      startPollingReview(videoId);
    } catch (err) {
      setReviewError(err.message);
      setReviewLoading(false);
    }
  };

  // Auto-scroll active cue into center view as video plays (Webex style)
  useEffect(() => {
    if (!autoScroll) return;
    if (activeCueIdx >= 0 && cueRefs.current[activeCueIdx] && scrollContainerRef.current) {
      const activeEl = cueRefs.current[activeCueIdx];
      const container = scrollContainerRef.current;
      const isJump = Math.abs(activeCueIdx - (prevActiveCueRef.current ?? activeCueIdx)) > 1;
      const scrollBehavior = isJump ? 'auto' : 'smooth';
      prevActiveCueRef.current = activeCueIdx;

      isProgrammaticScrollRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

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

      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 450);
    }
  }, [activeCueIdx, autoScroll]);

  const handleRecenter = useCallback(() => {
    setAutoScroll(true);
    if (activeCueIdx >= 0 && cueRefs.current[activeCueIdx] && scrollContainerRef.current) {
      const activeEl = cueRefs.current[activeCueIdx];
      const container = scrollContainerRef.current;
      isProgrammaticScrollRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      } else {
        container.scrollTop = Math.max(0, targetTop);
      }
      if (typeof activeEl?.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    }
  }, [activeCueIdx]);

  const onCueClick = (cueTime, idx) => {
    // If user is selecting text to annotate or highlight, do not seek player
    if (typeof window !== 'undefined') {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return;
      }
    }

    setAutoScroll(true);
    handleCueClick(cueTime);
    if (cueRefs.current[idx] && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      isProgrammaticScrollRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      const targetTop = cueRefs.current[idx].offsetTop - (container.clientHeight / 2) + (cueRefs.current[idx].clientHeight / 2);
      try {
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      } catch {
        container.scrollTop = Math.max(0, targetTop);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
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

    // If user scrolled manually away from center while autoScroll was active, pause auto-scroll
    if (!isProgrammaticScrollRef.current && autoScroll && activeCueIdx >= 0 && cueRefs.current[activeCueIdx]) {
      const activeEl = cueRefs.current[activeCueIdx];
      const targetTop = activeEl.offsetTop - (el.clientHeight / 2) + (activeEl.clientHeight / 2);
      if (Math.abs(el.scrollTop - targetTop) > 60) {
        setAutoScroll(false);
      }
    }
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

  // Manual Cue Edit Handler
  const startEditingCue = (idx, cue, e) => {
    if (e) e.stopPropagation();
    setEditingCueIdx(idx);
    setEditingText(cue.text || '');
  };

  const cancelEditingCue = (e) => {
    if (e) e.stopPropagation();
    setEditingCueIdx(null);
    setEditingText('');
  };

  const saveEditingCue = async (idx, cue, e) => {
    if (e) e.stopPropagation();
    const newText = editingText.trim();
    if (!newText || newText === cue.text) {
      setEditingCueIdx(null);
      return;
    }

    const cueId = cue.id ?? idx;
    setIsSavingCue(true);

    // Update in activeData optimistically
    if (typeof setActiveData === 'function') {
      setActiveData(prev => {
        if (!prev) return prev;
        const updateCues = (list) => {
          if (!Array.isArray(list)) return list;
          return list.map((c, i) => {
            if ((c.id !== undefined && c.id === cueId) || i === idx) {
              return { ...c, text: newText };
            }
            return c;
          });
        };
        return {
          ...prev,
          cues: updateCues(prev.cues),
          processed_cues: updateCues(prev.processed_cues)
        };
      });
    }

    // Mark summary outdated immediately
    if (summaryHook?.markOutdated) {
      summaryHook.markOutdated();
    }
    if (summaryHook?.setIsOutdated) {
      summaryHook.setIsOutdated(true);
    }

    try {
      if (videoId) {
        try {
          await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/cues/${cueId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
          });
        } catch (fetchErr) {
          console.warn('Network error saving cue to backend, applying locally:', fetchErr);
        }
      }
    } catch (err) {
      console.error('Failed to save cue edit:', err);
    } finally {
      setIsSavingCue(false);
      setEditingCueIdx(null);
    }
  };

  // AI Review Suggestion Handlers
  const handleAcceptSuggestion = (suggestion) => {
    setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, status: 'accepted' } : s));
    const newText = suggestion.suggestedText;
    const cueId = suggestion.cueId;

    if (typeof setActiveData === 'function') {
      setActiveData(prev => {
        if (!prev) return prev;
        const updateCues = (list) => {
          if (!Array.isArray(list)) return list;
          return list.map((c, i) => {
            if ((c.id !== undefined && c.id === cueId) || i === cueId) {
              return { ...c, text: newText };
            }
            return c;
          });
        };
        return {
          ...prev,
          cues: updateCues(prev.cues),
          processed_cues: updateCues(prev.processed_cues)
        };
      });
    }

    if (summaryHook?.markOutdated) {
      summaryHook.markOutdated();
    }
  };

  const handleRejectSuggestion = (suggestion) => {
    setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, status: 'rejected' } : s));
  };

  const handleUndoSuggestion = (suggestion) => {
    setSuggestions(prev => prev.map(s => s.id === suggestion.id ? { ...s, status: 'pending' } : s));
    const originalText = suggestion.originalText;
    const cueId = suggestion.cueId;

    if (typeof setActiveData === 'function') {
      setActiveData(prev => {
        if (!prev) return prev;
        const updateCues = (list) => {
          if (!Array.isArray(list)) return list;
          return list.map((c, i) => {
            if ((c.id !== undefined && c.id === cueId) || i === cueId) {
              return { ...c, text: originalText };
            }
            return c;
          });
        };
        return {
          ...prev,
          cues: updateCues(prev.cues),
          processed_cues: updateCues(prev.processed_cues)
        };
      });
    }
  };

  // Text Selection Toolbar Handling
  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (text.length < 2) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = scrollContainerRef.current?.getBoundingClientRect();

      let targetCue = null;
      let targetCueIdx = null;
      let node = selection.anchorNode;
      while (node && node !== scrollContainerRef.current) {
        if (node.getAttribute && node.getAttribute('data-cue-idx') !== null) {
          targetCueIdx = parseInt(node.getAttribute('data-cue-idx'), 10);
          targetCue = displayCues[targetCueIdx];
          break;
        }
        node = node.parentNode;
      }

      if (containerRect) {
        setSelectionToolbar({
          position: {
            x: rect.left + rect.width / 2,
            y: rect.top,
            top: Math.max(10, rect.top - containerRect.top - 46),
            left: Math.max(10, Math.min(rect.left - containerRect.left, containerRect.width - 290))
          },
          selectedText: text,
          cueId: targetCue?.id ?? targetCueIdx,
          startSeconds: targetCue?.seconds || 0,
          endSeconds: (targetCue?.seconds || 0) + 5
        });
      }
    } catch {
      // Ignore selection errors
    }
  };

  const handleContainerMouseDown = (e) => {
    if (selectionToolbar && !e.target.closest?.('.text-selection-toolbar')) {
      setSelectionToolbar(null);
    }
  };

  // Helper to render mathematical formulas via KaTeX inside cue strings
  const renderMathText = (text, isActive) => {
    if (!text || typeof text !== 'string') return text;
    if (!text.includes('$')) {
      return text;
    }

    const parts = [];
    const regex = /\$([^\$]+)\$/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const formula = match[1];
      try {
        const rendered = katex.renderToString(formula, { throwOnError: false });
        parts.push(
          <span
            key={`katex-${match.index}`}
            className="cue-math-expression"
            style={{
              padding: '0 2px',
              color: isActive ? 'var(--theme-primary)' : 'inherit',
              fontWeight: 600
            }}
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        );
      } catch {
        parts.push(`$${formula}$`);
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  // Helper to render annotated text (highlights, comments/notes, and AI explanations)
  const renderAnnotatedCue = (cueText, cueAnnotations, isActive) => {
    if (!cueText || typeof cueText !== 'string') return cueText;
    if (!cueAnnotations || cueAnnotations.length === 0) {
      return renderMathText(cueText, isActive);
    }

    // Find occurrences of all annotations in this cue text
    const matches = [];
    cueAnnotations.forEach((ann, aIdx) => {
      const searchStr = (ann.selected_text || '').trim();
      if (!searchStr) return;

      const lowerText = cueText.toLowerCase();
      const lowerSearch = searchStr.toLowerCase();
      let startPos = 0;

      while ((startPos = lowerText.indexOf(lowerSearch, startPos)) !== -1) {
        matches.push({
          start: startPos,
          end: startPos + searchStr.length,
          annotation: ann,
          id: ann.id || `ann-${aIdx}`
        });
        startPos += searchStr.length;
      }
    });

    if (matches.length === 0) {
      return renderMathText(cueText, isActive);
    }

    // Sort by start position, then by length descending
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Filter out overlapping matches
    const nonOverlapping = [];
    let currentEnd = 0;
    for (const m of matches) {
      if (m.start >= currentEnd) {
        nonOverlapping.push(m);
        currentEnd = m.end;
      }
    }

    // Slice cueText into fragments
    const fragments = [];
    let lastIdx = 0;

    nonOverlapping.forEach((m, i) => {
      if (m.start > lastIdx) {
        fragments.push(
          <span key={`plain-${lastIdx}`}>
            {renderMathText(cueText.slice(lastIdx, m.start), isActive)}
          </span>
        );
      }

      const snippet = cueText.slice(m.start, m.end);
      const ann = m.annotation;
      const isNote = ann.annotation_type === 'note';
      const isAi = ann.annotation_type === 'ai_explanation';

      let bg = 'rgba(254, 240, 138, 0.45)'; // default yellow
      let borderBottom = '2px solid #eab308';

      if (ann.color === 'green') {
        bg = 'rgba(187, 247, 208, 0.55)';
        borderBottom = '2px solid #22c55e';
      } else if (ann.color === 'blue') {
        bg = 'rgba(191, 219, 254, 0.55)';
        borderBottom = '2px solid #3b82f6';
      } else if (ann.color === 'pink') {
        bg = 'rgba(251, 207, 232, 0.55)';
        borderBottom = '2px solid #ec4899';
      } else if (isNote) {
        bg = 'rgba(59, 130, 246, 0.15)';
        borderBottom = '2px dotted #3b82f6';
      } else if (isAi) {
        bg = 'rgba(168, 85, 247, 0.15)';
        borderBottom = '2px dashed #a855f7';
      }

      fragments.push(
        <mark
          key={`highlight-${m.id}-${i}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowAnnotationsDrawer(true);
          }}
          title={
            isNote
              ? `Note: "${ann.note_text || ''}" (Click to view)`
              : isAi
              ? `AI Explanation: "${ann.ai_response?.slice(0, 100) || ''}"`
              : `Highlight (${ann.color || 'yellow'}) - Click to view in Notes`
          }
          style={{
            backgroundColor: bg,
            borderBottom,
            borderRadius: '3px',
            padding: '1px 2px',
            cursor: 'pointer',
            color: 'inherit',
            transition: 'background-color 0.15s ease'
          }}
        >
          {renderMathText(snippet, isActive)}
        </mark>
      );

      lastIdx = m.end;
    });

    if (lastIdx < cueText.length) {
      fragments.push(
        <span key={`plain-${lastIdx}`}>
          {renderMathText(cueText.slice(lastIdx), isActive)}
        </span>
      );
    }

    return fragments;
  };

  // Render cue content (highlights or math or text)
  const renderCueContent = (cue, idx, isActive) => {
    const cueAnnotations = (annotations || []).filter(a => {
      if (a.cue_id !== undefined && (a.cue_id === cue.id || a.cue_id === idx)) return true;
      if (a.selected_text && cue.text && cue.text.toLowerCase().includes(a.selected_text.toLowerCase())) return true;
      return false;
    });

    if (cue.highlightHtml && !cue.highlightHtml.includes('$') && cueAnnotations.length === 0) {
      return (
        <span
          className="transcript-cue"
          style={{
            fontSize: '0.84rem',
            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: isActive ? 600 : 400,
            lineHeight: 1.35
          }}
          dangerouslySetInnerHTML={{ __html: cue.highlightHtml }}
        />
      );
    }

    return (
      <span
        className="transcript-cue"
        style={{
          fontSize: '0.84rem',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 600 : 400,
          lineHeight: 1.35
        }}
      >
        {renderAnnotatedCue(cue.text, cueAnnotations, isActive)}
      </span>
    );
  };

  const pendingCount = suggestions.filter(s => s.status === 'pending').length;

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
              {/* Review Drawer Button */}
              {videoId && (
                <button
                  onClick={() => setShowReviewDrawer(true)}
                  title="Open AI Review & Corrections"
                  aria-label="AI Transcript Review"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: pendingCount > 0 ? 'rgba(99, 102, 241, 0.12)' : 'var(--card-bg)',
                    color: pendingCount > 0 ? 'var(--theme-primary)' : 'var(--text-secondary)',
                    border: pendingCount > 0 ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid var(--border-color)',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Sparkles size={12} color="var(--theme-primary)" />
                  <span>Review</span>
                  {pendingCount > 0 && (
                    <span style={{
                      background: 'var(--theme-primary)',
                      color: '#fff',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '0 5px',
                      borderRadius: '10px',
                      marginLeft: '2px'
                    }}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}

              {/* Notes & Highlights Drawer Button */}
              {videoId && (
                <button
                  onClick={() => setShowAnnotationsDrawer(true)}
                  title="View Notes & Highlights"
                  aria-label="Notes and Highlights"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: annotations.length > 0 ? 'rgba(234, 179, 8, 0.12)' : 'var(--card-bg)',
                    color: annotations.length > 0 ? '#b45309' : 'var(--text-secondary)',
                    border: annotations.length > 0 ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid var(--border-color)',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <BookOpen size={12} color={annotations.length > 0 ? '#b45309' : 'var(--text-secondary)'} />
                  <span>Notes</span>
                  {annotations.length > 0 && (
                    <span style={{
                      background: '#f59e0b',
                      color: '#fff',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '0 5px',
                      borderRadius: '10px',
                      marginLeft: '2px'
                    }}>
                      {annotations.length}
                    </span>
                  )}
                </button>
              )}

              {/* Auto Scroll Sync Button */}
              <button
                onClick={() => {
                  if (!autoScroll) {
                    handleRecenter();
                  } else {
                    setAutoScroll(false);
                  }
                }}
                title={autoScroll ? "Auto-scroll enabled (click to pause)" : "Auto-scroll paused (click to resume & re-center)"}
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
          onWheel={() => {
            if (autoScroll) setAutoScroll(false);
          }}
          onTouchMove={() => {
            if (autoScroll) setAutoScroll(false);
          }}
          onMouseUp={handleMouseUp}
          onMouseDown={handleContainerMouseDown}
          tabIndex={0}
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
            const isEditing = editingCueIdx === idx;
            const isHovered = hoveredCueIdx === idx;

            return (
              <div
                key={idx}
                ref={(el) => { cueRefs.current[idx] = el; }}
                onClick={() => !isEditing && onCueClick(cue.time, idx)}
                onMouseEnter={() => setHoveredCueIdx(idx)}
                onMouseLeave={() => setHoveredCueIdx(null)}
                data-cue-idx={idx}
                className={`transcript-cue-row ${isActive ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: isEditing ? 'center' : 'flex-start',
                  gap: '8px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: isEditing ? 'default' : 'pointer',
                  marginBottom: '2px',
                  backgroundColor: isActive ? 'var(--highlight-bg)' : isHovered ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--theme-primary)' : '3px solid transparent',
                  transition: 'background-color 0.15s ease',
                  position: 'relative'
                }}
              >
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  minWidth: '58px',
                  flexShrink: 0,
                  marginTop: isEditing ? 0 : '1px'
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

                {isEditing ? (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '4px' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditingCue(idx, cue, e);
                          if (e.key === 'Escape') cancelEditingCue(e);
                        }}
                        autoFocus
                        aria-label={`Edit cue at ${cue.time}`}
                        style={{
                          flex: 1,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--theme-primary)',
                          color: 'var(--text-primary)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '0.84rem',
                          outline: 'none'
                        }}
                      />
                      <button
                        onClick={(e) => saveEditingCue(idx, cue, e)}
                        disabled={isSavingCue}
                        aria-label="Save cue"
                        title="Save changes (Enter)"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          background: 'var(--theme-primary)',
                          color: '#fff',
                          border: 'none',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: isSavingCue ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <Check size={12} /> Save
                      </button>
                      <button
                        onClick={cancelEditingCue}
                        aria-label="Cancel editing"
                        title="Cancel (Esc)"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 6px',
                          borderRadius: '4px',
                          background: 'transparent',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.72rem',
                          cursor: 'pointer'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {editingText.includes('$') && (
                      <div
                        data-testid="katex-edit-preview"
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                          background: 'rgba(0, 117, 237, 0.05)',
                          border: '1px dashed rgba(0, 117, 237, 0.35)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--theme-primary)' }}>Preview:</span>
                        <div style={{ color: 'var(--text-primary)' }}>{renderMathText(editingText, false)}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      {renderCueContent(cue, idx, isActive)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      {/* Note / Comment indicator badge if present on this cue */}
                      {annotations.some(a => (a.cue_id === cue.id || a.cue_id === idx || (a.selected_text && cue.text?.toLowerCase().includes(a.selected_text.toLowerCase()))) && a.annotation_type === 'note') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAnnotationsDrawer(true);
                          }}
                          title="View comment for this cue"
                          aria-label="View cue comment"
                          style={{
                            background: 'rgba(59, 130, 246, 0.1)',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                            color: '#2563eb',
                            cursor: 'pointer',
                            padding: '1px 5px',
                            borderRadius: '10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '0.68rem',
                            fontWeight: 600
                          }}
                        >
                          <MessageSquare size={10} />
                          <span>Note</span>
                        </button>
                      )}

                      {/* AI Explanation badge if present on this cue */}
                      {annotations.some(a => (a.cue_id === cue.id || a.cue_id === idx || (a.selected_text && cue.text?.toLowerCase().includes(a.selected_text.toLowerCase()))) && a.annotation_type === 'ai_explanation') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAnnotationsDrawer(true);
                          }}
                          title="View AI explanation for this cue"
                          aria-label="View AI explanation"
                          style={{
                            background: 'rgba(168, 85, 247, 0.1)',
                            border: '1px solid rgba(168, 85, 247, 0.25)',
                            color: '#9333ea',
                            cursor: 'pointer',
                            padding: '1px 5px',
                            borderRadius: '10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '0.68rem',
                            fontWeight: 600
                          }}
                        >
                          <Sparkles size={10} />
                          <span>AI</span>
                        </button>
                      )}

                      {/* Inline edit button (visible on hover or active) */}
                      {(isHovered || isActive) && (
                        <button
                          onClick={(e) => startEditingCue(idx, cue, e)}
                          title="Edit cue text"
                          aria-label={`Edit cue ${idx}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            opacity: 0.7
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--theme-primary)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={transcriptEndRef} />

          {/* Floating Text Selection Toolbar */}
          {selectionToolbar && (
            <TextSelectionToolbar
              position={selectionToolbar.position}
              selectedText={selectionToolbar.selectedText}
              cueId={selectionToolbar.cueId}
              startSeconds={selectionToolbar.startSeconds}
              endSeconds={selectionToolbar.endSeconds}
              videoId={videoId}
              userEmail={googleUser?.email}
              onClose={() => setSelectionToolbar(null)}
              onAnnotationCreated={(newAnnotation) => {
                setAnnotations(prev => [newAnnotation, ...prev]);
                setSelectionToolbar(null);
              }}
            />
          )}
        </div>

        {/* Floating Map-style Re-center Button when user has scrolled away */}
        {!autoScroll && activeCueIdx >= 0 && displayCues[activeCueIdx] && (
          <button
            onClick={handleRecenter}
            data-testid="recenter-cue-btn"
            title={`Jump to current playback line [${displayCues[activeCueIdx].time}]`}
            aria-label={`Re-center to playing cue at ${displayCues[activeCueIdx].time}`}
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 25,
              background: 'var(--card-bg, #ffffff)',
              color: 'var(--theme-primary, #0075ed)',
              border: '1.5px solid var(--theme-primary, #0075ed)',
              borderRadius: '24px',
              padding: '6px 14px',
              fontSize: '0.78rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 4px 16px rgba(0, 117, 237, 0.25), 0 2px 6px rgba(0,0,0,0.12)',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              backdropFilter: 'blur(8px)',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateX(-50%) scale(1.04)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 117, 237, 0.35), 0 2px 8px rgba(0,0,0,0.16)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 117, 237, 0.25), 0 2px 6px rgba(0,0,0,0.12)';
            }}
          >
            <LocateFixed size={14} />
            <span>Re-center [{displayCues[activeCueIdx].time}]</span>
          </button>
        )}

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

        {/* AI Transcript Review Drawer */}
        <TranscriptReviewDrawer
          open={showReviewDrawer}
          onClose={() => setShowReviewDrawer(false)}
          videoId={videoId}
          suggestions={suggestions}
          reviewLoading={reviewLoading}
          reviewError={reviewError}
          reviewJob={reviewJob}
          onAcceptSuggestion={handleAcceptSuggestion}
          onRejectSuggestion={handleRejectSuggestion}
          onUndoSuggestion={handleUndoSuggestion}
          handleCueClick={handleCueClick}
          onTriggerReview={handleTriggerReview}
        />

        {/* Annotations & Notes Drawer */}
        <TranscriptAnnotationsDrawer
          open={showAnnotationsDrawer}
          onClose={() => setShowAnnotationsDrawer(false)}
          videoId={videoId}
          annotations={annotations}
          onDeleteAnnotation={(deletedId) => {
            setAnnotations(prev => prev.filter(a => a.id !== deletedId));
          }}
          handleCueClick={handleCueClick}
        />
      </div>
    </div>
  );
}
