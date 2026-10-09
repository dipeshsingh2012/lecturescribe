import React, { useState } from 'react';
import {
  BookOpen,
  X,
  Volume2,
  Trash2,
  Sparkles,
  MessageSquare,
  Highlighter
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

export default function TranscriptAnnotationsDrawer({
  open,
  onClose,
  videoId,
  annotations = [],
  onDeleteAnnotation,
  handleCueClick
}) {
  const [filterType, setFilterType] = useState('all'); // 'all' | 'note' | 'highlight' | 'ai_explanation'
  const [deleteError, setDeleteError] = useState(null);

  if (!open) return null;

  const filtered = annotations.filter(a => {
    if (filterType === 'all') return true;
    const aType = a.annotationType || a.annotation_type || 'highlight';
    return aType === filterType;
  });

  const formatSeconds = (sec) => {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                    <button
                      onClick={() => handleDelete(item.id)}
                      aria-label="Delete annotation"
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
                      <Trash2 size={13} />
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

                {/* Comment / AI Note */}
                {noteText && (
                  <p style={{ fontSize: '0.82rem', margin: '2px 0', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {noteText}
                  </p>
                )}

                {aiResponse && (
                  <div style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-primary)',
                    background: 'rgba(168, 85, 247, 0.05)',
                    border: '1px solid rgba(168, 85, 247, 0.15)',
                    borderRadius: '6px',
                    padding: '8px',
                    lineHeight: 1.4
                  }}>
                    {aiResponse}
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
