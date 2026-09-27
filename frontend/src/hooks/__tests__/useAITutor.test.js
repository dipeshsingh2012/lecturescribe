import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAITutor } from '../useAITutor';

describe('useAITutor hook functionality', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/ai/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('fetches AI models and sets selected model when activeData is provided', async () => {
    const models = [
      { id: 'llama-3.2', name: 'Llama 3.2', is_configured: true, is_recommended: true }
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/ai/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ models }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const activeData = { videoId: 'v10', transcript: 'Hello class.' };
    const { result } = renderHook(() => useAITutor(activeData, null));

    await act(async () => {});

    expect(result.current.availableModels).toEqual(models);
    expect(result.current.selectedModel).toBe('llama-3.2');
  });

  it('handleSendMessage sends user query to RAG endpoint and appends bot response', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/ai/models')) {
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
      }
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
});
