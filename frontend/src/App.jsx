import React, { useState, useEffect, useRef } from 'react';
import Player from '@vimeo/player';
import {
  Play, Search, Video, Sparkles, FileText, ArrowLeft, Download, Check, Copy,
  AlertCircle, RefreshCw, Send, Bot, User, Bookmark, ExternalLink, Database,
  Zap, Cloud, HardDrive, Terminal, X, Folder, FileCode, CheckCircle2, LogOut
} from 'lucide-react';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cacheNotice, setCacheNotice] = useState(null);
  const [activeData, setActiveData] = useState(null);
  const [activeTab, setActiveTab] = useState('transcript'); // 'transcript' | 'summary' | 'chat'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeCueIdx, setActiveCueIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [regeneratingSummary, setRegeneratingSummary] = useState(false);

  // Download & Cloud Export Modal State
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadModalTab, setDownloadModalTab] = useState('device'); // 'device' | 'cloud'
  const [streamData, setStreamData] = useState(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [copiedCmd, setCopiedCmd] = useState(null);
  const [activeCmdTab, setActiveCmdTab] = useState('yt_dlp'); // 'yt_dlp' | 'ffmpeg' | 'vlc'

  // Google Drive Cloud State
  const [gdriveStatus, setGdriveStatus] = useState(null);
  const [gdriveJobId, setGdriveJobId] = useState(null);
  const [gdriveJob, setGdriveJob] = useState(null);
  const [gdriveUploading, setGdriveUploading] = useState(false);
  const [gdriveAccessToken, setGdriveAccessToken] = useState(() => {
    try {
      return sessionStorage.getItem('lecturescribe_gdrive_token') || '';
    } catch {
      return '';
    }
  });
  const [googleUser, setGoogleUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('lecturescribe_google_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [googleClientIdInput, setGoogleClientIdInput] = useState(() => {
    try {
      return localStorage.getItem('lecturescribe_google_client_id') || '';
    } catch {
      return '';
    }
  });
  const [gdriveError, setGdriveError] = useState(null);
  const pollIntervalRef = useRef(null);

  // Client-side cache: In-memory & LocalStorage (Auto-purges stale hardcoded summaries)
  const [cachedVideos, setCachedVideos] = useState(() => {
    try {
      const stored = localStorage.getItem('lecturescribe_cached_videos');
      if (stored) {
        const parsed = JSON.parse(stored);
        let modified = false;
        Object.keys(parsed).forEach(k => {
          const str = JSON.stringify(parsed[k].summarySections || []);
          if (str.includes("Course Structure & Evaluation Framework") || str.includes("34 credits")) {
            delete parsed[k];
            modified = true;
          }
        });
        if (modified) {
          localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(parsed));
        }
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  });


  const extractVideoId = (url) => {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return match ? match[1] : trimmed;
  };

  // Chatbot & RAG State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Helper: Convert timestamp "MM:SS" or "HH:MM:SS" to total seconds
  const parseTimestampToSeconds = (ts) => {
    if (!ts) return 0;
    const parts = ts.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  };

  // Algolia Instant Search Handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery,
            video_id: activeData?.videoId,
            limit: 30
          })
        });

        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.hits || []);
        }
      } catch (err) {
        console.warn("Algolia instant search warning:", err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, activeData]);

  // Initialize Vimeo Player SDK on iframe load
  useEffect(() => {
    if (activeData && iframeRef.current) {
      try {
        const player = new Player(iframeRef.current);
        playerRef.current = player;

        player.on('timeupdate', (data) => {
          const seconds = data.seconds;
          const cues = activeData.cues;
          for (let i = cues.length - 1; i >= 0; i--) {
            const cueSecs = parseTimestampToSeconds(cues[i].time);
            if (seconds >= cueSecs) {
              setActiveCueIdx(i);
              break;
            }
          }
        });
      } catch (err) {
        console.warn("Vimeo Player SDK init warning:", err);
      }
    }
  }, [activeData]);

  // Jump to specific timestamp when cue or citation is clicked
  const handleCueClick = (timestampStr) => {
    const secs = parseTimestampToSeconds(timestampStr);
    if (playerRef.current) {
      playerRef.current.setCurrentTime(secs).catch(err => console.log("Seek error:", err));
      playerRef.current.play().catch(err => console.log("Autoplay blocked:", err));
    }
  };

  const handleTranscribe = async (targetUrl = urlInput) => {
    const rawUrl = targetUrl || urlInput;
    if (!rawUrl.trim()) return;
    const vidId = extractVideoId(rawUrl);

    // 1. If currently active video is already this video, do NOT re-generate
    if (activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
      setCacheNotice("⚡ Video is already active. Transcripts and summary were reused.");
      return;
    }

    // 2. If present in client cache, load immediately (0ms delay, no re-generation)
    if (cachedVideos[vidId]) {
      const cached = cachedVideos[vidId];
      setActiveData({ ...cached, cached: true });
      initChatMessages(cached.title);
      setCacheNotice("⚡ Loaded instantly from browser cache — Transcripts and summary were reused!");
      return;
    }

    setLoading(true);
    setError(null);
    setCacheNotice(null);

    try {
      const res = await fetch(`/api/transcript?url=${encodeURIComponent(rawUrl)}`);
      if (res.ok) {
        const data = await res.json();
        setActiveData(data);
        initChatMessages(data.title);

        // Store into client cache for instant repeated loads
        setCachedVideos((prev) => {
          const updated = { ...prev, [data.videoId]: data };
          try {
            localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(updated));
          } catch (e) {
            console.warn("Could not cache to localStorage:", e);
          }
          return updated;
        });

        if (data.cached) {
          setCacheNotice("⚡ Retrieved from Database Cache! Transcripts and summary were not regenerated.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned status ${res.status}`);
      }
    } catch (err) {
      console.error("API Call Error:", err);
      setError(err.message || "Failed to fetch Vimeo transcript. Please check the backend connection and URL.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasteUrl = (e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    const vidId = extractVideoId(pasted);
    if (vidId) {
      if (activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
        setCacheNotice("⚡ Pasted video is already active. Transcripts and summary will be reused.");
      } else if (cachedVideos[vidId]) {
        setCacheNotice("⚡ Pasted video is already cached! Transcripts and summary will load instantly without re-generation.");
      }
    }
  };

  const initChatMessages = (title) => {
    setChatMessages([
      {
        sender: 'bot',
        text: `🔍 **Pinecone Vector RAG Ready** for *${title}*!\n\nAsk any question to retrieve grounded answers with exact video timestamp citations:\n- *"What are the core objectives and themes covered in this lecture?"*\n- *"Explain the primary methodology and key concepts discussed"*\n- *"Summarize the main takeaways and conclusions"*\n- *"What specific questions or challenges were addressed?"*`,
        citations: []
      }
    ]);
  };


  const handleSendMessage = async (customPrompt = null) => {
    const textToSend = customPrompt || chatInput;
    if (!textToSend.trim() || !activeData) return;

    const newMessages = [...chatMessages, { sender: 'user', text: textToSend }];
    setChatMessages(newMessages);
    if (!customPrompt) setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: textToSend,
          video_id: activeData.videoId,
          top_k: 4
        })
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages([...newMessages, { 
          sender: 'bot', 
          text: data.answer,
          citations: data.citations || []
        }]);
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "RAG Query failed");
      }
    } catch (err) {
      console.error("RAG Query Error:", err);
      setChatMessages([...newMessages, { 
        sender: 'bot', 
        text: `⚠️ **Error querying RAG engine**: ${err.message}`,
        citations: []
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const displayCues = searchQuery.trim() && searchResults.length > 0
    ? searchResults.map(h => ({
        time: h.timestamp,
        text: h.text,
        highlightHtml: h._highlightResult?.text?.value
      }))
    : (activeData?.cues || []);

  const handleCopyMarkdown = () => {
    if (!activeData) return;
    let md = `# ${activeData.title}\nSource: ${activeData.sourceUrl}\n\n`;
    activeData.cues.forEach(c => {
      md += `**[${c.time}]** ${c.text}\n\n`;
    });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to trigger browser download of text/markdown/vtt files
  const downloadTextFile = (filename, content, mime = 'text/plain') => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTranscript = () => {
    if (!activeData) return;
    let md = `# Full Transcript: ${activeData.title}\nSource: ${activeData.sourceUrl}\nVideo ID: ${activeData.videoId}\n\n---\n\n`;
    activeData.cues.forEach(c => {
      md += `**[${c.time}]** ${c.text}\n\n`;
    });
    const safeTitle = (activeData.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    downloadTextFile(`${safeTitle}_transcript.md`, md, 'text/markdown');
  };

  const handleDownloadSummary = () => {
    if (!activeData) return;
    let md = `# Executive AI Summary: ${activeData.title}\nSource: ${activeData.sourceUrl}\n\n---\n\n`;
    (activeData.summarySections || []).forEach(sec => {
      md += `### ${sec.title}\n`;
      (sec.points || []).forEach(pt => {
        md += `- ${pt}\n`;
      });
      md += '\n';
    });
    const safeTitle = (activeData.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    downloadTextFile(`${safeTitle}_summary.md`, md, 'text/markdown');
  };

  const handleDownloadVtt = () => {
    if (!activeData) return;
    let vtt = "WEBVTT\n\n";
    activeData.cues.forEach((c, idx) => {
      const start = c.time.length === 5 ? `00:${c.time}.000` : `${c.time}.000`;
      vtt += `${idx + 1}\n${start} --> 99:99:99.000\n${c.text}\n\n`;
    });
    const safeTitle = (activeData.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    downloadTextFile(`${safeTitle}_captions.vtt`, vtt, 'text/vtt');
  };

  const handleRegenerateSummary = async () => {
    if (!activeData) return;
    setRegeneratingSummary(true);
    setCacheNotice(null);
    try {
      const res = await fetch('/api/summary/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: activeData.videoId })
      });
      if (res.ok) {
        const data = await res.json();
        const updatedSections = data.summarySections;
        const updatedActive = { ...activeData, summarySections: updatedSections, cached: false };
        setActiveData(updatedActive);
        setCachedVideos(prev => {
          const up = { ...prev, [activeData.videoId]: updatedActive };
          try { localStorage.setItem('lecturescribe_cached_videos', JSON.stringify(up)); } catch {}
          return up;
        });
        setCacheNotice("✨ Dynamic AI Summary freshly extracted from transcript cues!");
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Failed to regenerate dynamic summary");
      }
    } catch (err) {
      console.error("Summary regeneration error:", err);
      setError(err.message || "Failed to regenerate summary.");
    } finally {
      setRegeneratingSummary(false);
    }
  };

  const renderSummaryPoint = (pt) => {
    const match = String(pt).match(/^\[(.*?)\]\s*(.*)/);
    if (match) {
      const time = match[1];
      const text = match[2];
      return (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleCueClick(time)}
            title={`Jump video to ${time}`}
            style={{
              background: 'rgba(0, 173, 239, 0.15)',
              border: '1px solid rgba(0, 173, 239, 0.4)',
              color: 'var(--vimeo-blue)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px'
            }}
          >
            ▶ [{time}]
          </button>
          <span>{text}</span>
        </span>
      );
    }
    return <span>{pt}</span>;
  };

  const openDownloadModal = async (initialTab = 'device') => {
    if (!activeData) return;
    setDownloadModalTab(initialTab);
    setIsDownloadModalOpen(true);
    setStreamLoading(true);
    setStreamError(null);
    setGdriveError(null);

    try {
      const [streamsRes, gdriveRes] = await Promise.all([
        fetch(`/api/video/download-options?url=${encodeURIComponent(activeData.videoId)}`),
        fetch('/api/cloud/gdrive/status')
      ]);

      if (streamsRes.ok) {
        const sData = await streamsRes.json();
        setStreamData(sData);
      } else {
        const errJson = await streamsRes.json().catch(() => ({}));
        setStreamError(errJson.detail || "Could not retrieve download streams");
      }

      if (gdriveRes.ok) {
        const gData = await gdriveRes.json();
        setGdriveStatus(gData);
      }
    } catch (err) {
      console.warn("Error fetching download options:", err);
      setStreamError("Failed to fetch stream details from server.");
    } finally {
      setStreamLoading(false);
    }
  };

  const closeDownloadModal = () => {
    setIsDownloadModalOpen(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleCopyCmd = (key, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleGoogleSignIn = () => {
    const activeClientId = (
      gdriveStatus?.client_id ||
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
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error("Google Sign-in error:", tokenResponse);
            setGdriveError(`Sign-in was cancelled or failed: ${tokenResponse.error_description || tokenResponse.error}`);
            return;
          }
          if (tokenResponse.access_token) {
            const token = tokenResponse.access_token;
            setGdriveAccessToken(token);
            try { sessionStorage.setItem('lecturescribe_gdrive_token', token); } catch {}
            setGdriveError(null);

            // Fetch user profile info to show friendly user email/name
            try {
              const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                setGoogleUser(uData);
                try { sessionStorage.setItem('lecturescribe_google_user', JSON.stringify(uData)); } catch {}
              } else {
                setGoogleUser({ email: 'Google User' });
              }
            } catch {
              setGoogleUser({ email: 'Google User' });
            }
          }
        },
      });
      tokenClient.requestAccessToken();
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
    try {
      sessionStorage.removeItem('lecturescribe_gdrive_token');
      sessionStorage.removeItem('lecturescribe_google_user');
    } catch {}
  };

  const handleStartGdriveUpload = async () => {
    if (!activeData) return;
    setGdriveUploading(true);
    setGdriveError(null);
    setGdriveJob(null);

    let summaryMd = `# Executive Summary: ${activeData.title}\n\n`;
    (activeData.summarySections || []).forEach(sec => {
      summaryMd += `### ${sec.title}\n`;
      (sec.points || []).forEach(pt => {
        summaryMd += `- ${pt}\n`;
      });
      summaryMd += '\n';
    });

    try {
      const res = await fetch('/api/cloud/gdrive/upload-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: activeData.videoId,
          title: activeData.title,
          summary_content: summaryMd,
          access_token: gdriveAccessToken.trim() || null
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload trigger failed (Status ${res.status})`);
      }

      const jobData = await res.json();
      const jobId = jobData.job_id;
      setGdriveJobId(jobId);
      setGdriveJob({ status: 'PROCESSING', progress: 10, current_step: 'Job queued on server...' });

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/cloud/jobs/${jobId}`);
          if (pollRes.ok) {
            const currentJob = await pollRes.json();
            setGdriveJob(currentJob);

            if (currentJob.status === 'COMPLETED' || currentJob.status === 'FAILED') {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setGdriveUploading(false);
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

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);


  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
      
      {/* Header */}
      <header style={{
        backgroundColor: 'var(--panel-bg)',
        borderBottom: '1px solid var(--border-color)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 700, fontSize: '1.1rem' }}>
          <span style={{ color: 'var(--vimeo-blue)', fontWeight: 900, fontSize: '1.3rem', letterSpacing: '-0.5px' }}>vimeo</span>
          <span>Transcript Triad Engine</span>
          <span style={{
            background: 'rgba(0, 173, 239, 0.2)',
            color: 'var(--vimeo-blue)',
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>PG + Algolia + Pinecone</span>
        </div>

        {activeData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              display: 'flex',
              gap: '4px',
              background: 'var(--bg-dark)',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <button
                onClick={() => setActiveTab('transcript')}
                style={{
                  background: activeTab === 'transcript' ? 'var(--vimeo-blue)' : 'transparent',
                  color: activeTab === 'transcript' ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
              >
                🔍 Algolia Search
              </button>
              <button
                onClick={() => setActiveTab('summary')}
                style={{
                  background: activeTab === 'summary' ? 'var(--vimeo-blue)' : 'transparent',
                  color: activeTab === 'summary' ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <FileText size={16} /> AI Summary
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                style={{
                  background: activeTab === 'chat' ? 'var(--vimeo-blue)' : 'transparent',
                  color: activeTab === 'chat' ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Bot size={16} /> Pinecone Tutor
              </button>
            </div>

            <button
              onClick={() => openDownloadModal('device')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'linear-gradient(135deg, rgba(0, 173, 239, 0.15), rgba(16, 185, 129, 0.15))',
                color: 'var(--vimeo-blue)',
                border: '1px solid rgba(0, 173, 239, 0.35)',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              <Download size={15} /> Download & Cloud
            </button>

            <button
              onClick={() => { setActiveData(null); setError(null); }}

              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--card-bg)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              <ArrowLeft size={16} /> New Video
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      {!activeData ? (
        /* LANDING PAGE / INPUT SCREEN */
        <div className="fade-in" style={{
          maxWidth: '800px',
          margin: '80px auto',
          padding: '0 24px',
          textAlign: 'center'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0, 173, 239, 0.1)',
            border: '1px solid rgba(0, 173, 239, 0.3)',
            padding: '6px 16px',
            borderRadius: '20px',
            color: 'var(--vimeo-blue)',
            fontSize: '0.85rem',
            fontWeight: 600,
            marginBottom: '24px'
          }}>
            <Zap size={16} /> Triad Engine: Postgres + Algolia Instant Search + Pinecone RAG
          </div>

          <h1 style={{
            fontSize: '2.8rem',
            fontWeight: 800,
            lineHeight: 1.2,
            letterSpacing: '-1px',
            marginBottom: '16px'
          }}>
            Vimeo Transcripts & Video AI <br />
            <span style={{ color: 'var(--vimeo-blue)' }}>Algolia Search + Pinecone RAG</span>
          </h1>

          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '1.1rem',
            maxWidth: '600px',
            margin: '0 auto 40px',
            lineHeight: 1.6
          }}>
            Paste any Vimeo video link. Algolia provides sub-10ms instant typo-tolerant search while Pinecone vector search powers grounded AI Chatbot answers.
          </p>

          {/* Error Banner */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#f87171',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontSize: '0.9rem'
            }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {/* Cache Notice Banner */}
          {cacheNotice && (
            <div style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              color: '#34d399',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontSize: '0.9rem',
              fontWeight: 500
            }}>
              <Check size={18} /> {cacheNotice}
            </div>
          )}

          {/* Input Form */}
          <div style={{
            background: 'var(--panel-bg)',
            border: '1px solid var(--border-color)',
            padding: '8px',
            borderRadius: '12px',
            display: 'flex',
            gap: '8px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)'
          }}>
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Video size={20} style={{ position: 'absolute', left: '14px', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                placeholder="Paste Vimeo link or ID (e.g. https://vimeo.com/1229247139)..."
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setCacheNotice(null); }}
                onPaste={handlePasteUrl}
                onKeyDown={(e) => e.key === 'Enter' && handleTranscribe()}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  paddingLeft: '44px',
                  paddingRight: '14px'
                }}
              />
            </div>

            <button
              onClick={() => handleTranscribe()}
              disabled={loading || !urlInput.trim()}
              style={{
                background: 'var(--vimeo-blue)',
                color: '#ffffff',
                border: 'none',
                padding: '12px 28px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
                opacity: loading || !urlInput.trim() ? 0.6 : 1
              }}
            >
              {loading ? (
                <>
                  <RefreshCw className="loading-pulse" size={18} /> Ingesting Data...
                </>
              ) : (
                <>
                  <Sparkles size={18} /> Ingest & Transcribe
                </>
              )}
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div style={{ marginTop: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Try example:</span>
            <button
              onClick={() => {
                setUrlInput('https://vimeo.com/1229247139');
                handleTranscribe('https://vimeo.com/1229247139');
              }}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                color: 'var(--vimeo-blue)',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              📹 Introduction to Research (#1229247139)
            </button>
          </div>
        </div>
      ) : (
        /* TRANSCRIPT & TRIAD WORKSPACE */
        <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
          
          {/* Left Panel: Real Embedded Vimeo Player */}
          <div style={{
            flex: '1.2',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            overflowY: 'auto',
            borderRight: '1px solid var(--border-color)'
          }}>
            <div style={{
              width: '100%',
              aspectRatio: '16 / 9',
              background: '#000',
              borderRadius: '12px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              border: '1px solid var(--border-color)'
            }}>
              <iframe
                ref={iframeRef}
                src={`https://player.vimeo.com/video/${activeData.videoId}?autoplay=0&title=0&byline=0&portrait=0`}
                width="100%"
                height="100%"
                frameBorder="0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={activeData.title}
                style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
              ></iframe>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.3 }}>{activeData.title}</h1>
                {activeData.cached && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#34d399',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    <Check size={12} /> Cached (0ms Re-generation)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={12} color="var(--vimeo-blue)" /> {activeData.cached ? 'Database Cache (Reused)' : 'Postgres/SQLite'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} color="#10b981" /> Algolia Instant Search</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Bot size={12} color="#8b5cf6" /> Pinecone Vector RAG</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={handleCopyMarkdown}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  background: 'var(--card-bg)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  padding: '10px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                {copied ? <Check size={16} color="var(--vimeo-blue)" /> : <Copy size={16} />}
                {copied ? 'Copied Markdown!' : 'Copy Markdown'}
              </button>
            </div>
          </div>

          {/* Right Panel: Algolia Search Drawer (.css-1xdwfcd) or RAG AI Tutor */}
          {activeTab === 'transcript' ? (
            <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column' }}>
              <div className="css-1xdwfcd" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Zap size={16} color="var(--vimeo-blue)" /> Algolia Instant Search
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Showing {displayCues.length} hits</span>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input
                      type="text"
                      placeholder="Typo-tolerant instant search (e.g. 'semico', 'covid')..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        padding: '10px 14px 10px 36px',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.88rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                  {displayCues.map((cue, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleCueClick(cue.time)}
                      style={{
                        display: 'flex',
                        gap: '14px',
                        padding: '10px 12px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        marginBottom: '4px',
                        backgroundColor: activeCueIdx === idx ? 'var(--highlight-bg)' : 'transparent',
                        borderLeft: activeCueIdx === idx ? '3px solid var(--vimeo-blue)' : '3px solid transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        color: 'var(--vimeo-blue)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        paddingTop: '2px'
                      }}>[{cue.time}]</span>
                      
                      {cue.highlightHtml ? (
                        <span
                          style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4 }}
                          dangerouslySetInnerHTML={{ __html: cue.highlightHtml }}
                        />
                      ) : (
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{cue.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab === 'summary' ? (
            /* EXECUTIVE AI SUMMARY VIEW */
            <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>🎓 Executive AI Summary</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Structured executive insights extracted directly from lecture captions
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={handleRegenerateSummary}
                    disabled={regeneratingSummary}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--vimeo-blue)',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: regeneratingSummary ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <RefreshCw size={13} className={regeneratingSummary ? 'loading-pulse' : ''} />
                    {regeneratingSummary ? 'Extracting Dynamic Summary...' : 'Regenerate Dynamic Summary'}
                  </button>
                  {activeData.cached && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34d399',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}>
                      <Check size={14} /> Reused from Cache
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(activeData.summarySections || []).map((sec, sIdx) => (
                  <div key={sIdx} style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                  }}>
                    <h3 style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--vimeo-blue)', marginBottom: '10px' }}>
                      {sec.title}
                    </h3>
                    <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {(sec.points || []).map((pt, pIdx) => (
                        <li key={pIdx} style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                          {renderSummaryPoint(pt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

            </div>
          ) : (
            /* PINECONE RAG AI TUTOR VIEW */
            <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* Chat Header */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Bot size={20} color="var(--vimeo-blue)" />
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Pinecone Vector RAG AI Tutor</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Semantic search & answers grounded in video timestamps</p>
                </div>
              </div>

              {/* Chat Messages Container */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'flex-start',
                      alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%'
                    }}
                  >
                    {msg.sender === 'bot' && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'rgba(0, 173, 239, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <Bot size={18} color="var(--vimeo-blue)" />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{
                        background: msg.sender === 'user' ? 'var(--vimeo-blue)' : 'var(--card-bg)',
                        color: '#ffffff',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        borderTopLeftRadius: msg.sender === 'bot' ? '2px' : '12px',
                        borderTopRightRadius: msg.sender === 'user' ? '2px' : '12px',
                        fontSize: '0.9rem',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                        border: msg.sender === 'bot' ? '1px solid var(--border-color)' : 'none'
                      }}>
                        {msg.text}
                      </div>

                      {/* RAG Timestamp Citation Badges */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', items: 'center', gap: '4px' }}>
                            <Bookmark size={12} color="var(--vimeo-blue)" /> Grounded Citations:
                          </span>
                          {msg.citations.map((cit, cIdx) => (
                            <button
                              key={cIdx}
                              onClick={() => handleCueClick(cit.timestamp)}
                              style={{
                                background: 'rgba(0, 173, 239, 0.15)',
                                border: '1px solid rgba(0, 173, 239, 0.4)',
                                color: 'var(--vimeo-blue)',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              ▶ [{cit.timestamp}] <ExternalLink size={10} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {msg.sender === 'user' && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <User size={16} color="var(--text-secondary)" />
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'rgba(0, 173, 239, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Bot size={18} color="var(--vimeo-blue)" />
                    </div>
                    <div style={{
                      background: 'var(--card-bg)',
                      padding: '10px 16px',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <RefreshCw className="loading-pulse" size={16} /> Retrieving Pinecone vector embeddings...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Quick RAG Suggestion Chips */}
              <div style={{
                padding: '8px 20px',
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                borderTop: '1px solid var(--border-color)',
                background: 'var(--bg-dark)'
              }}>
                <button
                  onClick={() => handleSendMessage("What are the main objectives and scope covered in this lecture?")}
                  style={{
                    whiteSpace: 'nowrap',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--vimeo-blue)',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  🎯 Main Objectives
                </button>
                <button
                  onClick={() => handleSendMessage("Explain the core concepts and methodologies discussed in this session")}
                  style={{
                    whiteSpace: 'nowrap',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--vimeo-blue)',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  💡 Core Methodology
                </button>
                <button
                  onClick={() => handleSendMessage("Summarize the key takeaways, action items, and conclusions")}
                  style={{
                    whiteSpace: 'nowrap',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--vimeo-blue)',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  📜 Key Takeaways
                </button>
                <button
                  onClick={() => handleSendMessage("What specific questions or challenges were discussed in this video?")}
                  style={{
                    whiteSpace: 'nowrap',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--vimeo-blue)',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  ❓ Key Questions & Discussion
                </button>
              </div>

              {/* Chat Input Bar */}
              <div style={{ padding: '16px 20px', background: 'var(--panel-bg)', borderTop: '1px solid var(--border-color)' }}>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '6px 6px 6px 14px'
                }}>
                  <input
                    type="text"
                    placeholder="Ask RAG tutor about key concepts, methodology, or questions..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem'
                    }}
                  />
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!chatInput.trim() || chatLoading}
                    style={{
                      background: 'var(--vimeo-blue)',
                      color: '#ffffff',
                      border: 'none',
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      opacity: !chatInput.trim() || chatLoading ? 0.5 : 1
                    }}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>
      )}

      {/* ============================================================================== */}
      {/* Download to Device & Cloud Export Modal Dialog                                  */}
      {/* ============================================================================== */}
      {isDownloadModalOpen && (
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
                <Download size={20} color="var(--vimeo-blue)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Export & Download Lecture Package
                </h3>
              </div>
              <button
                onClick={closeDownloadModal}
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

            {/* Modal Tabs */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--card-bg)'
            }}>
              <button
                onClick={() => setDownloadModalTab('device')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  background: downloadModalTab === 'device' ? 'var(--panel-bg)' : 'transparent',
                  border: 'none',
                  borderBottom: downloadModalTab === 'device' ? '2px solid var(--vimeo-blue)' : '2px solid transparent',
                  color: downloadModalTab === 'device' ? 'var(--vimeo-blue)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                <HardDrive size={16} />
                Option 1: Download to Device
              </button>
              <button
                onClick={() => setDownloadModalTab('cloud')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  background: downloadModalTab === 'cloud' ? 'var(--panel-bg)' : 'transparent',
                  border: 'none',
                  borderBottom: downloadModalTab === 'cloud' ? '2px solid var(--vimeo-blue)' : '2px solid transparent',
                  color: downloadModalTab === 'cloud' ? 'var(--vimeo-blue)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                <Cloud size={16} />
                Option 2: Download to Cloud (Google Drive)
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {streamLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  <RefreshCw className="spinner" size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '12px' }} />
                  <div>Inspecting video stream manifests and cloud connections...</div>
                </div>
              ) : downloadModalTab === 'device' ? (
                /* ================= OPTION 1: DEVICE ================= */
                <>
                  {streamError && (
                    <div style={{
                      padding: '12px 16px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      color: '#f87171',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <AlertCircle size={16} />
                      {streamError}
                    </div>
                  )}

                  {/* Document Assets */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={16} color="var(--vimeo-blue)" />
                      Lecture Documents & Subtitles
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                      <button
                        onClick={handleDownloadSummary}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 14px',
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          fontWeight: 600
                        }}
                      >
                        <Download size={14} color="var(--vimeo-blue)" />
                        Summary (summary.md)
                      </button>
                      <button
                        onClick={handleDownloadTranscript}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 14px',
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          fontWeight: 600
                        }}
                      >
                        <Download size={14} color="var(--vimeo-blue)" />
                        Transcript (transcript.md)
                      </button>
                      <button
                        onClick={handleDownloadVtt}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 14px',
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          fontWeight: 600
                        }}
                      >
                        <Download size={14} color="var(--vimeo-blue)" />
                        Subtitles (captions.vtt)
                      </button>
                    </div>
                  </div>

                  {/* Progressive MP4 Downloads if available */}
                  {streamData?.progressive_mp4s && streamData.progressive_mp4s.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Video size={16} color="var(--vimeo-blue)" />
                        Direct MP4 Video Downloads
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {streamData.progressive_mp4s.map((mp4, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              background: 'var(--card-bg)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '8px'
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 700, color: 'var(--vimeo-blue)', fontSize: '0.88rem' }}>
                                {mp4.quality || 'Standard'} ({mp4.width}x{mp4.height})
                              </span>
                              {mp4.fps && <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginLeft: '8px' }}>{mp4.fps} fps</span>}
                            </div>
                            <a
                              href={mp4.url}
                              download
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                background: 'var(--vimeo-blue)',
                                color: '#ffffff',
                                borderRadius: '6px',
                                textDecoration: 'none',
                                fontSize: '0.8rem',
                                fontWeight: 600
                              }}
                            >
                              <Download size={13} />
                              Download MP4
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Adaptive HLS Stream Capture Guide */}
                  <div>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Terminal size={16} color="var(--vimeo-blue)" />
                      Download Video Stream via CLI (yt-dlp / ffmpeg)
                    </h4>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Vimeo protects high-definition video using multi-bitrate Adaptive HLS (<code style={{ color: 'var(--vimeo-blue)' }}>.m3u8</code>). Use these 1-click commands to download the full HD video directly onto your machine:
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* yt-dlp */}
                      <div style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '10px 14px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>yt-dlp (Recommended)</span>
                          <button
                            onClick={() => handleCopyCmd('ytdlp', `yt-dlp "${streamData?.hls_url || streamData?.source_url || activeData?.sourceUrl}" -o "${(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_')}.mp4"`)}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              color: copiedCmd === 'ytdlp' ? '#10b981' : 'var(--text-secondary)',
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            {copiedCmd === 'ytdlp' ? <Check size={12} /> : <Copy size={12} />}
                            {copiedCmd === 'ytdlp' ? 'Copied' : 'Copy Command'}
                          </button>
                        </div>
                        <code style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all', display: 'block' }}>
                          yt-dlp "{streamData?.hls_url || streamData?.source_url || activeData?.sourceUrl}" -o "{(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_')}.mp4"
                        </code>
                      </div>

                      {/* ffmpeg */}
                      <div style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '10px 14px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ffmpeg</span>
                          <button
                            onClick={() => handleCopyCmd('ffmpeg', `ffmpeg -i "${streamData?.hls_url || streamData?.source_url || activeData?.sourceUrl}" -c copy "${(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_')}.mp4"`)}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              color: copiedCmd === 'ffmpeg' ? '#10b981' : 'var(--text-secondary)',
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            {copiedCmd === 'ffmpeg' ? <Check size={12} /> : <Copy size={12} />}
                            {copiedCmd === 'ffmpeg' ? 'Copied' : 'Copy Command'}
                          </button>
                        </div>
                        <code style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all', display: 'block' }}>
                          ffmpeg -i "{streamData?.hls_url || streamData?.source_url || activeData?.sourceUrl}" -c copy "{(activeData?.title || 'lecture').replace(/[^a-zA-Z0-9_\- ]/g, '_')}.mp4"
                        </code>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* ================= OPTION 2: CLOUD (GOOGLE DRIVE) ================= */
                <>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(0, 173, 239, 0.08)',
                    border: '1px solid rgba(0, 173, 239, 0.25)',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--vimeo-blue)', fontSize: '0.9rem' }}>
                      <Folder size={18} />
                      Dedicated Cloud Folder: LectureScribe - {activeData?.title} ({activeData?.videoId})
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Exports the complete lecture bundle into Google Drive:
                      <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
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
                  ) : gdriveStatus?.configured ? (
                    /* CASE 2: Server Service Account Active */
                    <div style={{
                      padding: '14px 18px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Cloud size={20} color="#10b981" />
                        <div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Server Service Account Active
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {gdriveStatus.service_account_email || 'Verified Cloud Credentials'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', background: '#10b981', color: '#fff', padding: '3px 8px', borderRadius: '10px', fontWeight: 700 }}>
                        Ready
                      </span>
                    </div>
                  ) : (gdriveStatus?.client_id || googleClientIdInput || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID)) ? (
                    /* CASE 3: Client ID is known -> Prominent 1-Click Sign In */
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
                        To enable 1-click Google Sign-In, enter your Google OAuth <strong>Client ID</strong> below (or add <code style={{ color: 'var(--vimeo-blue)' }}>GOOGLE_CLIENT_ID</code> to your project's <code style={{ color: 'var(--vimeo-blue)' }}>.env</code> file):
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
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--vimeo-blue)' }}>
                          {gdriveJob.progress}%
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${gdriveJob.progress}%`,
                          height: '100%',
                          background: gdriveJob.status === 'FAILED' ? '#ef4444' : gdriveJob.status === 'COMPLETED' ? '#10b981' : 'var(--vimeo-blue)',
                          transition: 'width 0.4s ease'
                        }} />
                      </div>

                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {gdriveJob.current_step}
                      </div>

                      {/* Completed Link */}
                      {gdriveJob.status === 'COMPLETED' && gdriveJob.folder_url && (
                        <div style={{ marginTop: '6px' }}>
                          <a
                            href={gdriveJob.folder_url}
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
                              fontWeight: 700
                            }}
                          >
                            <ExternalLink size={15} />
                            Open Bundle in Google Drive
                          </a>
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

                  {/* Upload Trigger Button */}
                  {(!gdriveJob || gdriveJob.status === 'FAILED') && (
                    (gdriveAccessToken || gdriveStatus?.configured) ? (
                      <button
                        onClick={handleStartGdriveUpload}
                        disabled={gdriveUploading}
                        style={{
                          padding: '12px 20px',
                          background: 'var(--vimeo-blue)',
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
                    ) : (
                      <button
                        onClick={handleGoogleSignIn}
                        style={{
                          padding: '12px 20px',
                          background: 'rgba(0, 173, 239, 0.15)',
                          color: 'var(--vimeo-blue)',
                          border: '1px solid rgba(0, 173, 239, 0.4)',
                          borderRadius: '8px',
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}
                      >
                        <GoogleIcon />
                        Sign in with Google to Upload
                      </button>
                    )
                  )}
                </>
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
                onClick={closeDownloadModal}
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
      )}

    </div>
  );
}

