import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAITutor } from '../useAITutor';

describe('useAITutor hook functionality', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('initializes with default state when activeData is provided', () => {
    const activeData = { videoId: 'v10', transcript: 'Hello class.' };
    const { result } = renderHook(() => useAITutor(activeData, null));

    expect(result.current.chatMessages).toEqual([]);
    expect(result.current.chatInput).toBe('');
    expect(result.current.chatLoading).toBe(false);
    expect(result.current.webSearchEnabled).toBe(true);
  });

  it('handleSendMessage sends user query to RAG endpoint and appends bot response', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/rag/query')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            answer: 'Backpropagation computes the gradient.',
            submission_text: 'Backpropagation computes gradients using chain rule.'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const activeData = { videoId: 'v10' };
    const { result } = renderHook(() => useAITutor(activeData, null));

    act(() => {
      result.current.setChatInput('Explain backprop');
    });

    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(result.current.chatMessages.length).toBe(2);
    expect(result.current.chatMessages[0].text).toBe('Explain backprop');
    expect(result.current.chatMessages[1].text).toBe('Backpropagation computes the gradient.');
    expect(result.current.chatInput).toBe('');
  });

  it('clearChatHistory empties message history', async () => {
    const { result } = renderHook(() => useAITutor({ videoId: 'v10' }, null));

    act(() => {
      result.current.setChatMessages([{ sender: 'user', text: 'Hi' }]);
    });
    expect(result.current.chatMessages.length).toBe(1);

    await act(async () => {
      await result.current.clearChatHistory();
    });
    expect(result.current.chatMessages.length).toBe(0);
  });

  it('copyBotResponse writes text to clipboard and sets copiedResponseId', async () => {
    const writeTextMock = vi.fn().mockResolvedValue();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => useAITutor({ videoId: 'v10' }, null));
    });

    act(() => {
      hookResult.result.current.copyBotResponse('Neural networks learn weights.', 'msg-bot-1');
    });

    expect(writeTextMock).toHaveBeenCalledWith('Neural networks learn weights.');
    expect(hookResult.result.current.copiedResponseId).toBe('msg-bot-1');
  });

  it('autopopulates 4 prompt results when chat history is initially empty', async () => {
    const mockAutopopulateMessages = [
      { id: 'msg_user_1', sender: 'user', text: 'Create a summary for a 15 min read' },
      { id: 'msg_bot_1', sender: 'bot', text: '15 min summary content', submission_text: '15 min submission' },
      { id: 'msg_user_2', sender: 'user', text: 'Generate Summary for 30 mins read' },
      { id: 'msg_bot_2', sender: 'bot', text: '30 min summary content', submission_text: '30 min submission' },
      { id: 'msg_user_3', sender: 'user', text: 'Generate Full Comprehensive Summary' },
      { id: 'msg_bot_3', sender: 'bot', text: 'Full summary content', submission_text: 'Full submission' },
      { id: 'msg_user_4', sender: 'user', text: 'Explain key concepts and definitions' },
      { id: 'msg_bot_4', sender: 'bot', text: 'Key concepts content', submission_text: 'Key concepts submission' }
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/chat/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'success', count: 0, messages: [] })
        });
      }
      if (url.includes('/api/chat/autopopulate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'success', count: 8, messages: mockAutopopulateMessages })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => useAITutor({ videoId: 'v10', title: 'ML 101', cues: [] }, { email: 'student@example.com' }));
    });

    expect(hookResult.result.current.chatMessages.length).toBe(8);
    expect(hookResult.result.current.chatMessages[0].text).toBe('Create a summary for a 15 min read');
    expect(hookResult.result.current.chatMessages[1].text).toBe('15 min summary content');
    expect(hookResult.result.current.submissionSummaries['msg_bot_1']).toBe('15 min submission');
    expect(hookResult.result.current.submissionSummaries['msg_bot_4']).toBe('Key concepts submission');
  });

  it('does not re-autopopulate in same session after clearChatHistory', async () => {
    let autopopulateCallCount = 0;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/chat/autopopulate')) {
        autopopulateCallCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            messages: [
              { id: 'msg_user_1', sender: 'user', text: 'Create a summary for a 15 min read' },
              { id: 'msg_bot_1', sender: 'bot', text: 'Summary' }
            ]
          })
        });
      }
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', messages: [] })
      });
    });

    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => useAITutor({ videoId: 'v10' }, null));
    });

    expect(autopopulateCallCount).toBe(1);
    expect(hookResult.result.current.chatMessages.length).toBe(2);

    await act(async () => {
      await hookResult.result.current.clearChatHistory();
    });

    expect(hookResult.result.current.chatMessages.length).toBe(0);

    // Call fetchChatHistory again in the same session
    await act(async () => {
      await hookResult.result.current.fetchChatHistory('v10');
    });

    // Should NOT have called autopopulate again because it was cleared in this session
    expect(autopopulateCallCount).toBe(1);
    expect(hookResult.result.current.chatMessages.length).toBe(0);
  });

  it('resets session cleared guard when active video changes or initChatMessages is called', async () => {
    let autopopulatedVideos = [];
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/chat/autopopulate')) {
        const body = JSON.parse(opts.body || '{}');
        autopopulatedVideos.push(body.video_id);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            messages: [{ id: 'msg_1', sender: 'bot', text: 'Autopopulated' }]
          })
        });
      }
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', messages: [] })
      });
    });

    let hookData;
    await act(async () => {
      hookData = renderHook(({ data }) => useAITutor(data, null), {
        initialProps: { data: { videoId: 'v10' } }
      });
    });

    expect(autopopulatedVideos).toEqual(['v10']);

    // Clear chat for v10
    await act(async () => {
      await hookData.result.current.clearChatHistory();
    });

    // Switch video to v20 -> clearedInSessionRef should reset
    await act(async () => {
      hookData.rerender({ data: { videoId: 'v20' } });
    });

    expect(autopopulatedVideos).toEqual(['v10', 'v20']);

    // Clear chat for v20
    await act(async () => {
      await hookData.result.current.clearChatHistory();
    });

    // Calling initChatMessages for target video resets cleared guard
    await act(async () => {
      await hookData.result.current.initChatMessages('New Lecture', 'v30');
    });

    expect(autopopulatedVideos).toEqual(['v10', 'v20', 'v30']);
  });

  it('handles autopopulateChat network failure gracefully without crashing', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/chat/history')) {
        return Promise.resolve({ ok: true, json: async () => ({ messages: [] }) });
      }
      if (url.includes('/api/chat/autopopulate')) {
        return Promise.reject(new Error('Network offline'));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => useAITutor({ videoId: 'v-err' }, null));
    });

    expect(hookResult.result.current.chatLoading).toBe(false);
    expect(hookResult.result.current.chatMessages).toEqual([]);
  });

  it('regenerateResponse calls RAG query with bypass_cache: true and updates message in-place', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/rag/query')) {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            message_id: 'bot-1',
            answer: 'ELIZA was created by Joseph Weizenbaum at MIT.',
            submission_text: 'ELIZA created by Joseph Weizenbaum.'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const activeData = { videoId: 'v123', title: 'NLP Session' };
    const { result } = renderHook(() => useAITutor(activeData, null));

    act(() => {
      result.current.setChatMessages([
        { id: 'user-1', sender: 'user', text: 'what is early NLP system mimicking a phsycotherapist' },
        { id: 'bot-1', sender: 'bot', text: 'Old cached answer' }
      ]);
    });

    await act(async () => {
      await result.current.regenerateResponse('bot-1');
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.query).toBe('what is early NLP system mimicking a phsycotherapist');
    expect(capturedBody.bypass_cache).toBe(true);
    expect(capturedBody.video_id).toBe('v123');

    expect(result.current.chatMessages[1].text).toBe('ELIZA was created by Joseph Weizenbaum at MIT.');
    expect(result.current.submissionSummaries['bot-1']).toBe('ELIZA created by Joseph Weizenbaum.');
  });

  it('deleteChatMessage removes paired message from state and calls DELETE endpoint', async () => {
    let deletedUrl = null;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE' && url.includes('/api/chat/message')) {
        deletedUrl = url;
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const activeData = { videoId: 'v123' };
    const { result } = renderHook(() => useAITutor(activeData, { email: 'student@example.com' }));

    act(() => {
      result.current.setChatMessages([
        { id: 'msg_user_42', sender: 'user', text: 'Prompt 1' },
        { id: 'msg_bot_42', sender: 'bot', text: 'Response 1', submission_text: 'Sub 1' },
        { id: 'msg_user_43', sender: 'user', text: 'Prompt 2' },
        { id: 'msg_bot_43', sender: 'bot', text: 'Response 2', submission_text: 'Sub 2' }
      ]);
    });

    await act(async () => {
      await result.current.deleteChatMessage('msg_bot_42');
    });

    expect(result.current.chatMessages.length).toBe(2);
    expect(result.current.chatMessages[0].id).toBe('msg_user_43');
    expect(result.current.chatMessages[1].id).toBe('msg_bot_43');
    expect(deletedUrl).toContain('/api/chat/message?message_id=msg_bot_42');
    expect(deletedUrl).toContain('video_id=v123');
    expect(deletedUrl).toContain('email=student%40example.com');
  });
});