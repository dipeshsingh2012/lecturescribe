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
  LocateFixed,
  AlertTriangle,
  Eraser,
  Play,
  Pause,
  Pencil,
  Bot
} from 'lucide-react';
import katex from 'katex';
import { API_BASE } from '../../utils/constants';
import TranscriptReviewDrawer from './TranscriptReviewDrawer';
import TranscriptAnnotationsDrawer from './TranscriptAnnotationsDrawer';
import TextSelectionToolbar from './TextSelectionToolbar';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

const parseTimeToSeconds = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
};

const isWordChar = (ch) => {
  if (!ch) return false;
  return /[\p{L}\p{N}_]/u.test(ch);
};

const checkWordBoundary = (fullText, startIdx, endIdx) => {
  const prevChar = startIdx > 0 ? fullText[startIdx - 1] : '';
  const nextChar = endIdx < fullText.length ? fullText[endIdx] : '';
  if (prevChar && isWordChar(prevChar)) return false;
  if (nextChar && isWordChar(nextChar)) return false;
  return true;
};

export default function TranscriptSearch({
  displayCues = [],
  searchQuery,
  setSearchQuery,
  searchAvailable = true,
  searchError = null,
  handleCueClick,
  activeCueIdx,
  copied = false,
  handleCopyTranscript,
  transcriptAvailable = true,
  activeData = null,
  setActiveData = null,
  summaryHook = null,
  googleUser = null,
  isPlaying = false,
  handleTogglePlayPause = null,
  handlePauseVideo = null,
  onDiscussInTutor = null
}) {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(displayCues.length > 6);
  const [autoScroll, setAutoScroll] = useState(true);
  const [localPlaying, setLocalPlaying] = useState(Boolean(isPlaying));

  useEffect(() => {
    setLocalPlaying(Boolean(isPlaying));
  }, [isPlaying]);

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
  const [predictedQuizzes, setPredictedQuizzes] = useState([]);

  // Floating Selection Toolbar state
  const [selectionToolbar, setSelectionToolbar] = useState(null);
  const [activeMarkAction, setActiveMarkAction] = useState(null); // { annotation, x, y, editing?: boolean }
  const [hoveredMark, setHoveredMark] = useState(null); // { annotation, x, y }
  const [editingMarkNoteText, setEditingMarkNoteText] = useState('');
  const [isSavingMarkNote, setIsSavingMarkNote] = useState(false);

  const scrollContainerRef = useRef(null);
  const transcriptStartRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const cueRefs = useRef([]);
  const prevActiveCueRef = useRef(activeCueIdx);
  const pollIntervalRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const justDismissedToolbarRef = useRef(false);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const hoverCloseTimeoutRef = useRef(null);

  const videoId = activeData?.videoId || activeData?.video_id || (typeof window !== 'undefined' ? window.location.pathname.match(/\/lecture\/([^/?#]+)/)?.[1] : null);

  const onToggleVideoPlayback = useCallback(() => {
    if (typeof handleTogglePlayPause === 'function') {
      handleTogglePlayPause();
      setLocalPlaying(prev => !prev);
      return;
    }
    const videoEl = typeof document !== 'undefined' ? document.querySelector('video') : null;
    if (videoEl && typeof videoEl.pause === 'function') {
      if (videoEl.paused || videoEl.ended) {
        videoEl.play().catch(() => {});
        setLocalPlaying(true);
      } else {
        videoEl.pause();
        setLocalPlaying(false);
      }
      return;
    }
    const iframeEl = typeof document !== 'undefined' ? document.querySelector('iframe') : null;
    if (iframeEl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage(localPlaying ? '{"method":"pause"}' : '{"method":"play"}', '*');
      setLocalPlaying(prev => !prev);
    }
  }, [handleTogglePlayPause, localPlaying]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (e.code !== 'Space' && e.key !== ' ') return;
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toUpperCase();
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        activeEl?.isContentEditable ||
        activeEl?.closest?.('.lecture-player-panel')
      ) {
        return;
      }
      e.preventDefault();
      onToggleVideoPlayback();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleVideoPlayback]);

  const handleUpdateAnnotation = async (annId, newNoteText, extraFields = {}) => {
    if (!annId) return;
    const trimmed = (newNoteText || '').trim();
    setIsSavingMarkNote(true);
    try {
      const updateData = {
        ...(trimmed ? { noteText: trimmed, note_text: trimmed } : {}),
        ...extraFields
      };
      if (extraFields.annotation_type) {
        updateData.annotationType = extraFields.annotation_type;
      }
      setAnnotations(prev => prev.map(a =>
        a.id === annId
          ? { ...a, ...updateData }
          : a
      ));
      if (activeMarkAction && activeMarkAction.annotation?.id === annId) {
        setActiveMarkAction(prev => prev ? {
          ...prev,
          editing: false,
          annotation: { ...prev.annotation, ...updateData }
        } : null);
      }
      if (hoveredMark && hoveredMark.annotation?.id === annId) {
        setHoveredMark(prev => prev ? {
          ...prev,
          editing: false,
          annotation: { ...prev.annotation, ...updateData }
        } : null);
      }
      if (videoId) {
        const patchBody = {
          ...(trimmed ? { note_text: trimmed } : {}),
          ...extraFields
        };
        await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${annId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
        });
      }
    } catch (err) {
      console.error('Error updating annotation:', err);
    } finally {
      setIsSavingMarkNote(false);
    }
  };

  const handleDeleteAnnotation = async (annId, allAnnotations = null) => {
    if (!videoId || !annId) return;
    try {
      const idsToDelete = (allAnnotations && allAnnotations.length > 0)
        ? allAnnotations.map(a => a.id).filter(Boolean)
        : [annId];

      for (const id of idsToDelete) {
        await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${id}`, {
          method: 'DELETE'
        });
      }
      setAnnotations(prev => prev.filter(a => !idsToDelete.includes(a.id)));
      if (activeMarkAction && (idsToDelete.includes(activeMarkAction.annotation?.id) || activeMarkAction.annotation?.id === annId)) {
        setActiveMarkAction(null);
      }
    } catch (err) {
      console.error('Error deleting annotation:', err);
    }
  };

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

    fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/predicted-quizzes`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.quizzes) {
          setPredictedQuizzes(data.quizzes);
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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ review_mode: 'audio_grounded' })
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

  // Auto-scroll active cue into center view as video plays or resumes on page load (Webex style)
  useEffect(() => {
    if (!autoScroll) return;
    const performScrollToActive = () => {
      if (activeCueIdx >= 0 && cueRefs.current[activeCueIdx] && scrollContainerRef.current) {
        const activeEl = cueRefs.current[activeCueIdx];
        const container = scrollContainerRef.current;
        const isJump = Math.abs(activeCueIdx - (prevActiveCueRef.current ?? 0)) > 1;
        const scrollBehavior = isJump ? 'auto' : 'smooth';
        prevActiveCueRef.current = activeCueIdx;

        isProgrammaticScrollRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

        const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        const clampedTarget = Math.min(maxScroll, Math.max(0, targetTop));

        if (typeof container.scrollTo === 'function') {
          container.scrollTo({
            top: clampedTarget,
            behavior: scrollBehavior
          });
        } else {
          container.scrollTop = clampedTarget;
        }
        if (typeof activeEl?.scrollIntoView === 'function') {
          activeEl.scrollIntoView({
            behavior: scrollBehavior,
            block: 'center'
          });
        }

        scrollTimeoutRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 500);
      }
    };

    performScrollToActive();
    let layoutTimer = null;
    if (activeCueIdx > 0) {
      layoutTimer = setTimeout(performScrollToActive, 80);
    }
    return () => {
      if (layoutTimer) clearTimeout(layoutTimer);
    };
  }, [activeCueIdx, autoScroll, displayCues.length]);

  const handleRecenter = useCallback(() => {
    setAutoScroll(true);
    if (activeCueIdx >= 0 && cueRefs.current[activeCueIdx] && scrollContainerRef.current) {
      const activeEl = cueRefs.current[activeCueIdx];
      const container = scrollContainerRef.current;
      isProgrammaticScrollRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

      const targetTop = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const clampedTarget = Math.min(maxScroll, Math.max(0, targetTop));

      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: clampedTarget, behavior: 'smooth' });
      } else {
        container.scrollTop = clampedTarget;
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
    // If a toolbar or selection was just active/dismissed, do not seek video
    if (justDismissedToolbarRef.current) {
      justDismissedToolbarRef.current = false;
      return;
    }

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
    if (selectionToolbar) {
      setSelectionToolbar(null);
    }
    const el = e.currentTarget;
    setShowScrollTop(el.scrollTop > 60);
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
    setShowScrollBottom(isUp);

    // If user scrolled manually away from center while autoScroll was active, pause auto-scroll
    if (!isProgrammaticScrollRef.current && autoScroll && activeCueIdx >= 0 && cueRefs.current[activeCueIdx]) {
      const activeEl = cueRefs.current[activeCueIdx];
      const targetTop = activeEl.offsetTop - (el.clientHeight / 2) + (activeEl.clientHeight / 2);
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const clampedTarget = Math.min(maxScroll, Math.max(0, targetTop));
      if (Math.abs(el.scrollTop - clampedTarget) > 80) {
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
  const handleTextSelection = useCallback(() => {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const rawText = selection.toString().trim();
    // Strip any stray timestamps e.g. [02:15] that may occur when selecting across lines
    const text = rawText.replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;

    try {
      const range = selection.getRangeAt(0);
      const startNode = range.startContainer;
      const endNode = range.endContainer;

      const getCueRow = (node) => {
        let curr = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return curr?.closest?.('[data-cue-idx]');
      };

      let startRow = getCueRow(startNode);
      let endRow = getCueRow(endNode);

      if (!startRow && endRow) startRow = endRow;
      if (startRow && !endRow) endRow = startRow;
      // Must be within transcript cue rows
      if (!startRow || !endRow) return;

      const startCueIdx = parseInt(startRow.getAttribute('data-cue-idx'), 10);
      let endCueIdx = parseInt(endRow.getAttribute('data-cue-idx'), 10);

      if (isNaN(startCueIdx) || isNaN(endCueIdx)) {
        return;
      }

      // Handle common boundary edge case: selection end lands at start of next cue (offset 0)
      if (range.endOffset === 0 && endCueIdx > startCueIdx) {
        endCueIdx = endCueIdx - 1;
      }

      const firstIdx = Math.min(startCueIdx, endCueIdx);
      const lastIdx = Math.max(startCueIdx, endCueIdx);

      const targetCue = displayCues[firstIdx];
      const endCue = displayCues[lastIdx] || targetCue;
      if (!targetCue) return;

      // Selection must touch the cue text container (.transcript-cue)
      const getCueText = (node) => {
        let curr = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return curr?.closest?.('.transcript-cue');
      };
      if (!getCueText(startNode) && !getCueText(endNode) && !startRow.querySelector?.('.transcript-cue')) return;

      const rect = (range.getBoundingClientRect && range.getBoundingClientRect().width > 0)
        ? range.getBoundingClientRect()
        : (range.getClientRects && range.getClientRects()[0] ? range.getClientRects()[0] : null);
      const posX = rect ? (rect.left + rect.width / 2) : 200;
      const posY = rect ? rect.top : 200;

      const startSec = targetCue.seconds !== undefined
        ? Number(targetCue.seconds)
        : parseTimeToSeconds(targetCue.time);
      const isMultiCue = firstIdx !== lastIdx;
      const endSec = isMultiCue
        ? (endCue?.seconds !== undefined
            ? Number(endCue.seconds) + 2
            : (endCue?.time ? parseTimeToSeconds(endCue.time) + 2 : startSec + 4))
        : (targetCue?.seconds !== undefined
            ? Number(targetCue.seconds) + 2
            : (targetCue?.time ? parseTimeToSeconds(targetCue.time) + 2 : startSec + 2));

      const targetClean = text.trim().toLowerCase();
      const overlapping = (annotations || []).filter(a => {
        const aText = (a.selectedText || a.selected_text || '').trim().toLowerCase();
        const aCueId = a.cueId !== undefined ? a.cueId : a.cue_id;
        const aStartSec = Number(a.startSeconds ?? a.start_seconds ?? 0);
        const aEndSec = Number(a.endSeconds ?? a.end_seconds ?? 0);
        if (aCueId === targetCue.id || aCueId === firstIdx) return true;
        if (aText && (targetClean.includes(aText) || aText.includes(targetClean))) return true;
        if (aEndSec > 0 && startSec <= aEndSec && endSec >= aStartSec) return true;
        return false;
      });

      setSelectionToolbar({
        position: {
          x: posX,
          y: posY
        },
        selectedText: text,
        cueId: targetCue.id ?? firstIdx,
        startSeconds: startSec,
        endSeconds: endSec,
        overlappingAnnotations: overlapping
      });
    } catch {
      // Ignore selection errors
    }
  }, [displayCues, annotations]);

  useEffect(() => {
    const handleDocMouseDown = (e) => {
      if (selectionToolbar && !e.target.closest?.('.text-selection-toolbar')) {
        setSelectionToolbar(null);
        justDismissedToolbarRef.current = true;
        setTimeout(() => {
          justDismissedToolbarRef.current = false;
        }, 120);
      }
      if (activeMarkAction && !e.target.closest?.('.active-mark-action-popover')) {
        setActiveMarkAction(null);
      }
    };
    const handleDocMouseUp = (e) => {
      if (e.target.closest?.('.text-selection-toolbar')) return;
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!sel || sel.isCollapsed) return;
      if (
        scrollContainerRef.current?.contains(e.target) ||
        (sel.anchorNode && scrollContainerRef.current?.contains(sel.anchorNode)) ||
        (sel.focusNode && scrollContainerRef.current?.contains(sel.focusNode))
      ) {
        handleTextSelection();
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    document.addEventListener('mouseup', handleDocMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleDocMouseDown);
      document.removeEventListener('mouseup', handleDocMouseUp);
    };
  }, [selectionToolbar, handleTextSelection]);

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

  // Helper to find matching spans of an annotation string within cue text
  const findAnnotationOccurrences = (cueText, searchStr, isExplicitTimeRange = false) => {
    if (!cueText || !searchStr) return [];
    const cleanCue = cueText.replace(/\u00a0/g, ' ');
    const cleanSearch = searchStr.replace(/\u00a0/g, ' ').trim();
    if (!cleanSearch) return [];

    const lowerCue = cleanCue.toLowerCase();
    const lowerSearch = cleanSearch.toLowerCase();

    // 1. Exact substring match with strict word boundary checks
    // If "character" is highlighted, "characters" or "characteristic" will NOT match
    const results = [];
    let startPos = 0;
    while ((startPos = lowerCue.indexOf(lowerSearch, startPos)) !== -1) {
      const endPos = startPos + cleanSearch.length;
      if (checkWordBoundary(cleanCue, startPos, endPos)) {
        results.push({ start: startPos, end: endPos });
      }
      startPos += 1;
    }
    if (results.length > 0) return results;

    // 2. Whitespace-collapsed exact match for multi-word phrases/sentences
    const searchWords = cleanSearch.split(/\s+/).filter(Boolean);
    if (searchWords.length > 1) {
      const escapedWords = searchWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      try {
        const phraseRegex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedWords.join('\\s+')}(?![\\p{L}\\p{N}_])`, 'gui');
        let m;
        while ((m = phraseRegex.exec(cleanCue)) !== null) {
          results.push({ start: m.index, end: m.index + m[0].length });
        }
        if (results.length > 0) return results;
      } catch {
        // Fallback
        const collapsedCue = lowerCue.replace(/\s+/g, ' ');
        const collapsedSearch = lowerSearch.replace(/\s+/g, ' ');
        if (collapsedCue.includes(collapsedSearch)) {
          const matchPrefix = searchWords[0].toLowerCase();
          const startChar = lowerCue.indexOf(matchPrefix);
          if (startChar !== -1) {
            const endChar = Math.min(cleanCue.length, startChar + cleanSearch.length);
            if (checkWordBoundary(cleanCue, startChar, endChar)) {
              return [{ start: startChar, end: endChar }];
            }
          }
        }
      }
    }

    // 3. Multi-cue cross-span: ONLY when this cue is within the explicitly selected time window of the annotation
    if (isExplicitTimeRange && searchWords.length > 1) {
      const cueWords = cleanCue.trim().split(/\s+/);
      const cueTrimmedLower = cleanCue.trim().toLowerCase();

      // Case A: Cue is entirely contained in the multi-cue search
      if (cueTrimmedLower.length >= 3 && lowerSearch.includes(cueTrimmedLower)) {
        const idx = lowerCue.indexOf(cueTrimmedLower);
        if (idx !== -1) {
          return [{ start: idx, end: idx + cleanCue.trim().length }];
        }
      }

      // Case B: Starting cue of multi-cue span (matches suffix to end of cue)
      for (let w = 0; w < cueWords.length; w++) {
        const candidateSuffix = cueWords.slice(w).join(' ');
        const lowerCandidate = candidateSuffix.toLowerCase();
        if (lowerSearch.startsWith(lowerCandidate) && lowerCandidate.length >= 3) {
          const idx = lowerCue.lastIndexOf(lowerCandidate);
          if (idx !== -1 && checkWordBoundary(cleanCue, idx, idx + candidateSuffix.length)) {
            return [{ start: idx, end: idx + candidateSuffix.length }];
          }
        }
      }

      // Case C: Ending cue of multi-cue span (matches prefix from start of cue)
      for (let w = cueWords.length; w >= 1; w--) {
        const candidatePrefix = cueWords.slice(0, w).join(' ');
        const lowerCandidate = candidatePrefix.toLowerCase();
        if (lowerSearch.endsWith(lowerCandidate) && lowerCandidate.length >= 3) {
          const idx = lowerCue.indexOf(lowerCandidate);
          if (idx !== -1 && checkWordBoundary(cleanCue, idx, idx + candidatePrefix.length)) {
            return [{ start: idx, end: idx + candidatePrefix.length }];
          }
        }
      }
    }

    return [];
  };

  // Helper to render annotated text (highlights, comments/notes, and AI explanations)
  const renderAnnotatedCue = (cueText, cueAnnotations, isActive, cueSec, nextCueSec) => {
    if (!cueText || typeof cueText !== 'string') return cueText;
    if (!cueAnnotations || cueAnnotations.length === 0) {
      return renderMathText(cueText, isActive);
    }

    // Find occurrences of all annotations in this cue text
    const matches = [];
    cueAnnotations.forEach((ann, aIdx) => {
      const searchStr = (ann.selectedText || ann.selected_text || '').trim();
      if (!searchStr) return;

      const aStartSec = Number(ann.startSeconds ?? ann.start_seconds ?? 0);
      const aEndSec = Number(ann.endSeconds ?? ann.end_seconds ?? 0);
      const isExplicitTimeRange = aEndSec > 0 && cueSec !== undefined && cueSec <= aEndSec && nextCueSec >= aStartSec;

      const occurrences = findAnnotationOccurrences(cueText, searchStr, isExplicitTimeRange);
      occurrences.forEach((occ, oIdx) => {
        matches.push({
          start: occ.start,
          end: occ.end,
          annotation: ann,
          id: ann.id || `ann-${aIdx}-${oIdx}`
        });
      });
    });

    if (matches.length === 0) {
      return renderMathText(cueText, isActive);
    }

    // Sort by start position, then by length descending
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Filter out overlapping matches and merge overlapping/same-span annotations
    const nonOverlapping = [];
    let currentEnd = 0;
    for (const m of matches) {
      if (m.start >= currentEnd) {
        nonOverlapping.push({ ...m });
        currentEnd = m.end;
      } else {
        // Overlapping match: if it shares or falls within the existing span, merge note/explanation/color data
        const prev = nonOverlapping[nonOverlapping.length - 1];
        if (prev && m.start >= prev.start && m.end <= prev.end) {
          const prevAnn = prev.annotation || {};
          const currAnn = m.annotation || {};
          const noteText = prevAnn.noteText || prevAnn.note_text || currAnn.noteText || currAnn.note_text;
          const aiResponse = prevAnn.aiResponse || prevAnn.ai_response || currAnn.aiResponse || currAnn.ai_response;
          const isNote = prevAnn.annotationType === 'note' || prevAnn.annotation_type === 'note' || currAnn.annotationType === 'note' || currAnn.annotation_type === 'note' || !!noteText;
          const isAi = prevAnn.annotationType === 'ai_explanation' || prevAnn.annotation_type === 'ai_explanation' || currAnn.annotationType === 'ai_explanation' || currAnn.annotation_type === 'ai_explanation' || !!aiResponse;
          const color = (prevAnn.color && prevAnn.color !== 'yellow') ? prevAnn.color : (currAnn.color || prevAnn.color || 'yellow');
          const allAnnotations = [...(prevAnn.allAnnotations || [prevAnn]), currAnn];

          prev.annotation = {
            ...prevAnn,
            ...currAnn,
            color,
            noteText,
            note_text: noteText,
            aiResponse,
            ai_response: aiResponse,
            annotationType: isNote ? 'note' : (isAi ? 'ai_explanation' : (prevAnn.annotationType || currAnn.annotationType || 'highlight')),
            allAnnotations
          };
        }
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
      const annType = ann.annotationType || ann.annotation_type || 'highlight';
      const isNote = annType === 'note';
      const isAi = annType === 'ai_explanation';
      const color = ann.color || 'yellow';
      const noteText = ann.noteText || ann.note_text || '';
      const aiResponse = ann.aiResponse || ann.ai_response || '';

      let bg = 'rgba(254, 240, 138, 0.45)'; // default yellow
      let borderBottom = '2px solid #eab308';

      if (color === 'green') {
        bg = 'rgba(187, 247, 208, 0.55)';
        borderBottom = '2px solid #22c55e';
      } else if (color === 'blue') {
        bg = 'rgba(191, 219, 254, 0.55)';
        borderBottom = '2px solid #3b82f6';
      } else if (color === 'pink') {
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
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
              return;
            }
            e.stopPropagation();
            if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
            setHoveredMark(null);
            setEditingMarkNoteText(ann.noteText || ann.note_text || '');
            setActiveMarkAction({
              annotation: ann,
              x: e.clientX,
              y: e.clientY,
              editing: false
            });
          }}
          onMouseEnter={(e) => {
            const hasContent = Boolean(ann.noteText || ann.note_text || ann.aiResponse || ann.ai_response);
            if (!hasContent) return;
            if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
            const rect = e.currentTarget.getBoundingClientRect();
            setHoveredMark(prev => {
              if (prev?.editing && prev?.annotation?.id === ann.id) return prev;
              return {
                annotation: ann,
                x: rect.left + rect.width / 2,
                y: rect.top,
                editing: false
              };
            });
          }}
          onMouseLeave={() => {
            if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
            hoverCloseTimeoutRef.current = setTimeout(() => {
              setHoveredMark(prev => (prev?.editing ? prev : null));
            }, 180);
          }}
          title={
            isNote
              ? `Note: "${noteText}" (Click to edit, un-highlight or view)`
              : isAi
              ? `AI Explanation: "${aiResponse.slice(0, 100)}"`
              : `Highlight (${color}) - Click to ask AI, edit, or un-highlight`
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
    const cueSec = cue.seconds !== undefined ? Number(cue.seconds) : parseTimeToSeconds(cue.time);
    const nextCue = displayCues[idx + 1];
    const nextCueSec = nextCue?.seconds !== undefined
      ? Number(nextCue.seconds)
      : (nextCue?.time ? parseTimeToSeconds(nextCue.time) : cueSec + 6);

    const cueAnnotations = (annotations || []).filter(a => {
      const aCueId = a.cueId !== undefined ? a.cueId : a.cue_id;
      const aText = (a.selectedText || a.selected_text || '').trim();
      const aStartSec = Number(a.startSeconds ?? a.start_seconds ?? 0);
      const aEndSec = Number(a.endSeconds ?? a.end_seconds ?? 0);

      if (aCueId !== undefined && aCueId !== null && (aCueId === cue.id || aCueId === idx)) return true;
      if (aEndSec > 0 && cueSec <= aEndSec && nextCueSec >= aStartSec) {
        return true;
      }
      if (aText && cue.text) {
        if (findAnnotationOccurrences(cue.text, aText, false).length > 0) return true;
      }
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
        {renderAnnotatedCue(cue.text, cueAnnotations, isActive, cueSec, nextCueSec)}
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
          {!searchAvailable && (
            <div
              role="alert"
              data-testid="search-unavailable-alert"
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{searchError || 'Transcript search is currently unavailable.'}</span>
            </div>
          )}
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
          onMouseUp={handleTextSelection}
          onKeyUp={handleTextSelection}
          onTouchEnd={handleTextSelection}
          tabIndex={0}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '6px 10px calc(50vh)',
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
          ) : !searchAvailable && Boolean(searchQuery) ? (
            <div
              role="status"
              data-testid="search-unavailable-message"
              style={{
                margin: '28px auto',
                maxWidth: '480px',
                padding: '18px 20px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                textAlign: 'center',
                color: 'var(--text-primary)'
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: 6, color: '#ef4444' }}>
                Transcript Search Unavailable
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {searchError || 'Transcript search is currently unavailable. Algolia search index is offline or quota exceeded.'}
              </div>
            </div>
          ) : Boolean(searchQuery) && displayCues.length === 0 ? (
            <div
              role="status"
              data-testid="search-no-results"
              style={{
                margin: '28px auto',
                maxWidth: '440px',
                padding: '16px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem'
              }}
            >
              No transcript matches found for "{searchQuery}".
            </div>
          ) : displayCues.map((cue, idx) => {
            const isActive = activeCueIdx === idx;
            const isEditing = editingCueIdx === idx;
            const isHovered = hoveredCueIdx === idx;

            return (
              <div
                key={idx}
                ref={(el) => { cueRefs.current[idx] = el; }}
                onClick={(e) => {
                  if (isEditing) return;
                  if (justDismissedToolbarRef.current) return;
                  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
                  if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
                    return;
                  }
                  const dist = Math.hypot(
                    e.clientX - (mouseDownPosRef.current.x || 0),
                    e.clientY - (mouseDownPosRef.current.y || 0)
                  );
                  if (dist > 5) return;
                  onCueClick(cue.time, idx);
                }}
                onMouseDown={(e) => {
                  mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                  if (selectionToolbar && !e.target.closest?.('.text-selection-toolbar')) {
                    setSelectionToolbar(null);
                    justDismissedToolbarRef.current = true;
                    setTimeout(() => {
                      justDismissedToolbarRef.current = false;
                    }, 120);
                  }
                }}
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
                  marginTop: isEditing ? 0 : '1px',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  MozUserSelect: 'none'
                }}>
                  {isActive ? (
                    <button
                      type="button"
                      data-testid="transcript-play-pause-btn"
                      data-cue-play-pause={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleVideoPlayback();
                      }}
                      title={localPlaying ? 'Pause video (Space)' : 'Play video (Space)'}
                      aria-label={localPlaying ? 'Pause video' : 'Play video'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        background: localPlaying ? 'rgba(0, 117, 237, 0.12)' : 'rgba(16, 185, 129, 0.14)',
                        color: localPlaying ? 'var(--theme-primary)' : '#10b981',
                        border: localPlaying ? '1px solid rgba(0, 117, 237, 0.3)' : '1px solid rgba(16, 185, 129, 0.35)',
                        borderRadius: '4px',
                        padding: '1px 4px',
                        cursor: 'pointer',
                        lineHeight: 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Volume2
                        size={11}
                        color="var(--theme-primary)"
                        className="active-speaker-icon"
                        aria-label="Current playback cue"
                      />
                      {localPlaying ? (
                        <Pause size={11} fill="currentColor" />
                      ) : (
                        <Play size={11} fill="currentColor" />
                      )}
                    </button>
                  ) : (isHovered || (activeCueIdx < 0 && idx === 0)) ? (
                    <button
                      type="button"
                      data-testid={activeCueIdx < 0 && idx === 0 ? 'transcript-play-pause-btn' : `cue-play-pause-btn-${idx}`}
                      data-cue-play-pause={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCueClick(cue.time, idx);
                        setLocalPlaying(true);
                      }}
                      title={`Play from ${cue.time}`}
                      aria-label={`Play cue at ${cue.time}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0, 117, 237, 0.1)',
                        color: 'var(--theme-primary)',
                        border: '1px solid rgba(0, 117, 237, 0.25)',
                        borderRadius: '4px',
                        padding: '2px 4px',
                        cursor: 'pointer',
                        lineHeight: 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Play size={10} fill="currentColor" />
                    </button>
                  ) : null}
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: '0.76rem',
                    color: isActive ? 'var(--theme-primary)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none'
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, userSelect: 'none' }}>
                      {/* AI Explanation badge if present on this cue */}
                      {annotations.some(a => {
                        const aType = a.annotationType || a.annotation_type;
                        if (aType !== 'ai_explanation') return false;
                        const aCueId = a.cueId !== undefined ? a.cueId : a.cue_id;
                        const aText = (a.selectedText || a.selected_text || '').trim().toLowerCase();
                        if (aCueId !== undefined && aCueId !== null) {
                          if (aCueId === cue.id || aCueId === idx) return true;
                        }
                        if (aText && cue.text) {
                          if (cue.text.toLowerCase().includes(aText)) return true;
                        }
                        const aStartSec = Number(a.startSeconds ?? a.start_seconds ?? 0);
                        const aEndSec = Number(a.endSeconds ?? a.end_seconds ?? 0);
                        const cueSec = cue.seconds !== undefined ? Number(cue.seconds) : parseTimeToSeconds(cue.time);
                        return aEndSec > 0 && cueSec >= aStartSec && cueSec < aEndSec;
                      }) && (
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

                      {/* Predicted Quiz announcement badge if present on this cue */}
                      {(() => {
                        const matchingQuiz = predictedQuizzes.find(pq => {
                          const pqTime = pq.cue_time || pq.cueTime;
                          const pqText = (pq.cue_text || pq.cueText || '').toLowerCase();
                          return pqTime === cue.time || (pqText && cue.text && cue.text.toLowerCase().includes(pqText.slice(0, 30)));
                        });
                        if (!matchingQuiz) return null;
                        return (
                          <span
                            data-testid="predicted-quiz-cue-badge"
                            title={`Predicted Quiz: ${matchingQuiz.quiz_title || matchingQuiz.quizTitle} (${matchingQuiz.predicted_date || matchingQuiz.predictedDate})`}
                            style={{
                              background: 'rgba(245, 158, 11, 0.12)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              color: '#d97706',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              fontSize: '0.68rem',
                              fontWeight: 700
                            }}
                          >
                            <Sparkles size={10} />
                            <span>Quiz: {matchingQuiz.predicted_date || matchingQuiz.predictedDate || 'Upcoming'}</span>
                          </span>
                        );
                      })()}

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
              overlappingAnnotations={selectionToolbar.overlappingAnnotations}
              onDeleteAnnotation={handleDeleteAnnotation}
              initialMode={selectionToolbar.initialMode || 'menu'}
              onDiscussInTutor={onDiscussInTutor}
              onClose={() => setSelectionToolbar(null)}
              onAnnotationCreated={(newAnnotation) => {
                setAnnotations(prev => [newAnnotation, ...prev]);
                setSelectionToolbar(null);
              }}
            />
          )}

          {/* Rich Hover Card for Notes / Highlights (supports inline editing) */}
          {hoveredMark && !activeMarkAction && (
            <div
              data-testid="mark-hover-tooltip"
              onMouseEnter={() => {
                if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
              }}
              onMouseLeave={() => {
                if (hoverCloseTimeoutRef.current) clearTimeout(hoverCloseTimeoutRef.current);
                hoverCloseTimeoutRef.current = setTimeout(() => {
                  setHoveredMark(prev => (prev?.editing ? prev : null));
                }, 150);
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: Math.max(10, Math.min(typeof window !== 'undefined' ? window.innerWidth - 320 : 300, (hoveredMark.x || 200) - 140)),
                top: Math.max(10, (hoveredMark.y || 200) > 110 ? (hoveredMark.y || 200) - (hoveredMark.editing ? 120 : 84) : (hoveredMark.y || 200) + 26),
                zIndex: 1200,
                background: 'var(--card-bg, #1e293b)',
                border: '1px solid rgba(129, 140, 248, 0.35)',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                padding: '8px 12px',
                maxWidth: '300px',
                minWidth: '210px',
                pointerEvents: 'auto',
                animation: 'fadeIn 0.12s ease'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: (hoveredMark.annotation?.annotationType || hoveredMark.annotation?.annotation_type) === 'note' ? '#3b82f6' : 'var(--theme-primary, #6366f1)',
                marginBottom: '4px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {(hoveredMark.annotation?.annotationType || hoveredMark.annotation?.annotation_type) === 'note' ? (
                    <>
                      <MessageSquare size={12} />
                      <span>Margin Note</span>
                    </>
                  ) : (hoveredMark.annotation?.annotationType || hoveredMark.annotation?.annotation_type) === 'ai_explanation' ? (
                    <>
                      <Sparkles size={12} />
                      <span>AI Explanation</span>
                    </>
                  ) : (
                    <span>Highlight ({hoveredMark.annotation?.color || 'yellow'})</span>
                  )}
                </div>
                {!hoveredMark.editing && (
                  <button
                    type="button"
                    aria-label="Edit note in tooltip"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingMarkNoteText(hoveredMark.annotation?.noteText || hoveredMark.annotation?.note_text || '');
                      setHoveredMark(prev => prev ? { ...prev, editing: true } : null);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: '#3b82f6',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Pencil size={10} /> Edit
                  </button>
                )}
              </div>

              {hoveredMark.editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
                  <textarea
                    autoFocus
                    aria-label="Edit margin note text"
                    value={editingMarkNoteText}
                    onChange={(e) => setEditingMarkNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (editingMarkNoteText.trim()) {
                          handleUpdateAnnotation(hoveredMark.annotation?.id, editingMarkNoteText);
                        }
                      } else if (e.key === 'Escape') {
                        setHoveredMark(prev => prev ? { ...prev, editing: false } : null);
                      }
                    }}
                    rows={2}
                    placeholder="Write note... (Press Enter to save)"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '5px 7px',
                      borderRadius: '5px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--panel-bg)',
                      color: 'var(--text-primary)',
                      fontSize: '0.78rem',
                      resize: 'none',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>Enter to save</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => setHoveredMark(prev => prev ? { ...prev, editing: false } : null)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '0.68rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!editingMarkNoteText.trim() || isSavingMarkNote}
                        onClick={() => handleUpdateAnnotation(hoveredMark.annotation?.id, editingMarkNoteText)}
                        style={{
                          padding: '2px 8px',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          borderRadius: '4px',
                          border: 'none',
                          background: 'var(--theme-primary)',
                          color: '#fff',
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (hoveredMark.annotation?.noteText || hoveredMark.annotation?.note_text) ? (
                <div style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                  lineHeight: '1.5',
                  maxHeight: '160px',
                  overflowY: 'auto'
                }}>
                  <MarkdownWithTimestamps content={hoveredMark.annotation?.noteText || hoveredMark.annotation?.note_text} onCueClick={handleCueClick} />
                </div>
              ) : (hoveredMark.annotation?.aiResponse || hoveredMark.annotation?.ai_response) ? (
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  lineHeight: '1.5',
                  maxHeight: '160px',
                  overflowY: 'auto'
                }}>
                  <MarkdownWithTimestamps content={hoveredMark.annotation?.aiResponse || hoveredMark.annotation?.ai_response} onCueClick={handleCueClick} />
                </div>
              ) : null}
              {!hoveredMark.editing && (
                <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Click to open in Notes drawer, edit, or un-highlight
                </div>
              )}
            </div>
          )}

          {/* Inline Active Mark Un-highlight / Edit / Notes Popover */}
          {activeMarkAction && (
            <div
              className="active-mark-action-popover"
              style={{
                position: 'fixed',
                left: Math.max(10, Math.min(typeof window !== 'undefined' ? window.innerWidth - 320 : 300, (activeMarkAction.x || 200) - 120)),
                top: Math.max(10, (activeMarkAction.y || 200) > 80 ? (activeMarkAction.y || 200) - (activeMarkAction.editing ? 110 : 48) : (activeMarkAction.y || 200) + 24),
                zIndex: 1100,
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                padding: '6px 8px',
                display: 'flex',
                flexDirection: activeMarkAction.editing ? 'column' : 'row',
                alignItems: activeMarkAction.editing ? 'stretch' : 'center',
                gap: '6px',
                minWidth: activeMarkAction.editing ? '240px' : 'auto',
                animation: 'fadeIn 0.15s ease'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {activeMarkAction.editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <textarea
                    autoFocus
                    aria-label="Edit note text"
                    value={editingMarkNoteText}
                    onChange={(e) => setEditingMarkNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (editingMarkNoteText.trim()) {
                          handleUpdateAnnotation(activeMarkAction.annotation?.id, editingMarkNoteText);
                        }
                      } else if (e.key === 'Escape') {
                        setActiveMarkAction(prev => prev ? { ...prev, editing: false } : null);
                      }
                    }}
                    rows={2}
                    placeholder="Edit note... (Enter to save)"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '5px 7px',
                      borderRadius: '5px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--panel-bg)',
                      color: 'var(--text-primary)',
                      fontSize: '0.78rem',
                      resize: 'none',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Enter to save • Shift+Enter newline</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={() => setActiveMarkAction(prev => prev ? { ...prev, editing: false } : null)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '0.7rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!editingMarkNoteText.trim() || isSavingMarkNote}
                        onClick={() => handleUpdateAnnotation(activeMarkAction.annotation?.id, editingMarkNoteText)}
                        style={{
                          padding: '2px 8px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          borderRadius: '4px',
                          border: 'none',
                          background: 'var(--theme-primary)',
                          color: '#fff',
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {activeMarkAction.annotation?.noteText || activeMarkAction.annotation?.note_text
                      ? `Note: ${activeMarkAction.annotation?.noteText || activeMarkAction.annotation?.note_text}`
                      : `Highlight (${activeMarkAction.annotation?.color || 'yellow'})`}
                  </span>

                  {/* Ask AI button on already highlighted text */}
                  <button
                    type="button"
                    onClick={() => {
                      const ann = activeMarkAction.annotation;
                      const text = ann?.selectedText || ann?.selected_text || '';
                      setSelectionToolbar({
                        position: { x: activeMarkAction.x || 200, y: activeMarkAction.y || 200 },
                        selectedText: text,
                        cueId: ann?.cueId ?? ann?.cue_id,
                        startSeconds: Number(ann?.startSeconds ?? ann?.start_seconds ?? 0),
                        endSeconds: Number(ann?.endSeconds ?? ann?.end_seconds ?? 0),
                        overlappingAnnotations: [ann],
                        initialMode: 'ai'
                      });
                      setActiveMarkAction(null);
                    }}
                    title="Ask AI to explain this highlighted text"
                    aria-label="Ask AI"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      background: 'rgba(168, 85, 247, 0.12)',
                      color: '#a855f7',
                      border: 'none',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Sparkles size={11} /> Ask AI
                  </button>

                  {/* Discuss in AI Tutor button */}
                  {typeof onDiscussInTutor === 'function' && (
                    <button
                      type="button"
                      onClick={() => {
                        const ann = activeMarkAction.annotation;
                        const text = ann?.selectedText || ann?.selected_text || '';
                        const startSec = Number(ann?.startSeconds ?? ann?.start_seconds ?? 0);
                        const ts = startSec ? `${Math.floor(startSec / 60)}:${String(Math.floor(startSec % 60)).padStart(2, '0')}` : '';
                        onDiscussInTutor(text, ts);
                        setActiveMarkAction(null);
                      }}
                      title="Discuss this concept in AI Tutor"
                      aria-label="Discuss in AI Tutor"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        background: 'rgba(99, 102, 241, 0.1)',
                        color: 'var(--theme-primary, #6366f1)',
                        border: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      <Bot size={11} /> Discuss
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingMarkNoteText(activeMarkAction.annotation?.noteText || activeMarkAction.annotation?.note_text || '');
                      setActiveMarkAction(prev => prev ? { ...prev, editing: true } : null);
                    }}
                    title="Edit margin note"
                    aria-label="Edit note"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: '#3b82f6',
                      border: 'none',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Pencil size={11} /> Edit
                  </button>

                  <button
                    onClick={() => handleDeleteAnnotation(activeMarkAction.annotation?.id, activeMarkAction.annotation?.allAnnotations)}
                    title="Un-highlight and remove this note/highlight"
                    aria-label="Un-highlight"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      color: '#ef4444',
                      border: 'none',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Eraser size={11} /> Un-highlight
                  </button>

                  <button
                    onClick={() => {
                      setActiveMarkAction(null);
                      setShowAnnotationsDrawer(true);
                    }}
                    title="Open all notes and highlights"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: 'var(--theme-primary)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <BookOpen size={11} /> Notes
                  </button>

                  <button
                    onClick={() => setActiveMarkAction(null)}
                    aria-label="Close action menu"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
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
          onUpdateAnnotation={handleUpdateAnnotation}
          handleCueClick={handleCueClick}
          onDiscussInTutor={onDiscussInTutor}
        />
      </div>
    </div>
  );
}
