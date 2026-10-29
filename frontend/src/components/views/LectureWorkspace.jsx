import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, FileText, HelpCircle, Search, Paperclip } from 'lucide-react';
import LecturePlayer from '../lecture/LecturePlayer';
import TranscriptSearch from '../lecture/TranscriptSearch';
import AITutor from '../lecture/AITutor';
import LectureQuiz from '../lecture/LectureQuiz';
import LectureSummary from '../lecture/LectureSummary';
import LectureResourcesShelf from '../lecture/LectureResourcesShelf';
import ErrorBoundary from '../common/ErrorBoundary';
import { normalizeCourseSlug } from '../../utils/routing';

export default function LectureWorkspace({
  activeData,
  activeCourseData,
  selectedCourse,
  setSelectedCourse,
  userLibrary,
  effectiveCourses,
  setActiveData,
  navigateTo,
  handleTranscribe,
  handleGenerateTranscript,
  transcriptionLoading,
  transcriptionError,
  transcriptionStage,
  iframeRef,
  copied,
  handleCopyTranscript,
  googleUser,
  openUploadModal,
  openPreviewModal,
  lectureResources,
  lectureResourcesLoading,
  handleDeleteResource,
  handleRenameResource,
  activeTab,
  setActiveTab = () => {},
  displayCues,
  searchQuery,
  setSearchQuery,
  searchAvailable = true,
  searchError = null,
  handleCueClick,
  activeCueIdx,
  isPlaying,
  handleTogglePlayPause,
  handlePauseVideo,
  webSearchEnabled,
  setWebSearchEnabled,
  clearChatHistory,
  deleteChatMessage,
  chatMessages,
  setChatMessages,
  copiedPromptId,
  copyUserPrompt,
  copiedResponseId,
  copyBotResponse,
  regenerateResponse,
  regeneratingId,
  chatLoading,
  chatInput,
  setChatInput,
  chatInputRef,
  chatEndRef,
  handleSendMessage,
  currentTheme,
  quiz,
  summary,
  summaryHook = summary || {},
  quizData = quiz?.quizData,
  quizLoading = quiz?.quizLoading,
  quizError = quiz?.quizError,
  selectedAnswers = quiz?.selectedAnswers,
  isCompleted = quiz?.isCompleted,
  score = quiz?.score,
  totalQuestions = quiz?.totalQuestions,
  answeredCount = quiz?.answeredCount,
  generateQuiz = quiz?.generateQuiz,
  selectAnswer = quiz?.selectAnswer,
  resetQuiz = quiz?.resetQuiz,
  detailedExplanations = quiz?.detailedExplanations,
  explanationLoading = quiz?.explanationLoading,
  fetchDetailedExplanation = quiz?.fetchDetailedExplanation
}) {
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  // VS Code-style resizable panels
  const DEFAULT_SPLIT_RATIO = 55;
  const MIN_SPLIT_RATIO = 25;
  const MAX_SPLIT_RATIO = 75;

  const [splitRatio, setSplitRatio] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('lecturescribe_workspace_split');
        if (saved) {
          const val = parseFloat(saved);
          if (!isNaN(val) && val >= MIN_SPLIT_RATIO && val <= MAX_SPLIT_RATIO) {
            return val;
          }
        }
      } catch (_) {}
    }
    return DEFAULT_SPLIT_RATIO;
  });

  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const workspaceRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDraggingSplit(true);
  }, []);

  const handleResetSplit = useCallback(() => {
    setSplitRatio(DEFAULT_SPLIT_RATIO);
    try {
      localStorage.setItem('lecturescribe_workspace_split', String(DEFAULT_SPLIT_RATIO));
    } catch (_) {}
  }, []);

  const handleSeparatorKeyDown = useCallback((e) => {
    let next = splitRatio;
    if (e.key === 'ArrowLeft') {
      next = Math.max(MIN_SPLIT_RATIO, splitRatio - 2);
    } else if (e.key === 'ArrowRight') {
      next = Math.min(MAX_SPLIT_RATIO, splitRatio + 2);
    } else if (e.key === 'Home') {
      next = MIN_SPLIT_RATIO;
    } else if (e.key === 'End') {
      next = MAX_SPLIT_RATIO;
    } else if (e.key === 'Enter' || e.key === ' ') {
      next = DEFAULT_SPLIT_RATIO;
    } else {
      return;
    }
    e.preventDefault();
    setSplitRatio(next);
    try {
      localStorage.setItem('lecturescribe_workspace_split', String(next));
    } catch (_) {}
  }, [splitRatio]);

  useEffect(() => {
    if (!isDraggingSplit) return;

    const handleMouseMove = (e) => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Math.round(rawPct * 10) / 10));
      setSplitRatio(clamped);
    };

    const handleMouseUp = () => {
      setIsDraggingSplit(false);
      try {
        localStorage.setItem('lecturescribe_workspace_split', String(splitRatio));
      } catch (_) {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit, splitRatio]);

  // Allow pressing Esc to restore split view
  useEffect(() => {
    if (!isPanelExpanded) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsPanelExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPanelExpanded]);

  // Support postMessage seeking from detached pop-out window
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'LECTURESCRIBE_SEEK' && event.data.timestamp) {
        if (typeof handleCueClick === 'function') {
          handleCueClick(event.data.timestamp);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleCueClick]);

  const transcriptAvailable =
    activeData?.transcript_available !== false &&
    Array.isArray(activeData?.cues) &&
    activeData.cues.some((cue) => String(cue?.text || '').trim());

  const handleCrossLectureClick = (videoId, timestamp, courseName) => {
    if (!videoId) return;
    if (activeData?.videoId === videoId) {
      if (timestamp) handleCueClick(timestamp);
      return;
    }
    const finalCourse = courseName || activeCourseData?.course_name || selectedCourse;
    const courseSlug = finalCourse ? normalizeCourseSlug(finalCourse) : '';
    const query = timestamp ? `?t=${encodeURIComponent(timestamp)}` : '';
    const path = courseSlug ? `/course/${courseSlug}/lecture/${videoId}${query}` : `/lecture/${videoId}${query}`;

    if (typeof handleTranscribe === 'function') {
      handleTranscribe(videoId, true, finalCourse);
      if (typeof window !== 'undefined' && timestamp) {
        try {
          window.history.replaceState({}, '', path);
        } catch (e) {
          console.warn("Cross lecture history state warning:", e);
        }
      }
    } else if (typeof navigateTo === 'function') {
      navigateTo(path);
    }
  };

  const handleDiscussInTutor = (topicText, timestampStr) => {
    setActiveTab('tutor');
    const prompt = timestampStr
      ? `I would like to discuss the concept "${topicText}" (referenced around [${timestampStr}]). Can we break down the intuition, key equations, and check my understanding?`
      : `I would like to discuss the concept "${topicText}". Can we break down the intuition, key equations, and check my understanding?`;
    if (typeof setChatInput === 'function') {
      setChatInput(prompt);
    }
    if (chatInputRef?.current) {
      setTimeout(() => chatInputRef.current?.focus(), 120);
    }
  };

  return (
    <div
      ref={workspaceRef}
      className={`lecture-workspace-layout ${isPanelExpanded ? 'panel-expanded' : ''} ${isDraggingSplit ? 'is-resizing' : ''}`}
      style={{
        '--workspace-player-width': `${splitRatio}%`,
        '--workspace-tool-width': `${100 - splitRatio}%`
      }}
    >
      {/* Left Panel: Real Embedded Video Player */}
      <LecturePlayer
        activeData={activeData}
        activeCourseData={activeCourseData}
        selectedCourse={selectedCourse}
        setSelectedCourse={setSelectedCourse}
        userLibrary={userLibrary}
        effectiveCourses={effectiveCourses}
        setActiveData={setActiveData}
        navigateTo={navigateTo}
        handleTranscribe={handleTranscribe}
        handleGenerateTranscript={handleGenerateTranscript}
        transcriptionLoading={transcriptionLoading}
        transcriptionError={transcriptionError}
        transcriptionStage={transcriptionStage}
        iframeRef={iframeRef}
        copied={copied}
        handleCopyTranscript={handleCopyTranscript}
        googleUser={googleUser}
        openUploadModal={openUploadModal}
        openPreviewModal={openPreviewModal}
        lectureResources={lectureResources}
        lectureResourcesLoading={lectureResourcesLoading}
        handleDeleteResource={handleDeleteResource}
        handleRenameResource={handleRenameResource}
        currentTheme={currentTheme}
      />

      {/* VS Code Style Horizontal Split Resizer */}
      {!isPanelExpanded && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize workspace panels"
          aria-valuenow={Math.round(splitRatio)}
          aria-valuemin={MIN_SPLIT_RATIO}
          aria-valuemax={MAX_SPLIT_RATIO}
          title="Drag to resize video and tools panels (Double-click to reset)"
          className={`workspace-split-resizer ${isDraggingSplit ? 'active' : ''}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleResetSplit}
          onKeyDown={handleSeparatorKeyDown}
        />
      )}

      {/* Mobile Tab Navigation Bar (Visible only on mobile / screens < 900px) */}
      <nav className="lecture-mobile-nav" role="tablist" aria-label="Lecture Navigation Tabs">
        <button
          type="button"
          role="tab"
          aria-label="AI Tutor"
          aria-selected={activeTab === 'tutor' || !['summary', 'transcript', 'quiz'].includes(activeTab)}
          className={`lecture-mobile-tab-btn ${activeTab === 'tutor' || !['summary', 'transcript', 'quiz'].includes(activeTab) ? 'active' : ''}`}
          onClick={() => typeof setActiveTab === 'function' && setActiveTab('tutor')}
        >
          <Bot size={15} />
          <span>AI Tutor</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-label="Summary"
          aria-selected={activeTab === 'summary'}
          className={`lecture-mobile-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => typeof setActiveTab === 'function' && setActiveTab('summary')}
        >
          <FileText size={15} />
          <span>Summary</span>
          {(summaryHook?.isOutdated || activeData?.is_outdated || activeData?.summary_outdated) && (
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#f59e0b',
              boxShadow: '0 0 6px #f59e0b',
              marginLeft: '2px'
            }} />
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-label="Quiz"
          aria-selected={activeTab === 'quiz'}
          className={`lecture-mobile-tab-btn ${activeTab === 'quiz' ? 'active' : ''}`}
          onClick={() => typeof setActiveTab === 'function' && setActiveTab('quiz')}
        >
          <HelpCircle size={15} />
          <span>Quiz</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-label="Transcript"
          aria-selected={activeTab === 'transcript'}
          className={`lecture-mobile-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
          onClick={() => typeof setActiveTab === 'function' && setActiveTab('transcript')}
        >
          <Search size={14} />
          <span>Transcript</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-label="Resources"
          aria-selected={activeTab === 'resources'}
          className={`lecture-mobile-tab-btn ${activeTab === 'resources' ? 'active' : ''}`}
          onClick={() => typeof setActiveTab === 'function' && setActiveTab('resources')}
        >
          <Paperclip size={14} />
          <span>Resources</span>
        </button>
      </nav>

      {/* Right / Tool Panel: Summary, Instant Search Drawer, Practice Quiz, Resources, or AI Tutor */}
      <div className="lecture-tool-panel">
        <ErrorBoundary title="Workspace Panel Error">
        {activeTab === 'summary' ? (
          <LectureSummary
            summaryHook={summaryHook}
            activeData={activeData}
            handleCueClick={handleCueClick}
            handleCrossLectureClick={handleCrossLectureClick}
            isExpanded={isPanelExpanded}
            onToggleExpand={() => setIsPanelExpanded((prev) => !prev)}
          />
        ) : activeTab === 'transcript' ? (
          <TranscriptSearch
            displayCues={displayCues}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchAvailable={searchAvailable}
            searchError={searchError}
            handleCueClick={handleCueClick}
            activeCueIdx={activeCueIdx}
            copied={copied}
            handleCopyTranscript={handleCopyTranscript}
            transcriptAvailable={transcriptAvailable}
            activeData={activeData}
            setActiveData={setActiveData}
            summaryHook={summaryHook}
            googleUser={googleUser}
            isPlaying={isPlaying}
            handleTogglePlayPause={handleTogglePlayPause}
            handlePauseVideo={handlePauseVideo}
            onDiscussInTutor={handleDiscussInTutor}
          />
        ) : activeTab === 'quiz' ? (
          <LectureQuiz
            quizData={quizData}
            quizLoading={quizLoading}
            quizError={quizError}
            selectedAnswers={selectedAnswers}
            isCompleted={isCompleted}
            score={score}
            totalQuestions={totalQuestions}
            answeredCount={answeredCount}
            generateQuiz={generateQuiz}
            selectAnswer={selectAnswer}
            resetQuiz={resetQuiz}
            handleCueClick={handleCueClick}
            currentTheme={currentTheme}
            detailedExplanations={detailedExplanations}
            explanationLoading={explanationLoading}
            fetchDetailedExplanation={fetchDetailedExplanation}
            transcriptAvailable={transcriptAvailable}
          />
        ) : activeTab === 'resources' ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px', background: 'var(--panel-bg)', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
            <LectureResourcesShelf
              lectureResources={lectureResources}
              lectureResourcesLoading={lectureResourcesLoading}
              googleUser={googleUser}
              handleDeleteResource={handleDeleteResource}
              handleRenameResource={handleRenameResource}
              activeData={activeData}
              activeCourseData={activeCourseData}
              selectedCourse={selectedCourse}
              openPreviewModal={openPreviewModal}
              openUploadModal={openUploadModal}
            />
          </div>
        ) : (
          <AITutor
            webSearchEnabled={webSearchEnabled}
            setWebSearchEnabled={setWebSearchEnabled}
            clearChatHistory={clearChatHistory}
            deleteChatMessage={deleteChatMessage}
            chatMessages={chatMessages}
            setChatMessages={setChatMessages}
            handleCueClick={handleCueClick}
            handleCrossLectureClick={handleCrossLectureClick}
            copiedPromptId={copiedPromptId}
            copyUserPrompt={copyUserPrompt}
            copiedResponseId={copiedResponseId}
            copyBotResponse={copyBotResponse}
            regenerateResponse={regenerateResponse}
            regeneratingId={regeneratingId}
            chatLoading={chatLoading}
            chatInput={chatInput}
            setChatInput={setChatInput}
            chatInputRef={chatInputRef}
            chatEndRef={chatEndRef}
            handleSendMessage={handleSendMessage}
            transcriptAvailable={transcriptAvailable}
            videoId={activeData?.videoId}
          />
        )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
