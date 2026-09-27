import React from 'react';
import LecturePlayer from '../lecture/LecturePlayer';
import TranscriptSearch from '../lecture/TranscriptSearch';
import AITutor from '../lecture/AITutor';

export default function LectureWorkspace({
  activeData,
  activeCourseData,
  selectedCourse,
  setSelectedCourse,
  userLibrary,
  effectiveCourses,
  setActiveData,
  navigateTo,
  iframeRef,
  copied,
  handleCopyTranscript,
  googleUser,
  openUploadModal,
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
  selectedModel,
  setSelectedModel,
  availableModels,
  chatMessages,
  setChatMessages,
  viewMode,
  submissionSummaries,
  cleanSubmissionFallback,
  copiedPromptId,
  copyUserPrompt,
  copiedSubmissionId,
  copySubmissionText,
  chatLoading,
  chatInput,
  setChatInput,
  chatInputRef,
  chatEndRef,
  handleSendMessage,
  currentTheme
}) {
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
        lectureResources={lectureResources}
        lectureResourcesLoading={lectureResourcesLoading}
        handleDeleteResource={handleDeleteResource}
        currentTheme={currentTheme}
      />

      {/* Right Panel: Instant Search Drawer or AI Tutor */}
      {activeTab === 'transcript' ? (
        <TranscriptSearch
          displayCues={displayCues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          handleCueClick={handleCueClick}
          activeCueIdx={activeCueIdx}
        />
      ) : (
        <AITutor
          webSearchEnabled={webSearchEnabled}
          setWebSearchEnabled={setWebSearchEnabled}
          clearChatHistory={clearChatHistory}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          availableModels={availableModels}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          viewMode={viewMode}
          submissionSummaries={submissionSummaries}
          cleanSubmissionFallback={cleanSubmissionFallback}
          handleCueClick={handleCueClick}
          copiedPromptId={copiedPromptId}
          copyUserPrompt={copyUserPrompt}
          copiedSubmissionId={copiedSubmissionId}
          copySubmissionText={copySubmissionText}
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
