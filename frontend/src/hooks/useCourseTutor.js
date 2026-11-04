import { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function useCourseTutor(courseName, userEmail = null) {
  const courseSlug = normalizeCourseSlug(courseName) || (courseName || '').trim();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [copiedResponseId, setCopiedResponseId] = useState(null);
  const [streamingStatus, setStreamingStatus] = useState('');

  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Auto-scroll when new messages arrive or loading state changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, loading]);

  const fetchHistory = useCallback(async () => {
    if (!courseSlug) return;
    try {
      setError(null);
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/tutor/history${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.warn("Failed to fetch course tutor history:", err);
    }
  }, [courseSlug, userEmail]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setStreamingStatus('');
  }, []);

  const sendMessage = async (promptText = null) => {
    const textToSend = (promptText ?? input).trim();
    if (!textToSend || loading || !courseSlug) return;

    const userMsgId = `temp_user_${Date.now()}`;
    const tempUserMsg = {
      id: userMsgId,
      sender: 'user',
      text: textToSend,
      created_at: new Date().toISOString()
    };

    const botMsgId = `msg_bot_${Date.now()}`;
    const initialBotMsg = {
      id: botMsgId,
      sender: 'bot',
      text: '',
      citations: [],
      model: '',
      isStreaming: true,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempUserMsg, initialBotMsg]);
    setInput('');
    setLoading(true);
    setError(null);
    setStreamingStatus('Searching course materials...');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const t0 = performance.now();

    try {
      let streamHandled = false;

      // Try streaming endpoint first
      try {
        const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/tutor/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: textToSend,
            user_email: userEmail,
            chat_history: messages.slice(-6)
          })
        });

        if (res.ok && res.body && typeof res.body.getReader === 'function') {
          streamHandled = true;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let accumulatedText = '';
          let accumulatedCitations = [];
          let modelName = '';
          let responseTimeMs = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.replace(/^data:\s*/, '');
              if (dataStr === '[DONE]') continue;

              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'token' && data.delta) {
                  accumulatedText += data.delta;
                  setMessages(prev => prev.map(m =>
                    m.id === botMsgId ? { ...m, text: accumulatedText } : m
                  ));
                } else if (data.type === 'citations' && Array.isArray(data.citations)) {
                  accumulatedCitations = data.citations;
                  setMessages(prev => prev.map(m =>
                    m.id === botMsgId ? { ...m, citations: accumulatedCitations } : m
                  ));
                } else if (data.type === 'status' && data.message) {
                  setStreamingStatus(data.message);
                } else if (data.type === 'done') {
                  modelName = data.model || modelName;
                  responseTimeMs = data.response_time_ms;
                  if (data.citations) accumulatedCitations = data.citations;
                } else if (data.type === 'error') {
                  throw new Error(data.error || 'Stream error');
                }
              } catch (pErr) {
                if (pErr.message && pErr.message !== 'Unexpected end of JSON input') {
                  if (dataStr.includes('"type":"error"')) throw pErr;
                }
              }
            }
          }

          const elapsedMs = responseTimeMs ?? Math.max(1, Math.round(performance.now() - t0));
          setMessages(prev => prev.map(m =>
            m.id === botMsgId ? {
              ...m,
              text: accumulatedText || 'No response generated.',
              citations: accumulatedCitations,
              model: modelName,
              response_time_ms: elapsedMs,
              isStreaming: false
            } : m
          ));
        }
      } catch (streamErr) {
        if (streamErr.name === 'AbortError') {
          throw streamErr;
        }
        console.warn("Course Tutor streaming encountered issue, cascading to sync endpoint:", streamErr);
      }

      // If streaming wasn't handled (e.g. test environment or fallback), use synchronous endpoint
      if (!streamHandled) {
        const fallbackRes = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/tutor/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            message: textToSend,
            user_email: userEmail,
            chat_history: messages.slice(-6)
          })
        });

        if (!fallbackRes.ok) {
          const errData = await fallbackRes.json().catch(() => ({}));
          throw new Error(errData.detail || `Server responded with ${fallbackRes.status}`);
        }

        const data = await fallbackRes.json();
        const elapsedMs = data.response_time_ms ?? Math.max(1, Math.round(performance.now() - t0));
        setMessages(prev => prev.map(m =>
          m.id === botMsgId ? {
            ...m,
            text: data.reply || 'No response generated.',
            citations: data.citations || [],
            model: data.model || '',
            response_time_ms: elapsedMs,
            isStreaming: false
          } : m
        ));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === botMsgId ? { ...m, isStreaming: false } : m
        ));
      } else {
        setError(err.message || 'Failed to get answer from Course Tutor.');
        setMessages(prev => prev.filter(m => m.id !== botMsgId || (m.text && m.text.length > 0)));
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setStreamingStatus('');
    }
  };

  const clearHistory = async () => {
    if (!courseSlug) return;
    try {
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/tutor/history${emailParam}`, {
        method: 'DELETE'
      });
      setMessages([]);
      setError(null);
    } catch (err) {
      console.warn("Failed to clear course tutor history:", err);
    }
  };

  const deleteMessage = async (messageId) => {
    if (!courseSlug || !messageId) return;
    try {
      const emailParam = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/tutor/message/${encodeURIComponent(messageId)}${emailParam}`, {
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
    streamingStatus,
    abortStream,
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
