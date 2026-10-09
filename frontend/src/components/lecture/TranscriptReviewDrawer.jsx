import React, { useState } from 'react';
import {
  Sparkles,
  Check,
  X,
  RotateCcw,
  Volume2,
  AlertCircle,
  Loader2,
  FileText,
  HelpCircle,
  CheckCircle2
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

export default function TranscriptReviewDrawer({
  open,
  onClose,
  videoId,
  suggestions = [],
  reviewLoading = false,
  reviewError = null,
  reviewJob = null,
  onAcceptSuggestion,
  onRejectSuggestion,
  onUndoSuggestion,
  handleCueClick,
  onTriggerReview
}) {
  const [actionInProgressId, setActionInProgressId] = useState(null);

  if (!open) return null;

  const pendingSuggestions = suggestions.filter(s => s.status === 'pending');
  const acceptedSuggestions = suggestions.filter(s => s.status === 'accepted');
  const rejectedSuggestions = suggestions.filter(s => s.status === 'rejected');

  const handleAccept = async (suggestion) => {
    setActionInProgressId(suggestion.id);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/review/suggestions/${suggestion.id}/accept`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof onAcceptSuggestion === 'function') {
          onAcceptSuggestion(suggestion, data.cue);
        }
      }
    } catch (err) {
      console.error('Error accepting suggestion:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleReject = async (suggestion) => {
    setActionInProgressId(suggestion.id);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/review/suggestions/${suggestion.id}/reject`, {
        method: 'POST'
      });
      if (res.ok) {
        if (typeof onRejectSuggestion === 'function') {
          onRejectSuggestion(suggestion);
        }
      }
    } catch (err) {
      console.error('Error rejecting suggestion:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleUndo = async (suggestion) => {
    setActionInProgressId(suggestion.id);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/review/suggestions/${suggestion.id}/undo`, {
        method: 'POST'
      });
      if (res.ok) {
        if (typeof onUndoSuggestion === 'function') {
          onUndoSuggestion(suggestion);
        }
      }
    } catch (err) {
      console.error('Error undoing suggestion:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const formatSeconds = (sec) => {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      background: 'var(--panel-bg)',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid var(--border-color)',
      boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--card-bg)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={17} color="var(--theme-primary)" />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            AI Transcript Review
          </span>
          <span style={{
            fontSize: '0.72rem',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'var(--highlight-bg)',
            color: 'var(--theme-primary)',
            fontWeight: 600
          }}>
            {pendingSuggestions.length} pending
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onTriggerReview && (
            <button
              onClick={onTriggerReview}
              disabled={reviewLoading}
              title="Run AI Review on Transcript"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'var(--theme-primary)',
                color: '#fff',
                border: 'none',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: reviewLoading ? 'not-allowed' : 'pointer',
                opacity: reviewLoading ? 0.7 : 1
              }}
            >
              {reviewLoading ? (
                <>
                  <Loader2 size={12} className="loading-pulse" />
                  <span>Reviewing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  <span>{suggestions.length > 0 ? 'Re-run Review' : 'Run Review'}</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Review Panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {reviewLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '12px',
            color: 'var(--text-secondary)',
            padding: '40px 20px',
            textAlign: 'center'
          }}>
            <Loader2 size={24} className="loading-pulse" color="var(--theme-primary)" />
            <p style={{ fontSize: '0.86rem', margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
              Analyzing Transcript & Audio with Gemini...
            </p>
            <p style={{ fontSize: '0.74rem', margin: 0, maxWidth: '280px' }}>
              Checking speech recognition accuracy and formatting spoken mathematical equations into LaTeX.
            </p>
          </div>
        ) : reviewError ? (
          <div style={{
            padding: '14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <AlertCircle size={18} color="#ef4444" />
            <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{reviewError}</span>
          </div>
        ) : suggestions.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px'
          }}>
            {reviewJob?.status === 'completed' ? (
              <>
                <CheckCircle2 size={32} color="#10b981" />
                <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  No Errors Found
                </p>
                <p style={{ fontSize: '0.76rem', margin: 0, maxWidth: '260px' }}>
                  The model did not detect any speech recognition errors or unformatted equations. You can still manually edit any cue!
                </p>
              </>
            ) : (
              <>
                <Sparkles size={32} color="var(--theme-primary)" />
                <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  AI Review
                </p>
                <p style={{ fontSize: '0.76rem', margin: 0, maxWidth: '260px' }}>
                  Analyze lecture audio with Gemini to identify transcription errors, fix technical terminology, and format mathematical formulas into KaTeX.
                </p>
                {onTriggerReview && (
                  <button
                    onClick={onTriggerReview}
                    style={{
                      marginTop: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      background: 'var(--theme-primary)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Sparkles size={14} /> Start Review
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          suggestions.map((sugg) => {
            const isAccepted = sugg.status === 'accepted';
            const isRejected = sugg.status === 'rejected';
            const isPending = sugg.status === 'pending';
            const formattedTime = formatSeconds(sugg.startSeconds);

            return (
              <div
                key={sugg.id}
                style={{
                  border: isAccepted
                    ? '1px solid rgba(16, 185, 129, 0.4)'
                    : isRejected
                    ? '1px solid rgba(156, 163, 175, 0.3)'
                    : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  background: isAccepted
                    ? 'rgba(16, 185, 129, 0.05)'
                    : isRejected
                    ? 'rgba(0, 0, 0, 0.03)'
                    : 'var(--card-bg)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  opacity: isRejected ? 0.6 : 1,
                  transition: 'all 0.2s ease'
                }}
              >
                {/* Top Row: Timestamp & Tags */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <button
                    onClick={() => handleCueClick(formattedTime)}
                    title={`Jump to audio at ${formattedTime}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(0, 117, 237, 0.1)',
                      color: 'var(--theme-primary)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '0.74rem',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Volume2 size={12} /> {formattedTime}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: sugg.suggestionType === 'math_latex' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                      color: sugg.suggestionType === 'math_latex' ? '#a855f7' : '#3b82f6',
                      fontWeight: 600
                    }}>
                      {sugg.suggestionType === 'math_latex' ? 'Math (LaTeX)' : 'Correction'}
                    </span>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: isAccepted ? 'rgba(16, 185, 129, 0.2)' : isRejected ? 'rgba(107, 114, 128, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                      color: isAccepted ? '#10b981' : isRejected ? '#6b7280' : '#f59e0b',
                      fontWeight: 700
                    }}>
                      {sugg.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Diff View */}
                <div style={{ fontSize: '0.84rem', lineHeight: 1.4, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, marginRight: '4px' }}>Original:</span>
                    <del style={{ textDecoration: 'line-through', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '1px 4px', borderRadius: '3px' }}>
                      {sugg.originalText}
                    </del>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, marginRight: '4px', color: 'var(--text-secondary)' }}>Suggested:</span>
                    <ins style={{ textDecoration: 'none', color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>
                      {sugg.suggestedText}
                    </ins>
                  </div>
                </div>

                {/* Rationale */}
                {sugg.reason && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic' }}>
                    "{sugg.reason}"
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                  {isPending ? (
                    <>
                      <button
                        onClick={() => handleReject(sugg)}
                        disabled={actionInProgressId === sugg.id}
                        aria-label="Dismiss suggestion"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '5px',
                          border: '1px solid var(--border-color)',
                          background: 'transparent',
                          color: 'var(--text-secondary)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <X size={12} /> Dismiss
                      </button>
                      <button
                        onClick={() => handleAccept(sugg)}
                        disabled={actionInProgressId === sugg.id}
                        aria-label="Accept suggestion"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 10px',
                          borderRadius: '5px',
                          border: 'none',
                          background: '#10b981',
                          color: '#ffffff',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        <Check size={12} /> Accept
                      </button>
                    </>
                  ) : isAccepted ? (
                    <button
                      onClick={() => handleUndo(sugg)}
                      disabled={actionInProgressId === sugg.id}
                      aria-label="Undo accepted edit"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        fontSize: '0.72rem',
                        cursor: 'pointer'
                      }}
                    >
                      <RotateCcw size={11} /> Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAccept(sugg)}
                      disabled={actionInProgressId === sugg.id}
                      aria-label="Re-evaluate and accept"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        fontSize: '0.72rem',
                        cursor: 'pointer'
                      }}
                    >
                      <Check size={11} /> Accept Instead
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
