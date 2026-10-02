import React, { useState, useEffect } from 'react';
import {
  Cloud,
  X,
  Folder,
  AlertCircle,
  LogOut,
  ExternalLink,
  Video,
  FileText,
  RefreshCw,
  Check
} from 'lucide-react';
import GoogleIcon from '../common/GoogleIcon';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import { API_BASE } from '../../utils/constants';

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
  handleStartGdriveUpload,
  userLibrary = [],
  effectiveCourses = []
}) {
  const [fetchedDriveUrl, setFetchedDriveUrl] = useState(null);

  const targetVideoId = String(activeData?.videoId || activeData?.video_id || '').trim();
  const activeEmail = (googleUser?.email || '').trim().toLowerCase();

  const findDriveUrl = (list) => {
    if (!Array.isArray(list) || !targetVideoId) return null;
    const item = list.find(l => {
      const vid = String(l?.videoId || l?.video_id || '').trim();
      return vid && vid === targetVideoId;
    });
    return item?.drive_folder_url || item?.driveFolderUrl || null;
  };

  const propDriveUrl = (
    activeData?.drive_folder_url ||
    activeData?.driveFolderUrl ||
    findDriveUrl(userLibrary) ||
    findDriveUrl(effectiveCourses?.flatMap(c => c.lectures || [])) ||
    (gdriveJob?.status === 'COMPLETED' ? gdriveJob.folder_url : null)
  );

  const driveFolderUrl = propDriveUrl || fetchedDriveUrl;

  useEffect(() => {
    let isCancelled = false;
    if (open && targetVideoId && activeEmail && !propDriveUrl) {
      fetch(`${API_BASE}/api/user/library?email=${encodeURIComponent(activeEmail)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (isCancelled || !data) return;
          const list = data.lectures || data.library || [];
          const match = list.find(l => String(l?.videoId || l?.video_id || '').trim() === targetVideoId);
          const foundUrl = match?.drive_folder_url || match?.driveFolderUrl;
          if (foundUrl) {
            setFetchedDriveUrl(foundUrl);
          }
        })
        .catch(() => {});
    }
    return () => { isCancelled = true; };
  }, [open, targetVideoId, activeEmail, propDriveUrl]);

  if (!open) return null;

  const isAlreadySynced = Boolean(driveFolderUrl);

  const hasPartialUpload = Boolean(
    !isAlreadySynced &&
    gdriveJob?.status === 'FAILED' && (
      (Array.isArray(gdriveJob.files) && gdriveJob.files.length > 0) ||
      gdriveJob.folder_id ||
      (typeof gdriveJob.progress === 'number' && gdriveJob.progress > 5)
    )
  );

  const uploadButtonLabel = gdriveUploading
    ? (isAlreadySynced
        ? 'Re-uploading Bundle to Google Drive...'
        : hasPartialUpload
          ? 'Resuming Upload to Google Drive...'
          : 'Uploading Bundle to Google Drive...')
    : (isAlreadySynced
        ? (gdriveJob?.status === 'FAILED' ? 'Retry Re-upload to Google Drive' : 'Re-upload Bundle to Google Drive')
        : hasPartialUpload
          ? 'Resume Upload to Google Drive'
          : (gdriveJob?.status === 'FAILED' ? 'Retry Upload to Google Drive' : 'Upload Full Bundle to Google Drive'));

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: isAlreadySynced ? 'rgba(16, 185, 129, 0.15)' : 'var(--highlight-bg)',
              border: isAlreadySynced ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--badge-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {isAlreadySynced ? (
                <GoogleDriveIcon size={20} />
              ) : (
                <Cloud size={20} color="var(--theme-primary)" />
              )}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {isAlreadySynced ? 'Lecture Bundle Synced to Google Drive' : 'Save Lecture Bundle to Google Drive'}
              </h3>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {isAlreadySynced
                  ? 'This lecture is already synced in your Google Drive. You can view or re-upload below.'
                  : (activeData?.title ? activeData.title : 'Export video recording, notes, transcripts, & captions')}
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
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              transition: 'background 0.2s, color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--highlight-bg)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Synced Status Banner when already saved */}
          {isAlreadySynced && (
            <div style={{
              padding: '16px 18px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#10b981', fontSize: '0.92rem' }}>
                  <GoogleDriveIcon size={18} />
                  <span>Already Synced to Google Drive</span>
                </div>
                <span style={{
                  fontSize: '0.74rem',
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <Check size={11} strokeWidth={3} /> Synced
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                This lecture bundle (video, AI summary, full transcript, captions, and metadata) is already saved in your Google Drive.
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '2px' }}>
                <a
                  href={driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    background: '#10b981',
                    color: '#ffffff',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                    transition: 'filter 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.08)'}
                  onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                >
                  <ExternalLink size={14} />
                  Open in Google Drive
                </a>
              </div>
            </div>
          )}

          <div style={{
            padding: '16px 18px',
            background: 'var(--highlight-bg)',
            border: '1px solid var(--badge-border)',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--theme-primary)', fontSize: '0.9rem' }}>
              <Folder size={18} />
              Dedicated Cloud Folder: LectureScribe - {activeData?.title} ({targetVideoId})
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {isAlreadySynced
                ? 'Files included in this Google Drive lecture bundle:'
                : 'Exports the complete lecture bundle into Google Drive:'}
              <ul style={{ margin: '8px 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>
                  <strong style={{ color: 'var(--theme-primary)' }}>
                    <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--theme-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>
                      {(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim()}.mp4
                    </code>
                  </strong> — Full lecture video recording
                </li>
                <li>
                  <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>summary.md</code> — Executive dynamic AI summary & key questions
                </li>
                <li>
                  <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>transcript.md</code> — Chronological verbatim lecture transcript
                </li>
                <li>
                  <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>captions.vtt</code> — Complete WebVTT subtitle track
                </li>
                <li>
                  <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>metadata.json</code> — Video ID, stream URLs, timestamps, & statistics
                </li>
                <li>
                  <code style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '1px 6px', borderRadius: '4px', fontSize: '0.78rem' }}>download_guide.txt</code> — Multi-bitrate HLS URLs & terminal download commands
                </li>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{gdriveError}</span>
              </div>
              {/permission|scope|insufficient|403/i.test(gdriveError) && (
                <button
                  onClick={() => handleGoogleSignIn(false, true)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.25)',
                    border: '1px solid #f87171',
                    color: '#ffffff',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Re-authorize Drive
                </button>
              )}
              <button
                onClick={() => setGdriveError(null)}
                style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Google Authentication Status / Sign In Card */}
          {gdriveAccessToken ? (
            /* CASE 1: Signed In with Google */
            <div style={{
              padding: '16px 20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              boxShadow: 'var(--card-shadow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <GoogleIcon />
                </div>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Signed in with Google
                    <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>Active</span>
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
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text-primary)';
                  e.currentTarget.style.borderColor = 'var(--text-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          ) : (gdriveStatus?.client_id || googleClientIdInput || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID)) ? (
            /* CASE 2: Client ID is known -> 1-Click Connect or Re-authorize */
            <div style={{
              padding: '22px 20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              boxShadow: 'var(--card-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              alignItems: 'center',
              textAlign: 'center'
            }}>
              {googleUser ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <GoogleDriveIcon size={18} />
                    <span>Authorize Google Drive Access for <strong style={{ color: 'var(--theme-primary)' }}>{googleUser.email}</strong></span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '480px', lineHeight: 1.5 }}>
                    You are signed in as <strong>{googleUser.email}</strong>. Google requires an active authorization token to create and save lecture folders in your personal Google Drive.
                  </div>
                  <button
                    onClick={() => handleGoogleSignIn(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      background: 'var(--theme-primary)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '11px 26px',
                      borderRadius: '24px',
                      fontSize: '0.92rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
                      transition: 'background 0.2s ease, transform 0.1s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--theme-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--theme-primary)'}
                  >
                    <GoogleDriveIcon size={18} />
                    Authorize Google Drive
                  </button>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.4 }}>
                    Grants permission only to create and manage the lecture bundle files LectureScribe uploads.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Sign in to save this lecture bundle to your personal Google Drive
                  </div>
                  <button
                    onClick={() => handleGoogleSignIn(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      background: 'var(--panel-bg)',
                      color: 'var(--text-primary)',
                      border: '1.5px solid var(--border-color)',
                      padding: '11px 26px',
                      borderRadius: '24px',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--theme-primary)';
                      e.currentTarget.style.background = 'var(--highlight-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--panel-bg)';
                    }}
                  >
                    <GoogleIcon />
                    Sign in with Google
                  </button>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '440px', lineHeight: 1.4 }}>
                    Opens Google's official authorization popup. Only grants LectureScribe permission to create and manage the lecture files it uploads.
                  </div>
                </>
              )}
            </div>
          ) : (
            /* CASE 4: Client ID not configured yet -> Simple 1-Step Setup */
            <div style={{
              padding: '18px 20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              boxShadow: 'var(--card-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                <GoogleIcon />
                Set Up 1-Click Google Sign-In
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                To enable 1-click Google Sign-In, enter your Google OAuth <strong>Client ID</strong> below (or add <code style={{ color: 'var(--theme-primary)', background: 'var(--panel-bg)', padding: '1px 5px', borderRadius: '4px' }}>GOOGLE_CLIENT_ID</code> to your project's <code style={{ color: 'var(--theme-primary)', background: 'var(--panel-bg)', padding: '1px 5px', borderRadius: '4px' }}>.env</code> file):
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
                    borderRadius: '8px',
                    padding: '9px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--theme-primary)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
                <button
                  onClick={handleGoogleSignIn}
                  disabled={!(googleClientIdInput || '').trim()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: (googleClientIdInput || '').trim() ? 'var(--theme-primary)' : 'var(--panel-bg)',
                    color: (googleClientIdInput || '').trim() ? '#ffffff' : 'var(--text-secondary)',
                    border: (googleClientIdInput || '').trim() ? 'none' : '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '9px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: (googleClientIdInput || '').trim() ? 'pointer' : 'not-allowed',
                    transition: 'background 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if ((googleClientIdInput || '').trim()) e.currentTarget.style.background = 'var(--theme-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if ((googleClientIdInput || '').trim()) e.currentTarget.style.background = 'var(--theme-primary)';
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
              padding: '18px 20px',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              boxShadow: 'var(--card-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {gdriveJob.status === 'COMPLETED' ? '✅ Upload Complete!' : gdriveJob.status === 'FAILED' ? '❌ Upload Failed' : '⏳ Uploading in Background...'}
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--theme-primary)' }}>
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

              {/* Completed Files & Link (or partial uploads when interrupted) */}
              {(gdriveJob.status === 'COMPLETED' || (gdriveJob.status === 'FAILED' && gdriveJob.files && gdriveJob.files.length > 0)) && (
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
                        padding: '11px 18px',
                        background: gdriveJob.status === 'COMPLETED' ? '#10b981' : 'var(--theme-primary)',
                        color: '#ffffff',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        fontSize: '0.88rem',
                        fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        transition: 'filter 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                    >
                      <ExternalLink size={16} />
                      {gdriveJob.status === 'COMPLETED' ? 'Open Bundle in Google Drive' : 'View Saved Files in Google Drive'}
                    </a>
                  )}

                  {gdriveJob.files && gdriveJob.files.length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      marginTop: '6px',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--border-color)',
                      padding: '12px',
                      borderRadius: '10px'
                    }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {gdriveJob.status === 'COMPLETED'
                          ? `Uploaded Files (${gdriveJob.files.length})`
                          : `Partially Uploaded (${gdriveJob.files.length} saved in Google Drive)`}
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
                            padding: '8px 10px',
                            background: 'var(--card-bg)',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: 'var(--text-primary)',
                            fontSize: '0.8rem',
                            border: file.is_video ? '1px solid var(--badge-border)' : '1px solid var(--border-color)',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--theme-primary)';
                            e.currentTarget.style.background = 'var(--highlight-bg)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = file.is_video ? 'var(--badge-border)' : 'var(--border-color)';
                            e.currentTarget.style.background = 'var(--card-bg)';
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {file.is_video ? <Video size={14} color="var(--theme-primary)" /> : <FileText size={14} color="var(--text-secondary)" />}
                            <strong style={{ color: file.is_video ? 'var(--theme-primary)' : 'inherit' }}>{file.name}</strong>
                            {file.is_video && (
                              <span style={{ fontSize: '0.7rem', background: 'var(--badge-bg)', color: 'var(--badge-color)', border: '1px solid var(--badge-border)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
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
                <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '4px' }}>
                  {gdriveJob.error}
                </div>
              )}
            </div>
          )}

          {/* Upload / Re-upload Trigger Button */}
          {gdriveAccessToken && (!gdriveJob || gdriveJob.status === 'FAILED' || isAlreadySynced) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={handleStartGdriveUpload}
                disabled={gdriveUploading}
                style={{
                  padding: '13px 20px',
                  background: isAlreadySynced ? 'var(--panel-bg)' : 'var(--theme-primary)',
                  color: isAlreadySynced ? 'var(--text-primary)' : '#ffffff',
                  border: isAlreadySynced ? '1.5px solid var(--border-color)' : 'none',
                  borderRadius: '8px',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  cursor: gdriveUploading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  opacity: gdriveUploading ? 0.7 : 1,
                  boxShadow: 'var(--card-shadow, 0 4px 12px rgba(0, 0, 0, 0.12))',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  if (!gdriveUploading) {
                    if (isAlreadySynced) {
                      e.currentTarget.style.borderColor = 'var(--theme-primary)';
                      e.currentTarget.style.background = 'var(--highlight-bg)';
                    } else {
                      e.currentTarget.style.background = 'var(--theme-hover)';
                    }
                  }
                }}
                onMouseLeave={(e) => {
                  if (!gdriveUploading) {
                    if (isAlreadySynced) {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--panel-bg)';
                    } else {
                      e.currentTarget.style.background = 'var(--theme-primary)';
                    }
                  }
                }}
              >
                {gdriveUploading ? (
                  <RefreshCw className="spinner" size={18} style={{ animation: 'spin 1s linear infinite' }} />
                ) : isAlreadySynced || hasPartialUpload ? (
                  <RefreshCw size={18} />
                ) : (
                  <Cloud size={18} />
                )}
                {uploadButtonLabel}
              </button>

              {isAlreadySynced && !gdriveUploading && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Re-uploading updates AI summaries, notes, transcripts, or video in your existing Google Drive folder.
                </div>
              )}
            </div>
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
              padding: '8px 20px',
              background: 'var(--panel-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.84rem',
              fontWeight: 600,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.borderColor = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
