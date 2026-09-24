import React, { useState, useEffect, useRef } from 'react';
import Player from '@vimeo/player';
import { Play, Search, Video, Sparkles, FileText, ArrowLeft, Download, Check, Copy, AlertCircle, RefreshCw, Send, Bot, User, Bookmark, ExternalLink, Database, Zap } from 'lucide-react';

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
        text: `🔍 **Pinecone Vector RAG Ready** for *${title}*!\n\nAsk any question to retrieve grounded answers with exact video timestamp citations:\n- *"What is the COVID-19 case study axiom?"*\n- *"Explain Sovereign Technology and semiconductor Fabs"*\n- *"Summarize this lecture in 100 lines"*`,
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
                    <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(sec.points || []).map((pt, pIdx) => (
                        <li key={pIdx} style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                          {pt}
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
                  onClick={() => handleSendMessage("What is the COVID 19 case study axiom?")}
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
                  🛡️ COVID-19 Axiom
                </button>
                <button
                  onClick={() => handleSendMessage("Explain Sovereign Technology and semiconductor Fabs")}
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
                  ⚡ Sovereign Tech & Fabs
                </button>
                <button
                  onClick={() => handleSendMessage("Summarize this lecture in 100 lines")}
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
                  📜 100-Line Summary
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
                    placeholder="Ask RAG tutor (e.g. 'What are the 34 credits assigned for?')..."
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

    </div>
  );
}
