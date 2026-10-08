import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  BookOpen,
  Maximize2,
  Minimize2,
  FileText,
  AlertCircle,
  Loader2,
  Globe,
  Sparkles
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

export default function BookReaderModal({ open, onClose, book, currentTheme }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resolvedEmbedUrl, setResolvedEmbedUrl] = useState('');
  const [resolvedReaderType, setResolvedReaderType] = useState('embed');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isLending, setIsLending] = useState(Boolean(book?.is_lending));

  useEffect(() => {
    if (!open || !book) {
      setResolvedEmbedUrl('');
      setIsLoading(true);
      setHasError(false);
      setIsLending(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    setIsLending(Boolean(book.is_lending));

    // 1. If book already has an embed_url, use it directly
    if (book.embed_url) {
      setResolvedEmbedUrl(book.embed_url);
      setResolvedReaderType(book.reader_type || 'embed');
      setIsLoading(false);
      return;
    }

    // 2. If it's a Google Books preview link with id parameter, construct embed URL immediately
    if (book.preview_url && book.preview_url.includes('books.google.com')) {
      const match = book.preview_url.match(/id=([a-zA-Z0-9_\-]+)/);
      if (match) {
        setResolvedEmbedUrl(`https://books.google.com/books?id=${match[1]}&printsec=frontcover&output=embed`);
        setResolvedReaderType('google_embed');
        setIsLoading(false);
        return;
      }
    }

    // 3. Otherwise, fetch or resolve the digital reader URL on the fly from backend
    if (book.id) {
      fetch(`${API_BASE}/api/course/reading/${book.id}/reader`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (data && data.embed_url) {
            setResolvedEmbedUrl(data.embed_url);
            setResolvedReaderType(data.reader_type || 'embed');
            if (data.is_lending !== undefined) {
              setIsLending(Boolean(data.is_lending));
            }
          } else if (book.preview_url) {
            setResolvedEmbedUrl(book.preview_url);
            setResolvedReaderType('web');
          } else {
            setHasError(true);
          }
        })
        .catch((err) => {
          console.warn("Could not dynamically resolve book reader:", err);
          if (book.preview_url) {
            setResolvedEmbedUrl(book.preview_url);
            setResolvedReaderType('web');
          } else {
            setHasError(true);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (book.preview_url) {
      setResolvedEmbedUrl(book.preview_url);
      setResolvedReaderType('web');
      setIsLoading(false);
    } else {
      setHasError(true);
      setIsLoading(false);
    }
  }, [open, book]);

  // Handle ESC key to close
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !book) return null;

  const getReaderBadge = () => {
    if (isLending) {
      return { label: 'LENDING COPY (BORROW FOR 1 HR)', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' };
    }
    if (resolvedReaderType === 'archive_org' || resolvedEmbedUrl.includes('archive.org/embed')) {
      return { label: 'FULL BOOK (NO LOGIN)', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' };
    }
    if (resolvedReaderType === 'pdf' || resolvedEmbedUrl.endsWith('.pdf')) {
      return { label: 'OPEN-ACCESS PDF', bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' };
    }
    if (resolvedReaderType === 'google_embed' || resolvedEmbedUrl.includes('books.google.com')) {
      return { label: 'GOOGLE BOOKS READER', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' };
    }
    return { label: 'DIGITAL PREVIEW', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' };
  };

  const badge = getReaderBadge();
  const directOpenUrl = book.preview_url || resolvedEmbedUrl || '';
  const iaLoginUrl = 'https://archive.org/account/login';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reading: ${book.title}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: isFullscreen ? 0 : '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--panel-bg, #121316)',
          border: isFullscreen ? 'none' : '1px solid var(--border-color, rgba(255,255,255,0.12))',
          borderRadius: isFullscreen ? 0 : '16px',
          width: isFullscreen ? '100vw' : '95vw',
          maxWidth: isFullscreen ? '100vw' : '1240px',
          height: isFullscreen ? '100vh' : '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          transition: 'all 0.2s ease-in-out'
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            background: 'var(--card-bg, #1a1c23)',
            flexShrink: 0
          }}
        >
          {/* Badge & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 9px',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 800,
                letterSpacing: '0.5px',
                background: badge.bg,
                color: badge.color,
                flexShrink: 0
              }}
            >
              <BookOpen size={13} />
              {badge.label}
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: 'var(--text-primary, #ffffff)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={book.title}
              >
                {book.title}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary, #9ca3af)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {book.author ? `by ${book.author}` : ''} {book.edition ? `• ${book.edition}` : ''}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isLending && (
              <a
                href={iaLoginUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Log in to Internet Archive to borrow this library edition for 1 hour"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#f59e0b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  transition: 'background 0.15s'
                }}
              >
                <Sparkles size={13} />
                <span>Borrow Full Copy (1 Hr)</span>
              </a>
            )}

            {directOpenUrl && (
              <a
                href={directOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open reader in new tab"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-primary, #ffffff)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                  transition: 'background 0.15s'
                }}
              >
                <ExternalLink size={14} />
                <span>External View</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Reader'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-primary, #ffffff)',
                border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                cursor: 'pointer'
              }}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close reader (Esc)"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                cursor: 'pointer'
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Lending Advisory Banner */}
        {isLending && (
          <div
            style={{
              padding: '8px 20px',
              background: 'rgba(245, 158, 11, 0.08)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '0.8rem',
              color: '#fbbf24'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>
                <strong>1-Hour Lending Edition:</strong> To read beyond preview pages, use the <strong>"Borrow"</strong> button inside the reader controls or log in to Internet Archive.
              </span>
            </div>
            <a
              href={iaLoginUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#fbbf24',
                fontWeight: 700,
                textDecoration: 'underline',
                whiteSpace: 'nowrap',
                fontSize: '0.78rem'
              }}
            >
              Sign In to Archive.org &rarr;
            </a>
          </div>
        )}

        {/* Reader Viewer Container */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: '#0d0e12',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {isLoading && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                color: 'var(--text-secondary, #9ca3af)'
              }}
            >
              <Loader2 size={32} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Loading digital book reader...</span>
            </div>
          )}

          {!isLoading && hasError && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                maxWidth: '440px',
                textAlign: 'center',
                gap: '12px',
                padding: '24px',
                color: 'var(--text-primary, #ffffff)'
              }}
            >
              <AlertCircle size={40} color="#f59e0b" />
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>In-Page Reader Unavailable</h4>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.5 }}>
                An interactive embed is not directly accessible for this title due to publisher licensing restrictions.
              </p>
              {directOpenUrl && (
                <a
                  href={directOpenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: '#3b82f6',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    marginTop: '8px'
                  }}
                >
                  <ExternalLink size={15} />
                  <span>Open Book on Web</span>
                </a>
              )}
            </div>
          )}

          {!isLoading && !hasError && resolvedEmbedUrl && (
            <iframe
              src={resolvedEmbedUrl}
              title={book.title}
              width="100%"
              height="100%"
              style={{
                border: 'none',
                width: '100%',
                height: '100%',
                background: '#ffffff'
              }}
              allow="fullscreen; autoplay; clipboard-write; encrypted-media"
            />
          )}
        </div>

        {/* Context Footer */}
        {book.source_context && (
          <div
            style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
              background: 'var(--panel-bg, #14161d)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.75rem',
              color: 'var(--text-secondary, #9ca3af)',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
              <Sparkles size={14} color="#8b5cf6" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>Course Reference:</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {book.source_context}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

