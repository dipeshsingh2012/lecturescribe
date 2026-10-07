import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AITutor from '../AITutor';

describe('AITutor', () => {
  it('warns when tutor responses cannot be grounded in a transcript', () => {
    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        chatMessages={[]}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={vi.fn()}
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
        transcriptAvailable={false}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/imported without a transcript/i);
    expect(screen.getByRole('status')).toHaveTextContent(/lecture-grounded answers/i);
  });

  it('renders chat header, web toggle, and new chat button without model selector', () => {
    const setWebSearchEnabled = vi.fn();
    const clearChatHistory = vi.fn();

    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={setWebSearchEnabled}
        clearChatHistory={clearChatHistory}
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
    // Model selector dropdown must be removed
    expect(screen.queryByTitle(/Select the active LLM engine/i)).toBeNull();

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

    // Shift + Enter should NOT send message (allows multiline input)
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(handleSendMessage).toHaveBeenCalledTimes(0);

    // Regular Enter sends message
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: false });
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
    expect(screen.getByText(/Auto-populating 15-min and full comprehensive summaries/i)).toBeInTheDocument();
  });

  it('renders quick prompts in welcome screen and clicking each triggers handleSendMessage', () => {
    const handleSendMessage = vi.fn();
    const prompts = [
      "Create a summary for a 15 min read",
      "Generate Full Comprehensive Summary"
    ];

    render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
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
    expect(handleSendMessage).toHaveBeenCalledTimes(2);
  });

  it('renders 4 quick pills above input and disables clicks while chatLoading is true', () => {
    const handleSendMessage = vi.fn();
    const { rerender } = render(
      <AITutor
        webSearchEnabled={false}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
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

  it('renders Delete button on messages and triggers deleteChatMessage with message ID', () => {
    const deleteChatMessage = vi.fn();
    const messages = [
      { id: 'msg_user_99', sender: 'user', text: 'Explain SVM' },
      { id: 'msg_bot_99', sender: 'bot', text: 'SVM is Support Vector Machine' }
    ];

    render(
      <AITutor
        webSearchEnabled={true}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        deleteChatMessage={deleteChatMessage}
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
        chatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatInputRef={{ current: null }}
        chatEndRef={{ current: null }}
        handleSendMessage={vi.fn()}
      />
    );

    const deleteUserBtn = screen.getByRole('button', { name: /Delete message/i });
    expect(deleteUserBtn).toBeInTheDocument();
    fireEvent.click(deleteUserBtn);
    expect(deleteChatMessage).toHaveBeenCalledWith('msg_user_99');

    const deleteBotBtn = screen.getByRole('button', { name: /Delete response/i });
    expect(deleteBotBtn).toBeInTheDocument();
    fireEvent.click(deleteBotBtn);
    expect(deleteChatMessage).toHaveBeenCalledWith('msg_bot_99');
  });

  it('triggers handleCrossLectureClick when a cross-lecture citation is clicked', () => {
    const handleCrossLectureClick = vi.fn();
    const handleCueClick = vi.fn();
    const messages = [
      {
        id: 'msg_cross_1',
        sender: 'bot',
        text: 'The professor covered np.arange in Session 2 at [37:46]【search_course_lectures】.',
        citations: [
          {
            video_id: '1229247139',
            video_title: 'Data Science Lab Live session - 2',
            timestamp: '37:46',
            cross_lecture: true
          }
        ]
      }
    ];

    render(
      <AITutor
        webSearchEnabled={true}
        setWebSearchEnabled={vi.fn()}
        clearChatHistory={vi.fn()}
        deleteChatMessage={vi.fn()}
        chatMessages={messages}
        setChatMessages={vi.fn()}
        viewMode="learning"
        submissionSummaries={{}}
        cleanSubmissionFallback={vi.fn()}
        handleCueClick={handleCueClick}
        handleCrossLectureClick={handleCrossLectureClick}
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
        handleSendMessage={vi.fn()}
      />
    );

    // Click the citation in the citations bar
    const citePill = screen.getByTitle(/\[Data Science Lab Live session - 2\] 37:46/i);
    expect(citePill).toBeInTheDocument();
    fireEvent.click(citePill);
    expect(handleCrossLectureClick).toHaveBeenCalledWith('1229247139', '37:46', 'Data Science Lab Live session - 2');
    expect(handleCueClick).not.toHaveBeenCalled();
  });
});
