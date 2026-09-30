import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../utils/constants';
import { cleanSubmissionFallback } from '../utils/formatters';

export function useAITutor(activeData, googleUser) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
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

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

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
          model: data.model || selectedModel,
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

  return {
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    chatLoading,
    availableModels,
    selectedModel,
    setSelectedModel,
    webSearchEnabled,
    setWebSearchEnabled,
    viewMode,
    setViewMode,
    submissionSummaries,
    copiedSubmissionId,
    copiedPromptId,
    chatEndRef,
    chatInputRef,
    fetchChatHistory,
    clearChatHistory,
    initChatMessages,
    handleSendMessage,
    generateSubmissionVersion,
    copySubmissionText,
    copyUserPrompt
  };
}
