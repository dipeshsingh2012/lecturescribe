import React, { useState, useMemo } from 'react';
import { CircularProgress, Tooltip } from '@mui/material';
import {
  Paperclip,
  ExternalLink,
  Download,
  Trash2,
  Eye,
  Upload,
  Edit2,
  Check,
  X,
  ArrowUpDown
} from 'lucide-react';
import { formatRelativeTime, formatBytes, getFileTypeBadge } from '../../utils/formatters';
import { sortResources, RESOURCE_SORT_OPTIONS } from '../../utils/lectureSort';

export default function LectureResourcesShelf({
  lectureResources = [],
  lectureResourcesLoading,
  googleUser,
  handleDeleteResource,
  handleRenameResource,
  activeData,
  activeCourseData,
  selectedCourse,
  openPreviewModal,
  openUploadModal
}) {
  const [sortBy, setSortBy] = useState('title_desc');
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const sortedResources = useMemo(() => {
    return sortResources(lectureResources, sortBy);
  }, [lectureResources, sortBy]);

  const startRenaming = (res) => {
    setEditingResourceId(res.id);
    setRenameTitleInput(res.title || res.filename || '');
  };

  const cancelRenaming = () => {
    setEditingResourceId(null);
    setRenameTitleInput('');
  };

  const saveRename = async (resId) => {
    if (!renameTitleInput.trim() || !handleRenameResource) {
      cancelRenaming();
      return;
    }
    setIsRenaming(true);
    try {
      await handleRenameResource(resId, renameTitleInput.trim());
      setEditingResourceId(null);
    } finally {
      setIsRenaming(false);
    }
  };
  return (
    <div style={{
      marginTop: '12px',
      padding: '14px 16px',
      background: 'var(--card-bg)',
      border: '1px solid var(--border-color)',
      borderRadius: '10px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: lectureResources.length > 0 ? '10px' : '0'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Paperclip size={15} color="var(--theme-primary)" />
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Lecture Resources
          </span>
          <span style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '10px',
            background: 'var(--highlight-bg)',
            color: 'var(--theme-primary)'
          }}>
            {lectureResources.length}
          </span>
          {lectureResourcesLoading && <CircularProgress size={14} sx={{ color: 'var(--theme-primary)' }} />}
        </div>

        {openUploadModal && (
          <Tooltip title={!googleUser ? "Sign in with Google to upload resources" : "Upload lecture notes, slides, or links"}>
            <span>
              <button
                onClick={() => {
                  if (!googleUser) return;
                  openUploadModal({
                    courseName: activeCourseData?.course_name || selectedCourse || activeData?.course_name || '',
                    videoId: activeData?.videoId
                  });
                }}
                disabled={!googleUser}
                aria-label="Upload Resource"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: googleUser ? 'var(--card-bg)' : 'rgba(255, 255, 255, 0.04)',
                  color: googleUser ? 'var(--theme-primary)' : 'var(--text-secondary)',
                  border: googleUser ? '1px solid var(--theme-primary)' : '1px solid var(--border-color)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  cursor: googleUser ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  opacity: googleUser ? 1 : 0.6,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s ease'
                }}
              >
                <Upload size={13} />
                <span>Upload Resource</span>
              </button>
            </span>
          </Tooltip>
        )}
      </div>

      {lectureResources.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingTop: '6px' }}>
          No materials or slides attached to this lecture yet.{' '}
          {googleUser ? 'Click "Upload Resource" above to add PDFs, slides, or links.' : 'Sign in to upload resources.'}
        </div>
      ) : (
        <>
          {lectureResources.length > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ArrowUpDown size={13} color="var(--theme-primary)" />
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Sort:
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort resources"
                  style={{
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--panel-bg)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  {RESOURCE_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sortBy === 'title_desc') setSortBy('title_asc');
                  else if (sortBy === 'title_asc') setSortBy('title_desc');
                  else if (sortBy === 'date_desc') setSortBy('date_asc');
                  else if (sortBy === 'date_asc') setSortBy('date_desc');
                  else if (sortBy === 'size_desc') setSortBy('size_asc');
                  else if (sortBy === 'size_asc') setSortBy('size_desc');
                  else setSortBy('title_desc');
                }}
                title={sortBy.endsWith('_desc') ? "Switch to ascending" : "Switch to descending"}
                aria-label="Toggle sort order"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--panel-bg)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.74rem',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                {sortBy === 'title_desc' ? 'Z → A' : sortBy === 'title_asc' ? 'A → Z' : sortBy.endsWith('_desc') ? 'Desc ↓' : 'Asc ↑'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedResources.map((res) => {
            const badge = getFileTypeBadge(res.file_type, res.filename);
            const isOwner = googleUser?.email && res.user_email?.toLowerCase() === googleUser.email.toLowerCase();
            return (
              <div
                key={res.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '8px 12px',
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.82rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    letterSpacing: '0.5px',
                    color: badge.color,
                    background: badge.bg,
                    flexShrink: 0
                  }}>
                    {badge.label}
                  </span>
                  {(!res.video_id || res.video_id === 'null') && (
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      letterSpacing: '0.3px',
                      color: 'var(--theme-primary)',
                      background: 'var(--highlight-bg)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      flexShrink: 0
                    }}>
                      Course Material
                    </span>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {editingResourceId === res.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0' }}>
                        <input
                          autoFocus
                          value={renameTitleInput}
                          onChange={(e) => setRenameTitleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(res.id);
                            if (e.key === 'Escape') cancelRenaming();
                          }}
                          placeholder="Resource title"
                          style={{
                            padding: '3px 8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--input-bg, transparent)',
                            color: 'var(--text-primary)'
                          }}
                        />
                        <button
                          type="button"
                          disabled={isRenaming}
                          onClick={() => saveRename(res.id)}
                          title="Save title"
                          aria-label="Save title"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#10b981',
                            padding: '2px'
                          }}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRenaming}
                          title="Cancel"
                          aria-label="Cancel"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#ef4444',
                            padding: '2px'
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {res.title || res.filename}
                        </span>
                        {typeof handleRenameResource === 'function' && (
                          <button
                            type="button"
                            onClick={() => startRenaming(res)}
                            title="Rename resource"
                            aria-label="Rename resource"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--text-secondary)',
                              opacity: 0.7,
                              padding: '2px',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                          >
                            <Edit2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
                      {res.file_size_bytes > 0 && <span>{formatBytes(res.file_size_bytes)}</span>}
                      <span>{formatRelativeTime(res.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  {res.file_type === 'link' || res.file_type === 'gdrive' ? (
                    <a
                      href={res.view_url || res.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open"
                      aria-label="Open"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '5px 7px',
                        borderRadius: '6px',
                        background: 'var(--highlight-bg)',
                        color: 'var(--theme-primary)',
                        border: '1px solid rgba(0, 117, 237, 0.25)',
                        textDecoration: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <>
                      <button
                        onClick={() => openPreviewModal && openPreviewModal(res)}
                        title="View"
                        aria-label="View"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '5px 7px',
                          borderRadius: '6px',
                          background: 'var(--highlight-bg)',
                          color: 'var(--theme-primary)',
                          border: '1px solid rgba(0, 117, 237, 0.25)',
                          cursor: 'pointer'
                        }}
                      >
                        <Eye size={13} />
                      </button>
                      <a
                        href={res.download_url || res.view_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={res.filename || true}
                        title="Download"
                        aria-label="Download"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '5px 7px',
                          borderRadius: '6px',
                          background: 'var(--button-secondary-bg, rgba(255, 255, 255, 0.05))',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-color)',
                          textDecoration: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <Download size={13} />
                      </a>
                    </>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => handleDeleteResource(res.id, res.video_id || activeData?.videoId, selectedCourse || res.course_name)}
                      title="Delete Resource"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '5px',
                        borderRadius: '6px',
                        background: 'transparent',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}
    </div>
  );
}
