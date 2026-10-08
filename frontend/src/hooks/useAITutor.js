import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/constants';
import { cleanSubmissionFallback } from '../utils/formatters';

export function useAITutor(activeData, googleUser) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [viewMode, setViewMode] = useState('learning'); // 'learning' or 'submission'
  const [submissionSummaries, setSubmissionSummaries] = useState({});
  const [copiedSubmissionId, setCopiedSubmissionId] = useState(null);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [copiedResponseId, setCopiedResponseId] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const clearedInSessionRef = useRef(false);
  const currentVideoIdRef = useRef(null);
  const inFlightFetchRef = useRef(null);
  const isAutopopulatingRef = useRef(false);

  const activeDataRef = useRef(activeData);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  // Auto scroll chat to bottom only when new messages are appended, without hijacking manual user scroll
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (chatMessages.length > prevMessageCountRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    prevMessageCountRef.current = chatMessages.length;
  }, [chatMessages.length]);

  const autopopulateChat = async (videoId, userEmail = null) => {
    if (!videoId || isAutopopulatingRef.current) return;
    isAutopopulatingRef.current = true;
    setChatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat/autopopulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          video_title: activeDataRef.current?.title || activeData?.title || '',
          cues: activeDataRef.current?.cues || activeData?.cues || [],
          user_email: userEmail
        })
      });
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
          setSubmissionSummaries(summaries);
          return;
        }
      }
    } catch (err) {
      console.warn("Auto-population error:", err);
    } finally {
      isAutopopulatingRef.current = false;
      setChatLoading(false);
    }
  };

  const fetchChatHistory = async (videoId, userEmail = null, allowAutopopulate = true) => {
    if (!videoId) {
      setChatMessages([]);
      setSubmissionSummaries({});
      return;
    }
    // Prevent duplicate in-flight fetch/autopopulate for the same video
    if (inFlightFetchRef.current === videoId) {
      return;
    }
    inFlightFetchRef.current = videoId;
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
          setSubmissionSummaries(summaries);
          return;
        }
      }

      // If history is empty and not explicitly cleared in this session, auto-populate the 4 standard prompts
      const availableCues = activeDataRef.current?.cues || activeData?.cues || [];
      const hasTranscript = Array.isArray(availableCues) &&
        availableCues.some((cue) => String(cue?.text || '').trim().length > 0);
      if (allowAutopopulate && hasTranscript && !clearedInSessionRef.current) {
        await autopopulateChat(videoId, userEmail);
        return;
      }
    } catch (e) {
      console.warn("Could not fetch chat history:", e);
    } finally {
      if (inFlightFetchRef.current === videoId) {
        inFlightFetchRef.current = null;
      }
    }
    setChatMessages([]);
    setSubmissionSummaries({});
  };

  // Sync chat messages and submission summaries whenever the active video changes or cues load
  useEffect(() => {
    if (activeData?.videoId) {
      if (currentVideoIdRef.current !== activeData.videoId) {
        currentVideoIdRef.current = activeData.videoId;
        clearedInSessionRef.current = false;
        fetchChatHistory(activeData.videoId, googleUser?.email);
      } else if (chatMessages.length === 0 && !chatLoading && !clearedInSessionRef.current && inFlightFetchRef.current !== activeData.videoId) {
        fetchChatHistory(activeData.videoId, googleUser?.email);
      }
    } else {
      setChatMessages([]);
      setSubmissionSummaries({});
    }
  }, [activeData?.videoId, activeData?.cues?.length, googleUser?.email]);

  const clearChatHistory = async () => {
    if (!activeData?.videoId) return;
    clearedInSessionRef.current = true;
    inFlightFetchRef.current = null;
    isAutopopulatingRef.current = false;
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

  const deleteChatMessage = async (messageId) => {
    if (messageId === undefined || messageId === null || messageId === '') return;

    // Check if it's a paired turn (msg_user_X <-> msg_bot_X)
    let pairedPrefix = null;
    let baseId = null;
    if (typeof messageId === 'string') {
      if (messageId.startsWith('msg_user_')) {
        baseId = messageId.replace('msg_user_', '');
        pairedPrefix = 'msg_bot_';
      } else if (messageId.startsWith('msg_bot_')) {
        baseId = messageId.replace('msg_bot_', '');
        pairedPrefix = 'msg_user_';
      }
    }

    setChatMessages(prev => prev.filter((m, i) => {
      if (m.id === messageId || i === messageId) return false;
      if (baseId && m.id === `${pairedPrefix}${baseId}`) return false;
      return true;
    }));

    setSubmissionSummaries(prev => {
      const copy = { ...prev };
      delete copy[messageId];
      if (baseId) delete copy[`msg_bot_${baseId}`];
      return copy;
    });

    try {
      const emailParam = googleUser?.email ? `&email=${encodeURIComponent(googleUser.email)}` : '';
      const vid = activeDataRef.current?.videoId || activeData?.videoId;
      const vidParam = vid ? `&video_id=${encodeURIComponent(vid)}` : '';
      await fetch(`${API_BASE}/api/chat/message?message_id=${encodeURIComponent(messageId)}${vidParam}${emailParam}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn("Could not delete chat message on server:", e);
    }
  };

  const initChatMessages = (title, videoId = null, cues = undefined, options = {}) => {
    const targetVid = videoId || activeData?.videoId;
    if (targetVid) {
      if (!options.preserveCleared || targetVid !== currentVideoIdRef.current) {
        clearedInSessionRef.current = false;
      }
      currentVideoIdRef.current = targetVid;
      const targetCues = cues ?? (
        targetVid === activeDataRef.current?.videoId
          ? activeDataRef.current?.cues
          : undefined
      );
      const hasTranscript = Array.isArray(targetCues) &&
        targetCues.some((cue) => String(cue?.text || '').trim().length > 0);
      fetchChatHistory(targetVid, googleUser?.email, hasTranscript);
    } else {
      setChatMessages([]);
      setSubmissionSummaries({});
    }
  };

  const handleSendMessage = async (customPrompt = null) => {
    const textToSend = customPrompt || chatInput;
    if (!textToSend.trim() || !activeData) return;

    const userMsgId = `msg_user_${Date.now()}`;
    const newMessages = [...chatMessages, { id: userMsgId, sender: 'user', text: textToSend }];
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
          video_title: activeData.title,
          cues: activeData.cues || [],
          enable_web_search: webSearchEnabled,
          user_email: googleUser?.email || null,
          chat_history: newMessages.slice(-6)
        })
      });

      if (res.ok) {
        const data = await res.json();
        const botMsg = {
          id: data.message_id || `msg_bot_${Date.now()}`,
          sender: 'bot',
          text: data.answer,
          citations: data.citations || [],
          model: data.model || 'Groq GPT-OSS 120B',
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
          original_text: originalText,
          video_id: videoId,
          word_count: 120
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

  const copyBotResponse = (text, messageId) => {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) {
      console.warn("Clipboard write error:", e);
    }
    setCopiedResponseId(messageId);
    setTimeout(() => setCopiedResponseId(null), 2000);
  };

  const regenerateResponse = async (messageId) => {
    if (!activeData?.videoId || chatLoading || regeneratingId) return;

    // Find the target bot message
    const botMsgIdx = chatMessages.findIndex((m, idx) => (m.id || idx) === messageId || m.id === messageId);
    if (botMsgIdx === -1) return;

    // Look backward for the user prompt that generated this answer
    let promptText = '';
    for (let i = botMsgIdx - 1; i >= 0; i--) {
      if (chatMessages[i].sender === 'user' && chatMessages[i].text) {
        promptText = chatMessages[i].text;
        break;
      }
    }
    if (!promptText.trim()) return;

    setRegeneratingId(messageId);
    try {
      const res = await fetch(`${API_BASE}/api/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: promptText,
          video_id: activeData.videoId,
          video_title: activeData.title,
          cues: activeData.cues || [],
          enable_web_search: webSearchEnabled,
          bypass_cache: true,
          enforce_regenerate: true,
          user_email: googleUser?.email || null,
          chat_history: chatMessages.slice(0, botMsgIdx).slice(-6)
        })
      });

      if (res.ok) {
        const data = await res.json();
        const updatedMsg = {
          id: data.message_id || messageId || Date.now().toString(),
          sender: 'bot',
          text: data.answer,
          citations: data.citations || [],
          model: data.model || 'Groq GPT-OSS 120B',
          web_sources: data.web_sources || [],
          submission_text: data.submission_text || null
        };

        setChatMessages(prev => prev.map((m, i) => (i === botMsgIdx ? updatedMsg : m)));

        if (data.submission_text) {
          setSubmissionSummaries(prev => ({ ...prev, [updatedMsg.id]: data.submission_text }));
        } else {
          generateSubmissionVersion(data.answer, activeData.videoId, updatedMsg.id);
        }
      }
    } catch (err) {
      console.error("Regenerate response error:", err);
    } finally {
      setRegeneratingId(null);
    }
  };

  return {
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    chatLoading,
    webSearchEnabled,
    setWebSearchEnabled,
    viewMode,
    setViewMode,
    submissionSummaries,
    copiedSubmissionId,
    copiedPromptId,
    copiedResponseId,
    regeneratingId,
    chatEndRef,
    chatInputRef,
    fetchChatHistory,
    autopopulateChat,
    clearChatHistory,
    deleteChatMessage,
    initChatMessages,
    handleSendMessage,
    generateSubmissionVersion,
    copySubmissionText,
    copyUserPrompt,
    copyBotResponse,
    regenerateResponse
  };
}

export default useAITutor;
