import React, { useState } from 'react';
import {
  FileText,
  BookOpen,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Maximize2,
  Minimize2,
  ExternalLink,
  Headphones
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';
import LecturePodcastPlayer from './LecturePodcastPlayer';

export default function LectureSummary({
  summaryHook,
  activeData,
  handleCueClick,
  handleCrossLectureClick,
  isExpanded = false,
  onToggleExpand
}) {
  const [isPodcastOpen, setIsPodcastOpen] = useState(false);
  const {
    currentSummary,
    viewMode,
    setViewMode,
    loading,
    generating,
    error,
    copiedField,
    copyText,
    generateSummary,
    transcriptAvailable
  } = summaryHook;

  const currentSubmissionText = currentSummary?.submissionText || '';
  const wordCount = currentSummary?.wordCount || (
    currentSubmissionText ? currentSubmissionText.trim().split(/\s+/).filter(Boolean).length : 0
  );

  const handlePopOutWindow = () => {
    if (typeof window === 'undefined') return;
    const title = activeData?.title ? `${activeData.title} — Summary Notes` : 'Lecture Summary';
    const popup = window.open('', '_blank', 'width=920,height=880,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes');
    if (!popup) {
      alert('Pop-up window was blocked by your browser. Please allow popups for this site.');
      return;
    }

    const currentStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(el => el.outerHTML)
      .join('\n');

    const contentHtml = document.querySelector('.summary-markdown-container, .summary-submission-container')?.innerHTML ||
      (currentSummary ? (viewMode === 'submission' ? currentSubmissionText : currentSummary.markdownText) : 'No summary content available.');

    popup.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  ${currentStyles}
  <style>
    body {
      background: var(--bg-dark, #0d1117);
      color: var(--text-primary, #e6edf3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 32px 20px;
      display: flex;
      justify-content: center;
      -webkit-font-smoothing: antialiased;
    }
    .popout-reader-wrap {
      max-width: 880px;
      width: 100%;
      background: var(--card-bg, #161b22);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      padding: 36px 44px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
      line-height: 1.8;
    }
    .popout-topbar {
      border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
      padding-bottom: 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .popout-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
      color: var(--text-primary, #e6edf3);
    }
    .popout-subtitle {
      font-size: 0.8rem;
      color: var(--text-secondary, #8b949e);
      margin-top: 4px;
    }
    .popout-print-btn {
      background: var(--panel-bg, #21262d);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
      color: var(--text-primary, #e6edf3);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 0.8rem;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s ease;
    }
    .popout-print-btn:hover {
      background: var(--theme-primary, #1f6feb);
      color: #ffffff;
    }
  </style>
</head>
<body>
  <div class="popout-reader-wrap">
    <div class="popout-topbar">
      <div>
        <h1 class="popout-title">${title}</h1>
        <div class="popout-subtitle">
          ${viewMode === 'submission' ? 'Assignment Submission Prose' : 'Study Notes'} • Detached Reading Window
        </div>
      </div>
      <button class="popout-print-btn" onclick="window.print()">Print / PDF</button>
    </div>
    <div class="popout-body">
      ${contentHtml}
    </div>
  </div>
  <script>
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('button[data-timestamp], a[data-timestamp]');
      if (btn && window.opener) {
        const time = btn.getAttribute('data-timestamp') || btn.textContent.replace(/[^0-9:]/g, '').trim();
        if (time) {
          window.opener.postMessage({ type: 'LECTURESCRIBE_SEEK', timestamp: time }, '*');
        }
      }
    });
  </script>
</body>
</html>`);
    popup.document.close();
  };

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      background: 'var(--panel-bg)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: '100%',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Top Header */}
      <div style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        background: 'var(--card-bg)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'var(--highlight-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <FileText size={18} color="var(--theme-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Summary & Submissions
            </h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
              Structured Study Notes & Academic Assignment Prose
            </p>
          </div>
        </div>

        {/* Action Buttons: Podcast Audio, Pop-out, Expand/Restore, and Regenerate */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {currentSummary && (
            <button
              type="button"
              onClick={() => setIsPodcastOpen((prev) => !prev)}
              title={isPodcastOpen ? "Hide podcast audio player" : "Listen to single-narrator podcast recap (Google TTS)"}
              aria-label={isPodcastOpen ? "Hide podcast player" : "Listen to lecture summary podcast"}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: isPodcastOpen ? '1px solid var(--theme-primary)' : '1px solid var(--border-color)',
                background: isPodcastOpen ? 'var(--highlight-bg)' : 'var(--panel-bg)',
                color: isPodcastOpen ? 'var(--theme-primary)' : 'var(--text-secondary)',
                transition: 'all 0.2s ease'
              }}
            >
              <Headphones size={13} />
              <span>{isPodcastOpen ? 'Hide Podcast' : 'Audio Podcast'}</span>
            </button>
          )}

          {currentSummary && (
            <button
              type="button"
              onClick={handlePopOutWindow}
              title="Pop out summary into a detached window"
              aria-label="Pop out summary into detached window"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: 'var(--panel-bg)',
                color: 'var(--text-secondary)',
                transition: 'all 0.2s ease'
              }}
            >
              <ExternalLink size={13} />
              <span>Pop Out</span>
            </button>
          )}

          {typeof onToggleExpand === 'function' && (
            <button
              type="button"
              onClick={onToggleExpand}
              title={isExpanded ? "Collapse back to split view (Esc)" : "Expand summary to full workspace (like VS Code)"}
              aria-label={isExpanded ? "Collapse reading view" : "Expand reading view"}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: isExpanded ? '1px solid var(--theme-primary)' : '1px solid var(--border-color)',
                background: isExpanded ? 'var(--highlight-bg)' : 'var(--panel-bg)',
                color: isExpanded ? 'var(--theme-primary)' : 'var(--text-secondary)',
                transition: 'all 0.2s ease'
              }}
            >
              {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span>{isExpanded ? 'Restore (Esc)' : 'Expand'}</span>
            </button>
          )}

          {/* Action: Regenerate */}
          <button
            type="button"
            onClick={() => generateSummary('comprehensive', true)}
            disabled={generating || !transcriptAvailable}
            title="Regenerate this summary from transcript"
            aria-label="Regenerate summary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: generating || !transcriptAvailable ? 'not-allowed' : 'pointer',
              border: '1px solid var(--border-color)',
              background: 'var(--panel-bg)',
              color: 'var(--text-secondary)',
              opacity: generating || !transcriptAvailable ? 0.6 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            <RefreshCw size={13} className={generating ? 'loading-pulse' : ''} />
            <span>{generating ? 'Generating...' : 'Regenerate'}</span>
          </button>
        </div>
      </div>

      {/* Outdated Summary Alert Banner */}
      {summaryHook.isOutdated && (
        <div style={{
          padding: '10px 18px',
          background: 'rgba(245, 158, 11, 0.12)',
          borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} color="#d97706" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
              Transcript Modified — Summary May Be Outdated
            </span>
          </div>
          <button
            type="button"
            onClick={() => generateSummary('comprehensive', true)}
            disabled={generating || !transcriptAvailable}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.74rem',
              fontWeight: 700,
              background: '#d97706',
              color: '#ffffff',
              border: 'none',
              cursor: generating || !transcriptAvailable ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={12} className={generating ? 'loading-pulse' : ''} />
            <span>Regenerate Summary Now</span>
          </button>
        </div>
      )}

      {/* Sub-bar: View Mode Selector & Word Count */}
      <div style={{
        padding: '8px 18px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        background: 'var(--panel-bg)'
      }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '2px',
          gap: '2px'
        }}>
          <button
            type="button"
            onClick={() => setViewMode('study')}
            aria-label="Study Notes View"
            style={{
              background: viewMode === 'study' ? 'var(--theme-primary)' : 'transparent',
              color: viewMode === 'study' ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              padding: '4px 10px',
              borderRadius: '5px',
              fontSize: '0.74rem',
              fontWeight: viewMode === 'study' ? 700 : 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <BookOpen size={12} /> Study Notes
          </button>
          <button
            type="button"
            onClick={() => setViewMode('submission')}
            aria-label="Assignment Submission View"
            style={{
              background: viewMode === 'submission' ? 'var(--theme-primary)' : 'transparent',
              color: viewMode === 'submission' ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              padding: '4px 10px',
              borderRadius: '5px',
              fontSize: '0.74rem',
              fontWeight: viewMode === 'submission' ? 700 : 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <FileText size={12} /> Submission Prose
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isExpanded && (
            <span style={{
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              padding: '2px 8px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              Press <kbd style={{ padding: '0 4px', background: 'var(--panel-bg)', borderRadius: '3px', border: '1px solid var(--border-color)', fontSize: '0.7rem' }}>Esc</kbd> to restore
            </span>
          )}

          {viewMode === 'submission' && Boolean(currentSubmissionText) && (
            <span style={{
              fontSize: '0.74rem',
              color: 'var(--text-secondary)',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)'
            }}>
              • {wordCount} words
            </span>
          )}

          {currentSummary && (
            <button
              type="button"
              onClick={() => setIsPodcastOpen((prev) => !prev)}
              title={isPodcastOpen ? "Hide podcast audio player" : `Listen to ${viewMode === 'submission' ? 'submission prose' : 'lecture summary'} podcast (Google TTS)`}
              aria-label={isPodcastOpen ? "Hide podcast player" : "Listen to podcast audio"}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: isPodcastOpen ? '1px solid var(--theme-primary)' : '1px solid var(--border-color)',
                background: isPodcastOpen ? 'var(--highlight-bg)' : 'var(--card-bg)',
                color: isPodcastOpen ? 'var(--theme-primary)' : 'var(--text-primary)',
                transition: 'all 0.15s ease'
              }}
            >
              <Headphones size={13} />
              <span>{isPodcastOpen ? 'Hide Audio' : 'Audio Podcast'}</span>
            </button>
          )}

          {currentSummary && (
            <button
              type="button"
              onClick={() => {
                const textToCopy = viewMode === 'submission'
                  ? currentSummary.submissionText
                  : currentSummary.markdownText;
                copyText(textToCopy, viewMode);
              }}
              aria-label={viewMode === 'submission' ? 'Copy for Submission' : 'Copy Markdown'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: copiedField === viewMode ? 'rgba(16, 185, 129, 0.15)' : 'var(--card-bg)',
                color: copiedField === viewMode ? '#10b981' : 'var(--text-primary)',
                transition: 'all 0.15s ease'
              }}
            >
              {copiedField === viewMode ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
              <span>{copiedField === viewMode ? 'Copied!' : (viewMode === 'submission' ? 'Copy Submission' : 'Copy Markdown')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{
        flex: '1 1 0%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: isExpanded ? '28px 36px 60px' : '20px 24px',
        scrollBehavior: 'smooth'
      }}>
        {!transcriptAvailable ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '16px',
            borderRadius: '8px',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            color: 'var(--text-primary)'
          }}>
            <AlertCircle size={20} color="#eab308" />
            <span style={{ fontSize: '0.86rem' }}>
              This video was imported without a transcript. AI summaries cannot be generated for this lecture.
            </span>
          </div>
        ) : loading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: 'var(--text-secondary)'
          }}>
            <RefreshCw className="loading-pulse" size={24} color="var(--theme-primary)" />
            <p style={{ marginTop: '12px', fontSize: '0.88rem' }}>Loading lecture summaries...</p>
          </div>
        ) : generating ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: 'var(--text-secondary)'
          }}>
            <Sparkles className="loading-pulse" size={26} color="var(--theme-primary)" />
            <h4 style={{ margin: '14px 0 4px', color: 'var(--text-primary)', fontSize: '0.98rem' }}>
              Synthesizing Full Summary...
            </h4>
            <p style={{ margin: 0, fontSize: '0.82rem' }}>
              Extracting core topics, timestamp references, and academic prose from transcript cues.
            </p>
          </div>
        ) : !currentSummary ? (
          (Array.isArray(activeData?.summarySections) && activeData.summarySections.length > 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                padding: '14px 18px',
                borderRadius: '8px',
                background: 'rgba(0, 117, 237, 0.08)',
                border: '1px solid rgba(0, 117, 237, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div>
                  <h4 style={{ margin: '0 0 4px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Executive Lecture Overview
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Structured chapter breakdown generated during video ingestion. You can also generate an exhaustive academic study guide and assignment prose.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => generateSummary('comprehensive', true)}
                  disabled={generating}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    background: 'var(--theme-primary)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: generating ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Sparkles size={14} />
                  <span>Generate Full Study Notes</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeData.summarySections.map((sec, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '16px 20px'
                    }}
                  >
                    <h5 style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                      {sec.title}
                    </h5>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: '1.6' }}>
                      {(sec.points || []).map((pt, pIdx) => {
                        const timeMatch = pt.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/);
                        if (timeMatch) {
                          const [, timeStr, body] = timeMatch;
                          return (
                            <li key={pIdx} style={{ marginBottom: '6px' }}>
                              <button
                                type="button"
                                onClick={() => handleCueClick && handleCueClick(timeStr)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--theme-primary)',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                  marginRight: '6px',
                                  textDecoration: 'underline'
                                }}
                              >
                                [{timeStr}]
                              </button>
                              <span>{body}</span>
                            </li>
                          );
                        }
                        return <li key={pIdx} style={{ marginBottom: '6px' }}>{pt}</li>;
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              textAlign: 'center',
              color: 'var(--text-secondary)'
            }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'var(--highlight-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '14px'
              }}>
                <FileText size={22} color="var(--theme-primary)" />
              </div>
              <h4 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700 }}>
                No Summary Generated Yet
              </h4>
              <p style={{ margin: '0 0 18px', maxWidth: '420px', fontSize: '0.84rem', lineHeight: '1.5' }}>
                Click below to generate a comprehensive academic summary and submission-ready prose from this lecture.
              </p>
              <button
                type="button"
                onClick={() => generateSummary('comprehensive', true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 18px',
                  borderRadius: '8px',
                  background: 'var(--theme-primary)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0, 117, 237, 0.25)'
                }}
              >
                <Sparkles size={16} />
                <span>Generate Full Summary</span>
              </button>
            </div>
          )
        ) : (
          <div style={{
            maxWidth: isExpanded ? '920px' : '100%',
            margin: isExpanded ? '0 auto' : '0',
            width: '100%'
          }}>
            {isPodcastOpen && (
              <LecturePodcastPlayer
                videoId={activeData?.videoId || currentSummary?.videoId || ''}
                title={activeData?.title || 'Lecture Summary'}
                mode={viewMode}
                summaryText={viewMode === 'submission' ? currentSubmissionText : currentSummary.markdownText}
                onClose={() => setIsPodcastOpen(false)}
              />
            )}

            {viewMode === 'study' ? (
              <div
                className={`summary-markdown-container ${isExpanded ? 'expanded-reader' : ''}`}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: isExpanded ? '32px 48px' : '24px 28px',
                  color: 'var(--text-primary)',
                  lineHeight: '1.75',
                  fontSize: isExpanded ? '0.98rem' : '0.92rem',
                  boxShadow: isExpanded ? '0 4px 20px rgba(0, 0, 0, 0.12)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.25s ease'
                }}
              >
                <MarkdownWithTimestamps
                  content={currentSummary.markdownText}
                  citations={currentSummary.citations}
                  onCueClick={handleCueClick}
                  onCrossLectureClick={handleCrossLectureClick}
                />
              </div>
            ) : (
              <div
                className={`summary-submission-container ${isExpanded ? 'expanded-reader' : ''}`}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: isExpanded ? '32px 48px' : '24px 28px',
                  fontSize: isExpanded ? '1rem' : '0.92rem',
                  lineHeight: '1.8',
                  color: 'var(--text-primary)',
                  boxShadow: isExpanded ? '0 4px 20px rgba(0, 0, 0, 0.12)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.25s ease'
                }}
              >
                {currentSubmissionText ? (
                  <MarkdownWithTimestamps
                    content={currentSubmissionText}
                    citations={currentSummary?.citations || []}
                    onCueClick={handleCueClick}
                    onCrossLectureClick={handleCrossLectureClick}
                  />
                ) : (
                  <p style={{ margin: 0, color: 'var(--text-secondary)' }}>No submission prose available.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

