import { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE } from '../utils/constants';

export function useCourseTutor(courseName, userEmail = null) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [copiedResponseId, setCopiedResponseId] = useState(null);

  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  const fetchHistory = useCallback(async () => {
    if (!courseName) return;
    try {
      setError(null);
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/tutor/history${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.warn("Failed to fetch course tutor history:", err);
    }
  }, [courseName, userEmail]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const sendMessage = async (promptText = null) => {
    const textToSend = (promptText ?? input).trim();
    if (!textToSend || loading || !courseName) return;

    const tempUserMsg = {
      id: `temp_user_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempUserMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/tutor/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          user_email: userEmail,
          chat_history: messages.slice(-6)
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      const botMsg = {
        id: `msg_bot_${Date.now()}`,
        sender: 'bot',
        text: data.reply || 'No response generated.',
        citations: data.citations || [],
        model: data.model || '',
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      setError(err.message || 'Failed to get answer from Course Tutor.');
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!courseName) return;
    try {
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/tutor/history${emailParam}`, {
        method: 'DELETE'
      });
      setMessages([]);
      setError(null);
    } catch (err) {
      console.warn("Failed to clear course tutor history:", err);
    }
  };

  const deleteMessage = async (messageId) => {
    if (!courseName || !messageId) return;
    try {
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/tutor/message/${encodeURIComponent(messageId)}${emailParam}`, {
        method: 'DELETE'
      });
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      console.warn("Failed to delete message:", err);
    }
  };

  const copyText = (text, id, isResponse = false) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    if (isResponse) {
      setCopiedResponseId(id);
      setTimeout(() => setCopiedResponseId(null), 2000);
    } else {
      setCopiedPromptId(id);
      setTimeout(() => setCopiedPromptId(null), 2000);
    }
  };

  return {
    messages,
    input,
    setInput,
    loading,
    error,
    sendMessage,
    clearHistory,
    deleteMessage,
    copyText,
    copiedPromptId,
    copiedResponseId,
    chatEndRef,
    chatInputRef
  };
}
