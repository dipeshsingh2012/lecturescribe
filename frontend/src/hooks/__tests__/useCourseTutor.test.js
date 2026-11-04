import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCourseTutor } from '../useCourseTutor';

describe('useCourseTutor Hook', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initializes with default empty state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] })
    });

    const { result } = renderHook(() => useCourseTutor('Machine Learning', 'user@test.com'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe('');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetchHistory populates messages from server', async () => {
    const mockHistory = [
      { id: 'm1', sender: 'user', text: 'What is PCA?' },
      { id: 'm2', sender: 'bot', text: 'Principal Component Analysis reduces dimensions.' }
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/tutor/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ messages: mockHistory })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { result } = renderHook(() => useCourseTutor('Machine Learning', 'user@test.com'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.messages).toEqual(mockHistory);
  });

  it('sendMessage streams SSE tokens and updates message in real time', async () => {
    const encoder = new TextEncoder();
    const streamChunks = [
      'data: {"type": "status", "message": "Searching..."}\n\n',
      'data: {"type": "citations", "citations": [{"video_id": "v1", "timestamp": "12:00"}]}\n\n',
      'data: {"type": "token", "delta": "Neural "}\n\n',
      'data: {"type": "token", "delta": "networks "}\n\n',
      'data: {"type": "token", "delta": "learn weights."}\n\n',
      'data: {"type": "done", "model": "Gemini 3.8 Flash", "response_time_ms": 280}\n\n',
      'data: [DONE]\n\n'
    ];

    let chunkIndex = 0;
    const mockReadableStream = {
      getReader: () => ({
        read: async () => {
          if (chunkIndex < streamChunks.length) {
            const chunk = encoder.encode(streamChunks[chunkIndex++]);
            return { done: false, value: chunk };
          }
          return { done: true, value: undefined };
        }
      })
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/tutor/chat/stream')) {
        return Promise.resolve({
          ok: true,
          body: mockReadableStream
        });
      }
      if (url.includes('/tutor/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ messages: [] })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { result } = renderHook(() => useCourseTutor('Machine Learning', 'user@test.com'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage('Explain neural networks');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.messages.length).toBe(2);
    expect(result.current.messages[0].sender).toBe('user');
    expect(result.current.messages[0].text).toBe('Explain neural networks');

    const botMsg = result.current.messages[1];
    expect(botMsg.sender).toBe('bot');
    expect(botMsg.text).toBe('Neural networks learn weights.');
    expect(botMsg.citations).toEqual([{ video_id: 'v1', timestamp: '12:00' }]);
    expect(botMsg.model).toBe('Gemini 3.8 Flash');
    expect(botMsg.response_time_ms).toBe(280);
    expect(botMsg.isStreaming).toBe(false);
  });

  it('sendMessage cascades to fallback JSON endpoint if streaming is unavailable', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/tutor/chat/stream')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (url.includes('/tutor/chat')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            reply: 'Fallback non-streamed response.',
            citations: [],
            model: 'Fallback Model',
            response_time_ms: 350
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ messages: [] }) });
    });

    const { result } = renderHook(() => useCourseTutor('Machine Learning', 'user@test.com'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.messages.length).toBe(2);
    expect(result.current.messages[1].text).toBe('Fallback non-streamed response.');
    expect(result.current.messages[1].isStreaming).toBe(false);
  });

  it('abortStream halts active stream and keeps accumulated text', async () => {
    const encoder = new TextEncoder();
    let aborted = false;

    const mockReadableStream = {
      getReader: () => ({
        read: async () => {
          if (aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          return { done: false, value: encoder.encode('data: {"type": "token", "delta": "Partial "}\n\n') };
        }
      })
    };

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/tutor/chat/stream')) {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            aborted = true;
          });
        }
        return Promise.resolve({
          ok: true,
          body: mockReadableStream
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ messages: [] }) });
    });

    const { result } = renderHook(() => useCourseTutor('Machine Learning', 'user@test.com'));

    await act(async () => {
      await Promise.resolve();
    });

    let sendPromise;
    act(() => {
      sendPromise = result.current.sendMessage('Long prompt');
    });

    act(() => {
      result.current.abortStream();
    });

    await act(async () => {
      await sendPromise.catch(() => {});
    });

    expect(result.current.loading).toBe(false);
    const botMsg = result.current.messages.find(m => m.sender === 'bot');
    expect(botMsg?.isStreaming).toBe(false);
  });
});
