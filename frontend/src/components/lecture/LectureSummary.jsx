import React from 'react';
import {
  FileText,
  BookOpen,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function LectureSummary({
  summaryHook,
  handleCueClick,
  handleCrossLectureClick
}) {
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

        {/* Action: Regenerate */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
        padding: '20px 24px'
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
        ) : viewMode === 'study' ? (
          <div
            className="summary-markdown-container"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '24px 28px',
              color: 'var(--text-primary)',
              lineHeight: '1.75',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
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
            className="summary-submission-container"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '24px 28px',
              fontSize: '0.92rem',
              lineHeight: '1.75',
              color: 'var(--text-primary)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
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
    </div>
  );
}

