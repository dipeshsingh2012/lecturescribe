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
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const clearedInSessionRef = useRef(false);
  const currentVideoIdRef = useRef(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const autopopulateChat = async (videoId, userEmail = null) => {
    if (!videoId) return;
    setChatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat/autopopulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          video_title: activeData?.title || '',
          cues: activeData?.cues || [],
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
      setChatLoading(false);
    }
  };

  const fetchChatHistory = async (videoId, userEmail = null, allowAutopopulate = true) => {
    if (!videoId) {
      setChatMessages([]);
      setSubmissionSummaries({});
      return;
    }
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
      if (allowAutopopulate && !clearedInSessionRef.current) {
        await autopopulateChat(videoId, userEmail);
        return;
      }
    } catch (e) {
      console.warn("Could not fetch chat history:", e);
    }
    setChatMessages([]);
    setSubmissionSummaries({});
  };

  // Sync chat messages and submission summaries whenever the active video changes
  useEffect(() => {
    if (activeData?.videoId) {
      if (currentVideoIdRef.current !== activeData.videoId) {
        currentVideoIdRef.current = activeData.videoId;
        clearedInSessionRef.current = false;
      }
      fetchChatHistory(activeData.videoId, googleUser?.email);
    } else {
      setChatMessages([]);
      setSubmissionSummaries({});
    }
  }, [activeData?.videoId, googleUser?.email]);

  const clearChatHistory = async () => {
    if (!activeData?.videoId) return;
    clearedInSessionRef.current = true;
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
      clearedInSessionRef.current = false;
      fetchChatHistory(targetVid, googleUser?.email);
    } else {
      setChatMessages([]);
      setSubmissionSummaries({});
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
          id: data.message_id || Date.now().toString(),
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
    chatEndRef,
    chatInputRef,
    fetchChatHistory,
    autopopulateChat,
    clearChatHistory,
    initChatMessages,
    handleSendMessage,
    generateSubmissionVersion,
    copySubmissionText,
    copyUserPrompt,
    copyBotResponse
  };
}