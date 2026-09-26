import React from 'react';
import {
  Cloud,
  X,
  Folder,
  AlertCircle,
  LogOut,
  ExternalLink,
  Video,
  FileText,
  RefreshCw
} from 'lucide-react';
import GoogleIcon from '../common/GoogleIcon';

export default function DownloadModal({
  open,
  onClose,
  activeData,
  gdriveStatus,
  gdriveError,
  setGdriveError,
  gdriveAccessToken,
  googleUser,
  googleClientIdInput,
  setGoogleClientIdInput,
  gdriveJob,
  gdriveUploading,
  handleGoogleSignIn,
  handleGoogleSignOut,
  handleStartGdriveUpload
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
        maxWidth: '680px',
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
            <Cloud size={20} color="var(--theme-primary)" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Save Lecture Bundle to Google Drive
            </h3>
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
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{
            padding: '14px 18px',
            background: 'rgba(0, 173, 239, 0.08)',
            border: '1px solid rgba(0, 173, 239, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--theme-primary)', fontSize: '0.9rem' }}>
              <Folder size={18} />
              Dedicated Cloud Folder: LectureScribe - {activeData?.title} ({activeData?.videoId})
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Exports the complete lecture bundle into Google Drive:
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li><strong style={{ color: 'var(--theme-primary)' }}><code>{(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()}.mp4</code></strong> — Full lecture video recording</li>
                <li><code>summary.md</code> — Executive dynamic AI summary & key questions</li>
                <li><code>transcript.md</code> — Chronological verbatim lecture transcript</li>
                <li><code>captions.vtt</code> — Complete WebVTT subtitle track</li>
                <li><code>metadata.json</code> — Video ID, stream URLs, timestamps, & statistics</li>
                <li><code>download_guide.txt</code> — Multi-bitrate HLS URLs & terminal download commands</li>
              </ul>
            </div>
          </div>

          {/* Error Notification Banner if any */}
          {gdriveError && (
            <div style={{
              padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} />
                <span>{gdriveError}</span>
              </div>
              <button
                onClick={() => setGdriveError(null)}
                style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', display: 'flex' }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Google Authentication Status / Sign In Card */}
          {gdriveAccessToken ? (
            /* CASE 1: Signed In with Google */
            <div style={{
              padding: '14px 18px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <GoogleIcon />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    Signed in with Google
                    <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>Active</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {googleUser?.email || 'Connected Google Account'}
                  </div>
                </div>
              </div>
              <button
                onClick={handleGoogleSignOut}
                title="Sign out of Google"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer'
                }}
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          ) : (gdriveStatus?.client_id || googleClientIdInput || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID)) ? (
            /* CASE 2: Client ID is known -> Prominent 1-Click Sign In */
            <div style={{
              padding: '20px 18px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              alignItems: 'center',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Sign in to save this lecture bundle to your personal Google Drive
              </div>
              <button
                onClick={handleGoogleSignIn}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  background: '#ffffff',
                  color: '#3c4043',
                  border: '1px solid #dadce0',
                  padding: '10px 24px',
                  borderRadius: '24px',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
              >
                <GoogleIcon />
                Sign in with Google
              </button>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.3 }}>
                Opens Google's official authorization popup. Only grants LectureScribe permission to create and manage the lecture files it uploads.
              </div>
            </div>
          ) : (
            /* CASE 4: Client ID not configured yet -> Simple 1-Step Setup */
            <div style={{
              padding: '16px 18px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                <GoogleIcon />
                Set Up 1-Click Google Sign-In
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                To enable 1-click Google Sign-In, enter your Google OAuth <strong>Client ID</strong> below (or add <code style={{ color: 'var(--theme-primary)' }}>GOOGLE_CLIENT_ID</code> to your project's <code style={{ color: 'var(--theme-primary)' }}>.env</code> file):
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="e.g. 123456789-abcdef.apps.googleusercontent.com"
                  value={googleClientIdInput}
                  onChange={(e) => {
                    setGoogleClientIdInput(e.target.value);
                    try { localStorage.setItem('lecturescribe_google_client_id', e.target.value); } catch {}
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={handleGoogleSignIn}
                  disabled={!googleClientIdInput.trim()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: googleClientIdInput.trim() ? '#ffffff' : 'rgba(255,255,255,0.2)',
                    color: '#3c4043',
                    border: '1px solid #dadce0',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: googleClientIdInput.trim() ? 'pointer' : 'not-allowed'
                  }}
                >
                  <GoogleIcon />
                  Sign In
                </button>
              </div>
            </div>
          )}

          {/* Active Job Progress View */}
          {gdriveJob && (
            <div style={{
              padding: '16px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {gdriveJob.status === 'COMPLETED' ? '✅ Upload Complete!' : gdriveJob.status === 'FAILED' ? '❌ Upload Failed' : '⏳ Uploading in Background...'}
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--theme-primary)' }}>
                  {gdriveJob.progress}%
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: `${gdriveJob.progress}%`,
                  height: '100%',
                  background: gdriveJob.status === 'FAILED' ? '#ef4444' : gdriveJob.status === 'COMPLETED' ? '#10b981' : 'var(--theme-primary)',
                  transition: 'width 0.4s ease'
                }} />
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {gdriveJob.current_step}
              </div>

              {/* Video Warning Notice (if documents uploaded but video had notice) */}
              {gdriveJob.video_warning && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#f59e0b',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  lineHeight: 1.4
                }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Notice:</strong> {gdriveJob.video_warning}
                  </div>
                </div>
              )}

              {/* Completed Files & Link */}
              {gdriveJob.status === 'COMPLETED' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  {gdriveJob.folder_url && (
                    <a
                      href={gdriveJob.folder_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        background: '#10b981',
                        color: '#ffffff',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        fontSize: '0.88rem',
                        fontWeight: 700
                      }}
                    >
                      <ExternalLink size={16} />
                      Open Bundle in Google Drive
                    </a>
                  )}

                  {gdriveJob.files && gdriveJob.files.length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      marginTop: '6px',
                      background: 'var(--bg-secondary)',
                      padding: '10px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Uploaded Files ({gdriveJob.files.length})
                      </div>
                      {gdriveJob.files.map(file => (
                        <a
                          key={file.id || file.name}
                          href={file.url || gdriveJob.folder_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            background: 'var(--card-bg)',
                            borderRadius: '6px',
                            textDecoration: 'none',
                            color: 'var(--text-primary)',
                            fontSize: '0.8rem',
                            border: file.is_video ? '1px solid rgba(0, 173, 239, 0.4)' : '1px solid var(--border-color)'
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {file.is_video ? <Video size={14} color="var(--theme-primary)" /> : <FileText size={14} color="var(--text-secondary)" />}
                            <strong style={{ color: file.is_video ? 'var(--theme-primary)' : 'inherit' }}>{file.name}</strong>
                            {file.is_video && (
                              <span style={{ fontSize: '0.7rem', background: 'var(--highlight-bg)', color: 'var(--theme-primary)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                Video MP4
                              </span>
                            )}
                          </span>
                          <ExternalLink size={12} color="var(--text-secondary)" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error details */}
              {gdriveJob.status === 'FAILED' && (
                <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>
                  {gdriveJob.error}
                </div>
              )}
            </div>
          )}

          {/* Upload Trigger Button - Appears once user is signed in */}
          {(!gdriveJob || gdriveJob.status === 'FAILED') && gdriveAccessToken && (
            <button
              onClick={handleStartGdriveUpload}
              disabled={gdriveUploading}
              style={{
                padding: '12px 20px',
                background: 'var(--theme-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: gdriveUploading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                opacity: gdriveUploading ? 0.6 : 1
              }}
            >
              {gdriveUploading ? <RefreshCw className="spinner" size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Cloud size={18} />}
              {gdriveUploading ? 'Uploading Bundle to Google Drive...' : 'Upload Full Bundle to Google Drive'}
            </button>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--card-bg)',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.84rem'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
