import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Download,
  FileText,
  Image as ImageIcon,
  FileCode,
  Presentation,
  File,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { formatBytes } from '../../utils/formatters';

export default function ResourcePreviewModal({ open, onClose, resource }) {
  const [isLoading, setIsLoading] = useState(true);
  const [textContent, setTextContent] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!open || !resource) {
      setIsLoading(true);
      setTextContent(null);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setTextContent(null);

    const ext = (resource.filename?.split('.').pop() || resource.file_type || '').toLowerCase();
    const isText = ['txt', 'md', 'json', 'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'csv'].includes(ext);

    // If it's a small text/code file, fetch and display cleanly
    if (isText && (resource.view_url || resource.download_url)) {
      const url = resource.view_url || resource.download_url;
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          setTextContent(text);
          setIsLoading(false);
        })
        .catch((err) => {
          console.warn('Could not fetch text content directly for preview:', err);
          setIsLoading(false);
        });
    } else {
      // For PDF, Images, Office Docs, iframe/img handles display
      const timer = setTimeout(() => setIsLoading(false), 800);
      return () => clearTimeout(timer);
    }
  }, [open, resource]);

  if (!open || !resource) return null;

  const viewUrl = resource.view_url || resource.download_url || '';
  const downloadUrl = resource.download_url || resource.view_url || '';
  const ext = (resource.filename?.split('.').pop() || resource.file_type || '').toLowerCase();

  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
  const isOffice = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);
  const isText = ['txt', 'md', 'json', 'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'csv'].includes(ext);

  // Office documents use Google Docs Viewer for browser preview
  const officeViewerUrl = isOffice && viewUrl
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(viewUrl)}&embedded=true`
    : null;

  const getBadgeInfo = () => {
    if (isPdf) return { label: 'PDF', bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', icon: <FileText size={14} /> };
    if (isImage) return { label: 'IMG', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', icon: <ImageIcon size={14} /> };
    if (isOffice) return { label: 'DOC', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', icon: <Presentation size={14} /> };
    if (isText) return { label: 'CODE', bg: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6', icon: <FileCode size={14} /> };
    return { label: 'FILE', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', icon: <File size={14} /> };
  };

  const badge = getBadgeInfo();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resource Preview"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          width: '94vw',
          maxWidth: '1100px',
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            background: 'var(--card-bg)',
            flexShrink: 0
          }}
        >
          {/* File Title & Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 9px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.5px',
                background: badge.bg,
                color: badge.color,
                flexShrink: 0
              }}
            >
              {badge.icon}
              {badge.label}
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {resource.title || resource.filename}
              </h3>
              {resource.file_size_bytes > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {formatBytes(resource.file_size_bytes)}
                </span>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {viewUrl && (
              <a
                href={viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in new browser tab"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  background: 'var(--highlight-bg)',
                  color: 'var(--theme-primary)',
                  border: '1px solid rgba(0, 117, 237, 0.25)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <ExternalLink size={14} />
                <span>New Tab</span>
              </a>
            )}

            {downloadUrl && (
              <a
                href={downloadUrl}
                download={resource.filename || true}
                title="Download original file"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  background: 'var(--button-secondary-bg, rgba(255, 255, 255, 0.08))',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Download size={14} />
                <span>Download</span>
              </a>
            )}

            <button
              onClick={onClose}
              aria-label="Close preview"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                marginLeft: '4px'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Viewport Content */}
        <div
          style={{
            flex: 1,
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            background: isImage ? '#0f172a' : 'var(--bg-primary, #090d16)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Loading Indicator */}
          {isLoading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '12px',
                zIndex: 5,
                background: 'var(--panel-bg)'
              }}
            >
              <Loader2 size={32} className="spin" style={{ color: 'var(--theme-primary)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loading preview...</span>
            </div>
          )}

          {/* PDF Viewer */}
          {isPdf && viewUrl && (
            <iframe
              src={viewUrl}
              title={resource.title || resource.filename}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setLoadError('Failed to display PDF inline.');
              }}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: '#ffffff'
              }}
            />
          )}

          {/* Image Viewer */}
          {isImage && viewUrl && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                overflow: 'auto'
              }}
            >
              <img
                src={viewUrl}
                alt={resource.title || resource.filename}
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setIsLoading(false);
                  setLoadError('Failed to load image.');
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'
                }}
              />
            </div>
          )}

          {/* Office Documents (Google Docs Viewer) */}
          {isOffice && officeViewerUrl && (
            <iframe
              src={officeViewerUrl}
              title={resource.title || resource.filename}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setLoadError('Failed to load document viewer.');
              }}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: '#ffffff'
              }}
            />
          )}

          {/* Text / Markdown / Code Viewer */}
          {isText && textContent !== null && (
            <div
              style={{
                flex: 1,
                padding: '20px',
                overflowY: 'auto',
                fontFamily: 'monospace, "Fira Code", Courier',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                color: 'var(--text-primary)',
                background: 'var(--panel-bg)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {textContent}
            </div>
          )}

          {/* Fallback / Unsupported File Type or Load Error */}
          {(!viewUrl || (!isPdf && !isImage && !isOffice && !isText) || loadError) && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px',
                textAlign: 'center',
                gap: '16px'
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  background: 'rgba(0, 117, 237, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--theme-primary)'
                }}
              >
                {loadError ? <AlertCircle size={32} /> : badge.icon}
              </div>

              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  {loadError || 'In-Browser Preview Not Available'}
                </h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '420px' }}>
                  {loadError
                    ? 'The file could not be rendered directly inside this modal.'
                    : `This file type (.${ext || 'file'}) cannot be rendered inline. You can open it in a new browser tab or download it directly to your device.`}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {viewUrl && (
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: 'var(--theme-primary)',
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <ExternalLink size={15} /> Open in New Tab
                  </a>
                )}
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={resource.filename || true}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: 'var(--highlight-bg)',
                      color: 'var(--theme-primary)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      textDecoration: 'none',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Download size={15} /> Download File
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
