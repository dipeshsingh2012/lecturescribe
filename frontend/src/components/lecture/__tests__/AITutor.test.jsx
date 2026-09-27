import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AITutor from '../AITutor';

describe('AITutor', () => {
  const defaultModels = [
    { id: 'llama-3.2', name: 'Llama 3.2 3B', provider: 'Groq', badge: 'Fastest' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', badge: 'Smart' }
  ];

  it('renders chat header, web toggle, and new chat button', () => {
    const setWebSearchEnabled = vi.fn();
    const clearChatHistory = vi.fn();

    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={setWebSearchEnabled}
        clearChatHistory={clearChatHistory}
        selectedModel="llama-3.2"
        setSelectedModel={vi.fn()}
        availableModels={defaultModels}
        chatMessages={[]}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={vi.fn()}
        copiedPromptId={null}
        copyUserPrompt={vi.fn()}
        copiedSubmissionId={null}
        copySubmissionText={vi.fn()}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
      />
    );

    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
    expect(screen.getByText('Web: OFF')).toBeInTheDocument();

    const webBtn = screen.getByTitle(/Web grounding DISABLED/i);
    fireEvent.click(webBtn);
    expect(setWebSearchEnabled).toHaveBeenCalled();

    const newChatBtn = screen.getByTitle(/Start a new chat thread/i);
    fireEvent.click(newChatBtn);
    expect(clearChatHistory).toHaveBeenCalled();
  });

  it('renders chat messages and handles sending a question', () => {
    const handleSendMessage = vi.fn();
    const setChatInput = vi.fn();
    const messages = [
      { id: '1', sender: 'user', text: 'What is gradient descent?' },
      { id: '2', sender: 'bot', text: 'Gradient descent is an optimization algorithm.' }
    ];

    render(
      <AITutor
        webSearchEnabled={true}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        selectedModel="llama-3.2"
        setSelectedModel={vi.fn()}
        availableModels={defaultModels}
        chatMessages={messages}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={vi.fn()}
        copiedPromptId={null}
        copyUserPrompt={vi.fn()}
        copiedSubmissionId={null}
        copySubmissionText={vi.fn()}
        chatLoading={false}
        chatInput="Tell me more"
        setChatInput={setChatInput}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={handleSendMessage}
      />
    );

    expect(screen.getByText('What is gradient descent?')).toBeInTheDocument();
    expect(screen.getByText(/optimization algorithm/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Ask AI tutor anything about this lecture/i);
    expect(input).toHaveValue('Tell me more');

    fireEvent.change(input, { target: { value: 'How about Adam optimizer?' } });
    expect(setChatInput).toHaveBeenCalledWith('How about Adam optimizer?');

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(handleSendMessage).toHaveBeenCalledTimes(1);
  });
});
