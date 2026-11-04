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
  Image as ImageIcon
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function QuickSnapModal({
  courseContext = '',
  currentTheme
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [imageFileName, setImageFileName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [customCourseContext, setCustomCourseContext] = useState(courseContext);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [detailedSolution, setDetailedSolution] = useState(null);

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const timerRef = useRef(null);

  // Sync default course context when changed from outside
  useEffect(() => {
    if (courseContext && !customCourseContext) {
      setCustomCourseContext(courseContext);
    }
  }, [courseContext]);

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

  // Listen to open-quick-solver event (triggered from Mobile Bottom Nav, Header, CourseTutor, AITutor)
  useEffect(() => {
    const handleOpenEvent = () => setIsOpen(true);
    window.addEventListener('open-quick-solver', handleOpenEvent);
    return () => window.removeEventListener('open-quick-solver', handleOpenEvent);
  }, []);

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
      const b64 = e.target.result;
      setImageData(b64);
      // Auto-trigger solve for instant zero-click speed
      executeSolve(b64, prompt, false);
    };
    reader.onerror = () => {
      setError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  }, [prompt]);

  // Global & modal paste listener (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e) => {
      if (!isOpen) return;
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
  }, [isOpen, processImageFile]);

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

    try {
      const res = await fetch(`${API_BASE}/api/quick-solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: targetImage,
          prompt: extraPrompt || '',
          course_context: customCourseContext || '',
          detailed: detailed
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
    navigator.clipboard.writeText(text);
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

  return (
    <>
      {/* Floating Action Trigger Button (Bottom-Right) */}
      {!isOpen && (
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
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
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
              maxWidth: '620px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
              overflow: 'hidden'
            }}
          >
            {/* Mobile Touch Drag Handle (Visual affordance) */}
            <div className="quick-solver-drag-handle" style={{
              display: 'none',
              width: '38px',
              height: '4px',
              background: 'rgba(255, 255, 255, 0.25)',
              borderRadius: '2px',
              margin: '8px auto 0 auto'
            }} />

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
                <div style={{
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
                }}>
                  <Zap size={18} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #fff)', whiteSpace: 'nowrap' }}>
                      Quick Snap & Solve
                    </h3>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#10b981',
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      padding: '1px 6px',
                      borderRadius: '4px'
                    }}>
                      &lt; 1s Speed
                    </span>
                  </div>
                  <div style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary, #94a3b8)',
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    Instant answer for handwritten math & MCQs
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

            {/* Modal Body */}
            <div style={{
              padding: '16px',
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              WebkitOverflowScrolling: 'touch'
            }}>

              {/* Context Hint Input */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.8rem',
                color: 'var(--text-secondary, #94a3b8)',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #2d3340)'
              }}>
                <Sparkles size={14} color="var(--theme-primary, #0075ed)" style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 600, flexShrink: 0, fontSize: '0.76rem' }}>Subject:</span>
                <input
                  type="text"
                  placeholder="e.g. Calculus, Physics, or leave blank"
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
              </div>

              {/* NO IMAGE LOADED: Mobile Camera & Gallery Action Cards */}
              {!imageData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Mobile-Friendly Big Action Buttons */}
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
                      <div style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: 'rgba(255, 215, 0, 0.2)',
                        color: '#ffd700',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
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
                      <div style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: 'rgba(0, 117, 237, 0.15)',
                        color: 'var(--theme-primary, #0075ed)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
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

              {/* IMAGE LOADED: Responsive Preview & Action Layout */}
              {imageData && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  background: 'var(--card-bg, #181b22)',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color, #2d3340)'
                }}>
                  {/* Image Display & Remove Row */}
                  <div style={{ position: 'relative', width: '100%', maxHeight: '180px', overflow: 'hidden', borderRadius: '8px', background: '#000' }}>
                    <img
                      src={imageData}
                      alt="Question preview"
                      style={{
                        width: '100%',
                        maxHeight: '180px',
                        objectFit: 'contain',
                        display: 'block'
                      }}
                    />
                    <button
                      onClick={handleReset}
                      title="Remove image"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(239, 68, 68, 0.9)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '20px',
                        padding: '4px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
                      }}
                    >
                      <X size={13} />
                      Remove
                    </button>
                  </div>

                  {/* Clarification Input */}
                  <input
                    type="text"
                    placeholder="Optional: 'Part (b) only' or leave blank"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') executeSolve(imageData, prompt, false);
                    }}
                    className="quick-solver-input"
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #2d3340)',
                      background: 'var(--panel-bg, #1e222a)',
                      color: 'var(--text-primary, #fff)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />

                  {/* Big Touch-Friendly Action Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
                    <button
                      onClick={() => executeSolve(imageData, prompt, false)}
                      disabled={loading}
                      style={{
                        padding: '12px 16px',
                        minHeight: '44px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'linear-gradient(135deg, var(--theme-primary, #0075ed) 0%, #3b82f6 100%)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.88rem',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 2px 8px rgba(0, 117, 237, 0.3)'
                      }}
                    >
                      <Zap size={16} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
                      {loading ? `Solving (${elapsedSec}s)...` : '⚡ Solve Now (< 1s)'}
                    </button>

                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      style={{
                        padding: '12px 14px',
                        minHeight: '44px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color, #2d3340)',
                        background: 'var(--panel-bg, #1e222a)',
                        color: 'var(--text-primary, #fff)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      title="Retake photo"
                    >
                      <Camera size={16} />
                      <span className="quick-solver-hide-mobile">Retake</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              {/* Loading Indicator */}
              {loading && (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  background: 'var(--card-bg, #181b22)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color, #2d3340)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    border: '3px solid rgba(0, 117, 237, 0.2)',
                    borderTopColor: 'var(--theme-primary, #0075ed)',
                    animation: 'spin 0.8s linear infinite'
                  }} />
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary, #fff)' }}>
                    Reading handwritten symbols & solving...
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #94a3b8)' }}>
                    Gemini Flash-Lite Multimodal Vision ({elapsedSec}s)
                  </div>
                </div>
              )}

              {/* Answer Result Display */}
              {result && !loading && (
                <div style={{
                  background: 'var(--card-bg, #181b22)',
                  borderRadius: '12px',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                }}>
                  {/* Top Result Banner */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1.15rem' }}>🎯</span>
                      <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#10b981' }}>
                        Final Answer
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {result.response_time_ms && (
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.1)',
                          padding: '2px 7px',
                          borderRadius: '999px',
                          border: '1px solid rgba(16, 185, 129, 0.2)'
                        }}>
                          ⚡ {result.response_time_ms}ms
                        </span>
                      )}
                      <button
                        onClick={() => handleCopy(result.answer)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid var(--border-color, #2d3340)',
                          color: copied ? '#10b981' : 'var(--text-secondary, #94a3b8)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          padding: '5px 10px',
                          borderRadius: '6px',
                          minHeight: '34px'
                        }}
                      >
                        {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Render Answer Text with LaTeX Math (Horizontally scrollable for long equations) */}
                  <div style={{
                    fontSize: '1rem',
                    lineHeight: 1.6,
                    color: 'var(--text-primary, #fff)',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-color, #2d3340)',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch'
                  }}>
                    <MarkdownWithTimestamps content={result.answer} />
                  </div>

                  {/* Action Row: Explain / Show Steps */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    paddingTop: '4px',
                    flexWrap: 'wrap'
                  }}>
                    <button
                      onClick={() => {
                        if (!detailedSolution) {
                          executeSolve(imageData, prompt, true);
                        } else {
                          setDetailedSolution(null);
                        }
                      }}
                      disabled={isExplaining}
                      style={{
                        background: 'rgba(0, 117, 237, 0.1)',
                        border: '1px solid rgba(0, 117, 237, 0.3)',
                        color: 'var(--theme-primary, #0075ed)',
                        borderRadius: '8px',
                        padding: '8px 14px',
                        minHeight: '40px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: isExplaining ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
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
                    <div style={{
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
                    }}>
                      <MarkdownWithTimestamps content={detailedSolution} />
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Global CSS animation for modal & mobile bottom-sheet styling */}
      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUpMobile {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
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
            align-items: flex-end !important;
            padding: 0 !important;
          }
          .quick-solver-modal-card {
            width: 100% !important;
            max-width: 100% !important;
            max-height: 92dvh !important;
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            border-top-left-radius: 20px !important;
            border-top-right-radius: 20px !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
            padding-bottom: max(16px, env(safe-area-inset-bottom, 16px)) !important;
            animation: slideUpMobile 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          .quick-solver-drag-handle {
            display: block !important;
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
