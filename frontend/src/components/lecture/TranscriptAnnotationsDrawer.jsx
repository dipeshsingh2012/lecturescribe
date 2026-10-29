import React, { useState } from 'react';
import {
  BookOpen,
  X,
  Volume2,
  Trash2,
  Sparkles,
  MessageSquare,
  Highlighter,
  Eraser,
  Pencil,
  Check,
  Copy,
  Loader2,
  Bot
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { formatSecondsToTimestamp } from '../../utils/formatters';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function TranscriptAnnotationsDrawer({
  open,
  onClose,
  videoId,
  annotations = [],
  onDeleteAnnotation,
  onUpdateAnnotation,
  handleCueClick,
  onDiscussInTutor
}) {
  const [filterType, setFilterType] = useState('all'); // 'all' | 'note' | 'highlight' | 'ai_explanation'
  const [deleteError, setDeleteError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [explainingId, setExplainingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  if (!open) return null;

  const filtered = annotations.filter(a => {
    if (filterType === 'all') return true;
    const aType = a.annotationType || a.annotation_type || 'highlight';
    return aType === filterType;
  });

  const formatSeconds = formatSecondsToTimestamp;

  const handleSaveEdit = async (annotationId) => {
    const trimmed = (editNoteText || '').trim();
    if (!trimmed) return;
    setSavingEdit(true);
    setDeleteError(null);
    try {
      if (typeof onUpdateAnnotation === 'function') {
        await onUpdateAnnotation(annotationId, trimmed);
      } else if (videoId) {
        const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${annotationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note_text: trimmed })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setDeleteError(err.detail || 'Failed to update note');
          setSavingEdit(false);
          return;
        }
      }
      setEditingId(null);
      setEditNoteText('');
    } catch (err) {
      console.error('Error updating annotation:', err);
      setDeleteError(err.message || 'Error updating note');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (annotationId) => {
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${annotationId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        if (typeof onDeleteAnnotation === 'function') {
          onDeleteAnnotation(annotationId);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.detail || 'Failed to delete annotation');
      }
    } catch (err) {
      console.error('Error deleting annotation:', err);
      setDeleteError(err.message || 'Error deleting annotation');
    }
  };

  const handleExplainNote = async (item, promptType = 'explain') => {
    const textToExplain = item.selectedText || item.selected_text || item.noteText || item.note_text;
    if (!textToExplain) return;
    setExplainingId(item.id);
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/explain-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_text: textToExplain,
          prompt_type: promptType,
          start_seconds: item.startSeconds ?? item.start_seconds ?? 0,
          end_seconds: item.endSeconds ?? item.end_seconds ?? 0
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to generate explanation');
      }
      const data = await res.json();
      const explanation = data.explanation;
      if (explanation) {
        if (typeof onUpdateAnnotation === 'function') {
          await onUpdateAnnotation(item.id, item.noteText || item.note_text || explanation, {
            ai_response: explanation,
            ai_prompt: promptType,
            annotation_type: 'ai_explanation'
          });
        } else if (videoId) {
          await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/annotations/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ai_response: explanation,
              ai_prompt: promptType,
              annotation_type: 'ai_explanation'
            })
          });
        }
      }
    } catch (err) {
      console.error('Error generating AI explanation:', err);
      setDeleteError(err.message || 'Error generating AI explanation');
    } finally {
      setExplainingId(null);
    }
  };

  const getColorClass = (col) => {
    switch (col) {
      case 'green': return '#bbf7d0';
      case 'blue': return '#bfdbfe';
      case 'pink': return '#fbcfe8';
      default: return '#fef08a';
    }
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
          <BookOpen size={17} color="var(--theme-primary)" />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            Reader Notes & Highlights
          </span>
          <span style={{
            fontSize: '0.72rem',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'var(--highlight-bg)',
            color: 'var(--theme-primary)',
            fontWeight: 600
          }}>
            {annotations.length}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close Notes Panel"
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

      {/* Filter Tabs */}
      <div style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        gap: '4px',
        background: 'var(--panel-bg)'
      }}>
        {[
          { key: 'all', label: 'All', icon: BookOpen },
          { key: 'note', label: 'Notes', icon: MessageSquare },
          { key: 'highlight', label: 'Highlights', icon: Highlighter },
          { key: 'ai_explanation', label: 'AI Explanations', icon: Sparkles },
        ].map(tab => {
          const Icon = tab.icon;
          const active = filterType === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilterType(tab.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '5px',
                border: 'none',
                background: active ? 'var(--card-bg)' : 'transparent',
                color: active ? 'var(--theme-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 700 : 500,
                fontSize: '0.74rem',
                cursor: 'pointer',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <Icon size={12} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Error banner */}
      {deleteError && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          color: '#ef4444',
          fontSize: '0.74rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(239, 68, 68, 0.2)'
        }}>
          <span>{deleteError}</span>
          <button
            onClick={() => setDeleteError(null)}
            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Highlighter size={28} color="var(--text-secondary)" style={{ opacity: 0.5 }} />
            <p style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              No annotations yet
            </p>
            <p style={{ fontSize: '0.74rem', margin: 0, maxWidth: '240px' }}>
              Select text on any transcript line to highlight, add margin comments, or ask AI for explanations.
            </p>
          </div>
        ) : (
          filtered.map(item => {
            const startSec = item.startSeconds !== undefined ? item.startSeconds : (item.start_seconds !== undefined ? item.start_seconds : 0);
            const formattedTime = formatSeconds(startSec);
            const annType = item.annotationType || item.annotation_type || 'highlight';
            const isNote = annType === 'note';
            const isAi = annType === 'ai_explanation';
            const isHighlight = annType === 'highlight';
            const selectedText = item.selectedText || item.selected_text || '';
            const noteText = item.noteText || item.note_text;
            const aiResponse = item.aiResponse || item.ai_response;
            const isEditingThis = editingId === item.id;

            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  background: 'var(--card-bg)',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button
                    onClick={() => handleCueClick(formattedTime)}
                    title={`Jump to ${formattedTime}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(0, 117, 237, 0.1)',
                      color: 'var(--theme-primary)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '0.72rem',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Volume2 size={11} /> {formattedTime}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: isAi ? 'rgba(168, 85, 247, 0.15)' : isNote ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: isAi ? '#a855f7' : isNote ? '#3b82f6' : '#d97706',
                      fontWeight: 600
                    }}>
                      {isAi ? 'AI Explainer' : isNote ? 'Margin Note' : 'Highlight'}
                    </span>

                    {/* AI Explain / Re-explain Button */}
                    <button
                      type="button"
                      onClick={() => handleExplainNote(item)}
                      disabled={explainingId === item.id}
                      title={aiResponse ? "Re-explain with AI" : "Explain with AI"}
                      aria-label="Explain note with AI"
                      style={{
                        background: 'rgba(168, 85, 247, 0.12)',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        color: '#a855f7',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        cursor: explainingId === item.id ? 'wait' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      {explainingId === item.id ? (
                        <Loader2 size={11} className="loading-pulse" />
                      ) : (
                        <Sparkles size={11} />
                      )}
                      <span>{explainingId === item.id ? 'Explaining...' : (aiResponse ? 'Re-explain' : 'AI Explain')}</span>
                    </button>

                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => {
                        const toCopy = aiResponse || noteText || selectedText;
                        navigator.clipboard.writeText(toCopy);
                        setCopiedId(item.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      title="Copy text / explanation"
                      aria-label="Copy annotation"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: copiedId === item.id ? '#10b981' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      {copiedId === item.id ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                    </button>

                    {/* Discuss in AI Tutor */}
                    {typeof onDiscussInTutor === 'function' && (
                      <button
                        type="button"
                        onClick={() => onDiscussInTutor(selectedText || noteText || aiResponse, formattedTime)}
                        title="Discuss in AI Tutor"
                        aria-label="Discuss in AI Tutor"
                        style={{
                          background: 'rgba(99, 102, 241, 0.1)',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          color: 'var(--theme-primary, #6366f1)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <Bot size={11} />
                        <span>Discuss</span>
                      </button>
                    )}

                    {!isAi && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditNoteText(noteText || '');
                        }}
                        title="Edit note"
                        aria-label="Edit note"
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
                        <Pencil size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(item.id)}
                      title={isHighlight ? "Un-highlight" : "Delete annotation"}
                      aria-label={isHighlight ? "Un-highlight" : "Delete annotation"}
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
                      {isHighlight ? <Eraser size={13} /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>

                {/* Quoted Text */}
                <blockquote style={{
                  margin: '2px 0',
                  padding: '4px 8px',
                  borderLeft: `3px solid ${getColorClass(item.color)}`,
                  background: 'var(--panel-bg)',
                  borderRadius: '0 4px 4px 0',
                  fontSize: '0.78rem',
                  fontStyle: 'italic',
                  color: 'var(--text-primary)'
                }}>
                  "{selectedText}"
                </blockquote>

                {/* Comment / Edit Mode / AI Note */}
                {isEditingThis ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    <textarea
                      autoFocus
                      aria-label="Edit note input"
                      value={editNoteText}
                      onChange={(e) => setEditNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (editNoteText.trim()) {
                            handleSaveEdit(item.id);
                          }
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditNoteText('');
                        }
                      }}
                      rows={2}
                      placeholder="Write your note... (Press Enter to save)"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--panel-bg)',
                        color: 'var(--text-primary)',
                        fontSize: '0.8rem',
                        resize: 'none',
                        outline: 'none'
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                        Press Enter to save • Shift+Enter for new line
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditNoteText('');
                          }}
                          style={{
                            padding: '3px 8px',
                            fontSize: '0.72rem',
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
                          disabled={!editNoteText.trim() || savingEdit}
                          onClick={() => handleSaveEdit(item.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 10px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: 'none',
                            background: 'var(--theme-primary)',
                            color: '#fff',
                            cursor: 'pointer'
                          }}
                        >
                          <Check size={11} /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  noteText && noteText !== aiResponse && (
                    <div
                      onClick={() => {
                        setEditingId(item.id);
                        setEditNoteText(noteText || '');
                      }}
                      title="Click to edit note"
                      style={{
                        fontSize: '0.82rem',
                        margin: '2px 0',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        lineHeight: 1.5
                      }}
                    >
                      <MarkdownWithTimestamps content={noteText} onCueClick={handleCueClick} />
                    </div>
                  )
                )}

                {aiResponse && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    background: 'rgba(168, 85, 247, 0.06)',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    lineHeight: 1.5
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#a855f7', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Sparkles size={11} /> AI Explanation
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {typeof onDiscussInTutor === 'function' && (
                          <button
                            type="button"
                            aria-label="Discuss AI explanation in Tutor"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDiscussInTutor(selectedText || aiResponse, formattedTime);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '0.68rem',
                              color: 'var(--theme-primary, #6366f1)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Bot size={11} /> Discuss
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Copy AI explanation"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(aiResponse);
                            setCopiedId(`ai-${item.id}`);
                            setTimeout(() => setCopiedId(null), 1500);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.68rem',
                            color: copiedId === `ai-${item.id}` ? '#10b981' : 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                        >
                          {copiedId === `ai-${item.id}` ? <><Check size={11} color="#10b981" /> Copied</> : <><Copy size={11} /> Copy</>}
                        </button>
                      </div>
                    </div>
                    <MarkdownWithTimestamps content={aiResponse} onCueClick={handleCueClick} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
