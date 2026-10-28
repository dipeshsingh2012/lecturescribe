import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/constants';

export function useAITutor(activeData, googleUser) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [copiedResponseId, setCopiedResponseId] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState(null);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const clearedInSessionRef = useRef(false);
  const currentVideoIdRef = useRef(null);
  const inFlightFetchRef = useRef(null);

  const activeDataRef = useRef(activeData);
  useEffect(() => {
    activeDataRef.current = activeData;
  }, [activeData]);

  const fetchChatHistory = async (videoId, userEmail = null) => {
    if (!videoId) {
      setChatMessages([]);
      return;
    }
    // Prevent duplicate in-flight fetch for the same video
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
          return;
        }
      }
    } catch (e) {
      console.warn("Could not fetch chat history:", e);
    } finally {
      if (inFlightFetchRef.current === videoId) {
        inFlightFetchRef.current = null;
      }
    }
  };

  // Sync chat messages whenever the active video changes
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
    }
  }, [activeData?.videoId, activeData?.cues?.length, googleUser?.email]);

  const clearChatHistory = async () => {
    if (!activeData?.videoId) return;
    clearedInSessionRef.current = true;
    inFlightFetchRef.current = null;
    try {
      const emailParam = googleUser?.email ? `&email=${encodeURIComponent(googleUser.email)}` : '';
      await fetch(`${API_BASE}/api/chat/history?video_id=${encodeURIComponent(activeData.videoId)}${emailParam}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn("Could not clear chat history on server:", e);
    }
    setChatMessages([]);
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
          cues: activeData.videoId ? undefined : (activeData.cues || []),
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
          web_sources: data.web_sources || []
        };
        setChatMessages([...newMessages, botMsg]);
      } else {
        const errJson = await res.json().catch(() => ({}));
        let errMsg = 'Failed to generate response. Please verify the AI engine is configured.';
        if (typeof errJson.detail === 'string') {
          errMsg = errJson.detail;
        } else if (Array.isArray(errJson.detail)) {
          errMsg = errJson.detail.map(d => (typeof d === 'string' ? d : d.msg || JSON.stringify(d))).join(', ');
        } else if (errJson.message) {
          errMsg = errJson.message;
        }
        setChatMessages([...newMessages, {
          sender: 'bot',
          text: `⚠️ **AI Tutor Error:** ${errMsg}`
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
          cues: activeData.videoId ? undefined : (activeData.cues || []),
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
          web_sources: data.web_sources || []
        };

        setChatMessages(prev => prev.map((m, i) => (i === botMsgIdx ? updatedMsg : m)));
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
    copiedPromptId,
    copiedResponseId,
    regeneratingId,
    chatEndRef,
    chatInputRef,
    fetchChatHistory,
    clearChatHistory,
    deleteChatMessage,
    initChatMessages,
    handleSendMessage,
    copyUserPrompt,
    copyBotResponse,
    regenerateResponse
  };
}

export default useAITutor;
