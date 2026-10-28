import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureWorkspace from '../LectureWorkspace';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('LectureWorkspace', () => {
  const activeData = {
    videoId: '445566',
    title: 'Operating Systems',
    course_name: 'CS301',
    cues: [{ time: '02:00', text: 'Kernel architecture.' }]
  };

  const baseProps = {
    activeData,
    activeCourseData: { course_name: 'CS301' },
    selectedCourse: 'CS301',
    setSelectedCourse: vi.fn(),
    userLibrary: [],
    effectiveCourses: [],
    setActiveData: vi.fn(),
    navigateTo: vi.fn(),
    iframeRef: { current: null },
    copied: false,
    handleCopyTranscript: vi.fn(),
    googleUser: null,
    openUploadModal: vi.fn(),
    lectureResources: [],
    lectureResourcesLoading: false,
    handleDeleteResource: vi.fn(),
    activeTab: 'transcript',
    displayCues: [{ time: '02:00', text: 'Kernel architecture.' }],
    searchQuery: '',
    setSearchQuery: vi.fn(),
    handleCueClick: vi.fn(),
    activeCueIdx: 0,
    webSearchEnabled: false,
    setWebSearchEnabled: vi.fn(),
    clearChatHistory: vi.fn(),
    chatMessages: [],
    setChatMessages: vi.fn(),
    copiedPromptId: null,
    copyUserPrompt: vi.fn(),
    chatLoading: false,
    chatInput: '',
    setChatInput: vi.fn(),
    chatInputRef: { current: null },
    chatEndRef: { current: null },
    handleSendMessage: vi.fn(),
    currentTheme: mockTheme
  };

  it('renders LecturePlayer on the left and TranscriptSearch when activeTab is transcript', () => {
    render(<LectureWorkspace {...baseProps} activeTab="transcript" />);

    expect(screen.getAllByText('Operating Systems').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/Search transcript/i)).toBeInTheDocument();
    expect(screen.getByText('Kernel architecture.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy Transcript/i })).toBeInTheDocument();
  });

  it('renders AITutor on the right when activeTab is tutor and passes deleteChatMessage', () => {
    const deleteChatMessage = vi.fn();
    const messages = [
      { id: 'msg_user_1', sender: 'user', text: 'Prompt 1' },
      { id: 'msg_bot_1', sender: 'bot', text: 'Answer 1' }
    ];
    render(
      <LectureWorkspace
        {...baseProps}
        activeTab="tutor"
        chatMessages={messages}
        deleteChatMessage={deleteChatMessage}
      />
    );

    expect(screen.getAllByText('Operating Systems').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AI Tutor').length).toBeGreaterThan(0);

    const deleteBtn = screen.getByRole('button', { name: /Delete message/i });
    deleteBtn.click();
    expect(deleteChatMessage).toHaveBeenCalledWith('msg_user_1');
  });

  it('renders LectureQuiz on the right when activeTab is quiz', () => {
    const generateQuiz = vi.fn();
    render(
      <LectureWorkspace
        {...baseProps}
        activeTab="quiz"
        generateQuiz={generateQuiz}
      />
    );

    expect(screen.getByText('Lecture Practice Quiz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Quiz/i })).toBeInTheDocument();
  });

  it('renders LectureSummary on the right when activeTab is summary', () => {
    const summaryHook = {
      summaries: {
        '15_min': {
          id: 1,
          videoId: '445566',
          summaryType: '15_min',
          markdownText: 'Executive summary content',
          submissionText: 'Submission text content',
          wordCount: 120
        }
      },
      currentSummary: {
        id: 1,
        videoId: '445566',
        summaryType: '15_min',
        markdownText: 'Executive summary content',
        submissionText: 'Submission text content',
        wordCount: 120
      },
      activeSummaryType: '15_min',
      setActiveSummaryType: vi.fn(),
      viewMode: 'study',
      setViewMode: vi.fn(),
      loading: false,
      generating: false,
      error: null,
      copiedField: null,
      copyText: vi.fn(),
      generateSummary: vi.fn(),
      transcriptAvailable: true
    };

    render(
      <LectureWorkspace
        {...baseProps}
        activeTab="summary"
        summaryHook={summaryHook}
      />
    );

    expect(screen.getByText('Summary & Submissions')).toBeInTheDocument();
    expect(screen.getByText('Executive summary content')).toBeInTheDocument();
  });

  it('renders mobile navigation tabs and calls setActiveTab when clicked', () => {
    const setActiveTab = vi.fn();
    render(
      <LectureWorkspace
        {...baseProps}
        activeTab="summary"
        setActiveTab={setActiveTab}
      />
    );

    const mobileNav = screen.getByRole('tablist', { name: /Lecture Navigation Tabs/i });
    expect(mobileNav).toBeInTheDocument();

    const tutorTab = screen.getByRole('tab', { name: /AI Tutor/i });
    const quizTab = screen.getByRole('tab', { name: /Quiz/i });
    const transcriptTab = screen.getByRole('tab', { name: /Transcript/i });
    const resourcesTab = screen.getByRole('tab', { name: /Resources/i });

    tutorTab.click();
    expect(setActiveTab).toHaveBeenCalledWith('tutor');

    quizTab.click();
    expect(setActiveTab).toHaveBeenCalledWith('quiz');

    transcriptTab.click();
    expect(setActiveTab).toHaveBeenCalledWith('transcript');

    resourcesTab.click();
    expect(setActiveTab).toHaveBeenCalledWith('resources');
  });

  it('renders LectureResourcesShelf in tool panel when activeTab is resources', () => {
    const resources = [
      {
        id: 'res-1',
        title: 'Weekly Lecture Notes',
        filename: 'notes.pdf',
        file_type: 'pdf',
        file_size_bytes: 1024,
        created_at: '2026-09-01T00:00:00Z'
      }
    ];
    render(
      <LectureWorkspace
        {...baseProps}
        activeTab="resources"
        lectureResources={resources}
      />
    );

    expect(screen.getAllByText('Weekly Lecture Notes').length).toBeGreaterThan(0);
  });

  it('renders LectureSummary and toggles panel-expanded class when expand is clicked and collapses on Escape', () => {
    const summaryHook = {
      currentSummary: {
        id: 1,
        markdownText: '# Introduction',
        submissionText: 'Intro summary prose'
      },
      viewMode: 'study',
      setViewMode: vi.fn(),
      loading: false,
      generating: false,
      transcriptAvailable: true,
      copyText: vi.fn(),
      generateSummary: vi.fn()
    };

    const { container } = render(
      <LectureWorkspace
        {...baseProps}
        activeTab="summary"
        summaryHook={summaryHook}
      />
    );

    const layout = container.querySelector('.lecture-workspace-layout');
    expect(layout).not.toHaveClass('panel-expanded');

    const expandBtn = screen.getByRole('button', { name: /Expand reading view/i });
    fireEvent.click(expandBtn);
    expect(layout).toHaveClass('panel-expanded');

    // Press Escape to restore
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(layout).not.toHaveClass('panel-expanded');
  });

  it('renders resizable split separator and supports dragging and resetting', () => {
    const { container } = render(
      <LectureWorkspace
        {...baseProps}
        activeTab="transcript"
      />
    );

    const separator = screen.getByRole('separator', { name: /Resize workspace panels/i });
    expect(separator).toBeInTheDocument();
    expect(separator).toHaveAttribute('aria-valuenow', '55');

    // Test keyboard navigation on separator
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '57');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '55');

    // Test Home key (min width)
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '25');

    // Test End key (max width)
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '75');

    // Test double click to reset
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '55');

    // Test mouse down initiates resizing state
    const layout = container.querySelector('.lecture-workspace-layout');
    fireEvent.mouseDown(separator);
    expect(layout).toHaveClass('is-resizing');

    fireEvent.mouseUp(window);
    expect(layout).not.toHaveClass('is-resizing');
  });
});

