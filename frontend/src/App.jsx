import React, { useState, useEffect, useRef, useMemo } from 'react';
import Player from '@vimeo/player';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import {
  ArrowLeft, Search, RefreshCw, AlertCircle, Check, Video, Paperclip, Upload
} from 'lucide-react';

import { useThemeStore, LMS_THEMES, applyThemeCssVariables } from './store/themeStore';
import { API_BASE } from './utils/constants';
import {
  formatRelativeTime, formatBytes, getFileTypeBadge,
  extractVideoId, parseTimestampToSeconds, cleanSubmissionFallback
} from './utils/formatters';
import {
  parsePathRoute, getLectureIdFromPath, getCourseNameFromPath,
  normalizeCourseSlug
} from './utils/routing';

import Header from './components/layout/Header';
import HeroBanner from './components/home/HeroBanner';
import QuickAddBar from './components/home/QuickAddBar';
import CourseGrid from './components/course/CourseGrid';
import CourseMaterials from './components/course/CourseMaterials';
import CourseLectures from './components/course/CourseLectures';
import LecturePlayer from './components/lecture/LecturePlayer';
import TranscriptSearch from './components/lecture/TranscriptSearch';
import AITutor from './components/lecture/AITutor';
import DownloadModal from './components/modals/DownloadModal';
import UploadResourceModal from './components/modals/UploadResourceModal';

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

  // Client-side cache: In-memory & LocalStorage
  const [cachedVideos, setCachedVideos] = useState(() => {
    try {
      const stored = localStorage.getItem('lecturescribe_cached_videos');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Dedicated Course & Lecture Routing & History State
  const [currentPath, setCurrentPath] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
    } catch {
      return '/';
    }
  });

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
    if (selectedCourse) {
      navigateTo(`/course/${normalizeCourseSlug(selectedCourse)}`);
    } else {
      navigateTo('/');
    }
    setActiveData(null);
    setError(null);
    setCacheNotice(null);
  };

  const handleSelectCourse = (courseName) => {
    if (!courseName) return;
    setSelectedCourse(courseName);
    navigateTo(`/course/${normalizeCourseSlug(courseName)}`);
  };

  const handleClearCourse = () => {
    setSelectedCourse(null);
    setDirectCourseData(null);
    navigateTo('/');
  };

  // Cloud Export Modal State
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  // Google Drive Cloud State
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
  const [googleClientIdInput, setGoogleClientIdInput] = useState(() => {
    try {
      return localStorage.getItem('lecturescribe_google_client_id') || '';
    } catch {
      return '';
    }
  });
  const [gdriveError, setGdriveError] = useState(null);
  const pollIntervalRef = useRef(null);

  // LMS User Library & Course Grouping State
  const [userLibrary, setUserLibrary] = useState([]);
  const [userCourses, setUserCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(() => {
    try {
      const initial = typeof window !== 'undefined' ? window.location.pathname : '/';
      return getCourseNameFromPath(initial);
    } catch {
      return null;
    }
  });
  const [courseLoading, setCourseLoading] = useState(false);
  const [directCourseData, setDirectCourseData] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);

  // Resources State (Lecture & Course Materials via GCS)
  const [lectureResources, setLectureResources] = useState([]);
  const [lectureResourcesLoading, setLectureResourcesLoading] = useState(false);
  const [courseResources, setCourseResources] = useState([]);
  const [courseResourcesLoading, setCourseResourcesLoading] = useState(false);
  const [courseViewTab, setCourseViewTab] = useState('lectures'); // 'lectures' | 'resources'
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState({ courseName: 'General Lectures', videoId: null });
  const [uploadMode, setUploadMode] = useState('file'); // 'file' | 'link'
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadLinkUrl, setUploadLinkUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

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
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }
  }), [currentTheme]);

  // Fetch verified LMS library and course list
  const fetchUserLibrary = async (email) => {
    if (!email) return;
    setLibraryLoading(true);
    try {
      const [libRes, coursesRes] = await Promise.all([
        fetch(`${API_BASE}/api/user/library?email=${encodeURIComponent(email)}`),
        fetch(`${API_BASE}/api/user/courses?email=${encodeURIComponent(email)}`)
      ]);
      if (libRes.ok) {
        const data = await libRes.json();
        setUserLibrary(data.library || []);
      }
      if (coursesRes.ok) {
        const cData = await coursesRes.json();
        setUserCourses(cData.courses || []);
      }
    } catch (err) {
      console.warn("Failed to fetch user library/courses:", err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleDeleteFromLibrary = async (videoId) => {
    if (!videoId) return;
    try {
      const emailParam = googleUser?.email ? `?email=${encodeURIComponent(googleUser.email)}` : '';
      const res = await fetch(`${API_BASE}/api/user/library/${videoId}${emailParam}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setUserLibrary(prev => prev.filter(item => item.video_id !== videoId));
      }
    } catch (err) {
      console.warn("Failed to delete from user library:", err);
    }
  };

  useEffect(() => {
    if (googleUser?.email) {
      fetchUserLibrary(googleUser.email);
    } else {
      setUserLibrary([]);
    }
  }, [googleUser?.email]);

  // Fetch lecture-specific resources whenever activeData changes
  const fetchLectureResources = async (videoId) => {
    if (!videoId) {
      setLectureResources([]);
      return;
    }
    setLectureResourcesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/resources`);
      if (res.ok) {
        const data = await res.json();
        setLectureResources(data.resources || []);
      }
    } catch (err) {
      console.warn("Failed to load lecture resources:", err);
    } finally {
      setLectureResourcesLoading(false);
    }
  };

  useEffect(() => {
    if (activeData?.videoId) {
      fetchLectureResources(activeData.videoId);
    } else {
      setLectureResources([]);
    }
  }, [activeData?.videoId]);

  // Fetch course-wide resources whenever selectedCourse changes
  const fetchCourseResources = async (courseName) => {
    if (!courseName) {
      setCourseResources([]);
      return;
    }
    setCourseResourcesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/resources`);
      if (res.ok) {
        const data = await res.json();
        setCourseResources(data.resources || []);
      }
    } catch (err) {
      console.warn("Failed to load course resources:", err);
    } finally {
      setCourseResourcesLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCourse) {
      fetchCourseResources(selectedCourse);
    } else {
      setCourseResources([]);
    }
  }, [selectedCourse]);

  const openUploadModal = (target = { courseName: selectedCourse || 'General Lectures', videoId: activeData?.videoId || null }) => {
    setUploadTarget(target);
    setUploadFile(null);
    setUploadTitle('');
    setUploadLinkUrl('');
    setUploadError('');
    setUploadMode('file');
    setUploadModalOpen(true);
  };

  const handleUploadResource = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!googleUser?.email) {
      setUploadError("Please sign in with Google to upload resources.");
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      if (uploadMode === 'file') {
        if (!uploadFile) {
          throw new Error("Please select a file to upload.");
        }

        const presignRes = await fetch(`${API_BASE}/api/resources/presign-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse || 'General Lectures',
            video_id: uploadTarget.videoId || null,
            filename: uploadFile.name,
            content_type: uploadFile.type || 'application/octet-stream',
            user_email: googleUser.email
          })
        });

        if (!presignRes.ok) {
          const errData = await presignRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to get secure upload authorization.");
        }

        const presignData = await presignRes.json();

        const gcsRes = await fetch(presignData.signed_url, {
          method: 'PUT',
          headers: {
            'Content-Type': uploadFile.type || 'application/octet-stream'
          },
          body: uploadFile
        });

        if (!gcsRes.ok) {
          throw new Error(`Cloud storage upload failed (HTTP ${gcsRes.status}).`);
        }

        const confirmRes = await fetch(`${API_BASE}/api/resources/confirm-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse || 'General Lectures',
            video_id: uploadTarget.videoId || null,
            title: uploadTitle.trim() || uploadFile.name.replace(/\.[^/.]+$/, ''),
            filename: uploadFile.name,
            gcs_path: presignData.gcs_path,
            file_type: presignData.file_type,
            file_size_bytes: uploadFile.size,
            user_email: googleUser.email
          })
        });

        if (!confirmRes.ok) {
          const errData = await confirmRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to record uploaded resource.");
        }

        const confirmed = await confirmRes.json();
        if (uploadTarget.videoId) {
          setLectureResources(prev => [confirmed.resource, ...prev]);
        }
        setCourseResources(prev => [confirmed.resource, ...prev]);
        setUploadModalOpen(false);

      } else {
        if (!uploadLinkUrl.trim()) {
          throw new Error("Please enter a valid URL.");
        }

        const linkRes = await fetch(`${API_BASE}/api/resources/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse || 'General Lectures',
            video_id: uploadTarget.videoId || null,
            title: uploadTitle.trim() || uploadLinkUrl,
            link_url: uploadLinkUrl.trim(),
            user_email: googleUser.email
          })
        });

        if (!linkRes.ok) {
          const errData = await linkRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to save resource link.");
        }

        const linkData = await linkRes.json();
        if (uploadTarget.videoId) {
          setLectureResources(prev => [linkData.resource, ...prev]);
        }
        setCourseResources(prev => [linkData.resource, ...prev]);
        setUploadModalOpen(false);
      }
    } catch (err) {
      console.error("Resource upload error:", err);
      setUploadError(err.message || "Failed to upload resource.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteResource = async (resourceId, videoId, courseName) => {
    if (!googleUser?.email) return;
    if (!window.confirm("Are you sure you want to delete this resource?")) return;

    try {
      const res = await fetch(`${API_BASE}/api/resources/${resourceId}?user_email=${encodeURIComponent(googleUser.email)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setLectureResources(prev => prev.filter(r => r.id !== resourceId));
        setCourseResources(prev => prev.filter(r => r.id !== resourceId));
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.detail || "Failed to delete resource.");
      }
    } catch (err) {
      console.error("Error deleting resource:", err);
    }
  };

  // Chatbot & RAG State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [viewMode, setViewMode] = useState('learning'); // 'learning' or 'submission'
  const [submissionSummaries, setSubmissionSummaries] = useState({});
  const [copiedSubmissionId, setCopiedSubmissionId] = useState(null);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);

  // Fetch available AI models only when active lecture/tutor is loaded
  useEffect(() => {
    if (!activeData || availableModels.length > 0) return;

    fetch(`${API_BASE}/api/ai/models`)
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
  }, [activeData, availableModels.length]);

  const iframeRef = useRef(null);
  const playerRef = useRef(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Instant Search Handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, video_id: activeData?.videoId })
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
        }
      } catch (err) {
        console.error("Search API Error:", err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, activeData]);

  // Connect Vimeo Player SDK to track current playhead timestamp
  useEffect(() => {
    if (iframeRef.current && activeData) {
      try {
        const player = new Player(iframeRef.current);
        playerRef.current = player;

        const onTimeUpdate = (data) => {
          const currentSec = data.seconds;
          const cues = activeData.cues || [];
          for (let i = cues.length - 1; i >= 0; i--) {
            const cueSec = parseTimestampToSeconds(cues[i].time);
            if (currentSec >= cueSec) {
              setActiveCueIdx(i);
              break;
            }
          }
        };

        player.on('timeupdate', onTimeUpdate);
        return () => {
          player.off('timeupdate', onTimeUpdate);
        };
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

  const handleTranscribe = async (targetUrl = urlInput, pushRoute = true, targetCourse = null) => {
    const rawUrl = targetUrl || urlInput;
    if (!rawUrl.trim()) return;
    const vidId = extractVideoId(rawUrl);

    let effectiveCourse = targetCourse || activeCourseData?.course_name || selectedCourse || (userLibrary.find(l => l.video_id === vidId)?.course_name) || null;
    if (effectiveCourse) {
      const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(effectiveCourse));
      if (match) {
        effectiveCourse = match.course_name;
      } else if (effectiveCourse.includes('-') && effectiveCourse === effectiveCourse.toLowerCase()) {
        effectiveCourse = effectiveCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }

    if (pushRoute && vidId) {
      if (effectiveCourse) {
        setSelectedCourse(effectiveCourse);
        navigateTo(`/course/${normalizeCourseSlug(effectiveCourse)}/lecture/${vidId}`);
      } else {
        navigateTo(`/lecture/${vidId}`);
      }
    }

    // 1. If currently active video is already this video, do NOT re-generate
    if (activeData && (activeData.videoId === vidId || extractVideoId(activeData.sourceUrl) === vidId)) {
      setCacheNotice("⚡ Video is already active. Transcripts and summary were reused.");
      return;
    }

    // 2. If present in client cache, load immediately (0ms delay, no re-generation)
    if (cachedVideos[vidId]) {
      const cached = cachedVideos[vidId];
      let finalCourse = cached.course_name || effectiveCourse;
      if (finalCourse) {
        const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(finalCourse));
        if (match) finalCourse = match.course_name;
        setSelectedCourse(finalCourse);
        if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/lecture/') || window.location.pathname.includes('%20') || window.location.pathname.includes(' '))) {
          navigateTo(`/course/${normalizeCourseSlug(finalCourse)}/lecture/${vidId}`, true);
        }
      }
      setActiveData({ ...cached, cached: true });
      setUrlInput(cached.sourceUrl || `https://vimeo.com/${vidId}`);
      initChatMessages(cached.title, vidId);
      if (googleUser?.email) {
        fetch(`${API_BASE}/api/user/library/record`, {
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
            duration_seconds: cached.duration || null,
            course_name: finalCourse
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
      const courseParam = effectiveCourse ? `&course_name=${encodeURIComponent(effectiveCourse)}` : '';
      const res = await fetch(`${API_BASE}/api/transcript?url=${encodeURIComponent(rawUrl)}${userParam}${courseParam}`);
      if (res.ok) {
        const data = await res.json();
        let finalCourse = data.course_name || effectiveCourse;
        if (finalCourse) {
          const match = effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === normalizeCourseSlug(finalCourse));
          if (match) finalCourse = match.course_name;
          setSelectedCourse(finalCourse);
          if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/lecture/') || window.location.pathname.includes('%20') || window.location.pathname.includes(' '))) {
            navigateTo(`/course/${normalizeCourseSlug(finalCourse)}/lecture/${data.videoId}`, true);
          }
        }
        setActiveData(data);
        setUrlInput(data.sourceUrl || `https://vimeo.com/${data.videoId}`);
        initChatMessages(data.title, data.videoId);

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

  const activeDataRef = useRef(activeData);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  // Dedicated Route & History Handler (Mount URL load & Browser Back/Forward)
  useEffect(() => {
    const initialPath = window.location.pathname || '/';
    const { courseName: initialCourse, videoId: initialVidId } = parsePathRoute(initialPath);
    if (initialCourse) {
      setSelectedCourse(initialCourse);
    }
    if (initialVidId) {
      handleTranscribe(`https://vimeo.com/${initialVidId}`, false, initialCourse);
    }

    const onPopState = () => {
      const current = window.location.pathname || '/';
      setCurrentPath(current);
      const { courseName, videoId } = parsePathRoute(current);

      setSelectedCourse(courseName);

      if (videoId) {
        const currentActiveVid = activeDataRef.current?.videoId;
        if (currentActiveVid !== videoId) {
          handleTranscribe(`https://vimeo.com/${videoId}`, false, courseName);
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

  useEffect(() => {
    if (error || cacheNotice) {
      const timer = setTimeout(() => {
        setError(null);
        setCacheNotice(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [error, cacheNotice]);

  const handlePasteUrl = (e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted.trim()) {
      const vidId = extractVideoId(pasted);
      if (activeData && activeData.videoId === vidId) {
        setCacheNotice("⚡ Video is already active. Transcripts and summary will be reused.");
      } else if (cachedVideos[vidId]) {
        setCacheNotice("⚡ Pasted video is already cached! Transcripts and summary will load instantly.");
      }
    }
  };

  const fetchChatHistory = async (videoId, userEmail = null) => {
    if (!videoId) return;
    try {
      const emailParam = userEmail ? `&email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/chat/history?video_id=${encodeURIComponent(videoId)}${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          setChatMessages(data.messages);
          const summaries = {};
          data.messages.forEach(m => {
            if (m.sender === 'bot' && m.submission_text) {
              summaries[m.id] = m.submission_text;
            }
          });
          setSubmissionSummaries(prev => ({ ...prev, ...summaries }));
          return;
        }
      }
    } catch (e) {
      console.warn("Could not fetch chat history:", e);
    }
  };

  const clearChatHistory = async () => {
    if (!activeData?.videoId) return;
    try {
      const emailParam = googleUser?.email ? `&email=${encodeURIComponent(googleUser.email)}` : '';
      await fetch(`${API_BASE}/api/chat/history?video_id=${encodeURIComponent(activeData.videoId)}${emailParam}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn("Could not clear chat history on server:", e);
    }
    setChatMessages([]);
    setSubmissionSummaries({});
  };

  const initChatMessages = (title, videoId = null) => {
    const targetVid = videoId || activeData?.videoId;
    if (targetVid) {
      fetchChatHistory(targetVid, googleUser?.email);
    } else {
      setChatMessages([]);
    }
  };

  const handleSendMessage = async (customPrompt = null) => {
    const textToSend = customPrompt || chatInput;
    if (!textToSend.trim() || !activeData) return;

    const newMessages = [...chatMessages, { sender: 'user', text: textToSend }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: textToSend,
          video_id: activeData.videoId,
          model: selectedModel,
          enable_web_search: webSearchEnabled,
          user_email: googleUser?.email || null
        })
      });

      if (res.ok) {
        const data = await res.json();
        const botMsg = {
          id: data.message_id || Date.now().toString(),
          sender: 'bot',
          text: data.answer,
          citations: data.citations || [],
          model: data.model_used || selectedModel,
          web_sources: data.web_sources || [],
          submission_text: data.submission_text || null
        };
        setChatMessages([...newMessages, botMsg]);

        if (data.submission_text) {
          setSubmissionSummaries(prev => ({ ...prev, [botMsg.id]: data.submission_text }));
        } else {
          generateSubmissionVersion(data.answer, activeData.videoId, botMsg.id);
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        setChatMessages([...newMessages, {
          sender: 'bot',
          text: `⚠️ **AI Tutor Error:** ${errJson.detail || 'Failed to generate response. Please verify the AI engine is configured.'}`
        }]);
      }
    } catch (err) {
      console.error("Chat RAG query error:", err);
      setChatMessages([...newMessages, {
        sender: 'bot',
        text: `⚠️ **Connection Error:** Could not reach the AI Tutor backend. Please make sure the service is running.`
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const generateSubmissionVersion = async (originalText, videoId, messageId) => {
    try {
      const res = await fetch(`${API_BASE}/api/rag/query/submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_answer: originalText,
          video_id: videoId,
          target_word_count: 120,
          model: selectedModel
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.submission_text) {
          setSubmissionSummaries(prev => ({ ...prev, [messageId]: data.submission_text }));
          return;
        }
      }
    } catch (e) {
      console.warn("Could not generate condensed submission with LLM, falling back to local extractor:", e);
    }

    const fallback = cleanSubmissionFallback(originalText, 120);
    setSubmissionSummaries(prev => ({ ...prev, [messageId]: fallback }));
  };

  const copySubmissionText = (text, messageId) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSubmissionId(messageId);
    setTimeout(() => setCopiedSubmissionId(null), 2000);
  };

  const copyUserPrompt = (text, messageId) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedPromptId(messageId);
    setTimeout(() => setCopiedPromptId(null), 2000);
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

  const openDownloadModal = async () => {
    if (!activeData) return;
    setIsDownloadModalOpen(true);
    setGdriveError(null);

    try {
      const gdriveRes = await fetch(`${API_BASE}/api/cloud/gdrive/status`);
      if (gdriveRes.ok) {
        const gData = await gdriveRes.json();
        setGdriveStatus(gData);
      }
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

  const handleGoogleSignIn = async (autoStartUpload = false) => {
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
      localStorage.removeItem('lecturescribe_gdrive_token');
      localStorage.removeItem('lecturescribe_gdrive_token_expires');
      localStorage.removeItem('lecturescribe_google_user');
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
      const res = await fetch(`${API_BASE}/api/cloud/gdrive/upload-bundle`, {
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
          const pollRes = await fetch(`${API_BASE}/api/cloud/jobs/${jobId}`);
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
    const tokenExpiresAt = Number(localStorage.getItem('lecturescribe_gdrive_token_expires') || '0');
    const isTokenExpired = tokenExpiresAt > 0 && Date.now() > (tokenExpiresAt - 120000);

    if (gdriveAccessToken && isTokenExpired) {
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

  const effectiveCourses = useMemo(() => {
    if (userCourses && userCourses.length > 0) {
      return userCourses;
    }
    const map = {};
    (userLibrary || []).forEach(item => {
      let cName = item.course_name;
      if (!cName) {
        const raw = (item.title || item.video_title || "General Lectures").trim();
        const withoutDate = raw.replace(/[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
        cName = withoutDate.replace(/\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$/i, '').trim();
        cName = cName.replace(/[\s\-_:\|\/]+$/, '').trim();
        if (!cName || cName.length < 3) cName = raw;
      }

      const slug = normalizeCourseSlug(cName) || 'general';
      const isSlugFormat = cName === slug || (cName.includes('-') && cName === cName.toLowerCase());

      if (!map[slug]) {
        let displayTitle = cName;
        if (isSlugFormat) {
          const raw = (item.title || item.video_title || '').trim();
          const withoutDate = raw.replace(/[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
          const extracted = withoutDate.replace(/\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$/i, '').trim().replace(/[\s\-_:\|\/]+$/, '');
          displayTitle = (extracted && extracted.length >= 3 && !extracted.includes('-')) 
            ? extracted 
            : cName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        map[slug] = {
          course_name: displayTitle,
          course_slug: slug,
          lecture_count: 0,
          latest_viewed_at: item.last_viewed_at || item.created_at,
          thumbnail_video_id: item.video_id,
          lectures: []
        };
      } else {
        if (map[slug].course_name.includes('-') && map[slug].course_name === map[slug].course_name.toLowerCase() && !isSlugFormat) {
          map[slug].course_name = cName;
        }
      }

      map[slug].lecture_count += 1;
      map[slug].lectures.push({
        ...item,
        course_name: map[slug].course_name
      });
    });
    return Object.values(map);
  }, [userCourses, userLibrary]);

  const filteredCourses = useMemo(() => {
    if (!librarySearch.trim()) return effectiveCourses;
    const q = librarySearch.toLowerCase();
    return effectiveCourses.filter(c => 
      c.course_name.toLowerCase().includes(q) ||
      (c.lectures && c.lectures.some(l => 
        (l.video_title && l.video_title.toLowerCase().includes(q)) ||
        (l.title && l.title.toLowerCase().includes(q)) ||
        (l.video_id && String(l.video_id).toLowerCase().includes(q))
      ))
    );
  }, [effectiveCourses, librarySearch]);

  // Direct course fetching when navigated to /course/:courseName directly
  useEffect(() => {
    if (!selectedCourse) {
      setDirectCourseData(null);
      return;
    }
    const clean = selectedCourse.trim().toLowerCase();
    const slug = normalizeCourseSlug(selectedCourse);
    const alreadyFound = effectiveCourses.some(c => 
      c.course_name === selectedCourse || 
      c.course_name.toLowerCase() === clean ||
      normalizeCourseSlug(c.course_name) === slug
    );
    if (alreadyFound) return;

    let isMounted = true;
    const fetchDirectCourse = async () => {
      setCourseLoading(true);
      try {
        const emailParam = googleUser?.email ? `?email=${encodeURIComponent(googleUser.email)}` : '';
        const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(selectedCourse)}${emailParam}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.course) {
            setDirectCourseData(data.course);
          }
        }
      } catch (e) {
        console.warn("Direct course lookup error:", e);
      } finally {
        if (isMounted) setCourseLoading(false);
      }
    };
    fetchDirectCourse();
    return () => { isMounted = false; };
  }, [selectedCourse, effectiveCourses, googleUser]);

  const activeCourseData = useMemo(() => {
    if (!selectedCourse) return null;
    const clean = selectedCourse.trim().toLowerCase();
    const slug = normalizeCourseSlug(selectedCourse);
    const found = (
      effectiveCourses.find(c => c.course_name === selectedCourse) ||
      effectiveCourses.find(c => c.course_name.toLowerCase() === clean) ||
      effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === slug)
    );
    if (found) return found;
    if (directCourseData && (
      directCourseData.course_name === selectedCourse ||
      directCourseData.course_name.toLowerCase() === clean ||
      normalizeCourseSlug(directCourseData.course_name) === slug
    )) {
      return directCourseData;
    }
    return null;
  }, [effectiveCourses, selectedCourse, directCourseData]);

  // Automatically upgrade selectedCourse from a URL slug to its human-readable title
  useEffect(() => {
    if (activeCourseData?.course_name && selectedCourse) {
      if (selectedCourse !== activeCourseData.course_name && normalizeCourseSlug(selectedCourse) === normalizeCourseSlug(activeCourseData.course_name)) {
        setSelectedCourse(activeCourseData.course_name);
      }
    }
  }, [activeCourseData, selectedCourse]);

  const filteredCourseLectures = useMemo(() => {
    if (!activeCourseData) return [];
    if (!librarySearch.trim()) return activeCourseData.lectures;
    const q = librarySearch.toLowerCase();
    return activeCourseData.lectures.filter(item => 
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q))
    );
  }, [activeCourseData, librarySearch]);

  // Synchronize document title with currently active lecture or course route
  useEffect(() => {
    const courseTitle = activeCourseData?.course_name || selectedCourse;
    if (activeData?.title) {
      document.title = `${activeData.title} | LectureScribe`;
    } else if (courseTitle) {
      document.title = `${courseTitle} | Course | LectureScribe`;
    } else {
      document.title = 'LectureScribe - LMS & Lecture AI Workspace';
    }
  }, [activeData, selectedCourse, activeCourseData]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
        {/* Header */}
        <Header
          activeData={activeData}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          openDownloadModal={openDownloadModal}
          googleUser={googleUser}
          handleGoogleSignIn={handleGoogleSignIn}
          handleGoogleSignOut={handleGoogleSignOut}
          handleBackToHub={handleBackToHub}
          userLibrary={userLibrary}
          userMenuAnchor={userMenuAnchor}
          setUserMenuAnchor={setUserMenuAnchor}
          currentThemeId={currentThemeId}
          setTheme={setTheme}
          currentTheme={currentTheme}
        />

        {/* Main Content Area */}
        {loading && !activeData ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', p: 3 }}>
            <Paper
              elevation={0}
              sx={{
                p: 5,
                borderRadius: 4,
                bgcolor: currentTheme.palette.cardBg,
                border: `1px solid ${currentTheme.palette.cardBorder}`,
                textAlign: 'center',
                maxWidth: 420,
                boxShadow: currentTheme.palette.cardShadow
              }}
            >
              <CircularProgress size={48} sx={{ color: currentTheme.palette.primary, mb: 3 }} />
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, mb: 1 }}>
                Ingesting Lecture...
              </Typography>
              <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
                Downloading audio, extracting verbatim captions with timestamps, and training AI Tutor.
              </Typography>
            </Paper>
          </Box>
        ) : !activeData ? (
          /* Unified LMS Dashboard & Course Route */
          <Box sx={{ maxWidth: '1200px', mx: 'auto', p: { xs: 2.5, md: 4 } }}>
            {!selectedCourse && (
              <HeroBanner
                googleUser={googleUser}
                userLibrary={userLibrary}
                handleGoogleSignIn={handleGoogleSignIn}
                currentTheme={currentTheme}
              />
            )}

            {!selectedCourse && (
              <QuickAddBar
                urlInput={urlInput}
                setUrlInput={setUrlInput}
                setCacheNotice={setCacheNotice}
                handlePasteUrl={handlePasteUrl}
                handleTranscribe={handleTranscribe}
                loading={loading}
                currentTheme={currentTheme}
              />
            )}

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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                {selectedCourse ? (
                  <>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<ArrowLeft size={16} />}
                      onClick={handleClearCourse}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        borderRadius: 2,
                        color: currentTheme.palette.primary,
                        borderColor: currentTheme.palette.cardBorder,
                        bgcolor: currentTheme.palette.cardBg,
                        '&:hover': { bgcolor: 'var(--highlight-bg)', borderColor: currentTheme.palette.primary }
                      }}
                    >
                      All Courses
                    </Button>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                      {activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
                    </Typography>
                    <Chip
                      label={`${filteredCourseLectures.length} ${filteredCourseLectures.length === 1 ? 'lecture' : 'lectures'}`}
                      size="small"
                      sx={{ bgcolor: currentTheme.palette.badgeBg, color: currentTheme.palette.badgeColor, fontWeight: 700, border: `1px solid ${currentTheme.palette.badgeBorder}` }}
                    />
                  </>
                ) : (
                  <>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                      My Courses
                    </Typography>
                    <Chip
                      label={`${filteredCourses.length} ${filteredCourses.length === 1 ? 'course' : 'courses'}`}
                      size="small"
                      sx={{ bgcolor: currentTheme.palette.badgeBg, color: currentTheme.palette.badgeColor, fontWeight: 700, border: `1px solid ${currentTheme.palette.badgeBorder}` }}
                    />
                  </>
                )}
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
                placeholder={selectedCourse ? "Search lectures in this course..." : "Search courses or lectures..."}
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

            {/* Course View Tabs (Lectures vs Course Materials) */}
            {selectedCourse && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1.5 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant={courseViewTab === 'lectures' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={<Video size={15} />}
                    onClick={() => setCourseViewTab('lectures')}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      borderRadius: 2,
                      ...(courseViewTab === 'lectures'
                        ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                        : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
                    }}
                  >
                    Lectures ({filteredCourseLectures.length})
                  </Button>
                  <Button
                    variant={courseViewTab === 'resources' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={<Paperclip size={15} />}
                    onClick={() => setCourseViewTab('resources')}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      borderRadius: 2,
                      ...(courseViewTab === 'resources'
                        ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                        : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
                    }}
                  >
                    Course Materials ({courseResources.length})
                  </Button>
                </Box>

                <Tooltip title={!googleUser ? "Sign in with Google to upload course resources" : "Upload course-wide slides, syllabus, or notes"}>
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!googleUser}
                      startIcon={<Upload size={14} />}
                      onClick={() => openUploadModal({
                        courseName: activeCourseData?.course_name || selectedCourse,
                        videoId: null
                      })}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        borderRadius: 2,
                        color: currentTheme.palette.primary,
                        borderColor: currentTheme.palette.cardBorder,
                        bgcolor: currentTheme.palette.cardBg,
                        '&:hover': { bgcolor: 'var(--highlight-bg)', borderColor: currentTheme.palette.primary }
                      }}
                    >
                      Add Course Material
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            )}

            {/* LEVEL 1: COURSE CARDS VIEW */}
            {!selectedCourse ? (
              <CourseGrid
                filteredCourses={filteredCourses}
                handleSelectCourse={handleSelectCourse}
                librarySearch={librarySearch}
                currentTheme={currentTheme}
              />
            ) : courseViewTab === 'resources' ? (
              /* LEVEL 2B: COURSE MATERIALS & RESOURCES VIEW */
              <CourseMaterials
                courseResourcesLoading={courseResourcesLoading}
                courseResources={courseResources}
                googleUser={googleUser}
                userLibrary={userLibrary}
                selectedCourse={selectedCourse}
                activeCourseData={activeCourseData}
                openUploadModal={openUploadModal}
                handleDeleteResource={handleDeleteResource}
                currentTheme={currentTheme}
              />
            ) : (
              /* LEVEL 2A: INDIVIDUAL LECTURES IN SELECTED COURSE */
              <CourseLectures
                courseLoading={courseLoading}
                filteredCourseLectures={filteredCourseLectures}
                handleTranscribe={handleTranscribe}
                handleDeleteFromLibrary={handleDeleteFromLibrary}
                handleClearCourse={handleClearCourse}
                selectedCourse={selectedCourse}
                librarySearch={librarySearch}
                currentTheme={currentTheme}
              />
            )}
          </Box>
        ) : (
          /* TRANSCRIPT & TRIAD WORKSPACE */
          <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
            {/* Left Panel: Real Embedded Vimeo Player */}
            <LecturePlayer
              activeData={activeData}
              activeCourseData={activeCourseData}
              selectedCourse={selectedCourse}
              setSelectedCourse={setSelectedCourse}
              userLibrary={userLibrary}
              effectiveCourses={effectiveCourses}
              setActiveData={setActiveData}
              navigateTo={navigateTo}
              iframeRef={iframeRef}
              copied={copied}
              handleCopyTranscript={handleCopyTranscript}
              googleUser={googleUser}
              openUploadModal={openUploadModal}
              lectureResources={lectureResources}
              lectureResourcesLoading={lectureResourcesLoading}
              handleDeleteResource={handleDeleteResource}
              currentTheme={currentTheme}
            />

            {/* Right Panel: Instant Search Drawer or AI Tutor */}
            {activeTab === 'transcript' ? (
              <TranscriptSearch
                displayCues={displayCues}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                handleCueClick={handleCueClick}
                activeCueIdx={activeCueIdx}
              />
            ) : (
              <AITutor
                webSearchEnabled={webSearchEnabled}
                setWebSearchEnabled={setWebSearchEnabled}
                clearChatHistory={clearChatHistory}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                availableModels={availableModels}
                chatMessages={chatMessages}
                setChatMessages={setChatMessages}
                viewMode={viewMode}
                submissionSummaries={submissionSummaries}
                cleanSubmissionFallback={cleanSubmissionFallback}
                handleCueClick={handleCueClick}
                copiedPromptId={copiedPromptId}
                copyUserPrompt={copyUserPrompt}
                copiedSubmissionId={copiedSubmissionId}
                copySubmissionText={copySubmissionText}
                chatLoading={chatLoading}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatInputRef={chatInputRef}
                chatEndRef={chatEndRef}
                handleSendMessage={handleSendMessage}
              />
            )}
          </div>
        )}

        {/* Cloud Export Modal */}
        <DownloadModal
          open={isDownloadModalOpen}
          onClose={closeDownloadModal}
          activeData={activeData}
          gdriveStatus={gdriveStatus}
          gdriveError={gdriveError}
          setGdriveError={setGdriveError}
          gdriveAccessToken={gdriveAccessToken}
          googleUser={googleUser}
          googleClientIdInput={googleClientIdInput}
          setGoogleClientIdInput={setGoogleClientIdInput}
          gdriveJob={gdriveJob}
          gdriveUploading={gdriveUploading}
          handleGoogleSignIn={handleGoogleSignIn}
          handleGoogleSignOut={handleGoogleSignOut}
          handleStartGdriveUpload={handleStartGdriveUpload}
        />

        {/* Upload Resource Modal */}
        <UploadResourceModal
          open={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          uploadTarget={uploadTarget}
          uploadMode={uploadMode}
          setUploadMode={setUploadMode}
          uploadFile={uploadFile}
          setUploadFile={setUploadFile}
          uploadTitle={uploadTitle}
          setUploadTitle={setUploadTitle}
          uploadLinkUrl={uploadLinkUrl}
          setUploadLinkUrl={setUploadLinkUrl}
          isUploading={isUploading}
          uploadError={uploadError}
          setUploadError={setUploadError}
          handleUploadResource={handleUploadResource}
        />
      </div>
    </ThemeProvider>
  );
}
