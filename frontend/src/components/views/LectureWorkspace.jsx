import React from 'react';
import { Bot, FileText, HelpCircle, Search } from 'lucide-react';
import LecturePlayer from '../lecture/LecturePlayer';
import TranscriptSearch from '../lecture/TranscriptSearch';
import AITutor from '../lecture/AITutor';
import LectureQuiz from '../lecture/LectureQuiz';
import LectureSummary from '../lecture/LectureSummary';
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
  activeTab,
  setActiveTab = () => {},
  displayCues,
  searchQuery,
  setSearchQuery,
  handleCueClick,
  activeCueIdx,
  webSearchEnabled,
  setWebSearchEnabled,
  clearChatHistory,
  deleteChatMessage,
  chatMessages,
  setChatMessages,
  viewMode,
  submissionSummaries,
  cleanSubmissionFallback,
  copiedPromptId,
  copyUserPrompt,
  copiedSubmissionId,
  copySubmissionText,
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
  fetchOrGenerateQuiz = quiz?.fetchOrGenerateQuiz,
  selectAnswer = quiz?.selectAnswer,
  resetQuiz = quiz?.resetQuiz,
  detailedExplanations = quiz?.detailedExplanations,
  explanationLoading = quiz?.explanationLoading,
  fetchDetailedExplanation = quiz?.fetchDetailedExplanation
}) {
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

  return (
    <div className="lecture-workspace-layout">
      {/* Left Panel: Real Embedded Vimeo Player */}
      <LecturePlayer
        activeData={activeData}
        activeCourseData={activeCourseData}
        selectedCourse={selectedCourse}
        setSelectedCourse={setSelectedCourse}
        userLibrary={userLibrary}
        effectiveCourses={effectiveCourses}
        setActiveData={setActiveData}
        navigateTo={navigateTo}
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
        currentTheme={currentTheme}
      />

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
          <Search size={15} />
          <span>Transcript</span>
        </button>
      </nav>

      {/* Right / Tool Panel: Summary, Instant Search Drawer, Practice Quiz, or AI Tutor */}
      <div className="lecture-tool-panel">
        {activeTab === 'summary' ? (
          <LectureSummary
            summaryHook={summaryHook}
            handleCueClick={handleCueClick}
            handleCrossLectureClick={handleCrossLectureClick}
          />
        ) : activeTab === 'transcript' ? (
          <TranscriptSearch
            displayCues={displayCues}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleCueClick={handleCueClick}
            activeCueIdx={activeCueIdx}
            copied={copied}
            handleCopyTranscript={handleCopyTranscript}
            transcriptAvailable={transcriptAvailable}
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
            fetchOrGenerateQuiz={fetchOrGenerateQuiz}
            selectAnswer={selectAnswer}
            resetQuiz={resetQuiz}
            handleCueClick={handleCueClick}
            currentTheme={currentTheme}
            detailedExplanations={detailedExplanations}
            explanationLoading={explanationLoading}
            fetchDetailedExplanation={fetchDetailedExplanation}
            transcriptAvailable={transcriptAvailable}
          />
        ) : (
          <AITutor
            webSearchEnabled={webSearchEnabled}
            setWebSearchEnabled={setWebSearchEnabled}
            clearChatHistory={clearChatHistory}
            deleteChatMessage={deleteChatMessage}
            chatMessages={chatMessages}
            setChatMessages={setChatMessages}
            viewMode={viewMode}
            submissionSummaries={submissionSummaries}
            cleanSubmissionFallback={cleanSubmissionFallback}
            handleCueClick={handleCueClick}
            handleCrossLectureClick={handleCrossLectureClick}
            copiedPromptId={copiedPromptId}
            copyUserPrompt={copyUserPrompt}
            copiedSubmissionId={copiedSubmissionId}
            copySubmissionText={copySubmissionText}
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
      </div>
    </div>
  );
}
