import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/constants';

export function useGoogleAuth(activeData, onUploadSuccess) {
  const [gdriveStatus, setGdriveStatus] = useState(null);
  const [gdriveJobId, setGdriveJobId] = useState(null);
  const [gdriveJob, setGdriveJob] = useState(null);
  const [gdriveUploading, setGdriveUploading] = useState(false);
  const [gdriveAccessToken, setGdriveAccessToken] = useState(() => {
    try {
      const token = localStorage.getItem('lecturescribe_gdrive_token') || '';
      const expiresAt = Number(localStorage.getItem('lecturescribe_gdrive_token_expires') || '0');
      if (expiresAt > 0 && Date.now() > expiresAt) {
        localStorage.removeItem('lecturescribe_gdrive_token');
        localStorage.removeItem('lecturescribe_gdrive_token_expires');
        return '';
      }
      return token;
    } catch {
      return '';
    }
  });

  const [googleUser, setGoogleUser] = useState(() => {
    try {
      const saved = localStorage.getItem('lecturescribe_google_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [userRole, setUserRoleState] = useState(() => {
    try {
      const savedRole = localStorage.getItem('lecturescribe_user_role');
      if (savedRole === 'tutor' || savedRole === 'student') return savedRole;
      const savedUser = localStorage.getItem('lecturescribe_google_user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed?.role === 'tutor' || parsed?.effective_role === 'tutor') return 'tutor';
        return 'student';
      }
      return 'guest';
    } catch {
      return 'guest';
    }
  });
  const [courseRoles, setCourseRoles] = useState({});

  const syncUserRoleSession = async (userObj) => {
    const email = userObj?.email;
    if (!email || email === 'Google User') {
      setUserRoleState('guest');
      return 'guest';
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: userObj.name || null,
          picture_url: userObj.picture || null
        })
      });
      if (res.ok) {
        const data = await res.json();
        const effective = data.effective_role === 'tutor' ? 'tutor' : 'student';
        setUserRoleState(effective);
        if (data.course_roles && typeof data.course_roles === 'object') {
          setCourseRoles(data.course_roles);
        }
        try {
          localStorage.setItem('lecturescribe_user_role', effective);
        } catch {}
        return effective;
      }
    } catch (err) {
      console.warn('Could not sync user role session:', err);
    }
    return userRole === 'guest' ? 'student' : userRole;
  };

  const switchUserRole = async (nextRole) => {
    const normalized = nextRole === 'tutor' ? 'tutor' : 'student';
    setUserRoleState(normalized);
    try {
      localStorage.setItem('lecturescribe_user_role', normalized);
    } catch {}
    if (googleUser?.email && googleUser.email !== 'Google User') {
      try {
        const res = await fetch(`${API_BASE}/api/auth/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: googleUser.email,
            role: normalized,
            update_system_role: true
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.effective_role) {
            setUserRoleState(data.effective_role);
            try {
              localStorage.setItem('lecturescribe_user_role', data.effective_role);
            } catch {}
          }
        }
      } catch (err) {
        console.warn('Role switch backend sync warning:', err);
      }
    }
    return normalized;
  };

  useEffect(() => {
    if (googleUser?.email && googleUser.email !== 'Google User') {
      syncUserRoleSession(googleUser);
    } else if (!googleUser) {
      setUserRoleState('guest');
    }
  }, [googleUser?.email]);

  const [googleClientIdInput, setGoogleClientIdInput] = useState(() => {
    try {
      return localStorage.getItem('lecturescribe_google_client_id') || '';
    } catch {
      return '';
    }
  });

  const [gdriveError, setGdriveError] = useState(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const pollIntervalRef = useRef(null);

  const handleGoogleSignIn = async (autoStartUpload = false, forceConsent = false) => {
    let currentStatus = gdriveStatus;
    if (!currentStatus?.client_id) {
      try {
        const res = await fetch(`${API_BASE}/api/cloud/gdrive/status`);
        if (res.ok) {
          currentStatus = await res.json();
          setGdriveStatus(currentStatus);
        }
      } catch (err) {
        console.warn("Could not fetch Google Drive status on sign-in:", err);
      }
    }

    const activeClientId = (
      currentStatus?.client_id ||
      googleClientIdInput ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID) ||
      ''
    ).trim();

    if (!activeClientId) {
      setGdriveError("Please enter your Google OAuth Client ID to enable 1-click Sign In.");
      return;
    }

    if (!window.google?.accounts?.oauth2) {
      setGdriveError("Google Identity Services is still loading. Please check your internet connection or try again in a few seconds.");
      return;
    }

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: activeClientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
        hint: googleUser?.email || undefined,
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error("Google Sign-in error:", tokenResponse);
            setGdriveError(`Sign-in was cancelled or failed: ${tokenResponse.error_description || tokenResponse.error}`);
            return;
          }
          if (tokenResponse.access_token) {
            const token = tokenResponse.access_token;
            const grantedScope = tokenResponse.scope || '';
            const hasDriveScope = (
              grantedScope.includes('drive.file') ||
              grantedScope.includes('drive') ||
              (window.google?.accounts?.oauth2?.hasGrantedAnyScope &&
               window.google.accounts.oauth2.hasGrantedAnyScope(tokenResponse, 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'))
            );

            // If user signed in while export modal was open, ensure Drive scope was granted
            if (isDownloadModalOpen && !hasDriveScope) {
              setGdriveError("Google Drive permission was not granted. Please click 'Authorize Google Drive' again and check the Google Drive permission box in the popup.");
              return;
            }

            setGdriveAccessToken(token);
            const expiresIn = tokenResponse.expires_in ? Number(tokenResponse.expires_in) : 3599;
            const expiresAt = Date.now() + (expiresIn * 1000);
            try {
              localStorage.setItem('lecturescribe_gdrive_token', token);
              localStorage.setItem('lecturescribe_gdrive_token_expires', expiresAt.toString());
            } catch {}
            setGdriveError(null);

            try {
              const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                setGoogleUser(uData);
                try { localStorage.setItem('lecturescribe_google_user', JSON.stringify(uData)); } catch {}
                await syncUserRoleSession(uData);
                if (typeof onUploadSuccess === 'function') onUploadSuccess(uData.email);
              } else {
                setGoogleUser({ email: 'Google User' });
                setUserRoleState('student');
                if (typeof onUploadSuccess === 'function') onUploadSuccess('Google User');
              }
            } catch {
              setGoogleUser({ email: 'Google User' });
              setUserRoleState('student');
              if (typeof onUploadSuccess === 'function') onUploadSuccess('Google User');
            }

            if (autoStartUpload) {
              startUploadWithToken(token);
            }
          }
        },
      });
      tokenClient.requestAccessToken(isDownloadModalOpen || forceConsent ? { prompt: 'consent' } : {});
    } catch (err) {
      console.error("Google OAuth Exception:", err);
      setGdriveError(`Failed to initialize Google Sign-in: ${err.message}`);
    }
  };

  const handleGoogleSignOut = () => {
    if (gdriveAccessToken && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(gdriveAccessToken, () => {});
      } catch {}
    }
    setGdriveAccessToken('');
    setGoogleUser(null);
    setUserRoleState('guest');
    setCourseRoles({});
    try {
      localStorage.removeItem('lecturescribe_gdrive_token');
      localStorage.removeItem('lecturescribe_gdrive_token_expires');
      localStorage.removeItem('lecturescribe_google_user');
      localStorage.removeItem('lecturescribe_user_role');
    } catch {}
  };

  const startUploadWithToken = async (activeToken) => {
    if (!activeData) return;
    setGdriveUploading(true);
    setGdriveError(null);

    const isResuming = Boolean(gdriveJobId && gdriveJob?.status === 'FAILED');
    const existingJobId = isResuming ? gdriveJobId : null;

    if (isResuming && gdriveJob) {
      setGdriveJob(prev => ({
        ...prev,
        status: 'PROCESSING',
        current_step: 'Resuming Google Drive upload...',
        error: null
      }));
    } else {
      setGdriveJob(null);
    }

    let summaryMd = `# Executive Summary: ${activeData.title}\n\n`;
    (activeData.summarySections || []).forEach(sec => {
      summaryMd += `### ${sec.title}\n`;
      (sec.points || []).forEach(pt => {
        summaryMd += `- ${pt}\n`;
      });
      summaryMd += '\n';
    });

    try {
      const res = await fetch(`${API_BASE}/api/cloud/gdrive/upload-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: activeData.videoId,
          title: activeData.title,
          summary_content: summaryMd,
          access_token: (activeToken || '').trim() || null,
          user_email: googleUser?.email || null,
          job_id: existingJobId
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload trigger failed (Status ${res.status})`);
      }

      const jobData = await res.json();
      const jobId = jobData.job_id;
      setGdriveJobId(jobId);
      if (!isResuming) {
        setGdriveJob({ status: 'PROCESSING', progress: 5, current_step: 'Downloading video stream...' });
      }

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/api/cloud/jobs/${jobId}`);
          if (pollRes.ok) {
            const currentJob = await pollRes.json();
            setGdriveJob(currentJob);

            if (currentJob.status === 'COMPLETED' || currentJob.status === 'FAILED') {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setGdriveUploading(false);
              if (currentJob.status === 'COMPLETED' && googleUser?.email && typeof onUploadSuccess === 'function') {
                onUploadSuccess(googleUser.email, currentJob);
              }
              if (currentJob.status === 'FAILED') {
                setGdriveError(currentJob.error || currentJob.current_step || "Upload failed");
              }
            }
          }
        } catch (pollErr) {
          console.warn("Polling error:", pollErr);
        }
      }, 1000);

    } catch (err) {
      console.error("Gdrive upload initiation error:", err);
      setGdriveError(err.message);
      setGdriveUploading(false);
    }
  };

  const handleStartGdriveUpload = async () => {
    if (!activeData) return;
    const tokenExpiresAt = Number(localStorage.getItem('lecturescribe_gdrive_token_expires') || '0');
    const isTokenExpired = tokenExpiresAt > 0 && Date.now() > (tokenExpiresAt - 120000);

    if (gdriveAccessToken && isTokenExpired) {
      setGdriveError("Google session expired (tokens are valid for 1h). Re-authenticating with Google...");
      handleGoogleSignIn(true);
      return;
    }

    startUploadWithToken(gdriveAccessToken);
  };

  const openDownloadModal = async (targetLecture = activeData) => {
    if (!targetLecture) return;
    setIsDownloadModalOpen(true);
    setGdriveError(null);
    try {
      const gdriveRes = await fetch(`${API_BASE}/api/cloud/gdrive/status`);
      if (gdriveRes.ok) setGdriveStatus(await gdriveRes.json());
    } catch (err) {
      console.warn("Error fetching Google Drive status:", err);
    }
  };

  const closeDownloadModal = () => {
    setIsDownloadModalOpen(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  return {
    gdriveStatus,
    setGdriveStatus,
    gdriveJobId,
    gdriveJob,
    gdriveUploading,
    gdriveAccessToken,
    googleUser,
    setGoogleUser,
    userRole,
    isTutor: userRole === 'tutor',
    isStudent: userRole === 'student',
    courseRoles,
    switchUserRole,
    syncUserRoleSession,
    googleClientIdInput,
    setGoogleClientIdInput,
    gdriveError,
    setGdriveError,
    pollIntervalRef,
    isDownloadModalOpen,
    openDownloadModal,
    closeDownloadModal,
    handleGoogleSignIn,
    handleGoogleSignOut,
    handleStartGdriveUpload
  };
}
