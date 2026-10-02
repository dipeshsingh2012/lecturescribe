import React, { useState, useEffect, useMemo } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { useThemeStore, LMS_THEMES, applyThemeCssVariables, createAppMuiTheme } from './store/themeStore';
import { cleanSubmissionFallback } from './utils/formatters';
import { parsePathRoute, normalizeCourseSlug } from './utils/routing';

import { useGoogleAuth } from './hooks/useGoogleAuth';
import { useUserLibrary } from './hooks/useUserLibrary';
import { useCourseDetail } from './hooks/useCourseDetail';
import { useResources } from './hooks/useResources';
import { useAITutor } from './hooks/useAITutor';
import { useLecturePlayer } from './hooks/useLecturePlayer';
import { useLectureIngestion } from './hooks/useLectureIngestion';

import Header from './components/layout/Header';
import HomeView from './components/views/HomeView';
import LectureWorkspace from './components/views/LectureWorkspace';
import LoadingView from './components/views/LoadingView';
import DownloadModal from './components/modals/DownloadModal';
import UploadResourceModal from './components/modals/UploadResourceModal';
import ResourcePreviewModal from './components/modals/ResourcePreviewModal';

export default function App() {
  const [activeTab, setActiveTabState] = useState(() => {
    if (typeof window !== 'undefined') {
      const tabParam = new URLSearchParams(window.location.search).get('tab');
      if (tabParam === 'tutor' || tabParam === 'transcript') return tabParam;
    }
    return 'transcript';
  });

  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        if (tab === 'transcript') url.searchParams.delete('tab');
        else url.searchParams.set('tab', tab);
        window.history.replaceState({}, '', url.pathname + (url.search || ''));
      } catch (e) {
        console.warn("Tab URL update warning:", e);
      }
    }
  };

  const [userMenuAnchor, setUserMenuAnchor] = useState(null);
  const [, setCurrentPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname || '/' : '/'));

  const navigateTo = (path, replace = false) => {
    try {
      if (typeof window !== 'undefined') {
        const currentFull = window.location.pathname + window.location.search;
        if (currentFull !== path) {
          if (replace) window.history.replaceState({}, '', path);
          else window.history.pushState({}, '', path);
        }
      }
    } catch (e) {
      console.warn("Navigation history warning:", e);
    }
    setCurrentPath(path);
  };

  // 1. Core State & Domain Hooks
  const [activeLectureRef, setActiveLectureRef] = useState(null);
  const auth = useGoogleAuth(activeLectureRef, (email, job) => {
    library.fetchUserLibrary(email);
    if (job?.folder_url) {
      lecture.setActiveData((prev) => (prev ? { ...prev, drive_folder_url: job.folder_url } : prev));
    }
  });
  const library = useUserLibrary(auth.googleUser?.email);
  const course = useCourseDetail(library.effectiveCourses, auth.googleUser?.email, library.librarySearch, null);
  const { selectedCourse, setSelectedCourse, setDirectCourseData } = course;

  const lecture = useLectureIngestion({
    userEmail: auth.googleUser?.email,
    selectedCourse,
    setSelectedCourse,
    activeCourseData: course.activeCourseData,
    effectiveCourses: library.effectiveCourses,
    fetchUserLibrary: library.fetchUserLibrary,
    navigateTo,
    initChatMessages: (t, v) => tutor.initChatMessages(t, v)
  });
  const { activeData, setActiveData, loading, error, cacheNotice, setCacheNotice, urlInput, setUrlInput, handleTranscribe, handlePasteUrl } = lecture;

  useEffect(() => {
    setActiveLectureRef(activeData);
  }, [activeData]);

  const resources = useResources(activeData?.videoId, selectedCourse, auth.googleUser);
  const tutor = useAITutor(activeData, auth.googleUser);
  const player = useLecturePlayer(activeData);

  // Hub / Route Navigation
  const handleBackToHub = () => {
    navigateTo(selectedCourse ? `/course/${normalizeCourseSlug(selectedCourse)}` : '/');
    setActiveData(null);
    lecture.setError(null);
    setCacheNotice(null);
  };

  const handleSelectCourse = (name) => {
    if (!name) return;
    setSelectedCourse(name);
    navigateTo(`/course/${normalizeCourseSlug(name)}`);
  };

  const handleClearCourse = () => {
    setSelectedCourse(null);
    setDirectCourseData(null);
    navigateTo('/');
  };

  // Browser Navigation & Initial Route
  useEffect(() => {
    const initial = window.location.pathname || '/';
    const { courseName: initialCourse, videoId: initialVidId } = parsePathRoute(initial);
    if (initialCourse) setSelectedCourse(initialCourse);
    if (initialVidId) handleTranscribe(`https://vimeo.com/${initialVidId}`, false, initialCourse);

    const onPopState = () => {
      const current = window.location.pathname || '/';
      setCurrentPath(current);
      const { courseName, videoId } = parsePathRoute(current);
      setSelectedCourse(courseName);

      if (typeof window !== 'undefined') {
        const tabParam = new URLSearchParams(window.location.search).get('tab');
        setActiveTabState(tabParam === 'tutor' ? 'tutor' : 'transcript');
      }

      if (videoId) {
        if (lecture.activeDataRef.current?.videoId !== videoId) {
          handleTranscribe(`https://vimeo.com/${videoId}`, false, courseName);
        }
      } else {
        setActiveData(null);
        lecture.setError(null);
        setCacheNotice(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // When user is on or switches to AI Tutor tab, ensure chat history / autopopulate runs if empty
  useEffect(() => {
    if (activeTab === 'tutor' && activeData?.videoId && tutor.chatMessages.length === 0 && !tutor.chatLoading) {
      tutor.fetchChatHistory(activeData.videoId, auth.googleUser?.email);
    }
  }, [activeTab, activeData?.videoId]);

  // Theme Management
  const { currentThemeId, setTheme } = useThemeStore();
  const currentTheme = LMS_THEMES[currentThemeId] || LMS_THEMES.academic;

  useEffect(() => {
    applyThemeCssVariables(currentTheme);
  }, [currentThemeId, currentTheme]);

  const muiTheme = useMemo(() => createAppMuiTheme(currentTheme), [currentTheme]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', color: 'var(--text-primary)' }}>
        <Header
          activeData={activeData}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          openDownloadModal={() => auth.openDownloadModal(activeData)}
          googleUser={auth.googleUser}
          handleGoogleSignIn={auth.handleGoogleSignIn}
          handleGoogleSignOut={auth.handleGoogleSignOut}
          handleBackToHub={handleBackToHub}
          userLibrary={library.userLibrary}
          userMenuAnchor={userMenuAnchor}
          setUserMenuAnchor={setUserMenuAnchor}
          currentThemeId={currentThemeId}
          setTheme={setTheme}
          currentTheme={currentTheme}
        />

        {loading && !activeData ? (
          <LoadingView currentTheme={currentTheme} />
        ) : !activeData ? (
          <HomeView
            selectedCourse={selectedCourse}
            googleUser={auth.googleUser}
            userLibrary={library.userLibrary}
            handleGoogleSignIn={auth.handleGoogleSignIn}
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            setCacheNotice={setCacheNotice}
            cacheNotice={cacheNotice}
            handlePasteUrl={handlePasteUrl}
            handleTranscribe={handleTranscribe}
            loading={loading}
            error={error}
            handleClearCourse={handleClearCourse}
            activeCourseData={course.activeCourseData}
            filteredCourseLectures={course.filteredCourseLectures}
            filteredCourses={library.filteredCourses}
            fetchUserLibrary={library.fetchUserLibrary}
            libraryLoading={library.libraryLoading}
            librarySearch={library.librarySearch}
            setLibrarySearch={library.setLibrarySearch}
            courseViewTab={resources.courseViewTab}
            setCourseViewTab={resources.setCourseViewTab}
            courseResources={resources.courseResources}
            openUploadModal={resources.openUploadModal}
            openPreviewModal={resources.openPreviewModal}
            handleSelectCourse={handleSelectCourse}
            courseResourcesLoading={resources.courseResourcesLoading}
            handleDeleteResource={resources.handleDeleteResource}
            courseLoading={course.courseLoading}
            handleDeleteFromLibrary={library.handleDeleteFromLibrary}
            currentTheme={currentTheme}
          />
        ) : (
          <LectureWorkspace
            activeData={activeData}
            activeCourseData={course.activeCourseData}
            selectedCourse={selectedCourse}
            setSelectedCourse={setSelectedCourse}
            userLibrary={library.userLibrary}
            effectiveCourses={library.effectiveCourses}
            setActiveData={setActiveData}
            navigateTo={navigateTo}
            handleTranscribe={handleTranscribe}
            iframeRef={player.iframeRef}
            copied={player.copied}
            handleCopyTranscript={player.handleCopyTranscript}
            googleUser={auth.googleUser}
            openUploadModal={resources.openUploadModal}
            openPreviewModal={resources.openPreviewModal}
            lectureResources={resources.lectureResources}
            lectureResourcesLoading={resources.lectureResourcesLoading}
            handleDeleteResource={resources.handleDeleteResource}
            activeTab={activeTab}
            displayCues={player.displayCues}
            searchQuery={player.searchQuery}
            setSearchQuery={player.setSearchQuery}
            handleCueClick={player.handleCueClick}
            activeCueIdx={player.activeCueIdx}
            webSearchEnabled={tutor.webSearchEnabled}
            setWebSearchEnabled={tutor.setWebSearchEnabled}
            clearChatHistory={tutor.clearChatHistory}
            deleteChatMessage={tutor.deleteChatMessage}
            chatMessages={tutor.chatMessages}
            setChatMessages={tutor.setChatMessages}
            viewMode={tutor.viewMode}
            submissionSummaries={tutor.submissionSummaries}
            cleanSubmissionFallback={cleanSubmissionFallback}
            copiedPromptId={tutor.copiedPromptId}
            copyUserPrompt={tutor.copyUserPrompt}
            copiedSubmissionId={tutor.copiedSubmissionId}
            copySubmissionText={tutor.copySubmissionText}
            copiedResponseId={tutor.copiedResponseId}
            copyBotResponse={tutor.copyBotResponse}
            regenerateResponse={tutor.regenerateResponse}
            regeneratingId={tutor.regeneratingId}
            chatLoading={tutor.chatLoading}
            chatInput={tutor.chatInput}
            setChatInput={tutor.setChatInput}
            chatInputRef={tutor.chatInputRef}
            chatEndRef={tutor.chatEndRef}
            handleSendMessage={tutor.handleSendMessage}
            currentTheme={currentTheme}
          />
        )}

        <DownloadModal
          open={auth.isDownloadModalOpen}
          onClose={auth.closeDownloadModal}
          activeData={activeData}
          userLibrary={library.userLibrary}
          effectiveCourses={library.effectiveCourses}
          {...auth}
        />

        <UploadResourceModal
          open={resources.uploadModalOpen}
          onClose={() => resources.setUploadModalOpen(false)}
          {...resources}
        />

        <ResourcePreviewModal
          open={Boolean(resources.previewResource)}
          onClose={resources.closePreviewModal}
          resource={resources.previewResource}
        />
      </div>
    </ThemeProvider>
  );
}