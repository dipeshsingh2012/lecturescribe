import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AITutor from '../AITutor';

describe('AITutor', () => {
  const defaultModels = [
    { id: 'llama-3.2', name: 'Llama 3.2 3B', provider: 'Groq', badge: 'Fastest' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', badge: 'Smart' }
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

  it('renders copy button after AI response and copies response on click', () => {
    const copyBotResponse = vi.fn();
    const messages = [
      { id: 'bot-msg-1', sender: 'bot', text: 'This is the AI answer explaining transformers.' }
    ];

    render(
      <AITutor
        webSearchEnabled={false}
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
        copiedResponseId={null}
        copyBotResponse={copyBotResponse}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy AI response/i });
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveTextContent('Copy');

    fireEvent.click(copyBtn);
    expect(copyBotResponse).toHaveBeenCalledWith(
      'This is the AI answer explaining transformers.',
      'bot-msg-1'
    );
  });

  it('renders preparing/autopopulating state when chat is loading and empty', () => {
    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
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
        copiedResponseId={null}
        copyBotResponse={vi.fn()}
        chatLoading={true}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-autopopulating-state')).toBeInTheDocument();
    expect(screen.getByText(/Preparing Your AI Lecture Guide.../i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-populating 15-min & 30-min summaries/i)).toBeInTheDocument();
  });

  it('renders all 4 quick prompts in welcome screen and clicking each triggers handleSendMessage', () => {
    const handleSendMessage = vi.fn();
    const prompts = [
      "Create a summary for a 15 min read",
      "Generate Summary for 30 mins read",
      "Generate Full Comprehensive Summary",
      "Explain key concepts and definitions"
    ];

    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
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
        copiedResponseId={null}
        copyBotResponse={vi.fn()}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={handleSendMessage}
      />
    );

    prompts.forEach((pText) => {
      const btns = screen.getAllByRole('button', { name: new RegExp(pText, 'i') });
      expect(btns.length).toBeGreaterThanOrEqual(1);
      const welcomeBtn = btns.find((b) => b.textContent.includes('Run prompt')) || btns[0];
      fireEvent.click(welcomeBtn);
      expect(handleSendMessage).toHaveBeenCalledWith(pText);
    });
    expect(handleSendMessage).toHaveBeenCalledTimes(4);
  });

  it('renders 4 quick pills above input and disables clicks while chatLoading is true', () => {
    const handleSendMessage = vi.fn();
    const { rerender } = render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        selectedModel="llama-3.2"
        setSelectedModel={vi.fn()}
        availableModels={defaultModels}
        chatMessages={[{ id: '1', sender: 'user', text: 'Hi' }]}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={vi.fn()}
        copiedPromptId={null}
        copyUserPrompt={vi.fn()}
        copiedSubmissionId={null}
        copySubmissionText={vi.fn()}
        copiedResponseId={null}
        copyBotResponse={vi.fn()}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={handleSendMessage}
      />
    );

    const pillBtn = screen.getByTitle('Run prompt: "Create a summary for a 15 min read"');
    expect(pillBtn).toBeInTheDocument();
    expect(pillBtn).not.toBeDisabled();
    fireEvent.click(pillBtn);
    expect(handleSendMessage).toHaveBeenCalledWith('Create a summary for a 15 min read');

    // Now re-render with chatLoading={true}
    rerender(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        selectedModel="llama-3.2"
        setSelectedModel={vi.fn()}
        availableModels={defaultModels}
        chatMessages={[{ id: '1', sender: 'user', text: 'Hi' }]}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={vi.fn()}
        copiedPromptId={null}
        copyUserPrompt={vi.fn()}
        copiedSubmissionId={null}
        copySubmissionText={vi.fn()}
        copiedResponseId={null}
        copyBotResponse={vi.fn()}
        chatLoading={true}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={handleSendMessage}
      />
    );

    expect(pillBtn).toBeDisabled();
    fireEvent.click(pillBtn);
    // Should NOT have been called a second time
    expect(handleSendMessage).toHaveBeenCalledTimes(1);
  });

  it('renders Regenerate button on bot responses and triggers regenerateResponse', () => {
    const regenerateResponse = vi.fn();
    const messages = [
      { id: 'u1', sender: 'user', text: 'what is early NLP system mimicking a phsycotherapist' },
      { id: 'b1', sender: 'bot', text: 'ELIZA was an early natural language processing program...' }
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
        copiedResponseId={null}
        copyBotResponse={vi.fn()}
        regenerateResponse={regenerateResponse}
        regeneratingId={null}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
      />
    );

    const regenBtn = screen.getByRole('button', { name: /Regenerate/i });
    expect(regenBtn).toBeInTheDocument();
    fireEvent.click(regenBtn);
    expect(regenerateResponse).toHaveBeenCalledWith('b1');
  });
});
