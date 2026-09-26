import React from 'react';
import {
  Upload,
  X,
  Paperclip,
  Link2,
  AlertCircle,
  Zap,
  RefreshCw
} from 'lucide-react';
import { formatBytes } from '../../utils/formatters';

export default function UploadResourceModal({
  open,
  onClose,
  uploadTarget,
  uploadMode,
  setUploadMode,
  uploadFile,
  setUploadFile,
  uploadTitle,
  setUploadTitle,
  uploadLinkUrl,
  setUploadLinkUrl,
  isUploading,
  uploadError,
  setUploadError,
  handleUploadResource
}) {
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--card-bg)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Upload size={20} color="var(--theme-primary)" />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {uploadTarget.videoId ? 'Add Lecture Resource' : 'Add Course Material'}
              </h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {uploadTarget.videoId
                  ? `Attaching to lecture in ${uploadTarget.courseName || 'Course'}`
                  : `Attaching to course: ${uploadTarget.courseName || 'General Lectures'}`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              display: 'flex'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Mode Switcher Tabs */}
          <div style={{
            display: 'flex',
            background: 'var(--card-bg)',
            padding: '4px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <button
              type="button"
              onClick={() => { setUploadMode('file'); setUploadError(''); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: uploadMode === 'file' ? 'var(--highlight-bg)' : 'transparent',
                color: uploadMode === 'file' ? 'var(--theme-primary)' : 'var(--text-secondary)'
              }}
            >
              <Paperclip size={14} /> File Upload (PDF, DOC, PPT)
            </button>
            <button
              type="button"
              onClick={() => { setUploadMode('link'); setUploadError(''); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: uploadMode === 'link' ? 'var(--highlight-bg)' : 'transparent',
                color: uploadMode === 'link' ? 'var(--theme-primary)' : 'var(--text-secondary)'
              }}
            >
              <Link2 size={14} /> External Link / Docs
            </button>
          </div>

          {uploadError && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={16} /> {uploadError}
            </div>
          )}

          {uploadMode === 'file' ? (
            <>
              {/* Dropzone / File Picker */}
              <label
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '12px',
                  padding: '28px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--card-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'border-color 0.2s ease'
                }}
              >
                <input
                  type="file"
                  style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.py,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadFile(file);
                      if (!uploadTitle) {
                        setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
                      }
                      setUploadError('');
                    }
                  }}
                />
                <Upload size={32} color="var(--theme-primary)" style={{ opacity: 0.85 }} />
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  {uploadFile ? uploadFile.name : 'Click or browse to choose a file'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Supports PDF, Word (.docx), PowerPoint (.pptx), Text, and Zip
                </div>
                {uploadFile && (
                  <div style={{
                    marginTop: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#10b981',
                    background: 'rgba(16, 185, 129, 0.12)',
                    padding: '3px 10px',
                    borderRadius: '12px'
                  }}>
                    {formatBytes(uploadFile.size)} selected
                  </div>
                )}
              </label>

              {/* Resource Title */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Resource Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Week 1 Lecture Slides & Syllabus"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </>
          ) : (
            <>
              {/* Link URL */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Resource Link URL
                </label>
                <input
                  type="url"
                  placeholder="https://docs.google.com/document/d/... or Notion / Website"
                  value={uploadLinkUrl}
                  onChange={(e) => setUploadLinkUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Resource Title */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Resource Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shared Google Doc Notes"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </>
          )}

          {/* GCS Direct Signed URL Explanatory Footnote */}
          <div style={{
            padding: '10px 14px',
            background: 'rgba(0, 117, 237, 0.06)',
            border: '1px solid rgba(0, 117, 237, 0.2)',
            borderRadius: '8px',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Zap size={15} color="var(--theme-primary)" style={{ flexShrink: 0 }} />
            <span>Files are uploaded directly to Google Cloud Storage via secure V4 signed URLs.</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--card-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            style={{
              padding: '9px 18px',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              fontSize: '0.84rem'
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleUploadResource}
            disabled={isUploading || (uploadMode === 'file' ? !uploadFile : !uploadLinkUrl.trim())}
            style={{
              padding: '9px 20px',
              background: 'var(--theme-primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: isUploading || (uploadMode === 'file' ? !uploadFile : !uploadLinkUrl.trim()) ? 'not-allowed' : 'pointer',
              opacity: isUploading || (uploadMode === 'file' ? !uploadFile : !uploadLinkUrl.trim()) ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {isUploading ? (
              <>
                <RefreshCw className="spinner" size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={14} />
                {uploadMode === 'file' ? 'Upload Resource' : 'Save Link'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
