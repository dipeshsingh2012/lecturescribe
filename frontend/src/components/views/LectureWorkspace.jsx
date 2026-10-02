import React from 'react';
import LecturePlayer from '../lecture/LecturePlayer';
import TranscriptSearch from '../lecture/TranscriptSearch';
import AITutor from '../lecture/AITutor';
import LectureQuiz from '../lecture/LectureQuiz';
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
  resetQuiz = quiz?.resetQuiz
}) {
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
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
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

      {/* Right Panel: Instant Search Drawer, Practice Quiz, or AI Tutor */}
      {activeTab === 'transcript' ? (
        <TranscriptSearch
          displayCues={displayCues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          handleCueClick={handleCueClick}
          activeCueIdx={activeCueIdx}
          copied={copied}
          handleCopyTranscript={handleCopyTranscript}
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
        />
      )}
    </div>
  );
}
