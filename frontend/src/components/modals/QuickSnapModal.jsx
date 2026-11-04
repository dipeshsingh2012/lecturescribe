import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap,
  X,
  Upload,
  Camera,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Image as ImageIcon,
  Clock,
  Trash2,
  ExternalLink,
  BookOpen
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { formatRelativeTime } from '../../utils/formatters';
import { getCourseNameFromPath } from '../../utils/routing';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function QuickSnapModal({
  courseContext = '',
  userEmail = '',
  currentTheme,
  hideFloatingButton = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('solve'); // 'solve' | 'history'

  const isSolverTab = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('tab') === 'solves' ||
    new URLSearchParams(window.location.search).get('tab') === 'quick-solves'
  );
  const shouldHideFloatingButton = hideFloatingButton || isSolverTab;

  // Solver State
  const [imageData, setImageData] = useState(null);
  const [imageFileName, setImageFileName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [customCourseContext, setCustomCourseContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [detailedSolution, setDetailedSolution] = useState(null);

  // History State
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyCourseFilter, setHistoryCourseFilter] = useState('current'); // 'current' | 'all'
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [copiedHistoryId, setCopiedHistoryId] = useState(null);
  const [previewThumbnail, setPreviewThumbnail] = useState(null);

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const timerRef = useRef(null);

  // Detect active course from current window path or props
  const getWindowCourse = useCallback(() => {
    if (typeof window !== 'undefined') {
      const fromPath = getCourseNameFromPath(window.location.pathname);
      if (fromPath) return fromPath;
    }
    return courseContext || '';
  }, [courseContext]);

  // Sync course mapping when opening or when props change
  useEffect(() => {
    const active = getWindowCourse();
    if (active) {
      setCustomCourseContext(active);
    }
  }, [getWindowCourse, isOpen]);

  // Global hotkey: Ctrl+Shift+V or Cmd+Shift+V toggles Quick Solver
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen]);

  // Listen to open-quick-solver event
  useEffect(() => {
    const handleOpenEvent = (e) => {
      setIsOpen(true);
      if (e?.detail?.tab) {
        setActiveTab(e.detail.tab);
      }
      if (e?.detail?.course) {
        setCustomCourseContext(e.detail.course);
      } else {
        const detected = getWindowCourse();
        if (detected) setCustomCourseContext(detected);
      }
    };
    window.addEventListener('open-quick-solver', handleOpenEvent);
    return () => window.removeEventListener('open-quick-solver', handleOpenEvent);
  }, [getWindowCourse]);

  // Prevent background scrolling when modal is open (Body & HTML Scroll Lock)
  useEffect(() => {
    if (!isOpen) return;

    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const scrollY = window.scrollY;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Fetch History from DB / Cloud
  const fetchHistory = useCallback(async (courseFilter = historyCourseFilter) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const activeCourse = customCourseContext || getWindowCourse();
      const params = new URLSearchParams();
      if (courseFilter === 'current' && activeCourse) {
        params.append('course_name', activeCourse);
      }
      if (userEmail && userEmail !== 'anonymous') {
        params.append('user_email', userEmail);
      }
      params.append('limit', '50');

      const res = await fetch(`${API_BASE}/api/quick-solve/history?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load quick solve history:', err);
      setHistoryError('Could not load history from cloud.');
    } finally {
      setHistoryLoading(false);
    }
  }, [customCourseContext, getWindowCourse, historyCourseFilter, userEmail]);

  // Refetch history when opening history tab or changing filter
  useEffect(() => {
    if (isOpen && activeTab === 'history') {
      fetchHistory(historyCourseFilter);
    }
  }, [isOpen, activeTab, historyCourseFilter, fetchHistory]);

  // Handle elapsed timer during solving
  useEffect(() => {
    if (loading) {
      setElapsedSec(0);
      const start = performance.now();
      timerRef.current = setInterval(() => {
        setElapsedSec(((performance.now() - start) / 1000).toFixed(1));
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading]);

  // Process image file to base64 Data URL
  const processImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please provide a valid image file (PNG, JPEG, WebP).');
      return;
    }
    setError(null);
    setImageFileName(file.name || 'Handwritten Question');
    setResult(null);
    setDetailedSolution(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Data = e.target?.result;
      if (base64Data) {
        setImageData(base64Data);
        executeSolve(base64Data, prompt, false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  }, [prompt]);

  // Global Paste Listener when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e) => {
      if (activeTab !== 'solve') return;
      const targetTag = e.target?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) processImageFile(file);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, activeTab, processImageFile]);

  // Execute Quick Solve Request
  const executeSolve = async (imgB64 = imageData, extraPrompt = prompt, detailed = false) => {
    const targetImage = imgB64 || imageData;
    if (!targetImage) {
      setError('Please snap or upload an image of the question.');
      return;
    }

    if (detailed) {
      setIsExplaining(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const effectiveCourse = (customCourseContext || getWindowCourse() || '').trim();

    try {
      const res = await fetch(`${API_BASE}/api/quick-solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: targetImage,
          prompt: extraPrompt || '',
          course_context: effectiveCourse,
          course_name: effectiveCourse,
          user_email: userEmail || 'anonymous',
          detailed: detailed,
          save_to_history: true
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      if (detailed) {
        setDetailedSolution(data.answer);
      } else {
        setResult(data);
        // Prepend newly saved solve to history
        if (data.solve_id) {
          setHistoryItems((prev) => [
            {
              solve_id: data.solve_id,
              course_name: data.course_name || effectiveCourse || 'General',
              user_email: userEmail || 'anonymous',
              image_data: targetImage,
              prompt: extraPrompt || '',
              final_answer: data.answer || data.final_answer || '',
              detailed_solution: '',
              created_at: data.created_at || new Date().toISOString()
            },
            ...prev
          ]);
        }
      }
    } catch (err) {
      setError(err.message || 'Quick solve failed. Please retry.');
    } finally {
      setLoading(false);
      setIsExplaining(false);
    }
  };

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setImageData(null);
    setImageFileName('');
    setResult(null);
    setDetailedSolution(null);
    setError(null);
    setPrompt('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleDeleteHistoryItem = async (solveId, e) => {
    e?.stopPropagation();
    try {
      const params = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/quick-solve/history/${solveId}${params}`, {
        method: 'DELETE'
      });
      setHistoryItems((prev) => prev.filter((item) => item.solve_id !== solveId));
    } catch (err) {
      console.error('Failed to delete solve from cloud:', err);
    }
  };

  const handleClearHistory = async () => {
    const activeCourse = customCourseContext || getWindowCourse();
    const isCurrentFilter = historyCourseFilter === 'current' && activeCourse;
    const confirmMsg = isCurrentFilter
      ? `Clear all saved solves for ${activeCourse}?`
      : 'Clear all saved quick solves?';
    if (!window.confirm(confirmMsg)) return;

    try {
      const params = new URLSearchParams();
      if (isCurrentFilter) {
        params.append('course_name', activeCourse);
      }
      if (userEmail) {
        params.append('user_email', userEmail);
      }
      await fetch(`${API_BASE}/api/quick-solve/history?${params.toString()}`, {
        method: 'DELETE'
      });
      setHistoryItems([]);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const handleCopyHistoryAnswer = (solveId, text, e) => {
    e?.stopPropagation();
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedHistoryId(solveId);
    setTimeout(() => setCopiedHistoryId(null), 1800);
  };

  return (
    <>
      {/* Floating Action Trigger Button (Bottom-Right) */}
      {!isOpen && !shouldHideFloatingButton && (
        <button
          onClick={() => setIsOpen(true)}
          className="quick-solver-fab"
          title="⚡ Quick Snap & Solve (Ctrl+Shift+V)"
          aria-label="Quick Snap & Solve"
          style={{
            position: 'fixed',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'linear-gradient(135deg, var(--theme-primary, #0075ed) 0%, #3b82f6 100%)',
            color: '#ffffff',
            border: '1.5px solid rgba(255, 215, 0, 0.6)',
            boxShadow: '0 8px 24px rgba(0, 117, 237, 0.4), 0 0 12px rgba(255, 215, 0, 0.3)',
            cursor: 'pointer',
            fontWeight: 700,
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            outline: 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
            e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 117, 237, 0.5), 0 0 16px rgba(255, 215, 0, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 117, 237, 0.4), 0 0 12px rgba(255, 215, 0, 0.3)';
          }}
        >
          <Zap size={18} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
          <span>Quick Solver</span>
          <span
            className="quick-solver-fab-hotkey"
            style={{
              fontSize: '0.68rem',
              background: 'rgba(0, 0, 0, 0.25)',
              padding: '2px 6px',
              borderRadius: '4px',
              opacity: 0.9,
              fontWeight: 600,
              letterSpacing: '0.2px'
            }}
          >
            Ctrl+Shift+V
          </span>
        </button>
      )}

      {/* Quick Snap Modal Overlay */}
      {isOpen && (
        <div
          className="quick-solver-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '16px',
            boxSizing: 'border-box',
            touchAction: 'none'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
          onTouchMove={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
        >
          {/* Hidden File Inputs: Camera & Gallery */}
          <input
            type="file"
            ref={cameraInputRef}
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) processImageFile(e.target.files[0]);
            }}
          />
          <input
            type="file"
            ref={galleryInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) processImageFile(e.target.files[0]);
            }}
          />

          <div
            className="quick-solver-modal-card"
            style={{
              background: 'var(--panel-bg, #1e222a)',
              border: '1px solid var(--border-color, #2d3340)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '560px',
              maxHeight: 'min(88vh, 88dvh)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
              overflow: 'hidden',
              margin: 'auto',
              touchAction: 'auto',
              animation: 'fadeInScale 0.2s ease-out'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-color, #2d3340)',
                background: 'var(--card-bg, #181b22)',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    minWidth: '32px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #0075ed 0%, #3b82f6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    boxShadow: '0 2px 8px rgba(0, 117, 237, 0.3)'
                  }}
                >
                  <Zap size={18} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #fff)', whiteSpace: 'nowrap' }}>
                      Quick Snap & Solve
                    </h3>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: '#10b981',
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        padding: '1px 6px',
                        borderRadius: '4px'
                      }}
                    >
                      &lt; 1s Speed
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary, #94a3b8)',
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    Instant answer for handwritten math & MCQs • Cloud Synced ☁️
                  </div>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary, #94a3b8)',
                  cursor: 'pointer',
                  padding: '8px',
                  minWidth: '40px',
                  minHeight: '40px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Tabs Header: Solve vs History */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-color, #2d3340)',
                background: 'rgba(255, 255, 255, 0.02)',
                padding: '0 16px',
                gap: '8px',
                flexShrink: 0
              }}
            >
              <button
                type="button"
                onClick={() => setActiveTab('solve')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'solve' ? '2.5px solid var(--theme-primary, #0075ed)' : '2.5px solid transparent',
                  color: activeTab === 'solve' ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #94a3b8)',
                  padding: '10px 14px',
                  fontWeight: activeTab === 'solve' ? 800 : 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Zap size={14} style={{ fill: activeTab === 'solve' ? '#ffd700' : 'none', color: '#ffd700' }} />
                <span>Solve</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'history' ? '2.5px solid var(--theme-primary, #0075ed)' : '2.5px solid transparent',
                  color: activeTab === 'history' ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #94a3b8)',
                  padding: '10px 14px',
                  fontWeight: activeTab === 'history' ? 800 : 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Clock size={14} />
                <span>History</span>
                {historyItems.length > 0 && (
                  <span
                    style={{
                      background: 'rgba(0, 117, 237, 0.2)',
                      color: 'var(--theme-primary, #0075ed)',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontSize: '0.7rem',
                      fontWeight: 700
                    }}
                  >
                    {historyItems.length}
                  </span>
                )}
              </button>
            </div>

            {/* Modal Body */}
            <div
              style={{
                padding: '16px',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              {/* TAB 1: SOLVER */}
              {activeTab === 'solve' && (
                <>
                  {/* Course Mapping Input / Badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary, #94a3b8)',
                      background: 'rgba(255, 255, 255, 0.03)',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #2d3340)'
                    }}
                  >
                    <Sparkles size={14} color="var(--theme-primary, #0075ed)" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, flexShrink: 0, fontSize: '0.76rem' }}>Course:</span>
                    <input
                      type="text"
                      placeholder="e.g. Calculus, Physics, or auto-mapped"
                      value={customCourseContext}
                      onChange={(e) => setCustomCourseContext(e.target.value)}
                      className="quick-solver-input"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary, #fff)',
                        fontSize: '0.82rem',
                        flex: 1,
                        outline: 'none',
                        minWidth: 0
                      }}
                    />
                    {customCourseContext && (
                      <span
                        title="Mapped from active window"
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                        Mapped
                      </span>
                    )}
                  </div>

                  {/* NO IMAGE LOADED: Action Cards */}
                  {!imageData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          style={{
                            padding: '16px 12px',
                            borderRadius: '12px',
                            border: '1.5px solid rgba(255, 215, 0, 0.45)',
                            background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.12) 0%, rgba(255, 180, 0, 0.06) 100%)',
                            color: 'var(--text-primary, #fff)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div
                            style={{
                              width: '42px',
                              height: '42px',
                              borderRadius: '50%',
                              background: 'rgba(255, 215, 0, 0.2)',
                              color: '#ffd700',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Camera size={22} />
                          </div>
                          <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>Snap Photo</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #94a3b8)' }}>Open Camera</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          style={{
                            padding: '16px 12px',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color, #2d3340)',
                            background: 'var(--card-bg, #181b22)',
                            color: 'var(--text-primary, #fff)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div
                            style={{
                              width: '42px',
                              height: '42px',
                              borderRadius: '50%',
                              background: 'rgba(0, 117, 237, 0.15)',
                              color: 'var(--theme-primary, #0075ed)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <ImageIcon size={22} />
                          </div>
                          <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>Photo Gallery</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #94a3b8)' }}>Upload File</span>
                        </button>
                      </div>

                      {/* Desktop Drag & Paste Area */}
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => galleryInputRef.current?.click()}
                        style={{
                          border: `1.5px dashed ${isDragging ? 'var(--theme-primary, #0075ed)' : 'var(--border-color, #2d3340)'}`,
                          borderRadius: '12px',
                          padding: '20px 14px',
                          textAlign: 'center',
                          background: isDragging ? 'rgba(0, 117, 237, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '10px'
                        }}
                      >
                        <Upload size={18} color="var(--theme-primary, #0075ed)" />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #94a3b8)' }}>
                          Or paste screenshot here (<kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px' }}>Ctrl+V</kbd>)
                        </span>
                      </div>
                    </div>
                  )}

                  {/* IMAGE LOADED: Responsive Preview */}
                  {imageData && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        background: 'var(--card-bg, #181b22)',
                        padding: '12px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color, #2d3340)'
                      }}
                    >
                      <div style={{ position: 'relative', width: '100%', maxHeight: '180px', overflow: 'hidden', borderRadius: '8px', background: '#000' }}>
                        <img
                          src={imageData}
                          alt="Question Preview"
                          style={{
                            width: '100%',
                            maxHeight: '180px',
                            objectFit: 'contain',
                            display: 'block'
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleReset}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'rgba(0,0,0,0.65)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Remove image"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* Optional Instruction */}
                      <input
                        type="text"
                        placeholder="Optional: specific part e.g. 'Solve part (b)' or leave blank"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') executeSolve();
                        }}
                        className="quick-solver-input"
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid var(--border-color, #2d3340)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          color: 'var(--text-primary, #fff)',
                          fontSize: '0.82rem',
                          outline: 'none',
                          width: '100%',
                          boxSizing: 'border-box'
                        }}
                      />

                      {/* Retrigger Solve Button */}
                      {!result && !loading && (
                        <button
                          type="button"
                          onClick={() => executeSolve()}
                          style={{
                            background: 'linear-gradient(135deg, var(--theme-primary, #0075ed) 0%, #3b82f6 100%)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '10px 16px',
                            fontWeight: 700,
                            fontSize: '0.86rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          <Zap size={16} style={{ fill: '#ffd700' }} />
                          Solve Now
                        </button>
                      )}
                    </div>
                  )}

                  {/* LOADING STATE */}
                  {loading && (
                    <div
                      style={{
                        padding: '24px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        borderRadius: '12px',
                        background: 'rgba(0, 117, 237, 0.05)',
                        border: '1px solid rgba(0, 117, 237, 0.2)'
                      }}
                    >
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          border: '3px solid rgba(0, 117, 237, 0.2)',
                          borderTopColor: 'var(--theme-primary, #0075ed)',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite'
                        }}
                      />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary, #fff)' }}>
                          Solving with Flash Vision...
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '4px' }}>
                          Target: &lt; 1s • Elapsed: {elapsedSec}s
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ERROR STATE */}
                  {error && (
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: '8px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px'
                      }}
                    >
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div style={{ flex: 1 }}>{error}</div>
                    </div>
                  )}

                  {/* RESULT DISPLAY */}
                  {result && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        animation: 'fadeInScale 0.2s ease-out'
                      }}
                    >
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: '12px',
                          background: 'linear-gradient(135deg, rgba(0, 117, 237, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%)',
                          border: '1.5px solid rgba(0, 117, 237, 0.35)',
                          position: 'relative'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '8px',
                            gap: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: '#10b981'
                              }}
                            >
                              Final Solution
                            </span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary, #94a3b8)' }}>
                              ({result.response_time_ms}ms)
                            </span>
                          </div>

                          <button
                            onClick={() => handleCopy(result.answer)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: copied ? '#10b981' : 'var(--text-secondary, #94a3b8)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              padding: '4px 8px',
                              borderRadius: '4px'
                            }}
                            title="Copy final answer"
                          >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>

                        <div
                          style={{
                            fontSize: '1.05rem',
                            fontWeight: 700,
                            lineHeight: 1.5,
                            color: 'var(--text-primary, #ffffff)',
                            overflowX: 'auto',
                            WebkitOverflowScrolling: 'touch'
                          }}
                        >
                          <MarkdownWithTimestamps content={result.answer} />
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => {
                            if (detailedSolution) {
                              setDetailedSolution(null);
                            } else {
                              executeSolve(imageData, prompt, true);
                            }
                          }}
                          disabled={isExplaining}
                          style={{
                            flex: 1,
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid var(--border-color, #2d3340)',
                            borderRadius: '8px',
                            color: 'var(--text-primary, #fff)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            padding: '8px 14px',
                            minHeight: '40px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          {detailedSolution ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {isExplaining
                            ? 'Deriving steps...'
                            : detailedSolution
                            ? 'Hide Steps'
                            : 'Explain / Show Steps'}
                        </button>

                        <button
                          onClick={handleReset}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color, #2d3340)',
                            borderRadius: '8px',
                            color: 'var(--text-secondary, #94a3b8)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            padding: '8px 14px',
                            minHeight: '40px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <RotateCcw size={14} />
                          Solve Another
                        </button>
                      </div>

                      {/* Expanded Step-by-Step Explanation */}
                      {detailedSolution && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '14px',
                            borderRadius: '8px',
                            background: 'var(--panel-bg, #1e222a)',
                            border: '1px solid var(--border-color, #2d3340)',
                            fontSize: '0.86rem',
                            lineHeight: 1.6,
                            color: 'var(--text-primary, #fff)',
                            overflowX: 'auto',
                            WebkitOverflowScrolling: 'touch'
                          }}
                        >
                          <MarkdownWithTimestamps content={detailedSolution} />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* TAB 2: CLOUD HISTORY */}
              {activeTab === 'history' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* History Controls Bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #2d3340)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryCourseFilter('current');
                          fetchHistory('current');
                        }}
                        style={{
                          background: historyCourseFilter === 'current' ? 'var(--theme-primary, #0075ed)' : 'transparent',
                          color: historyCourseFilter === 'current' ? '#fff' : 'var(--text-secondary, #94a3b8)',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {customCourseContext ? `Course (${customCourseContext})` : 'Active Course'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setHistoryCourseFilter('all');
                          fetchHistory('all');
                        }}
                        style={{
                          background: historyCourseFilter === 'all' ? 'var(--theme-primary, #0075ed)' : 'transparent',
                          color: historyCourseFilter === 'all' ? '#fff' : 'var(--text-secondary, #94a3b8)',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        All Courses
                      </button>
                    </div>

                    {historyItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Trash2 size={12} />
                        Clear All
                      </button>
                    )}
                  </div>

                  {/* History Loading Indicator */}
                  {historyLoading && (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary, #94a3b8)' }}>
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          margin: '0 auto 8px',
                          border: '2px solid rgba(0, 117, 237, 0.2)',
                          borderTopColor: 'var(--theme-primary, #0075ed)',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite'
                        }}
                      />
                      <span style={{ fontSize: '0.8rem' }}>Loading cloud history...</span>
                    </div>
                  )}

                  {/* Empty History State */}
                  {!historyLoading && historyItems.length === 0 && (
                    <div
                      style={{
                        padding: '36px 16px',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                    >
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          background: 'rgba(255, 215, 0, 0.1)',
                          color: '#ffd700',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Clock size={22} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary, #fff)' }}>
                          No Saved Solves
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '4px' }}>
                          {historyCourseFilter === 'current' && customCourseContext
                            ? `No handwritten problems solved for ${customCourseContext} yet.`
                            : 'Every solved handwritten question will appear here.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('solve')}
                        style={{
                          background: 'var(--theme-primary, #0075ed)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px 16px',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >
                        Take a Snap Now
                      </button>
                    </div>
                  )}

                  {/* History List */}
                  {!historyLoading && historyItems.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {historyItems.map((item) => {
                        const isExpanded = expandedHistoryId === item.solve_id;
                        const isCopied = copiedHistoryId === item.solve_id;

                        return (
                          <div
                            key={item.solve_id}
                            style={{
                              padding: '12px',
                              borderRadius: '10px',
                              background: 'var(--card-bg, #181b22)',
                              border: '1px solid var(--border-color, #2d3340)',
                              display: 'flex',
                              gap: '12px',
                              alignItems: 'flex-start'
                            }}
                          >
                            {/* Thumbnail */}
                            {item.image_data && (
                              <div
                                onClick={() => setPreviewThumbnail(item.image_data)}
                                style={{
                                  width: '64px',
                                  height: '64px',
                                  minWidth: '64px',
                                  borderRadius: '6px',
                                  overflow: 'hidden',
                                  background: '#000',
                                  cursor: 'pointer',
                                  border: '1px solid rgba(255,255,255,0.08)'
                                }}
                                title="Click to enlarge"
                              >
                                <img
                                  src={item.image_data}
                                  alt="Question thumbnail"
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                            )}

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {/* Meta */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: 'var(--theme-primary, #0075ed)',
                                      background: 'rgba(0,117,237,0.1)',
                                      padding: '1px 6px',
                                      borderRadius: '4px'
                                    }}
                                  >
                                    {item.course_name || 'General'}
                                  </span>
                                  <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary, #94a3b8)' }}>
                                    {formatRelativeTime(item.created_at)}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopyHistoryAnswer(item.solve_id, item.final_answer, e)}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: isCopied ? '#10b981' : 'var(--text-secondary, #94a3b8)',
                                      cursor: 'pointer',
                                      padding: '4px'
                                    }}
                                    title="Copy answer"
                                  >
                                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteHistoryItem(item.solve_id, e)}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#ef4444',
                                      cursor: 'pointer',
                                      padding: '4px'
                                    }}
                                    title="Delete from cloud"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>

                              {/* Question prompt if any */}
                              {item.prompt && (
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #94a3b8)', fontStyle: 'italic' }}>
                                  "{item.prompt}"
                                </div>
                              )}

                              {/* Final Answer */}
                              <div
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  background: 'rgba(0,117,237,0.06)',
                                  border: '1px solid rgba(0,117,237,0.2)',
                                  fontSize: '0.86rem',
                                  color: 'var(--text-primary, #fff)'
                                }}
                              >
                                <MarkdownWithTimestamps content={item.final_answer} />
                              </div>

                              {/* Detailed steps toggle if present */}
                              {item.detailed_solution && (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedHistoryId(isExpanded ? null : item.solve_id)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--text-secondary, #94a3b8)',
                                      fontSize: '0.74rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      marginTop: '2px'
                                    }}
                                  >
                                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    {isExpanded ? 'Hide Steps' : 'View Steps'}
                                  </button>

                                  {isExpanded && (
                                    <div
                                      style={{
                                        marginTop: '6px',
                                        padding: '10px',
                                        borderRadius: '6px',
                                        background: 'rgba(0,0,0,0.2)',
                                        border: '1px solid var(--border-color, #2d3340)',
                                        fontSize: '0.8rem',
                                        lineHeight: 1.5,
                                        color: 'var(--text-primary, #fff)'
                                      }}
                                    >
                                      <MarkdownWithTimestamps content={item.detailed_solution} />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Preview for Thumbnails */}
      {previewThumbnail && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setPreviewThumbnail(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '85vh' }}>
            <img
              src={previewThumbnail}
              alt="Enlarged"
              style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '10px' }}
            />
            <button
              onClick={() => setPreviewThumbnail(null)}
              style={{
                position: 'absolute',
                top: '-12px',
                right: '-12px',
                background: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                cursor: 'pointer',
                fontWeight: 700
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Global CSS animations & Mobile Media Queries */}
      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .quick-solver-fab {
          bottom: 24px;
          right: 24px;
          padding: 10px 18px;
          border-radius: 9999px;
          font-size: 0.86rem;
        }

        /* Mobile Viewports (< 900px, smartphones and tablets) */
        @media (max-width: 899px) {
          .quick-solver-overlay {
            align-items: center !important;
            justify-content: center !important;
            padding: 14px !important;
          }
          .quick-solver-modal-card {
            width: 95% !important;
            max-width: 480px !important;
            max-height: min(88vh, 88dvh) !important;
            border-radius: 16px !important;
            border: 1px solid var(--border-color, #2d3340) !important;
            margin: auto !important;
            animation: fadeInScale 0.2s ease-out !important;
            overscroll-behavior: contain !important;
          }
          .quick-solver-drag-handle {
            display: none !important;
          }
          .quick-solver-input {
            font-size: 16px !important; /* Critical: Stops iOS Safari from auto-zooming input */
          }
          .quick-solver-fab {
            bottom: calc(var(--mobile-bottom-nav-height, 48px) + var(--safe-bottom, 0px) + 16px) !important;
            right: 14px !important;
            padding: 8px 14px !important;
            font-size: 0.82rem !important;
            box-shadow: 0 4px 18px rgba(0, 117, 237, 0.6), 0 0 12px rgba(255, 215, 0, 0.4) !important;
            z-index: 9999 !important;
          }
          .quick-solver-fab-hotkey {
            display: none !important;
          }
          .quick-solver-hide-mobile {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
