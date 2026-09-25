import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from '@vimeo/player';
import ReactMarkdown from 'react-markdown';
import {
  Play, Search, Video, Sparkles, FileText, ArrowLeft, Download, Check, Copy,
  AlertCircle, RefreshCw, Send, Bot, User, Bookmark, ExternalLink, Database,
  Zap, Cloud, HardDrive, Terminal, X, Folder, FileCode, CheckCircle2, LogOut,
  Trash2, Clock, BookOpen, Palette, ChevronDown, ChevronUp, Globe, Book
} from 'lucide-react';

import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import InputBase from '@mui/material/InputBase';
import { ProtonThemeSelector } from '@dipesh.singh/proton';
import { useThemeStore, LMS_THEMES, applyThemeCssVariables } from './store/themeStore';

const formatRelativeTime = (dateStr) => {
  if (!dateStr) return 'Recently';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Recently';
  }
};

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
  const [activeTab, setActiveTab] = useState('transcript'); // 'transcript' | 'tutor'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeCueIdx, setActiveCueIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [regeneratingSummary, setRegeneratingSummary] = useState(false);

  // Dedicated Lecture Routing & History State
  const [currentPath, setCurrentPath] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
    } catch {
      return '/';
    }
  });

  const getLectureIdFromPath = (path = (typeof window !== 'undefined' ? window.location.pathname : '/')) => {
    if (!path) return null;
    const match = path.match(/^\/(?:lecture|lectures|video|watch)\/([a-zA-Z0-9_\-]+)/i);
    return match ? match[1] : null;
  };

  const navigateTo = (path, replace = false) => {
    try {
      if (typeof window !== 'undefined' && window.location.pathname !== path) {
        if (replace) {
          window.history.replaceState({}, '', path);
        } else {
          window.history.pushState({}, '', path);
        }
      }
    } catch (e) {
      console.warn("Navigation history warning:", e);
    }
    setCurrentPath(path);
  };

  const handleBackToHub = () => {
    navigateTo('/');
    setActiveData(null);
    setError(null);
    setCacheNotice(null);
  };

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

  // LMS User Library State
  const [userLibrary, setUserLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);

  // LMS Theme State via Zustand (Default: Academic Classic Blue)
  const { currentThemeId, setTheme } = useThemeStore();

  const currentTheme = LMS_THEMES[currentThemeId] || LMS_THEMES.academic;

  useEffect(() => {
    applyThemeCssVariables(currentTheme);
  }, [currentThemeId, currentTheme]);

  const muiTheme = useMemo(() => createTheme({
    palette: {
      mode: currentTheme.mode || 'light',
      primary: { main: currentTheme.palette.primary },
      secondary: { main: currentTheme.palette.secondary },
      background: {
        default: currentTheme.palette.background,
        paper: currentTheme.palette.cardBg,
      },
      text: {
        primary: currentTheme.palette.textPrimary,
        secondary: currentTheme.palette.textSecondary,
      },
      divider: currentTheme.palette.cardBorder,
    },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    shape: {
      borderRadius: 12,
    },
  }), [currentTheme]);

  const fetchUserLibrary = async (email) => {
    if (!email) {
      setUserLibrary([]);
      return;
    }
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/user/library?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.library || data.lectures || [];
        setUserLibrary(list);
      }
    } catch (err) {
      console.warn("Failed to fetch user library:", err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleDeleteFromLibrary = async (videoId) => {
    if (!videoId) return;
    try {
      const emailParam = googleUser?.email ? `?email=${encodeURIComponent(googleUser.email)}` : '';
      const res = await fetch(`/api/user/library/${videoId}${emailParam}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setUserLibrary(prev => prev.filter(item => item.video_id !== videoId));
      }
    } catch (err) {
      console.warn("Failed to delete from user library:", err);
    }
  };

  // Automatically fetch library on mount and when signed in
  useEffect(() => {
    if (googleUser?.email) {
      fetchUserLibrary(googleUser.email);
    } else {
      setUserLibrary([]);
    }
  }, [googleUser?.email]);

  // Load Google Drive Status on initial mount to get Client ID early for top-right sign-in
  useEffect(() => {
    fetch('/api/cloud/gdrive/status')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setGdriveStatus(data);
      })
      .catch(() => {});
  }, []);

  // Client-side cache: In-memory & LocalStorage
  const [cachedVideos, setCachedVideos] = useState(() => {
    try {
      const stored = localStorage.getItem('lecturescribe_cached_videos');
      return stored ? JSON.parse(stored) : {};
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
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [viewMode, setViewMode] = useState('learning'); // 'learning' or 'submission'
  const [submissionSummaries, setSubmissionSummaries] = useState({}); // Store submission versions
  const [copiedSubmissionId, setCopiedSubmissionId] = useState(null);
  const chatEndRef = useRef(null);

  // Fetch available AI models
  useEffect(() => {
    fetch('/api/ai/models')
      .then(res => res.json())
      .then(data => {
        if (data && data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          const rec = data.models.find(m => m.is_recommended && m.is_configured);
          const firstConf = data.models.find(m => m.is_configured);
          if (rec) {
            setSelectedModel(rec.id);
          } else if (firstConf) {
            setSelectedModel(firstConf.id);
          }
        }
      })
      .catch(err => console.warn('Could not load AI models list:', err));
  }, []);

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

  // Instant Search Handler
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
        console.warn("Instant search warning:", err);
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

  // Parse inline timestamps in bot messages and make them clickable
  const renderMessageWithTimestamps = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
    if (parts.length === 1) return text;
    return parts.map((part, pIdx) => {
      const match = part.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/);
      if (match) {
        const ts = match[1];
        return (
          <button
            key={pIdx}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCueClick(ts);
            }}
            title={`Jump video to ${ts}`}
            style={{
              background: 'var(--highlight-bg)',
              color: 'var(--theme-primary)',
              border: '1px solid rgba(0, 117, 237, 0.3)',
              borderRadius: '4px',
              padding: '1px 6px',
              margin: '0 2px',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              verticalAlign: 'baseline',
              transition: 'all 0.15s ease'
            }}
          >
            ⏱️ {ts}
          </button>
        );
      }
      return part;
    });
  };

  // Recursively process children to find text and turn timestamps into clickable buttons
  const renderChildrenWithTimestamps = (children) => {
    if (!children) return null;
    if (typeof children === 'string') {
      return renderMessageWithTimestamps(children);
    }
    if (Array.isArray(children)) {
      return children.map((child, idx) => {
        if (typeof child === 'string') {
          return <React.Fragment key={idx}>{renderMessageWithTimestamps(child)}</React.Fragment>;
        }
        return child;
      });
    }
    return children;
  };

  // Clean fallback in case LLM condenser is still loading or offline
  const cleanSubmissionFallback = (text, targetWords = 120) => {
    if (!text) return '';
    let cleaned = text
      .replace(/^(based on (the )?(professor's )?(lecture|transcript|video|explanation|sources)[^:.\n]*?[,.:]+\s*)/i, '')
      .replace(/^(we can identify|we see that|we can observe|it can be seen that)\s+/i, '')
      .replace(/^(here('s| is) (what|a summary|my takeaway|the answer)[^:.,\n]*[:.,\n]+)/i, '')
      .replace(/^(certainly|sure thing|as an ai|in this lecture)[^:.,\n]*[:.,\n]+/i, '')
      .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(/\s+/);
    if (words.length > targetWords + 15) {
      cleaned = words.slice(0, targetWords).join(' ') + '.';
    }
    return cleaned;
  };

  // Custom component to render markdown with clickable timestamps
  const MarkdownWithTimestamps = ({ content }) => {
    return (
      <ReactMarkdown
        components={{
          // Custom renderer for inline text to handle timestamps
          p: ({ children }) => (
            <p style={{ margin: '0.4rem 0', lineHeight: 1.6 }}>{renderChildrenWithTimestamps(children)}</p>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: '0.25rem', lineHeight: 1.5 }}>{renderChildrenWithTimestamps(children)}</li>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{children}</em>
          ),
          h1: ({ children }) => (
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0.6rem 0 0.3rem', color: 'var(--text-primary)' }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0.5rem 0 0.25rem', color: 'var(--text-primary)' }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0.4rem 0 0.2rem', color: 'var(--text-primary)' }}>{children}</h3>
          ),
          ul: ({ children }) => (
            <ul style={{ paddingLeft: '1.3rem', margin: '0.4rem 0' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ paddingLeft: '1.3rem', margin: '0.4rem 0' }}>{children}</ol>
          ),
          code: ({ children }) => (
            <code style={{
              background: 'var(--panel-bg)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              color: 'var(--theme-primary)'
            }}>{children}</code>
          ),
          pre: ({ children }) => (
            <pre style={{
              background: 'var(--panel-bg)',
              padding: '0.8rem',
              borderRadius: '8px',
              overflow: 'auto',
              margin: '0.5rem 0'
            }}>{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '4px solid var(--theme-primary)',
              paddingLeft: '0.8rem',
              margin: '0.5rem 0',
              fontStyle: 'italic',
              color: 'var(--text-secondary)'
            }}>{children}</blockquote>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  const handleTranscribe = async (targetUrl = urlInput, pushRoute = true) => {
    const rawUrl = targetUrl || urlInput;
    if (!rawUrl.trim()) return;
    const vidId = extractVideoId(rawUrl);

    if (pushRoute && vidId) {
      navigateTo(`/lecture/${vidId}`);
    }

    // 1. If currently active video is already this video, do NOT re-generate
    if (activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
      setCacheNotice("⚡ Video is already active. Transcripts and summary were reused.");
      return;
    }

    // 2. If present in client cache, load immediately (0ms delay, no re-generation)
    if (cachedVideos[vidId]) {
      const cached = cachedVideos[vidId];
      setActiveData({ ...cached, cached: true });
      setUrlInput(cached.sourceUrl || `https://vimeo.com/${vidId}`);
      initChatMessages(cached.title);
      setCacheNotice("⚡ Loaded instantly from browser cache — Transcripts and summary were reused!");
      if (googleUser?.email) {
        fetch('/api/user/library/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_email: googleUser.email,
            email: googleUser.email,
            video_id: vidId,
            title: cached.title,
            video_title: cached.title,
            source_url: cached.sourceUrl || rawUrl,
            video_url: cached.sourceUrl || rawUrl,
            duration: cached.duration || '',
            duration_seconds: cached.duration || null
          })
        }).then(() => fetchUserLibrary(googleUser.email)).catch(() => {});
      }
      return;
    }

    setLoading(true);
    setError(null);
    setCacheNotice(null);

    try {
      const userParam = googleUser?.email ? `&email=${encodeURIComponent(googleUser.email)}` : '';
      const res = await fetch(`/api/transcript?url=${encodeURIComponent(rawUrl)}${userParam}`);
      if (res.ok) {
        const data = await res.json();
        setActiveData(data);
        setUrlInput(data.sourceUrl || `https://vimeo.com/${data.videoId}`);
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

        if (googleUser?.email) {
          fetchUserLibrary(googleUser.email);
        }

        if (data.cached) {
          setCacheNotice("⚡ Retrieved from Database Cache! Transcripts and summary were not regenerated.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned status ${res.status}`);
      }
    } catch (err) {
      console.error("API Call Error:", err);
      setError(err.message || "Failed to fetch lecture transcript. Please check the backend connection and URL.");
    } finally {
      setLoading(false);
    }
  };

  // Keep a ref of activeData so popstate callback always accesses the latest video state
  const activeDataRef = useRef(activeData);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  // Dedicated Route & History Handler (Mount URL load & Browser Back/Forward)
  useEffect(() => {
    // 1. Initial page load check
    const initialPath = window.location.pathname || '/';
    const initialVidId = getLectureIdFromPath(initialPath);
    if (initialVidId) {
      handleTranscribe(initialVidId, false);
    }

    // 2. Browser Back / Forward navigation listener
    const onPopState = () => {
      const current = window.location.pathname || '/';
      setCurrentPath(current);
      const vidId = getLectureIdFromPath(current);
      if (vidId) {
        if (!activeDataRef.current || activeDataRef.current.videoId !== vidId) {
          handleTranscribe(vidId, false);
        }
      } else {
        setActiveData(null);
        setError(null);
        setCacheNotice(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Synchronize document title with currently active lecture route
  useEffect(() => {
    if (activeData?.title) {
      document.title = `${activeData.title} | LectureScribe`;
    } else {
      document.title = 'LectureScribe - LMS & Lecture AI Workspace';
    }
  }, [activeData]);

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

  const initChatMessages = () => {
    setChatMessages([]);
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
          video_title: activeData.title,
          top_k: 10,
          user_email: googleUser?.email || null,
          model_id: selectedModel,
          enable_web_search: webSearchEnabled
        })
      });

      if (res.ok) {
        const data = await res.json();
        const messageId = Date.now();
        const subText = data.submission_text || '';
        
        if (subText) {
          setSubmissionSummaries(prev => ({
            ...prev,
            [messageId]: subText
          }));
        }

        setChatMessages([...newMessages, {
          sender: 'bot',
          text: data.answer,
          citations: data.citations || [],
          web_sources: data.web_sources || [],
          model: data.model || null,
          submission_text: subText,
          submission_word_count: data.submission_word_count || 0,
          id: messageId
        }]);
        
        // If backend did not return submission text, invoke async generation with fallback
        if (!subText) {
          generateSubmissionVersion(data.answer, activeData.videoId, messageId);
        }
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

  const generateSubmissionVersion = async (originalText, videoId, messageId) => {
    try {
      const res = await fetch('/api/rag/query/submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_text: originalText,
          video_id: videoId,
          word_count: 120,
          user_email: googleUser?.email || null,
          model_id: selectedModel
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.submission_text) {
          setSubmissionSummaries(prev => ({
            ...prev,
            [messageId]: data.submission_text
          }));
          return;
        }
      }
      // Fallback if API response did not contain submission_text
      const fallback = cleanSubmissionFallback(originalText, 120);
      setSubmissionSummaries(prev => ({
        ...prev,
        [messageId]: fallback
      }));
    } catch (err) {
      console.error("Submission generation error:", err);
      const fallback = cleanSubmissionFallback(originalText, 120);
      setSubmissionSummaries(prev => ({
        ...prev,
        [messageId]: fallback
      }));
    }
  };

  const copySubmissionText = (text, messageId) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSubmissionId(messageId);
    setTimeout(() => setCopiedSubmissionId(null), 2000);
  };

  const displayCues = searchQuery.trim() && searchResults.length > 0
    ? searchResults.map(h => ({
        time: h.timestamp,
        text: h.text,
        highlightHtml: h._highlightResult?.text?.value
      }))
    : (activeData?.cues || []);

  const handleCopyTranscript = () => {
    if (!activeData) return;
    let md = `# ${activeData.title}\nSource: ${activeData.sourceUrl}\n\n`;
    activeData.cues.forEach(c => {
      md += `**[${c.time}]** ${c.text}\n\n`;
    });
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleCopyMarkdown = handleCopyTranscript;

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
              color: 'var(--theme-primary)',
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

  const handleGoogleSignIn = (autoStartUpload = false) => {
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
            const expiresIn = tokenResponse.expires_in ? Number(tokenResponse.expires_in) : 3599;
            const expiresAt = Date.now() + (expiresIn * 1000);
            try {
              sessionStorage.setItem('lecturescribe_gdrive_token', token);
              sessionStorage.setItem('lecturescribe_gdrive_token_expires', expiresAt.toString());
            } catch {}
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
                if (uData.email) fetchUserLibrary(uData.email);
              } else {
                setGoogleUser({ email: 'Google User' });
                fetchUserLibrary('Google User');
              }
            } catch {
              setGoogleUser({ email: 'Google User' });
              fetchUserLibrary('Google User');
            }

            if (autoStartUpload) {
              startUploadWithToken(token);
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
      sessionStorage.removeItem('lecturescribe_gdrive_token_expires');
      sessionStorage.removeItem('lecturescribe_google_user');
    } catch {}
  };

  const startUploadWithToken = async (activeToken) => {
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
          access_token: (activeToken || '').trim() || null,
          user_email: googleUser?.email || null
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload trigger failed (Status ${res.status})`);
      }

      const jobData = await res.json();
      const jobId = jobData.job_id;
      setGdriveJobId(jobId);
      setGdriveJob({ status: 'PROCESSING', progress: 5, current_step: 'Downloading video stream...' });

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
              if (currentJob.status === 'COMPLETED' && googleUser?.email) {
                fetchUserLibrary(googleUser.email);
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

    // Check if token is expired or expires in less than 2 minutes
    const tokenExpiresAt = Number(sessionStorage.getItem('lecturescribe_gdrive_token_expires') || '0');
    const isTokenExpired = tokenExpiresAt > 0 && Date.now() > (tokenExpiresAt - 120000);

    if (gdriveAccessToken && isTokenExpired) {
      // Auto re-authenticate with Google popup and then auto-start upload
      setGdriveError("Google session expired (tokens are valid for 1h). Re-authenticating with Google...");
      handleGoogleSignIn(true);
      return;
    }

    startUploadWithToken(gdriveAccessToken);
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);


  const filteredLibrary = userLibrary.filter(item => {
    if (!librarySearch.trim()) return true;
    const q = librarySearch.toLowerCase();
    return (
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q))
    );
  });

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
        
        {/* Header */}
        <header style={{
          background: currentTheme.palette.headerGradient || currentTheme.palette.headerBg,
          color: currentTheme.palette.headerText || '#ffffff',
          borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '62px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.15rem' }}>
            <span
              style={{ color: '#ffffff', fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.3px', cursor: 'pointer' }}
              onClick={handleBackToHub}
            >
              LearnScribe LMS
            </span>
          </div>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {activeData && (
              <>
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  background: 'rgba(0, 0, 0, 0.2)',
                  padding: '4px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.15)'
                }}>
                  <button
                    onClick={() => setActiveTab('transcript')}
                    style={{
                      background: activeTab === 'transcript' ? '#ffffff' : 'transparent',
                      color: activeTab === 'transcript' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <Search size={15} /> Search Transcript
                  </button>
                  <button
                    onClick={() => setActiveTab('tutor')}
                    style={{
                      background: activeTab === 'tutor' ? '#ffffff' : 'transparent',
                      color: activeTab === 'tutor' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <Bot size={16} /> AI Tutor
                  </button>
                </div>

                <button
                  onClick={() => openDownloadModal('device')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(255, 255, 255, 0.16)',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
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

                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ArrowLeft size={16} />}
                  onClick={handleBackToHub}
                  sx={{
                    textTransform: 'none',
                    borderColor: 'rgba(255, 255, 255, 0.35)',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.84rem',
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.6,
                    '&:hover': { borderColor: '#ffffff', bgcolor: 'rgba(255, 255, 255, 0.1)' }
                  }}
                >
                  {googleUser ? 'My Library' : 'New Video'}
                </Button>
              </>
            )}

            {/* LMS Theme Selector from Proton (only for signed-in users) */}
            {googleUser && (
              <ProtonThemeSelector
                themes={LMS_THEMES}
                currentThemeId={currentThemeId}
                onSelectTheme={(themeId) => setTheme(themeId)}
                title="LMS Theme Selector"
                subtitle="Authentic campus & higher-ed LMS palettes"
              />
            )}


            {/* Top-Right Google Sign-In or User Profile Menu */}
            {!googleUser ? (
              <Button
                variant="contained"
                onClick={() => handleGoogleSignIn(false)}
                startIcon={<GoogleIcon />}
                sx={{
                  background: '#ffffff',
                  color: '#1f2937',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  borderRadius: '20px',
                  padding: '5px 14px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  '&:hover': { background: '#f3f4f6' }
                }}
              >
                Sign in with Google
              </Button>
            ) : (
              <>
                <Tooltip title={`${googleUser.name || 'Google User'} (${googleUser.email})`}>
                  <IconButton
                    onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                    sx={{ p: 0.5, border: '2px solid rgba(255, 255, 255, 0.6)', '&:hover': { borderColor: '#ffffff' } }}
                  >
                    <Avatar
                      alt={googleUser.name || googleUser.email}
                      src={googleUser.picture}
                      sx={{ width: 34, height: 34, bgcolor: currentTheme.palette.primary, fontSize: '0.85rem', fontWeight: 700 }}
                    >
                      {(googleUser.name || googleUser.email || 'U').charAt(0).toUpperCase()}
                    </Avatar>
                  </IconButton>
                </Tooltip>

                <Menu
                  anchorEl={userMenuAnchor}
                  open={Boolean(userMenuAnchor)}
                  onClose={() => setUserMenuAnchor(null)}
                  PaperProps={{
                    sx: {
                      bgcolor: currentTheme.palette.cardBg,
                      color: currentTheme.palette.textPrimary,
                      border: `1px solid ${currentTheme.palette.cardBorder}`,
                      boxShadow: currentTheme.palette.cardShadow,
                      minWidth: 240,
                      borderRadius: 2,
                      mt: 1.5,
                      p: 1
                    }
                  }}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                >
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#f8fafc' }}>
                      {googleUser.name || 'Google Scholar'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#94a3b8', wordBreak: 'break-all', display: 'block' }}>
                      {googleUser.email}
                    </Typography>
                  </Box>
                  <Divider sx={{ my: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }} />
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      handleBackToHub();
                    }}
                    sx={{ borderRadius: 1, py: 1 }}
                  >
                    <ListItemIcon>
                      <Folder size={18} color={currentTheme.palette.primary} />
                    </ListItemIcon>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      My Lecture Library ({userLibrary.length})
                    </Typography>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      if (activeData) openDownloadModal('cloud');
                    }}
                    disabled={!activeData}
                    sx={{ borderRadius: 1, py: 1 }}
                  >
                    <ListItemIcon>
                      <Cloud size={18} color="#10b981" />
                    </ListItemIcon>
                    <Typography variant="body2">
                      Google Drive Sync Active
                    </Typography>
                  </MenuItem>
                  <Divider sx={{ my: 1, borderColor: currentTheme.palette.cardBorder }} />
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      handleGoogleSignOut();
                    }}
                    sx={{ borderRadius: 1, py: 1, color: '#dc2626' }}
                  >
                    <ListItemIcon>
                      <LogOut size={18} color="#dc2626" />
                    </ListItemIcon>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Sign Out
                    </Typography>
                  </MenuItem>
                </Menu>
              </>
            )}
          </Box>
        </header>

        {/* Main Content Area */}
        {loading && !activeData ? (
          <Box sx={{ maxWidth: '800px', mx: 'auto', p: { xs: 4, md: 8 }, textAlign: 'center' }}>
            <Paper sx={{ p: 5, borderRadius: 4, bgcolor: currentTheme.palette.cardBg, border: `1px solid ${currentTheme.palette.cardBorder}`, boxShadow: currentTheme.palette.cardShadow }}>
              <RefreshCw size={44} color={currentTheme.palette.primary} style={{ animation: 'spin 2s linear infinite', display: 'inline-block' }} />
              <Typography variant="h5" sx={{ mt: 3, fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                Loading Lecture {getLectureIdFromPath(currentPath) ? `#${getLectureIdFromPath(currentPath)}` : ''}...
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: currentTheme.palette.textSecondary }}>
                Fetching video config, transcript cues, search index, and AI tutor knowledge base...
              </Typography>
            </Paper>
          </Box>
        ) : error && !activeData && getLectureIdFromPath(currentPath) ? (
          <Box sx={{ maxWidth: '800px', mx: 'auto', p: { xs: 4, md: 8 }, textAlign: 'center' }}>
            <Paper sx={{ p: 5, borderRadius: 4, bgcolor: currentTheme.palette.cardBg, border: '1px solid rgba(239, 68, 68, 0.4)', boxShadow: currentTheme.palette.cardShadow }}>
              <AlertCircle size={44} color="#dc2626" style={{ display: 'inline-block' }} />
              <Typography variant="h5" sx={{ mt: 2, fontWeight: 700, color: '#f8fafc' }}>
                Could Not Load Lecture
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: '#94a3b8', mb: 3 }}>
                {error}
              </Typography>
              <Button
                variant="contained"
                onClick={handleBackToHub}
                startIcon={<ArrowLeft size={16} />}
                sx={{ bgcolor: currentTheme.palette.primary, color: '#ffffff', textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: currentTheme.palette.primaryHover } }}
              >
                Back to {googleUser ? 'My Library' : 'Home'}
              </Button>
            </Paper>
          </Box>
        ) : !activeData ? (
          googleUser ? (
            /* ================= FLOW 1: SIGNED-IN LMS DASHBOARD ================= */
            <Box sx={{ maxWidth: '1200px', mx: 'auto', p: { xs: 2.5, md: 4 } }}>
              {/* Scholar Greeting & Stats Banner */}
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2.5, md: 3 },
                  mb: 4,
                  borderRadius: 3,
                  background: currentTheme.palette.headerGradient,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  display: 'flex',
                  flexDirection: { xs: 'column', md: 'row' },
                  alignItems: { xs: 'flex-start', md: 'center' },
                  justifyContent: 'space-between',
                  gap: 2,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar
                    src={googleUser.picture}
                    alt={googleUser.name}
                    sx={{ width: 56, height: 56, bgcolor: currentTheme.palette.primary, fontWeight: 800, fontSize: '1.4rem' }}
                  >
                    {(googleUser.name || googleUser.email || 'U').charAt(0).toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 1 }}>
                      Welcome back, {googleUser.name ? googleUser.name.split(' ')[0] : (googleUser.email ? googleUser.email.split('@')[0] : 'Scholar')}! 🎓
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.85)', mt: 0.5 }}>
                      {currentTheme.name} • Verified Study History & Cloud Backups
                    </Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Paper
                    elevation={0}
                    sx={{
                      px: 2.5,
                      py: 1.2,
                      borderRadius: 2.5,
                      bgcolor: 'rgba(255, 255, 255, 0.15)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255, 255, 255, 0.22)',
                      textAlign: 'center'
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)', display: 'block', fontWeight: 600 }}>Total Lectures</Typography>
                    <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 800, lineHeight: 1 }}>{userLibrary.length}</Typography>
                  </Paper>
                  <Paper
                    elevation={0}
                    sx={{
                      px: 2.5,
                      py: 1.2,
                      borderRadius: 2.5,
                      bgcolor: 'rgba(255, 255, 255, 0.15)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255, 255, 255, 0.22)',
                      textAlign: 'center'
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)', display: 'block', fontWeight: 600 }}>Google Drive Synced</Typography>
                    <Typography variant="h6" sx={{ color: '#a7f3d0', fontWeight: 800, lineHeight: 1 }}>
                      {userLibrary.filter(x => x.drive_folder_url).length}
                    </Typography>
                  </Paper>
                </Box>
              </Paper>

              {/* Quick-Add Lecture Bar */}
              <Paper
                elevation={0}
                sx={{
                  p: '6px 12px',
                  mb: 3,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  bgcolor: currentTheme.palette.cardBg,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  boxShadow: currentTheme.palette.cardShadow
                }}
              >
                <Video size={22} color={currentTheme.palette.textSecondary} style={{ marginLeft: 8, marginRight: 12, flexShrink: 0 }} />
                <InputBase
                  placeholder="Paste any lecture video URL or ID to study & save..."
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setCacheNotice(null); }}
                  onPaste={handlePasteUrl}
                  onKeyDown={(e) => e.key === 'Enter' && handleTranscribe()}
                  sx={{ flex: 1, color: currentTheme.palette.textPrimary, fontSize: '0.95rem' }}
                />
                <Button
                  variant="contained"
                  onClick={() => handleTranscribe()}
                  disabled={loading || !urlInput.trim()}
                  startIcon={loading ? <RefreshCw className="loading-pulse" size={16} /> : <Sparkles size={16} />}
                  sx={{
                    bgcolor: currentTheme.palette.primary,
                    color: '#ffffff',
                    fontWeight: 700,
                    textTransform: 'none',
                    px: 3,
                    py: 1,
                    borderRadius: 2,
                    '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                  }}
                >
                  {loading ? 'Ingesting...' : 'Transcribe & Study'}
                </Button>
              </Paper>

              {/* Error Banner */}
              {error && (
                <Box sx={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  color: '#f87171',
                  p: 1.5,
                  borderRadius: 2,
                  mb: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  fontSize: '0.9rem'
                }}>
                  <AlertCircle size={18} /> {error}
                </Box>
              )}

              {/* Cache Notice Banner */}
              {cacheNotice && (
                <Box sx={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid #10b981',
                  color: '#34d399',
                  p: 1.5,
                  borderRadius: 2,
                  mb: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  fontSize: '0.9rem',
                  fontWeight: 500
                }}>
                  <Check size={18} /> {cacheNotice}
                </Box>
              )}

              {/* Library Header & Search Bar */}
              <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                    My Lecture Library
                  </Typography>
                  <Chip
                    label={`${filteredLibrary.length} ${filteredLibrary.length === 1 ? 'lecture' : 'lectures'}`}
                    size="small"
                    sx={{ bgcolor: currentTheme.palette.badgeBg, color: currentTheme.palette.badgeColor, fontWeight: 700, border: `1px solid ${currentTheme.palette.badgeBorder}` }}
                  />
                  <Tooltip title="Refresh Library">
                    <IconButton
                      size="small"
                      onClick={() => fetchUserLibrary(googleUser?.email)}
                      sx={{ color: currentTheme.palette.textSecondary, '&:hover': { color: currentTheme.palette.primary } }}
                    >
                      <RefreshCw size={15} className={libraryLoading ? 'loading-pulse' : ''} />
                    </IconButton>
                  </Tooltip>
                </Box>

                <TextField
                  size="small"
                  placeholder="Search by title or video ID..."
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search size={16} color={currentTheme.palette.textSecondary} />
                      </InputAdornment>
                    ),
                    sx: {
                      bgcolor: currentTheme.palette.cardBg,
                      borderRadius: 2,
                      fontSize: '0.85rem',
                      color: currentTheme.palette.textPrimary,
                      width: { xs: '100%', sm: 280 },
                      '& fieldset': { borderColor: currentTheme.palette.cardBorder },
                      '&:hover fieldset': { borderColor: currentTheme.palette.primary }
                    }
                  }}
                />
              </Box>

              {/* Cards Grid */}
              {filteredLibrary.length > 0 ? (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      sm: 'repeat(2, minmax(0, 1fr))',
                      md: 'repeat(3, minmax(0, 1fr))'
                    },
                    gap: 3,
                    width: '100%',
                    alignItems: 'stretch'
                  }}
                >
                  {filteredLibrary.map((item) => (
                    <Card
                      key={item.video_id}
                      sx={{
                        width: '100%',
                        height: '100%',
                        minWidth: 0,
                        boxSizing: 'border-box',
                        bgcolor: currentTheme.palette.cardBg,
                        border: `1px solid ${currentTheme.palette.cardBorder}`,
                        borderRadius: 3,
                        boxShadow: currentTheme.palette.cardShadow,
                        transition: 'all 0.2s ease-in-out',
                        display: 'flex',
                        flexDirection: 'column',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          borderColor: currentTheme.palette.primary,
                          boxShadow: currentTheme.palette.cardHoverShadow
                        }
                      }}
                    >
                      <CardContent sx={{ flex: 1, p: 2.5, display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={`/lecture/${item.video_id}`}
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTranscribe(item.video_url || item.video_id);
                              }}
                              title="Open dedicated lecture route"
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                fontSize: '0.72rem',
                                bgcolor: currentTheme.palette.badgeBg,
                                color: currentTheme.palette.badgeColor,
                                border: `1px solid ${currentTheme.palette.badgeBorder}`,
                                cursor: 'pointer',
                                '&:hover': { opacity: 0.85 }
                              }}
                            />
                          </Box>
                          <Typography variant="caption" sx={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Clock size={12} /> {formatRelativeTime(item.last_accessed_at || item.created_at)}
                          </Typography>
                        </Box>

                        <Typography
                          variant="subtitle1"
                          sx={{
                            fontWeight: 700,
                            color: currentTheme.palette.textPrimary,
                            lineHeight: 1.4,
                            mb: 1.5,
                            minHeight: '2.8em',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            '&:hover': { color: currentTheme.palette.primary }
                          }}
                          onClick={() => handleTranscribe(item.video_url || item.video_id)}
                        >
                          {item.video_title || `Lecture ${item.video_id}`}
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mt: 'auto' }}>
                          {item.drive_folder_url ? (
                            <Chip
                              icon={<Folder size={13} color="#10b981" />}
                              label="In Google Drive"
                              size="small"
                              component="a"
                              href={item.drive_folder_url}
                              target="_blank"
                              rel="noreferrer"
                              clickable
                              sx={{
                                bgcolor: 'rgba(16, 185, 129, 0.15)',
                                color: '#34d399',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                fontWeight: 600,
                                fontSize: '0.7rem'
                              }}
                            />
                          ) : (
                            <Chip
                              label="Local / Database"
                              size="small"
                              sx={{
                                bgcolor: 'rgba(255, 255, 255, 0.05)',
                                color: '#94a3b8',
                                fontSize: '0.7rem'
                              }}
                            />
                          )}
                          <Chip
                            label="Transcript Search"
                            size="small"
                            sx={{
                              bgcolor: currentTheme.palette.badgeBg,
                              color: currentTheme.palette.badgeColor,
                              fontSize: '0.7rem',
                              fontWeight: 600
                            }}
                          />
                          <Chip
                            label="AI Tutor"
                            size="small"
                            sx={{
                              bgcolor: 'rgba(139, 92, 246, 0.1)',
                              color: '#8b5cf6',
                              fontSize: '0.7rem',
                              fontWeight: 600
                            }}
                          />
                        </Box>
                      </CardContent>

                      <Divider sx={{ borderColor: currentTheme.palette.cardBorder }} />

                      <CardActions sx={{ p: 1.5, justifyContent: 'space-between' }}>
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => handleTranscribe(item.video_url || item.video_id)}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            bgcolor: currentTheme.palette.accentCta,
                            '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                          }}
                        >
                          Study Lecture →
                        </Button>

                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {item.drive_folder_url && (
                            <Tooltip title="Open in Google Drive">
                              <IconButton
                                size="small"
                                component="a"
                                href={item.drive_folder_url}
                                target="_blank"
                                rel="noreferrer"
                                sx={{ color: '#10b981', '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.1)' } }}
                              >
                                <ExternalLink size={16} />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Remove from My Library">
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteFromLibrary(item.video_id)}
                              sx={{ color: '#64748b', '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' } }}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </CardActions>
                    </Card>
                  ))}
                </Box>

              ) : (
                <Paper
                  elevation={0}
                  sx={{
                    p: 6,
                    textAlign: 'center',
                    bgcolor: currentTheme.palette.cardBg,
                    border: `1px dashed ${currentTheme.palette.cardBorder}`,
                    borderRadius: 3,
                    boxShadow: currentTheme.palette.cardShadow
                  }}
                >
                  <BookOpen size={48} color={currentTheme.palette.primary} style={{ margin: '0 auto 16px', opacity: 0.85 }} />
                  <Typography variant="h6" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 1 }}>
                    {librarySearch ? 'No matching lectures found' : 'Your Lecture Library is Empty'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 460, mx: 'auto', mb: 1 }}>
                    {librarySearch
                      ? `No lectures matched "${librarySearch}". Try a different keyword or paste a new lecture URL above.`
                      : 'Paste any lecture link in the quick-add bar above to transcribe, index into search and AI tutor, and start studying!'}
                  </Typography>
                </Paper>
              )}
            </Box>
          ) : (
            /* ================= FLOW 2: GUEST / NON-SIGNED-IN SCREEN ================= */
            <div className="fade-in" style={{
              maxWidth: '1200px',
              margin: '40px auto 60px',
              padding: '0 24px',
              textAlign: 'center'
            }}>
              <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <h1 style={{
                  fontSize: '2.8rem',
                  fontWeight: 800,
                  lineHeight: 1.2,
                  letterSpacing: '-1px',
                  marginBottom: '14px',
                  color: currentTheme.palette.textPrimary
                }}>
                  LearnScribe LMS
                </h1>

                <p style={{
                  color: currentTheme.palette.textSecondary,
                  fontSize: '1.15rem',
                  maxWidth: '620px',
                  margin: '0 auto 28px',
                  lineHeight: 1.5
                }}>
                  Instant transcript search, executive summaries, and interactive AI Tutor for your lectures.
                </p>

                {/* Google Sign-in Callout Box */}
                <Paper
                  elevation={0}
                  sx={{
                    maxWidth: '640px',
                    mx: 'auto',
                    mb: 4,
                    p: 2,
                    borderRadius: 2.5,
                    bgcolor: currentTheme.palette.cardBg,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    boxShadow: currentTheme.palette.cardShadow,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    textAlign: 'left'
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <GoogleIcon />
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                        Sign in for your LMS Study Library
                      </Typography>
                      <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block' }}>
                        Keep a persistent history of all your lectures and backup full video bundles to Google Drive.
                      </Typography>
                    </Box>
                  </Box>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleGoogleSignIn(false)}
                    sx={{
                      bgcolor: currentTheme.palette.primary,
                      color: '#ffffff',
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      borderRadius: 2,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                      '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                    }}
                  >
                    Sign In
                  </Button>
                </Paper>

                {/* Error Banner */}
                {error && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid #ef4444',
                    color: '#dc2626',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '0.9rem',
                    fontWeight: 600
                  }}>
                    <AlertCircle size={18} /> {error}
                  </div>
                )}

                {/* Cache Notice Banner */}
                {cacheNotice && (
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid #10b981',
                    color: '#059669',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '0.9rem',
                    fontWeight: 600
                  }}>
                    <Check size={18} /> {cacheNotice}
                  </div>
                )}

                {/* Input Form */}
                <div style={{
                  background: currentTheme.palette.cardBg,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  padding: '8px',
                  borderRadius: '12px',
                  display: 'flex',
                  gap: '8px',
                  boxShadow: currentTheme.palette.cardShadow
                }}>
                  <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Video size={20} style={{ position: 'absolute', left: '14px', color: currentTheme.palette.textSecondary }} />
                    <input
                      type="text"
                      placeholder="Paste lecture video link or ID..."
                      value={urlInput}
                      onChange={(e) => { setUrlInput(e.target.value); setCacheNotice(null); }}
                      onPaste={handlePasteUrl}
                      onKeyDown={(e) => e.key === 'Enter' && handleTranscribe()}
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: currentTheme.palette.textPrimary,
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
                      background: currentTheme.palette.primary,
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
              </div>
            </div>
          )
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
                <Chip
                  icon={<Bookmark size={13} color={currentTheme.palette.primary} />}
                  label={`/lecture/${activeData.videoId}`}
                  size="small"
                  onClick={() => {
                    const fullUrl = `${window.location.origin}/lecture/${activeData.videoId}`;
                    navigator.clipboard.writeText(fullUrl);
                    setCacheNotice(`🔗 Copied permanent route: ${fullUrl}`);
                    setTimeout(() => setCacheNotice(null), 3000);
                  }}
                  title="Click to copy permanent direct lecture route"
                  sx={{
                    fontFamily: 'monospace',
                    bgcolor: currentTheme.palette.badgeBg,
                    color: currentTheme.palette.badgeColor,
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    border: `1px solid ${currentTheme.palette.badgeBorder}`,
                    '&:hover': { opacity: 0.85 }
                  }}
                />
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
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={12} color="var(--theme-primary)" /> {activeData.cached ? 'Database Cache (Reused)' : 'Cloud Database'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} color="#10b981" /> Instant Search</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Bot size={12} color="#8b5cf6" /> AI Tutor</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={handleCopyTranscript}
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
                {copied ? <Check size={16} color="var(--theme-primary)" /> : <Copy size={16} />}
                {copied ? 'Copied Transcript!' : 'Copy Transcript'}
              </button>
            </div>
          </div>

          {/* Right Panel: Instant Search Drawer or AI Tutor */}
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
                      <Search size={16} color="var(--theme-primary)" /> Instant Transcript Search
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Showing {displayCues.length} hits</span>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input
                      type="text"
                      placeholder="Search transcript by keywords or topics..."
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
                        borderLeft: activeCueIdx === idx ? '3px solid var(--theme-primary)' : '3px solid transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        color: 'var(--theme-primary)',
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
          ) : (
            /* SIMPLE AI CHAT BOT VIEW */
            <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              {/* Chat Header with Model Selector & Web Search Toggle */}
              <div style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                background: 'var(--card-bg)'
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
                    <Bot size={18} color="var(--theme-primary)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      AI Tutor
                    </h3>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Grounded Lecture & Web Socratic Tutor
                    </p>
                  </div>
                </div>

                {/* Model Selector & View Mode Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* View Mode Segmented Control in Header */}
                  <div style={{
                    display: 'inline-flex',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '2px',
                    gap: '2px'
                  }}>
                    <button
                      onClick={() => setViewMode('learning')}
                      title="Comprehensive learning mode: formatted Markdown, clickable timestamps, and lecture citations"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: viewMode === 'learning' ? 700 : 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: viewMode === 'learning' ? 'var(--theme-primary)' : 'transparent',
                        color: viewMode === 'learning' ? '#ffffff' : 'var(--text-secondary)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <BookOpen size={12} />
                      <span>Learning View</span>
                    </button>
                    <button
                      onClick={() => setViewMode('submission')}
                      title="Academic submission mode: 100-150 words, plain human style, no markdown or timestamps, 1-click copy"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: viewMode === 'submission' ? 700 : 500,
                        cursor: 'pointer',
                        border: 'none',
                        background: viewMode === 'submission' ? 'var(--theme-primary)' : 'transparent',
                        color: viewMode === 'submission' ? '#ffffff' : 'var(--text-secondary)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <FileText size={12} />
                      <span>Submission View</span>
                    </button>
                  </div>

                  {/* Web Grounding Toggle */}
                  <button
                    onClick={() => setWebSearchEnabled(prev => !prev)}
                    title={webSearchEnabled ? "Web grounding ENABLED (Free DuckDuckGo & Wikipedia search)" : "Web grounding DISABLED (Transcripts only)"}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: webSearchEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                      background: webSearchEnabled ? 'rgba(16, 185, 129, 0.12)' : 'var(--panel-bg)',
                      color: webSearchEnabled ? '#10b981' : 'var(--text-secondary)',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <Globe size={13} color={webSearchEnabled ? '#10b981' : 'var(--text-secondary)'} />
                    <span>Web: {webSearchEnabled ? 'ON' : 'OFF'}</span>
                  </button>

                  {/* Model Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      title="Select the active LLM engine"
                      style={{
                        background: 'var(--panel-bg)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '5px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        outline: 'none',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                      }}
                    >
                      {(availableModels.length > 0 ? availableModels : [
                        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', badge: '⚡ Free 1.5k/day' },
                        { id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B', badge: '🚀 Free 1k/day' },
                        { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'HF Llama 3.1 8B', badge: '🤗 Active Free' }
                      ]).map(m => (
                        <option key={m.id} value={m.id}>
                          {m.badge ? `${m.name} (${m.badge})` : m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Chat Messages Container */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}>
                {chatMessages.map((msg, idx) => {
                  const currentMsgMode = msg.viewOverride || viewMode;
                  const submissionText = submissionSummaries[msg.id] || msg.submission_text || cleanSubmissionFallback(msg.text);
                  const submissionWords = submissionText ? submissionText.trim().split(/\s+/).filter(Boolean).length : 0;
                  const isTargetRange = submissionWords >= 85 && submissionWords <= 155;

                  return (
                    <div
                      key={msg.id || idx}
                      style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                        alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '88%'
                      }}
                    >
                      {msg.sender === 'bot' && (
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--highlight-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: '2px'
                        }}>
                          <Bot size={16} color="var(--theme-primary)" />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '100%' }}>
                        {/* Per-Message View Mode Toggle */}
                        {msg.sender === 'bot' && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '6px',
                            marginBottom: '2px',
                            flexWrap: 'wrap'
                          }}>
                            <div style={{
                              display: 'inline-flex',
                              background: 'var(--panel-bg)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              padding: '1px',
                              gap: '2px'
                            }}>
                              <button
                                onClick={() => {
                                  setChatMessages(prev => prev.map((m, i) => (i === idx || m.id === msg.id) ? { ...m, viewOverride: 'learning' } : m));
                                }}
                                style={{
                                  background: currentMsgMode === 'learning' ? 'var(--theme-primary)' : 'transparent',
                                  color: currentMsgMode === 'learning' ? '#ffffff' : 'var(--text-secondary)',
                                  border: 'none',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  fontSize: '0.72rem',
                                  fontWeight: currentMsgMode === 'learning' ? 700 : 500,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <BookOpen size={11} /> Learning View
                              </button>
                              <button
                                onClick={() => {
                                  setChatMessages(prev => prev.map((m, i) => (i === idx || m.id === msg.id) ? { ...m, viewOverride: 'submission' } : m));
                                }}
                                style={{
                                  background: currentMsgMode === 'submission' ? 'var(--theme-primary)' : 'transparent',
                                  color: currentMsgMode === 'submission' ? '#ffffff' : 'var(--text-secondary)',
                                  border: 'none',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  fontSize: '0.72rem',
                                  fontWeight: currentMsgMode === 'submission' ? 700 : 500,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <FileText size={11} /> Submission View
                              </button>
                            </div>

                            {currentMsgMode === 'submission' && (
                              <span style={{
                                fontSize: '0.7rem',
                                color: isTargetRange ? '#10b981' : 'var(--text-secondary)',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}>
                                {isTargetRange ? '✓' : '•'} {submissionWords} words (Target: 100–150)
                              </span>
                            )}
                          </div>
                        )}

                        {/* Main Message Bubble */}
                        <div style={{
                          background: msg.sender === 'user' ? 'var(--theme-primary)' : 'var(--card-bg)',
                          color: msg.sender === 'user' ? '#ffffff' : 'var(--text-primary)',
                          padding: currentMsgMode === 'submission' && msg.sender === 'bot' ? '14px 16px' : '10px 14px',
                          borderRadius: '12px',
                          borderTopLeftRadius: msg.sender === 'bot' ? '2px' : '12px',
                          borderTopRightRadius: msg.sender === 'user' ? '2px' : '12px',
                          fontSize: '0.88rem',
                          lineHeight: '1.6',
                          border: msg.sender === 'bot' ? (currentMsgMode === 'submission' ? '1px solid rgba(0, 117, 237, 0.25)' : '1px solid var(--border-color)') : 'none',
                          boxShadow: currentMsgMode === 'submission' && msg.sender === 'bot' ? '0 2px 8px rgba(0, 117, 237, 0.08)' : '0 1px 3px rgba(0,0,0,0.06)'
                        }}>
                          {msg.sender === 'user' ? (
                            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                          ) : currentMsgMode === 'learning' ? (
                            <MarkdownWithTimestamps content={msg.text} />
                          ) : (
                            /* Submission Mode View: Clean human academic prose */
                            <div>
                              <div style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                color: 'var(--theme-primary)',
                                marginBottom: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                              }}>
                                <FileText size={12} />
                                <span>Academic Assignment Submission (Graduate Tone)</span>
                              </div>
                              <div style={{
                                fontSize: '0.88rem',
                                lineHeight: '1.65',
                                color: 'var(--text-primary)',
                                fontFamily: 'inherit',
                                whiteSpace: 'pre-wrap'
                              }}>
                                {submissionText || 'Generating condensed submission...'}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Submission Mode Footer Bar: Word Count & 1-Click Copy */}
                        {msg.sender === 'bot' && currentMsgMode === 'submission' && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 12px',
                            background: 'var(--panel-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            fontSize: '0.75rem',
                            gap: '8px',
                            flexWrap: 'wrap'
                          }}>
                            <span style={{
                              color: isTargetRange ? '#10b981' : 'var(--text-secondary)',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              {isTargetRange ? <CheckCircle2 size={12} color="#10b981" /> : <Clock size={12} />}
                              {submissionWords} words • Target: 100–150 words
                            </span>

                            <button
                              onClick={() => copySubmissionText(submissionText, msg.id)}
                              style={{
                                background: copiedSubmissionId === msg.id ? '#10b981' : 'var(--highlight-bg)',
                                color: copiedSubmissionId === msg.id ? '#ffffff' : 'var(--theme-primary)',
                                border: '1px solid ' + (copiedSubmissionId === msg.id ? '#10b981' : 'rgba(0, 117, 237, 0.3)'),
                                padding: '5px 12px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {copiedSubmissionId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                              <span>{copiedSubmissionId === msg.id ? 'Copied to Clipboard!' : 'Copy for Submission'}</span>
                            </button>
                          </div>
                        )}

                        {/* Lecture Transcript Citations Pill Bar (Shown in Learning Mode) */}
                        {msg.sender === 'bot' && currentMsgMode === 'learning' && msg.citations && msg.citations.length > 0 && (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            padding: '8px 12px',
                            background: 'var(--panel-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            fontSize: '0.75rem',
                            marginTop: '2px'
                          }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <Clock size={12} color="var(--theme-primary)" /> Lecture Citations (Click to jump):
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {msg.citations.map((cite, cIdx) => (
                                <button
                                  key={cIdx}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleCueClick(cite.timestamp);
                                  }}
                                  title={cite.text ? `Jump to ${cite.timestamp}: "${cite.text}"` : `Jump to ${cite.timestamp}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    background: 'var(--card-bg)',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--theme-primary)',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.74rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <Play size={10} style={{ fill: 'currentColor' }} />
                                  <span>{cite.timestamp}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Model & Web Source Badges (Shown in Learning Mode) */}
                        {msg.sender === 'bot' && currentMsgMode === 'learning' && (msg.model || (msg.web_sources && msg.web_sources.length > 0)) && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                          fontSize: '0.72rem',
                          color: 'var(--text-secondary)',
                          paddingLeft: '2px'
                        }}>
                          {msg.model && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              background: 'var(--highlight-bg)',
                              color: 'var(--theme-primary)',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontWeight: 600
                            }}>
                              <Zap size={10} /> {msg.model}
                            </span>
                          )}
                          {msg.web_sources && msg.web_sources.length > 0 && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              background: 'rgba(16, 185, 129, 0.1)',
                              color: '#10b981',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontWeight: 600
                            }}>
                              <Globe size={10} /> {msg.web_sources.length} Web Sources Grounded
                            </span>
                          )}
                        </div>
                      )}

                      {/* Web References Links */}
                      {msg.sender === 'bot' && msg.web_sources && msg.web_sources.length > 0 && (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          padding: '6px 10px',
                          background: 'var(--panel-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '0.74rem'
                        }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Globe size={11} color="#10b981" /> Web References:
                          </div>
                          {msg.web_sources.map((src, sIdx) => (
                            <a
                              key={sIdx}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: 'var(--theme-primary)',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={src.snippet || src.title}
                            >
                              <ExternalLink size={10} /> {src.title || src.url}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    {msg.sender === 'user' && (
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: '2px'
                      }}>
                        <User size={15} color="var(--text-secondary)" />
                      </div>
                    )}
                  </div>
                );
              })}

                {chatLoading && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'var(--highlight-bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Bot size={16} color="var(--theme-primary)" />
                    </div>
                    <div style={{
                      background: 'var(--card-bg)',
                      padding: '8px 14px',
                      borderRadius: '12px',
                      fontSize: '0.82rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <RefreshCw className="loading-pulse" size={14} /> Thinking...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Simple Input Text Box */}
              <div style={{ padding: '14px 20px', background: 'var(--panel-bg)', borderTop: '1px solid var(--border-color)' }}>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '6px 6px 6px 14px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                }}>
                  <input
                    type="text"
                    placeholder="Ask AI tutor anything about this lecture..."
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
                      background: 'var(--theme-primary)',
                      color: '#ffffff',
                      border: 'none',
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: !chatInput.trim() || chatLoading ? 'not-allowed' : 'pointer',
                      opacity: !chatInput.trim() || chatLoading ? 0.4 : 1,
                      transition: 'all 0.2s ease'
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
                <Download size={20} color="var(--theme-primary)" />
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
                  borderBottom: downloadModalTab === 'device' ? '2px solid var(--theme-primary)' : '2px solid transparent',
                  color: downloadModalTab === 'device' ? 'var(--theme-primary)' : 'var(--text-secondary)',
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
                  borderBottom: downloadModalTab === 'cloud' ? '2px solid var(--theme-primary)' : '2px solid transparent',
                  color: downloadModalTab === 'cloud' ? 'var(--theme-primary)' : 'var(--text-secondary)',
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
                      <FileText size={16} color="var(--theme-primary)" />
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
                        <Download size={14} color="var(--theme-primary)" />
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
                        <Download size={14} color="var(--theme-primary)" />
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
                        <Download size={14} color="var(--theme-primary)" />
                        Subtitles (captions.vtt)
                      </button>
                    </div>
                  </div>

                  {/* Progressive MP4 Downloads if available */}
                  {streamData?.progressive_mp4s && streamData.progressive_mp4s.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Video size={16} color="var(--theme-primary)" />
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
                              <span style={{ fontWeight: 700, color: 'var(--theme-primary)', fontSize: '0.88rem' }}>
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
                                background: 'var(--theme-primary)',
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
                      <Terminal size={16} color="var(--theme-primary)" />
                      Download Video Stream via CLI (yt-dlp / ffmpeg)
                    </h4>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      High-definition lecture video is streamed using multi-bitrate Adaptive HLS (<code style={{ color: 'var(--theme-primary)' }}>.m3u8</code>). Use these 1-click commands to download the full HD video directly onto your machine:
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
    </ThemeProvider>
  );
}

