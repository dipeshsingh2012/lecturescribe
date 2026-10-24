import React, { useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Menu,
  MenuItem
} from '@mui/material';
import {
  ArrowLeft,
  Search,
  RefreshCw,
  AlertCircle,
  Video,
  Paperclip,
  BookOpen,
  Upload,
  Award,
  Sparkles,
  Check,
  Plus,
  ChevronDown,
  FileText,
  FileCode
} from 'lucide-react';

import HeroBanner from '../home/HeroBanner';
import QuickAddBar from '../home/QuickAddBar';
import CourseGrid from '../course/CourseGrid';
import CourseLibrary from '../course/CourseLibrary';
import CourseLectures from '../course/CourseLectures';
import CourseQuiz from '../course/CourseQuiz';
import CourseTutor from '../course/CourseTutor';
import CourseSummary from '../course/CourseSummary';
import CourseAssignments from '../course/CourseAssignments';
import CalendarAlertCard from '../calendar/CalendarAlertCard';
import QuizRemindersCard from '../home/QuizRemindersCard';
import useCourseQuiz from '../../hooks/useCourseQuiz';
import { useCourseTutor } from '../../hooks/useCourseTutor';
import { useCourseAssignments } from '../../hooks/useCourseAssignments';
import useCourseSummary from '../../hooks/useCourseSummary';

