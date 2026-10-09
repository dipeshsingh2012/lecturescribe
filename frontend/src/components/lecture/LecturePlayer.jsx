import React from 'react';
import {
  Box,
  Button,
  Typography,
  Tooltip,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Folder,
  ChevronRight,
  ExternalLink,
  AudioLines
} from 'lucide-react';
import { normalizeCourseSlug } from '../../utils/routing';
import GoogleDriveIcon from '../common/GoogleDriveIcon';
import LectureResourcesShelf from './LectureResourcesShelf';

export default function LecturePlayer({
  activeData,
  activeCourseData,
  selectedCourse,
  setSelectedCourse,
  userLibrary = [],
  effectiveCourses = [],
  setActiveData,
  navigateTo,
  iframeRef,
  copied,
  handleCopyTranscript,
  googleUser,
  openUploadModal,
  openPreviewModal,
  lectureResources = [],
  lectureResourcesLoading,
  handleDeleteResource,
  currentTheme,
  handleGenerateTranscript,
  transcriptionLoading = false,
  transcriptionError = null,
  transcriptionStage = null
}) {
  if (!activeData) return null;

  const driveFolderUrl = (
    activeData.drive_folder_url ||
    activeData.driveFolderUrl ||
    userLibrary?.find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    userLibrary?.find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl ||
    effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    effectiveCourses?.flatMap(c => c.lectures || []).find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl ||
    activeCourseData?.lectures?.find(l => String(l.video_id) === String(activeData.videoId))?.drive_folder_url ||
    activeCourseData?.lectures?.find(l => String(l.video_id) === String(activeData.videoId))?.driveFolderUrl
  );
  const hasTranscript = Array.isArray(activeData.cues) &&
    activeData.cues.some((cue) => String(cue?.text || '').trim());
  const [videoCollapsed, setVideoCollapsed] = React.useState(false);

  return (
    <div className="lecture-player-panel">
      {/* Breadcrumb Navigation */}
      <Box
        component="nav"
        aria-label="Breadcrumbs"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'nowrap',
          overflow: 'hidden',
          minWidth: 0,
          py: 0.5
        }}
      >
        <Tooltip title="All Courses" arrow placement="top" enterDelay={200}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              setSelectedCourse(null);
              setActiveData(null);
              navigateTo('/');
            }}
            startIcon={<Folder size={15} color={currentTheme.palette.primary} />}
            sx={{
              p: 0,
              minWidth: 'auto',
              flexShrink: 0,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.84rem',
              color: currentTheme.palette.textSecondary,
              '&:hover': { color: currentTheme.palette.primary, bgcolor: 'transparent' }
            }}
          >
            Courses
          </Button>
        </Tooltip>

        <ChevronRight size={13} color={currentTheme.palette.textSecondary} style={{ opacity: 0.5, flexShrink: 0 }} />

        {(() => {
          const effectiveCourse = activeCourseData?.course_name || activeData.course_name || selectedCourse || (userLibrary.find(l => l.video_id === activeData.videoId)?.course_name) || 'General Lectures';
          const courseSlug = normalizeCourseSlug(effectiveCourse);
          const displayCourseName = (
            activeCourseData?.course_name ||
            effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === courseSlug)?.course_name ||
            (effectiveCourse.includes('-') && effectiveCourse === effectiveCourse.toLowerCase()
              ? effectiveCourse.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
              : effectiveCourse)
          );
          return (
            <Tooltip title={displayCourseName} arrow placement="top" enterDelay={150}>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setSelectedCourse(displayCourseName);
                  setActiveData(null);
                  navigateTo(`/course/${courseSlug}`);
                }}
                sx={{
                  p: 0,
                  minWidth: 0,
                  maxWidth: { xs: 130, sm: 200, md: 280 },
                  flexShrink: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  color: currentTheme.palette.primary,
                  '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' }
                }}
              >
                <Box
                  component="span"
                  sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                    maxWidth: '100%'
                  }}
                >
                  {displayCourseName}
                </Box>
              </Button>
            </Tooltip>
          );
        })()}

        <ChevronRight size={13} color={currentTheme.palette.textSecondary} style={{ opacity: 0.5, flexShrink: 0 }} />

        <Tooltip title={activeData.title} arrow placement="top" enterDelay={150}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              fontSize: '0.84rem',
              color: currentTheme.palette.textPrimary,
              minWidth: 0,
              flexShrink: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'default'
            }}
          >
            {activeData.title}
          </Typography>
        </Tooltip>
      </Box>

      {/* Video Player (GCS Native Video or Vimeo Embed Fallback) */}
      <Box
        sx={{
          display: { xs: videoCollapsed ? 'none' : 'block', md: 'block' },
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#000',
          borderRadius: '12px',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          border: '1px solid var(--border-color)',
          flexShrink: 0
        }}
      >
        {(activeData.gcs_video_url || activeData.gcsVideoUrl) ? (
          <video
            ref={iframeRef}
            src={activeData.gcs_video_url || activeData.gcsVideoUrl}
            controls
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, objectFit: 'contain' }}
            title={activeData.title}
          >
            {(activeData.captions_vtt_url || activeData.captionsUrl) && (
              <track
                kind="subtitles"
                src={activeData.captions_vtt_url || activeData.captionsUrl}
                srcLang="en"
                label="English"
                default
              />
            )}
            Your browser does not support the video tag.
          </video>
        ) : (
          <iframe
            ref={iframeRef}
            src={`https://player.vimeo.com/video/${activeData.videoId}?api=1&autoplay=0&title=0&byline=0&portrait=0`}
            width="100%"
            height="100%"
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title={activeData.title}
            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
          ></iframe>
        )}
      </Box>

      {/* Minimized Video Bar on Mobile */}
      {videoCollapsed && (
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: 'var(--card-bg)',
            p: 1,
            px: 1.5,
            borderRadius: 2,
            border: '1px solid var(--border-color)'
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
            Video player minimized
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setVideoCollapsed(false)}
            sx={{ textTransform: 'none', py: 0.2, px: 1, fontSize: '0.72rem' }}
          >
            Show Video
          </Button>
        </Box>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <h1 className="lecture-title">
          {activeData.title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => setVideoCollapsed(prev => !prev)}
            sx={{
              display: { xs: 'inline-flex', md: 'none' },
              textTransform: 'none',
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              py: 0.2,
              px: 0.8
            }}
          >
            {videoCollapsed ? 'Show Video' : 'Minimize Video'}
          </Button>
          {(activeData.gcs_video_url || activeData.gcsVideoUrl) && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '16px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#16a34a',
                fontSize: '0.78rem',
                fontWeight: 600,
                flexShrink: 0
              }}
              title="Streaming high-speed video directly from Google Cloud Storage"
            >
              <span>● Cloud Storage Video</span>
            </span>
          )}
          {driveFolderUrl && (
            <a
              href={driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Saved in Google Drive"
              title="Open lecture bundle in Google Drive"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '16px',
                background: 'var(--highlight-bg)',
                border: '1px solid var(--badge-border)',
                color: 'var(--theme-primary)',
                fontSize: '0.78rem',
                fontWeight: 600,
                textDecoration: 'none',
                flexShrink: 0,
                transition: 'all 0.2s ease'
              }}
            >
              <GoogleDriveIcon size={15} />
              <span>Saved in Drive</span>
              <ExternalLink size={12} style={{ opacity: 0.8 }} />
            </a>
          )}
        </div>
      </div>

      {!hasTranscript && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <Button
            variant="contained"
            onClick={handleGenerateTranscript}
            disabled={!handleGenerateTranscript || transcriptionLoading}
            startIcon={transcriptionLoading
              ? <CircularProgress size={16} color="inherit" />
              : <AudioLines size={17} />}
          >
            {transcriptionLoading ? 'Generating transcript…' : 'Generate transcript'}
          </Button>
          {transcriptionError && (
            <Alert severity="error" role="alert">{transcriptionError}</Alert>
          )}
          {transcriptionLoading && (
            <Alert severity="info" role="status">
              {transcriptionStage === 'queued' || transcriptionStage === 'starting'
                ? 'Transcript job queued. Waiting for a worker…'
                : transcriptionStage === 'indexing'
                  ? 'Transcript saved. Updating lecture search and tutor data…'
                  : 'Generating transcript…'}
            </Alert>
          )}
        </Box>
      )}

      {/* Lecture Resources Shelf */}
      <div className="desktop-only-shelf">
        <LectureResourcesShelf
          lectureResources={lectureResources}
          lectureResourcesLoading={lectureResourcesLoading}
          googleUser={googleUser}
          handleDeleteResource={handleDeleteResource}
          activeData={activeData}
          activeCourseData={activeCourseData}
          selectedCourse={selectedCourse}
          openPreviewModal={openPreviewModal}
          openUploadModal={openUploadModal}
        />
      </div>
    </div>
  );
}
