import React, { useState, useRef } from 'react';
import {
  Upload,
  X,
  Paperclip,
  Link2,
  AlertCircle,
  Zap,
  RefreshCw,
  FileText,
  Plus
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
  uploadFiles = [],
  setUploadFiles,
  uploadProgress = '',
  removeUploadFile,
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

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const activeFiles = (uploadFiles && uploadFiles.length > 0)
    ? uploadFiles
    : (uploadFile ? [uploadFile] : []);

  const totalBytes = activeFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  const handleFilesSelected = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;
    const filesArray = Array.from(newFiles);
    if (typeof setUploadFiles === 'function') {
      setUploadFiles(prev => [...(prev || []), ...filesArray]);
    }
    if (typeof setUploadFile === 'function') {
      setUploadFile(filesArray[0]);
    }
    if (filesArray.length === 1 && !uploadTitle) {
      setUploadTitle(filesArray[0].name.replace(/\.[^/.]+$/, ''));
    }
    if (typeof setUploadError === 'function') {
      setUploadError('');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleRemoveSingle = (index, e) => {
    e.stopPropagation();
    if (typeof removeUploadFile === 'function') {
      removeUploadFile(index);
    } else if (typeof setUploadFiles === 'function') {
      const remaining = activeFiles.filter((_, i) => i !== index);
      setUploadFiles(remaining);
      if (typeof setUploadFile === 'function') {
        setUploadFile(remaining[0] || null);
      }
    } else if (typeof setUploadFile === 'function') {
      setUploadFile(null);
    }
  };

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
              {/* Dropzone / Multi-File Picker */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--theme-primary)' : 'var(--border-color)'}`,
                  borderRadius: '12px',
                  padding: activeFiles.length > 0 ? '18px 16px' : '28px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: isDragging ? 'var(--highlight-bg, rgba(59, 130, 246, 0.08))' : 'var(--card-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease'
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.py,.zip,.csv,.xlsx"
                  onChange={(e) => {
                    handleFilesSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
                <Upload size={30} color="var(--theme-primary)" style={{ opacity: 0.85 }} />
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  {activeFiles.length > 0
                    ? `${activeFiles.length} file${activeFiles.length > 1 ? 's' : ''} selected (${formatBytes(totalBytes)})`
                    : 'Click or drag files here to upload'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Select one or more items: PDF, Word (.docx), PowerPoint (.pptx), Text, and Zip
                </div>
              </div>

              {/* Selected Files List with individual remove */}
              {activeFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--text-secondary)'
                  }}>
                    <span>Selected Files ({activeFiles.length})</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--theme-primary)',
                        cursor: 'pointer',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Plus size={13} /> Add more files
                    </button>
                  </div>

                  <div style={{
                    maxHeight: '160px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    paddingRight: '4px'
                  }}>
                    {activeFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '7px 12px',
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '0.82rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                          <FileText size={15} color="var(--theme-primary)" style={{ flexShrink: 0 }} />
                          <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 600,
                            color: 'var(--text-primary)'
                          }}>
                            {file.name}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                            ({formatBytes(file.size)})
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleRemoveSingle(idx, e)}
                          title={`Remove ${file.name}`}
                          aria-label={`Remove ${file.name}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '3px',
                            display: 'flex',
                            borderRadius: '4px',
                            marginLeft: '8px'
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resource Title (for single file) or multi-file notice */}
              {activeFiles.length <= 1 ? (
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
              ) : (
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  padding: '6px 10px',
                  background: 'var(--card-bg)',
                  borderRadius: '6px',
                  border: '1px dashed var(--border-color)'
                }}>
                  Each of the {activeFiles.length} files will be titled with its filename.
                </div>
              )}
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
            disabled={isUploading || (uploadMode === 'file' ? activeFiles.length === 0 : !uploadLinkUrl.trim())}
            style={{
              padding: '9px 20px',
              background: 'var(--theme-primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: isUploading || (uploadMode === 'file' ? activeFiles.length === 0 : !uploadLinkUrl.trim()) ? 'not-allowed' : 'pointer',
              opacity: isUploading || (uploadMode === 'file' ? activeFiles.length === 0 : !uploadLinkUrl.trim()) ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {isUploading ? (
              <>
                <RefreshCw className="spinner" size={14} style={{ animation: 'spin 1s linear infinite' }} />
                {uploadProgress || 'Uploading...'}
              </>
            ) : (
              <>
                <Upload size={14} />
                {uploadMode === 'file'
                  ? (activeFiles.length > 1 ? `Upload ${activeFiles.length} Resources` : 'Upload Resource')
                  : 'Save Link'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
