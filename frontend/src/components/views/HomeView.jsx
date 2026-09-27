import React from 'react';
import {
  Box,
  Button,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  ArrowLeft,
  Search,
  RefreshCw,
  AlertCircle,
  Check,
  Video,
  Paperclip,
  Upload
} from 'lucide-react';

import HeroBanner from '../home/HeroBanner';
import QuickAddBar from '../home/QuickAddBar';
import CourseGrid from '../course/CourseGrid';
import CourseMaterials from '../course/CourseMaterials';
import CourseLectures from '../course/CourseLectures';

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
  loading,
  error,
  handleClearCourse,
  activeCourseData,
  filteredCourseLectures,
  filteredCourses,
  fetchUserLibrary,
  libraryLoading,
  librarySearch,
  setLibrarySearch,
  courseViewTab,
  setCourseViewTab,
  courseResources,
  openUploadModal,
  handleSelectCourse,
  courseResourcesLoading,
  handleDeleteResource,
  courseLoading,
  handleDeleteFromLibrary,
  currentTheme
}) {
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

      {!selectedCourse && (
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

      {/* Course View Tabs (Lectures vs Course Materials) */}
      {selectedCourse && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant={courseViewTab === 'lectures' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<Video size={15} />}
              onClick={() => setCourseViewTab('lectures')}
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
              variant={courseViewTab === 'resources' ? 'contained' : 'outlined'}
              size="small"
              startIcon={<Paperclip size={15} />}
              onClick={() => setCourseViewTab('resources')}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: 2,
                ...(courseViewTab === 'resources'
                  ? { bgcolor: currentTheme.palette.primary, color: '#fff' }
                  : { color: currentTheme.palette.textSecondary, borderColor: currentTheme.palette.cardBorder, bgcolor: currentTheme.palette.cardBg })
              }}
            >
              Course Materials ({courseResources.length})
            </Button>
          </Box>

          <Tooltip title={!googleUser ? "Sign in with Google to upload course resources" : "Upload course-wide slides, syllabus, or notes"}>
            <span>
              <Button
                variant="outlined"
                size="small"
                disabled={!googleUser}
                startIcon={<Upload size={14} />}
                onClick={() => openUploadModal({
                  courseName: activeCourseData?.course_name || selectedCourse,
                  videoId: null
                })}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  borderRadius: 2,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  bgcolor: currentTheme.palette.cardBg,
                  '&:hover': { bgcolor: 'var(--highlight-bg)', borderColor: currentTheme.palette.primary }
                }}
              >
                Add Course Material
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}

      {/* LEVEL 1: COURSE CARDS VIEW */}
      {!selectedCourse ? (
        <CourseGrid
          filteredCourses={filteredCourses}
          handleSelectCourse={handleSelectCourse}
          librarySearch={librarySearch}
          currentTheme={currentTheme}
        />
      ) : courseViewTab === 'resources' ? (
        /* LEVEL 2B: COURSE MATERIALS & RESOURCES VIEW */
        <CourseMaterials
          courseResourcesLoading={courseResourcesLoading}
          courseResources={courseResources}
          googleUser={googleUser}
          userLibrary={userLibrary}
          selectedCourse={selectedCourse}
          activeCourseData={activeCourseData}
          openUploadModal={openUploadModal}
          handleDeleteResource={handleDeleteResource}
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
        />
      )}
    </Box>
  );
}
