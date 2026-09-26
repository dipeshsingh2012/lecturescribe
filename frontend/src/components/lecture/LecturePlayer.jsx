import React from 'react';
import {
  Box,
  Button,
  Typography,
  Tooltip
} from '@mui/material';
import {
  Folder,
  ChevronRight,
  Check,
  Database,
  Zap,
  Bot,
  Copy,
  Upload
} from 'lucide-react';
import { normalizeCourseSlug } from '../../utils/routing';
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
  lectureResources = [],
  lectureResourcesLoading,
  handleDeleteResource,
  currentTheme
}) {
  if (!activeData) return null;

  return (
    <div style={{
      flex: '1.2',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      overflowY: 'auto',
      borderRight: '1px solid var(--border-color)'
    }}>
      {/* Breadcrumb Navigation */}
      <Box
        component="nav"
        aria-label="Breadcrumbs"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          py: 0.5
        }}
      >
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
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.84rem',
            color: currentTheme.palette.textSecondary,
            '&:hover': { color: currentTheme.palette.primary, bgcolor: 'transparent' }
          }}
        >
          Courses
        </Button>

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
                minWidth: 'auto',
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.84rem',
                color: currentTheme.palette.primary,
                maxWidth: { xs: 160, sm: 240 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' }
              }}
              title={`Back to course: ${displayCourseName}`}
            >
              {displayCourseName}
            </Button>
          );
        })()}

        <ChevronRight size={13} color={currentTheme.palette.textSecondary} style={{ opacity: 0.5, flexShrink: 0 }} />

        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            fontSize: '0.84rem',
            color: currentTheme.palette.textPrimary,
            maxWidth: { xs: 160, sm: 260, md: 360 },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={activeData.title}
        >
          {activeData.title}
        </Typography>
      </Box>

      {/* Embedded Vimeo Player */}
      <div style={{
        width: '100%',
        aspectRatio: '16 / 9',
        background: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        border: '1px solid var(--border-color)'
      }}>
        <iframe
          ref={iframeRef}
          src={`https://player.vimeo.com/video/${activeData.videoId}?autoplay=0&title=0&byline=0&portrait=0`}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title={activeData.title}
          style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
        ></iframe>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.3 }}>{activeData.title}</h1>
          {activeData.cached && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              <Check size={12} /> Cached (0ms Re-generation)
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Database size={12} color="var(--theme-primary)" /> {activeData.cached ? 'Database Cache (Reused)' : 'Cloud Database'}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} color="#10b981" /> Instant Search</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Bot size={12} color="#8b5cf6" /> AI Tutor</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          onClick={handleCopyTranscript}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            background: 'var(--card-bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            padding: '10px 14px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.85rem'
          }}
        >
          {copied ? <Check size={16} color="var(--theme-primary)" /> : <Copy size={16} />}
          {copied ? 'Copied Transcript!' : 'Copy Transcript'}
        </button>

        <Tooltip title={!googleUser ? "Sign in with Google to upload resources" : "Upload lecture notes, slides, or links"}>
          <span>
            <button
              onClick={() => {
                if (!googleUser) return;
                openUploadModal({
                  courseName: activeCourseData?.course_name || selectedCourse || activeData?.course_name || 'General Lectures',
                  videoId: activeData.videoId
                });
              }}
              disabled={!googleUser}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: googleUser ? 'var(--card-bg)' : 'rgba(255, 255, 255, 0.04)',
                color: googleUser ? 'var(--theme-primary)' : 'var(--text-secondary)',
                border: googleUser ? '1px solid var(--theme-primary)' : '1px solid var(--border-color)',
                padding: '10px 14px',
                borderRadius: '8px',
                cursor: googleUser ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                fontSize: '0.85rem',
                opacity: googleUser ? 1 : 0.6,
                whiteSpace: 'nowrap'
              }}
            >
              <Upload size={16} />
              Upload Resource
            </button>
          </span>
        </Tooltip>
      </div>

      {/* Lecture Resources Shelf */}
      <LectureResourcesShelf
        lectureResources={lectureResources}
        lectureResourcesLoading={lectureResourcesLoading}
        googleUser={googleUser}
        handleDeleteResource={handleDeleteResource}
        activeData={activeData}
        selectedCourse={selectedCourse}
      />
    </div>
  );
}
