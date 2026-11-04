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
  HelpCircle,
  FileText
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

  const fileInputRef = useRef(null);
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
    setImageFileName(file.name || 'Pasted Screenshot');
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
      setError('Please paste or upload an image of the question.');
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
          title="⚡ Quick Snap & Solve (Ctrl+Shift+V)"
          aria-label="Quick Snap & Solve"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '9999px',
            background: 'linear-gradient(135deg, var(--theme-primary, #0075ed) 0%, #3b82f6 100%)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            boxShadow: '0 8px 24px rgba(0, 117, 237, 0.4), 0 2px 6px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.86rem',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            outline: 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
            e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 117, 237, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 117, 237, 0.4)';
          }}
        >
          <Zap size={18} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
          <span>Quick Solver</span>
          <span style={{
            fontSize: '0.68rem',
            background: 'rgba(0, 0, 0, 0.25)',
            padding: '2px 6px',
            borderRadius: '4px',
            opacity: 0.9,
            fontWeight: 600,
            letterSpacing: '0.2px'
          }}>
            Ctrl+Shift+V
          </span>
        </button>
      )}

      {/* Quick Snap Modal Overlay */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            style={{
              background: 'var(--panel-bg, #1e222a)',
              border: '1px solid var(--border-color, #2d3340)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '620px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
              animation: 'fadeInScale 0.2s ease-out'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-color, #2d3340)',
                background: 'var(--card-bg, #181b22)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
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
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary, #fff)' }}>
                      Quick Snap & Solve
                    </h3>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#10b981',
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      &lt; 1s Speed
                    </span>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px' }}>
                    Paste handwritten question or MCQ snapshot (Ctrl+V) for instant answer
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
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Context Hint Input / Pill */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.78rem',
                color: 'var(--text-secondary, #94a3b8)',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #2d3340)'
              }}>
                <Sparkles size={14} color="var(--theme-primary, #0075ed)" />
                <span style={{ fontWeight: 600 }}>Subject / Course Hint:</span>
                <input
                  type="text"
                  placeholder="e.g. Calculus, Linear Algebra, or leave blank"
                  value={customCourseContext}
                  onChange={(e) => setCustomCourseContext(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary, #fff)',
                    fontSize: '0.78rem',
                    flex: 1,
                    outline: 'none'
                  }}
                />
              </div>

              {/* Drop / Paste Area (when no image) */}
              {!imageData && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--theme-primary, #0075ed)' : 'var(--border-color, #2d3340)'}`,
                    borderRadius: '12px',
                    padding: '36px 20px',
                    textAlign: 'center',
                    background: isDragging ? 'rgba(0, 117, 237, 0.08)' : 'var(--card-bg, #181b22)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <div style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    background: 'rgba(0, 117, 237, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--theme-primary, #0075ed)'
                  }}>
                    <Camera size={26} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary, #fff)' }}>
                      Paste screenshot here (<kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '4px' }}>Ctrl+V</kbd>)
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '4px' }}>
                      or drag & drop image, or click to snap photo
                    </div>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) processImageFile(e.target.files[0]);
                    }}
                  />
                </div>
              )}

              {/* Image Preview & Prompt Row (when image is loaded) */}
              {imageData && (
                <div style={{
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'flex-start',
                  background: 'var(--card-bg, #181b22)',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color, #2d3340)'
                }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      src={imageData}
                      alt="Question preview"
                      style={{
                        width: '120px',
                        height: '90px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color, #2d3340)'
                      }}
                    />
                    <button
                      onClick={handleReset}
                      title="Remove image"
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>
                      {imageFileName}
                    </div>
                    <input
                      type="text"
                      placeholder="Optional question clarification (e.g. 'Solve part b only')"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') executeSolve(imageData, prompt, false);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color, #2d3340)',
                        background: 'var(--panel-bg, #1e222a)',
                        color: 'var(--text-primary, #fff)',
                        fontSize: '0.82rem',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                      <button
                        onClick={() => executeSolve(imageData, prompt, false)}
                        disabled={loading}
                        style={{
                          padding: '7px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, var(--theme-primary, #0075ed) 0%, #3b82f6 100%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <Zap size={14} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
                        {loading ? `Solving (${elapsedSec}s)...` : '⚡ Re-Solve'}
                      </button>
                      <button
                        onClick={handleReset}
                        style={{
                          padding: '7px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color, #2d3340)',
                          background: 'transparent',
                          color: 'var(--text-secondary, #94a3b8)',
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        Paste New
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div style={{
                  padding: '12px 14px',
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
                  padding: '24px',
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
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: '3px solid rgba(0, 117, 237, 0.2)',
                    borderTopColor: 'var(--theme-primary, #0075ed)',
                    animation: 'spin 0.8s linear infinite'
                  }} />
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary, #fff)' }}>
                    Analyzing handwritten question...
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #94a3b8)' }}>
                    Running Gemini Flash-Lite multimodal vision ({elapsedSec}s)
                  </div>
                </div>
              )}

              {/* Answer Result Display */}
              {result && !loading && (
                <div style={{
                  background: 'var(--card-bg, #181b22)',
                  borderRadius: '12px',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                }}>
                  {/* Top Result Banner */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.2rem' }}>🎯</span>
                      <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#10b981' }}>
                        Final Answer
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {result.response_time_ms && (
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          border: '1px solid rgba(16, 185, 129, 0.2)'
                        }}>
                          ⚡ {result.response_time_ms}ms
                        </span>
                      )}
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
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: '4px 8px',
                          borderRadius: '6px'
                        }}
                      >
                        {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Render Answer Text with LaTeX Math */}
                  <div style={{
                    fontSize: '1.05rem',
                    lineHeight: 1.6,
                    color: 'var(--text-primary, #fff)',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-color, #2d3340)'
                  }}>
                    <MarkdownWithTimestamps content={result.answer} />
                  </div>

                  {/* Action Row: Explain / Show Steps */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
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
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: isExplaining ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {detailedSolution ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {isExplaining
                        ? 'Deriving full steps...'
                        : detailedSolution
                        ? 'Hide Steps'
                        : 'Explain / Show Steps'}
                    </button>

                    <button
                      onClick={handleReset}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary, #94a3b8)',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <RotateCcw size={13} />
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
                      fontSize: '0.88rem',
                      lineHeight: 1.6,
                      color: 'var(--text-primary, #fff)'
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

      {/* Global CSS animation for modal & spinner */}
      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
