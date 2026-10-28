import React, { useState, useEffect } from 'react';
import {
  Highlighter,
  MessageSquare,
  Sparkles,
  Copy,
  Check,
  X,
  Loader2,
  BookmarkPlus,
  Eraser,
  Bot
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { formatSecondsToTimestamp } from '../../utils/formatters';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function TextSelectionToolbar({
  position,
  selectedText,
  cueId,
  startSeconds,
  endSeconds,
  videoId,
  userEmail,
  onClose,
  onAnnotationCreated,
  onDeleteAnnotation,
  overlappingAnnotations = [],
  initialMode = 'menu',
  onDiscussInTutor
}) {
  const [mode, setMode] = useState(initialMode || 'menu'); // 'menu' | 'note' | 'ai'
  const [noteInput, setNoteInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiPromptType, setAiPromptType] = useState('explain');
  const [copied, setCopied] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialMode === 'ai') {
      setMode('ai');
      handleAskAi('explain');
    }
  }, [initialMode]);

  if (!selectedText) return null;

  const handleHighlight = async (color = 'yellow') => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: userEmail || 'anonymous',
          selected_text: selectedText,
          annotation_type: 'highlight',
          cue_id: cueId,
          start_seconds: startSeconds || 0.0,
          end_seconds: endSeconds || 0.0,
          color
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to create highlight.');
      }
      const data = await res.json();
      if (typeof onAnnotationCreated === 'function') {
        onAnnotationCreated(data.annotation);
      }
      if (typeof window !== 'undefined') {
        window.getSelection()?.removeAllRanges();
      }
      onClose();
    } catch (err) {
      console.error('Error creating highlight:', err);
      setActionError(err.message || 'Error creating highlight');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveNote = async () => {
    if (!noteInput.trim()) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: userEmail || 'anonymous',
          selected_text: selectedText,
          annotation_type: 'note',
          cue_id: cueId,
          start_seconds: startSeconds || 0.0,
          end_seconds: endSeconds || 0.0,
          note_text: noteInput.trim()
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to save note.');
      }
      const data = await res.json();
      if (typeof onAnnotationCreated === 'function') {
        onAnnotationCreated(data.annotation);
      }
      if (typeof window !== 'undefined') {
        window.getSelection()?.removeAllRanges();
      }
      onClose();
    } catch (err) {
      console.error('Error saving note:', err);
      setActionError(err.message || 'Error saving note');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnhighlight = async () => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      if (overlappingAnnotations && overlappingAnnotations.length > 0) {
        for (const ann of overlappingAnnotations) {
          const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${ann.id}`, {
            method: 'DELETE'
          });
          if (res.ok && typeof onDeleteAnnotation === 'function') {
            onDeleteAnnotation(ann.id);
          }
        }
      }
      if (typeof window !== 'undefined') {
        window.getSelection()?.removeAllRanges();
      }
      onClose();
    } catch (err) {
      console.error('Error removing highlight/note:', err);
      setActionError(err.message || 'Error unhighlighting');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAskAi = async (promptType = 'explain') => {
    setMode('ai');
    setAiPromptType(promptType);
    setAiLoading(true);
    setAiResponse('');
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/explain-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: selectedText,
          prompt_type: promptType,
          start_seconds: startSeconds,
          end_seconds: endSeconds
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to generate AI explanation.');
      }
      const data = await res.json();
      setAiResponse(data.explanation || 'No explanation generated.');
    } catch (err) {
      console.error('Error asking AI:', err);
      setAiResponse(`Failed to generate AI explanation: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handlePinAiAsNote = async () => {
    if (!aiResponse) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: userEmail || 'anonymous',
          selected_text: selectedText,
          annotation_type: 'ai_explanation',
          cue_id: cueId,
          start_seconds: startSeconds || 0.0,
          end_seconds: endSeconds || 0.0,
          ai_prompt: aiPromptType,
          ai_response: aiResponse,
          note_text: aiResponse
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to pin AI explanation.');
      }
      const data = await res.json();
      if (typeof onAnnotationCreated === 'function') {
        onAnnotationCreated(data.annotation);
      }
      if (typeof window !== 'undefined') {
        window.getSelection()?.removeAllRanges();
      }
      onClose();
    } catch (err) {
      console.error('Error pinning AI explanation:', err);
      setActionError(err.message || 'Error pinning AI explanation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyQuote = () => {
    navigator.clipboard.writeText(`"${selectedText}"`);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 1200);
  };

  const posX = position?.x ?? position?.left ?? 200;
  const posY = position?.y ?? position?.top ?? 200;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const toolbarLeft = typeof window !== 'undefined'
    ? (isMobile ? '16px' : Math.max(10, Math.min(window.innerWidth - 320, posX - 140)))
    : posX;
  const toolbarTop = typeof window !== 'undefined'
    ? (isMobile ? 'auto' : Math.max(10, Math.min(window.innerHeight - 80, posY > 70 ? posY - 52 : posY + 28)))
    : Math.max(10, posY > 70 ? posY - 52 : posY + 28);
  const toolbarBottom = isMobile ? 'calc(var(--safe-bottom, 0px) + 16px)' : 'auto';

  return (
    <div
      className="text-selection-toolbar"
      style={{
        position: 'fixed',
        left: toolbarLeft,
        right: isMobile ? '16px' : 'auto',
        top: toolbarTop,
        bottom: toolbarBottom,
        zIndex: 1000,
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: isMobile ? '14px' : '8px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
        padding: isMobile ? '10px 12px' : '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxWidth: isMobile ? 'calc(100vw - 32px)' : (mode === 'ai' ? '380px' : '320px'),
        minWidth: isMobile ? 'auto' : '240px',
        animation: 'fadeIn 0.15s ease'
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {actionError && (
        <div style={{
          fontSize: '0.72rem',
          color: '#ef4444',
          background: 'rgba(239, 68, 68, 0.1)',
          padding: '4px 6px',
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}
          >
            <X size={10} />
          </button>
        </div>
      )}
      {mode === 'menu' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
          {/* Highlight Color Pickers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '6px', borderRight: '1px solid var(--border-color)' }}>
            {[
              { col: 'yellow', hex: '#fef08a' },
              { col: 'green', hex: '#bbf7d0' },
              { col: 'blue', hex: '#bfdbfe' },
              { col: 'pink', hex: '#fbcfe8' }
            ].map(c => (
              <button
                key={c.col}
                onClick={() => handleHighlight(c.col)}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                title={`Highlight in ${c.col}`}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: c.hex,
                  border: '1px solid rgba(0, 0, 0, 0.15)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'transform 0.15s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              />
            ))}
          </div>

          {/* Add Note Button */}
          <button
            onClick={() => setMode('note')}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            title="Add margin comment/note"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            <MessageSquare size={13} color="var(--theme-primary)" /> Note
          </button>

          {/* Ask AI Button */}
          <button
            onClick={() => handleAskAi('explain')}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            title="Ask AI to explain selected text"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 6px',
              border: 'none',
              background: 'rgba(168, 85, 247, 0.12)',
              color: '#a855f7',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            <Sparkles size={13} /> Ask AI
          </button>

          {/* Un-highlight Button */}
          {overlappingAnnotations && overlappingAnnotations.length > 0 && (
            <button
              onClick={handleUnhighlight}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              title="Un-highlight / Remove annotation"
              aria-label="Un-highlight annotation"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 6px',
                border: 'none',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              <Eraser size={13} /> Un-highlight
            </button>
          )}

          {/* Copy Quote Button */}
          <button
            onClick={handleCopyQuote}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            title="Copy selected quote"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            aria-label="Close selection menu"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {mode === 'note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Add Margin Note
            </span>
            <button
              onClick={() => setMode('menu')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            autoFocus
            rows={3}
            placeholder="Write study notes or key thoughts on this line..."
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveNote();
              }
            }}
            style={{
              width: '100%',
              fontSize: '0.78rem',
              padding: '6px',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--panel-bg)',
              color: 'var(--text-primary)',
              resize: 'none',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
              Press <kbd style={{ padding: '0 4px', background: 'var(--card-bg)', borderRadius: '3px', border: '1px solid var(--border-color)', fontSize: '0.64rem' }}>Enter</kbd> to save
            </span>
            <button
              onClick={handleSaveNote}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--theme-primary)',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Save Note
            </button>
          </div>
        </div>
      )}

      {mode === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={13} color="#a855f7" />
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                AI Selection Explainer
              </span>
            </div>
            <button
              onClick={() => setMode('menu')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Quick Action Chips */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { id: 'explain', label: 'Explain' },
              { id: 'math_breakdown', label: 'Math Breakdown' },
              { id: 'analogy', label: 'Analogy' },
              { id: 'practice_question', label: 'Quiz Me' }
            ].map(chip => (
              <button
                key={chip.id}
                onClick={() => handleAskAi(chip.id)}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                style={{
                  fontSize: '0.68rem',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: aiPromptType === chip.id ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                  color: aiPromptType === chip.id ? '#a855f7' : 'var(--text-secondary)',
                  fontWeight: aiPromptType === chip.id ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* AI Response Area with Markdown and LaTeX formatting */}
          <div style={{
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '8px 10px',
            background: 'var(--panel-bg)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            fontSize: '0.8rem',
            lineHeight: 1.5,
            color: 'var(--text-primary)'
          }}>
            {aiLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 0', color: 'var(--text-secondary)' }}>
                <Loader2 size={13} className="loading-pulse" color="#a855f7" />
                <span>Thinking...</span>
              </div>
            ) : (
              <div className="ai-explainer-markdown">
                <MarkdownWithTimestamps content={aiResponse} />
              </div>
            )}
          </div>

          {aiResponse && !aiLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
              {/* Copy Option */}
              <button
                type="button"
                aria-label="Copy AI explanation"
                onClick={() => {
                  navigator.clipboard.writeText(aiResponse);
                  setAiCopied(true);
                  setTimeout(() => setAiCopied(false), 1500);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--card-bg)',
                  color: aiCopied ? '#10b981' : 'var(--text-secondary)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {aiCopied ? <><Check size={11} color="#10b981" /> Copied!</> : <><Copy size={11} /> Copy</>}
              </button>

              {/* Discuss in AI Tutor Option */}
              {typeof onDiscussInTutor === 'function' && (
                <button
                  type="button"
                  aria-label="Discuss in AI Tutor"
                  onClick={() => {
                    const ts = startSeconds !== undefined
                      ? formatSecondsToTimestamp(startSeconds)
                      : '';
                    onDiscussInTutor(selectedText, ts);
                    onClose();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    background: 'rgba(99, 102, 241, 0.1)',
                    color: 'var(--theme-primary, #6366f1)',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Bot size={11} /> Discuss in Tutor
                </button>
              )}

              {/* Pin as Note */}
              <button
                type="button"
                onClick={handlePinAiAsNote}
                disabled={isSubmitting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: 'rgba(168, 85, 247, 0.2)',
                  color: '#a855f7',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1
                }}
              >
                <BookmarkPlus size={11} /> {isSubmitting ? 'Pinning...' : 'Pin as Note'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