export default function HomeView({
  selectedCourse,
  googleUser,
  userLibrary,
  handleGoogleSignIn,
  urlInput,
  setUrlInput,
  setCacheNotice,
  cacheNotice,
  handlePasteUrl,
  handleTranscribe,
  handleCueClick,
  loading,
  error,
  handleClearCourse,
  activeCourseData,
  filteredCourseLectures,
  lectureSortBy,
  setLectureSortBy,
  lectureStatusFilter,
  setLectureStatusFilter,
  sortBy,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  filteredCourses,
  fetchUserLibrary,
  libraryLoading,
  librarySearch,
  setLibrarySearch,
  courseViewTab,
  setCourseViewTab,
  courseResources = [],
  courseReadings = [],
  courseReadingsLoading = false,
  isExtractingReadings = false,
  triggerExtractReadings,
  handleRefreshReadingReader,
  handleDeleteCourseReading,
  searchReadingWeb,
  searchLiterature,
  addCourseReading,
  openUploadModal,
  openPreviewModal,
  handleSelectCourse,
  courseResourcesLoading,
  handleDeleteResource,
  courseLoading,
  handleDeleteFromLibrary,
  handleDeleteCourse,
  handleTogglePin,
  courseNotes = [],
  courseNotesLoading = false,
  onCreateNewNote,
  onOpenNote,
  onDeleteNote,
  currentTheme
}) {
  const [newMenuAnchor, setNewMenuAnchor] = React.useState(null);

  const courseQuiz = useCourseQuiz(
    activeCourseData?.course_name || selectedCourse,
    googleUser?.email
  );

  const courseTutor = useCourseTutor(
    activeCourseData?.course_name || selectedCourse,
    googleUser?.email
  );

  const courseAssignments = useCourseAssignments(
    activeCourseData?.course_name || selectedCourse,
    googleUser?.email
  );

  const courseSummary = useCourseSummary(
    activeCourseData?.course_name || selectedCourse
  );

  // Automatically fetch course quiz if user is on the Course Quiz tab and no quiz is loaded yet
  useEffect(() => {
    if (courseViewTab === 'quiz' && selectedCourse && !courseQuiz.quizData && !courseQuiz.quizLoading && !courseQuiz.quizError) {
      courseQuiz.fetchOrGenerateQuiz(false);
    }
  }, [courseViewTab, selectedCourse, courseQuiz.quizData, courseQuiz.quizLoading, courseQuiz.quizError, courseQuiz.fetchOrGenerateQuiz]);

  // Automatically fetch course summary if user is on Course Summary tab and no summary loaded yet
  useEffect(() => {
    if (
      courseViewTab === 'summary' &&
      selectedCourse &&
      !courseSummary.summaryData &&
      !courseSummary.loading &&
      !courseSummary.error &&
      !courseSummary.hasFetched
    ) {
      courseSummary.fetchSummary(false);
    }
  }, [
    courseViewTab,
    selectedCourse,
    courseSummary.summaryData,
    courseSummary.loading,
    courseSummary.error,
    courseSummary.hasFetched,
    courseSummary.fetchSummary
  ]);

  return (
    <Box sx={{ maxWidth: '1200px', mx: 'auto', p: { xs: 2.5, md: 4 } }}>
      {!selectedCourse && (
        <HeroBanner
          googleUser={googleUser}
          userLibrary={userLibrary}
          handleGoogleSignIn={handleGoogleSignIn}
          currentTheme={currentTheme}
        />
      )}

      {!googleUser && !selectedCourse && (
        <QuickAddBar
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          setCacheNotice={setCacheNotice}
          handlePasteUrl={handlePasteUrl}
          handleTranscribe={handleTranscribe}
          loading={loading}
          currentTheme={currentTheme}
        />
      )}

      {error && (
        <Box sx={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          color: '#f87171',
          p: 1.5,
          borderRadius: 2,
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          fontSize: '0.9rem'
        }}>
          <AlertCircle size={18} /> {error}
        </Box>
      )}

      {cacheNotice && (
        <Box sx={{
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid #10b981',
          color: '#34d399',
          p: 1.5,
          borderRadius: 2,
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          fontSize: '0.9rem',
          fontWeight: 500
        }}>
          <Check size={18} /> {cacheNotice}
        </Box>
      )}

      {/* Library Header & Search Bar */}
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {selectedCourse ? (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ArrowLeft size={16} />}
                onClick={handleClearCourse}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  borderRadius: 2,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  bgcolor: currentTheme.palette.cardBg,
                  '&:hover': { bgcolor: 'var(--highlight-bg)', borderColor: currentTheme.palette.primary }
                }}
              >
                All Courses
              </Button>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                {activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
              </Typography>
              <Chip
                label={`${filteredCourseLectures.length} ${filteredCourseLectures.length === 1 ? 'lecture' : 'lectures'}`}
                size="small"
                sx={{ bgcolor: currentTheme.palette.badgeBg, color: currentTheme.palette.badgeColor, fontWeight: 700, border: `1px solid ${currentTheme.palette.badgeBorder}` }}
              />
            </>
          ) : (
            <>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                My Courses
              </Typography>
              <Chip
                label={`${filteredCourses.length} ${filteredCourses.length === 1 ? 'course' : 'courses'}`}
                size="small"
                sx={{ bgcolor: currentTheme.palette.badgeBg, color: currentTheme.palette.badgeColor, fontWeight: 700, border: `1px solid ${currentTheme.palette.badgeBorder}` }}
              />
            </>
          )}
          <Tooltip title="Refresh Library">
            <IconButton
              size="small"
              onClick={() => fetchUserLibrary(googleUser?.email)}
              sx={{ color: currentTheme.palette.textSecondary, '&:hover': { color: currentTheme.palette.primary } }}
            >
              <RefreshCw size={15} className={libraryLoading ? 'loading-pulse' : ''} />
            </IconButton>
          </Tooltip>
        </Box>

        <TextField
          size="small"
          placeholder={selectedCourse ? "Search lectures in this course..." : "Search courses or lectures..."}
          value={librarySearch}
          onChange={(e) => setLibrarySearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} color={currentTheme.palette.textSecondary} />
                </InputAdornment>
              ),
              sx: {
                bgcolor: currentTheme.palette.cardBg,
                borderRadius: 2,
                fontSize: '0.85rem',
                color: currentTheme.palette.textPrimary,
                width: { xs: '100%', sm: 280 },
                '& fieldset': { borderColor: currentTheme.palette.cardBorder },
                '&:hover fieldset': { borderColor: currentTheme.palette.primary }
              }
            }
          }}
        />
      </Box>

      {/* Course-level Quick Add Bar */}
      {!googleUser && selectedCourse && (
        <QuickAddBar
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          setCacheNotice={setCacheNotice}
          handlePasteUrl={handlePasteUrl}
          handleTranscribe={(url) => handleTranscribe(url, false, activeCourseData?.course_name || selectedCourse, true)}
          loading={loading}
          currentTheme={currentTheme}
          placeholder={`Add video URL or ID to this course (${activeCourseData?.course_name || selectedCourse})...`}
          buttonLabel="Add to Course"
        />
      )}

      {/* Course View Tabs (Lectures vs Course Quiz vs Course Materials) */}
      {selectedCourse && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant={courseViewTab === 'lectures' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<Video size={15} />}
              onClick={() => setCourseViewTab('lectures')}
              aria-label="Course Lectures"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'lectures'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Lectures ({filteredCourseLectures.length})
            </Button>
            <Button
              variant={courseViewTab === 'summary' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<BookOpen size={15} />}
              onClick={() => setCourseViewTab('summary')}
              aria-label="Course Summary"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'summary'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Course Summary
            </Button>
            <Button
              variant={courseViewTab === 'quiz' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<Award size={15} />}
              onClick={() => setCourseViewTab('quiz')}
              aria-label="Course Quiz"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'quiz'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Course Quiz
            </Button>
            <Button
              variant={courseViewTab === 'tutor' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<Sparkles size={15} />}
              onClick={() => setCourseViewTab('tutor')}
              aria-label="Course AI Tutor"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'tutor'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Course Tutor
            </Button>
            <Button
              variant={courseViewTab === 'resources' || courseViewTab === 'library' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<BookOpen size={15} />}
              onClick={() => setCourseViewTab('library')}
              aria-label="Course Library"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'resources' || courseViewTab === 'library'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Library ({courseResources.length + (courseReadings?.length || 0) + (courseNotes?.length || 0)})
            </Button>
            <Button
              variant={courseViewTab === 'assignments' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<FileCode size={15} />}
              onClick={() => setCourseViewTab('assignments')}
              aria-label="Course Assignments"
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'assignments'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Assignments ({courseAssignments.assignments.length})
            </Button>
          </Box>

          {/* "+ NEW" MINI DROPBOX ACTION BUTTON & MENU */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title={!googleUser ? "Sign in with Google to create notes or upload files" : "Create a new note or upload files"}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  disabled={!googleUser}
                  startIcon={<Plus size={15} />}
                  endIcon={<ChevronDown size={14} />}
                  onClick={(e) => setNewMenuAnchor(e.currentTarget)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    borderRadius: 2,
                    bgcolor: currentTheme.palette.primary,
                    color: '#fff',
                    boxShadow: 'none',
                    '&:hover': { bgcolor: currentTheme.palette.primary, opacity: 0.9 }
                  }}
                >
                  New
                </Button>
              </span>
            </Tooltip>

            <Menu
              anchorEl={newMenuAnchor}
              open={Boolean(newMenuAnchor)}
              onClose={() => setNewMenuAnchor(null)}
              PaperProps={{
                sx: {
                  borderRadius: 2.5,
                  minWidth: 190,
                  bgcolor: currentTheme.palette.cardBg,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  boxShadow: currentTheme.palette.cardShadow
                }
              }}
            >
              <MenuItem
                onClick={() => {
                  setNewMenuAnchor(null);
                  if (onCreateNewNote) onCreateNewNote();
                }}
                sx={{ py: 1.2, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <FileText size={17} color={currentTheme.palette.primary} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                    New Note
                  </Typography>
                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block', fontSize: '0.72rem' }}>
                    Plain text scratchpad
                  </Typography>
                </Box>
              </MenuItem>

              <MenuItem
                onClick={() => {
                  setNewMenuAnchor(null);
                  openUploadModal({
                    courseName: activeCourseData?.course_name || selectedCourse,
                    videoId: null
                  });
                }}
                sx={{ py: 1.2, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Upload size={17} color={currentTheme.palette.primary} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
                    Upload File
                  </Typography>
                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block', fontSize: '0.72rem' }}>
                    Slides (.pptx, .pdf), docs
                  </Typography>
                </Box>
              </MenuItem>
            </Menu>
          </Box>
        </Box>
      )}

      {/* LEVEL 1: COURSE CARDS VIEW & ACADEMIC CALENDAR & PREDICTED QUIZZES */}
      <QuizRemindersCard
        currentTheme={currentTheme}
        onSelectLecture={(vid, ts, cName) => {
          if (!vid) return;
          const targetCourse = cName || activeCourseData?.course_name || selectedCourse || null;
          if (typeof handleTranscribe === 'function') {
            handleTranscribe(vid, true, targetCourse, false, ts);
          }
          if (typeof handleCueClick === 'function' && ts) {
            setTimeout(() => handleCueClick(ts), 350);
          }
        }}
        selectedCourse={selectedCourse}
      />

      {!selectedCourse ? (
        <>
          {googleUser && <CalendarAlertCard currentTheme={currentTheme} googleUser={googleUser} />}
          <CourseGrid
            filteredCourses={filteredCourses}
            handleSelectCourse={handleSelectCourse}
            handleDeleteCourse={handleDeleteCourse}
            handleTogglePin={handleTogglePin}
            librarySearch={librarySearch}
            currentTheme={currentTheme}
          />
        </>
      ) : courseViewTab === 'summary' ? (
        /* LEVEL 2E: COURSE EXECUTIVE SUMMARY */
        <CourseSummary
          courseName={activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
          lectureCount={filteredCourseLectures.length || activeCourseData?.lecture_count || 0}
          summaryData={courseSummary.summaryData}
          loading={courseSummary.loading}
          error={courseSummary.error}
          fetchSummary={courseSummary.fetchSummary}
          regenerateSummary={courseSummary.regenerateSummary}
          handleSelectLecture={(vid, cName, ts) => {
            if (vid) {
              const tParam = ts ? `?t=${encodeURIComponent(ts)}` : '';
              handleTranscribe(`${vid}${tParam}`, false, cName, false, ts);
              if (typeof handleCueClick === 'function' && ts) {
                setTimeout(() => handleCueClick(ts), 350);
              }
            }
          }}
          currentTheme={currentTheme}
        />
      ) : courseViewTab === 'quiz' ? (
        /* LEVEL 2C: COURSE COMPREHENSIVE PRACTICE EXAM */
        <CourseQuiz
          courseName={activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
          lectureCount={filteredCourseLectures.length || activeCourseData?.lecture_count || 0}
          quizData={courseQuiz.quizData}
          quizLoading={courseQuiz.quizLoading}
          quizError={courseQuiz.quizError}
          selectedAnswers={courseQuiz.selectedAnswers}
          isCompleted={courseQuiz.isCompleted}
          score={courseQuiz.score}
          totalQuestions={courseQuiz.totalQuestions}
          answeredCount={courseQuiz.answeredCount}
          lectureBreakdown={courseQuiz.lectureBreakdown}
          fetchOrGenerateQuiz={courseQuiz.fetchOrGenerateQuiz}
          selectAnswer={courseQuiz.selectAnswer}
          clearAnswer={courseQuiz.clearAnswer}
          finishQuiz={courseQuiz.finishQuiz}
          resetQuiz={courseQuiz.resetQuiz}
          detailedExplanations={courseQuiz.detailedExplanations}
          explanationLoading={courseQuiz.explanationLoading}
          expandedExplanation={courseQuiz.expandedExplanation}
          setExpandedExplanation={courseQuiz.setExpandedExplanation}
          fetchDetailedExplanation={courseQuiz.fetchDetailedExplanation}
          quizHistory={courseQuiz.quizHistory}
          historyLoading={courseQuiz.historyLoading}
          fetchQuizHistory={courseQuiz.fetchQuizHistory}
          loadPastQuiz={courseQuiz.loadPastQuiz}
          reviewMode={courseQuiz.reviewMode}
          replayingQuizId={courseQuiz.replayingQuizId}
          exitReplay={courseQuiz.exitReplay}
          timeLeft={courseQuiz.timeLeft}
          setTimeLeft={courseQuiz.setTimeLeft}
          autoSubmitted={courseQuiz.autoSubmitted}
          marksPerQuestion={courseQuiz.marksPerQuestion}
          totalMarks={courseQuiz.totalMarks}
          earnedMarks={courseQuiz.earnedMarks}
          handleSelectLecture={(vid, cName, ts) => {
            const tParam = ts ? `?t=${encodeURIComponent(ts)}` : '';
            handleTranscribe(`${vid}${tParam}`, false, cName, false, ts);
            if (typeof handleCueClick === 'function' && ts) {
              setTimeout(() => handleCueClick(ts), 350);
            }
          }}
          currentTheme={currentTheme}
        />
      ) : courseViewTab === 'tutor' ? (
        /* LEVEL 2D: COURSE-LEVEL AI TUTOR & EXAM PREPARATION */
        <CourseTutor
          courseName={activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
          lectureCount={filteredCourseLectures.length || activeCourseData?.lecture_count || 0}
          messages={courseTutor.messages}
          input={courseTutor.input}
          setInput={courseTutor.setInput}
          loading={courseTutor.loading}
          error={courseTutor.error}
          sendMessage={courseTutor.sendMessage}
          clearHistory={courseTutor.clearHistory}
          deleteMessage={courseTutor.deleteMessage}
          copyText={courseTutor.copyText}
          copiedPromptId={courseTutor.copiedPromptId}
          copiedResponseId={courseTutor.copiedResponseId}
          chatEndRef={courseTutor.chatEndRef}
          chatInputRef={courseTutor.chatInputRef}
          handleSelectLecture={(vid, cName, ts) => handleTranscribe(vid, false, cName)}
          currentTheme={currentTheme}
        />
      ) : (courseViewTab === 'resources' || courseViewTab === 'library') ? (
        /* LEVEL 2B: COURSE LIBRARY & SUPPORTING BOOKS VIEW */
        <CourseLibrary
          courseResourcesLoading={courseResourcesLoading}
          courseResources={courseResources}
          courseReadings={courseReadings}
          courseReadingsLoading={courseReadingsLoading}
          isExtractingReadings={isExtractingReadings}
          triggerExtractReadings={triggerExtractReadings}
          handleRefreshReadingReader={handleRefreshReadingReader}
          handleDeleteCourseReading={handleDeleteCourseReading}
          searchReadingWeb={searchReadingWeb}
          searchLiterature={searchLiterature}
          addCourseReading={addCourseReading}
          googleUser={googleUser}
          userLibrary={userLibrary}
          selectedCourse={selectedCourse}
          activeCourseData={activeCourseData}
          openUploadModal={openUploadModal}
          openPreviewModal={openPreviewModal}
          handleDeleteResource={handleDeleteResource}
          courseNotes={courseNotes}
          courseNotesLoading={courseNotesLoading}
          onCreateNewNote={onCreateNewNote}
          onOpenNote={onOpenNote}
          onDeleteNote={onDeleteNote}
          currentTheme={currentTheme}
        />
      ) : courseViewTab === 'assignments' ? (
        /* LEVEL 2E: COURSE ASSIGNMENT PLANNER & SOLVER */
        <CourseAssignments
          courseName={activeCourseData?.course_name || (selectedCourse && selectedCourse.includes('-') && selectedCourse === selectedCourse.toLowerCase() ? selectedCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : selectedCourse)}
          assignments={courseAssignments.assignments}
          loading={courseAssignments.loading}
          error={courseAssignments.error}
          uploading={courseAssignments.uploading}
          uploadError={courseAssignments.uploadError}
          onUploadAssignment={courseAssignments.uploadAssignment}
          onProvideDataset={courseAssignments.provideDataset}
          onRegenerateAssignment={courseAssignments.regenerateAssignment}
          onDeleteAssignment={courseAssignments.deleteAssignment}
          currentTheme={currentTheme}
        />
      ) : (
        /* LEVEL 2A: INDIVIDUAL LECTURES IN SELECTED COURSE */
        <CourseLectures
          courseLoading={courseLoading}
          filteredCourseLectures={filteredCourseLectures}
          handleTranscribe={handleTranscribe}
          handleDeleteFromLibrary={handleDeleteFromLibrary}
          handleClearCourse={handleClearCourse}
          selectedCourse={selectedCourse}
          librarySearch={librarySearch}
          currentTheme={currentTheme}
          sortBy={lectureSortBy !== undefined ? lectureSortBy : sortBy}
          onSortChange={setLectureSortBy || onSortChange}
          statusFilter={lectureStatusFilter !== undefined ? lectureStatusFilter : statusFilter}
          onStatusFilterChange={setLectureStatusFilter || onStatusFilterChange}
        />
      )}
    </Box>
  );
}
