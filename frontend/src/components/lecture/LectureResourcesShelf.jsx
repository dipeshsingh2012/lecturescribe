import React from 'react';
import { CircularProgress } from '@mui/material';
import {
  Paperclip,
  ExternalLink,
  Download,
  Trash2
} from 'lucide-react';
import { formatRelativeTime, formatBytes, getFileTypeBadge } from '../../utils/formatters';

export default function LectureResourcesShelf({
  lectureResources = [],
  lectureResourcesLoading,
  googleUser,
  handleDeleteResource,
  activeData,
  selectedCourse
}) {
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
        </div>
        {lectureResourcesLoading && <CircularProgress size={14} sx={{ color: 'var(--theme-primary)' }} />}
      </div>

      {lectureResources.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingTop: '6px' }}>
          No materials or slides attached to this lecture yet.{' '}
          {googleUser ? 'Click "Upload Resource" above to add PDFs, slides, or links.' : 'Sign in to upload resources.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lectureResources.map((res) => {
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
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {res.title || res.filename}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
                      {res.file_size_bytes > 0 && <span>{formatBytes(res.file_size_bytes)}</span>}
                      <span>{formatRelativeTime(res.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <a
                    href={res.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={res.file_type !== 'link' && res.file_type !== 'gdrive'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      background: 'var(--highlight-bg)',
                      color: 'var(--theme-primary)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    {res.file_type === 'link' || res.file_type === 'gdrive' ? (
                      <><ExternalLink size={13} /> Open</>
                    ) : (
                      <><Download size={13} /> Download</>
                    )}
                  </a>
                  {isOwner && (
                    <button
                      onClick={() => handleDeleteResource(res.id, activeData?.videoId, selectedCourse)}
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
      )}
    </div>
  );
}
