import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LecturePlayer from '../LecturePlayer';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('LecturePlayer', () => {
  it('returns null if activeData is not present', () => {
    const { container } = render(
      <LecturePlayer
        activeData={null}
        currentTheme={mockTheme}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders video player, title, and upload button', () => {
    const handleCopyTranscript = vi.fn();
    const openUploadModal = vi.fn();
    const activeData = {
      videoId: '556677',
      title: 'Deep Learning Foundations',
      course_name: 'CS229',
      duration: '45:00',
      total_cues: 120
    };

    render(
      <LecturePlayer
        activeData={activeData}
        activeCourseData={{ course_name: 'CS229' }}
        selectedCourse="CS229"
        setSelectedCourse={vi.fn()}
        userLibrary={[]}
        effectiveCourses={[]}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        iframeRef={{ current: null }}
        copied={false}
        handleCopyTranscript={handleCopyTranscript}
        googleUser={{ email: 'student@example.com' }}
        openUploadModal={openUploadModal}
        lectureResources={[]}
        lectureResourcesLoading={false}
        handleDeleteResource={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getAllByText('Deep Learning Foundations')[0]).toBeInTheDocument();
    expect(screen.getByText('CS229')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy Transcript/i })).toBeNull();

    const uploadBtn = screen.getByRole('button', { name: /Upload Resource/i });
    expect(uploadBtn).toBeInTheDocument();
    fireEvent.click(uploadBtn);
    expect(openUploadModal).toHaveBeenCalledWith({
      videoId: '556677',
      courseName: 'CS229'
    });

    expect(screen.queryByText(/Cached \(0ms Re-generation\)/i)).toBeNull();
    expect(screen.queryByText(/Database Cache/i)).toBeNull();
    expect(screen.queryByText(/Instant Search/i)).toBeNull();
    expect(screen.queryByText(/Saved in Drive/i)).toBeNull();
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders "Saved in Drive" badge linking to Google Drive when drive_folder_url is present', () => {
    const activeData = {
      videoId: '556677',
      title: 'Deep Learning Foundations',
      course_name: 'CS229',
      duration: '45:00',
      total_cues: 120,
      drive_folder_url: 'https://drive.google.com/drive/folders/folder-xyz'
    };

    render(
      <LecturePlayer
        activeData={activeData}
        activeCourseData={{ course_name: 'CS229' }}
        selectedCourse="CS229"
        setSelectedCourse={vi.fn()}
        userLibrary={[]}
        effectiveCourses={[]}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        iframeRef={{ current: null }}
        copied={false}
        handleCopyTranscript={vi.fn()}
        googleUser={{ email: 'student@example.com' }}
        openUploadModal={vi.fn()}
        lectureResources={[]}
        lectureResourcesLoading={false}
        handleDeleteResource={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const driveBadge = screen.getByRole('link', { name: /Saved in Google Drive/i });
    expect(driveBadge).toBeInTheDocument();
    expect(driveBadge).toHaveAttribute('href', 'https://drive.google.com/drive/folders/folder-xyz');
    expect(driveBadge).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Saved in Drive')).toBeInTheDocument();
  });

  it('offers transcript generation when the lecture has no transcript', () => {
    const handleGenerateTranscript = vi.fn();
    render(
      <LecturePlayer
        activeData={{ videoId: '123', title: 'No Captions', cues: [], transcript_available: false }}
        setSelectedCourse={vi.fn()}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        currentTheme={mockTheme}
        handleGenerateTranscript={handleGenerateTranscript}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Generate transcript/i }));
    expect(handleGenerateTranscript).toHaveBeenCalledOnce();
  });

  it('hides transcript generation when cues are already available', () => {
    render(
      <LecturePlayer
        activeData={{ videoId: '123', title: 'Has Captions', cues: [{ time: '00:00', text: 'Hello' }] }}
        setSelectedCourse={vi.fn()}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        currentTheme={mockTheme}
        handleGenerateTranscript={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /Generate transcript/i })).toBeNull();
  });

  it('renders breadcrumb with hovers and truncated styles for long course and lecture names', () => {
    const longData = {
      videoId: '998877',
      title: 'Applied Mathematics for Data Science and AI – Live Session 5 (30 / 9 / 2026)',
      course_name: 'Applied Mathematics for Data Science and AI',
      duration: '1:30:00',
      total_cues: 200
    };

    render(
      <LecturePlayer
        activeData={longData}
        activeCourseData={{ course_name: 'Applied Mathematics for Data Science and AI' }}
        selectedCourse="Applied Mathematics for Data Science and AI"
        setSelectedCourse={vi.fn()}
        userLibrary={[]}
        effectiveCourses={[]}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        iframeRef={{ current: null }}
        copied={false}
        handleCopyTranscript={vi.fn()}
        googleUser={null}
        openUploadModal={vi.fn()}
        lectureResources={[]}
        lectureResourcesLoading={false}
        handleDeleteResource={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const breadcrumbs = screen.getByRole('navigation', { name: /Breadcrumbs/i });
    expect(breadcrumbs).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Courses/i })).toBeInTheDocument();

    const courseBtn = screen.getByRole('button', { name: /Applied Mathematics for Data Science and AI/i });
    expect(courseBtn).toBeInTheDocument();
    expect(courseBtn).toHaveAttribute('aria-label', 'Applied Mathematics for Data Science and AI');

    const lectureTitle = within(breadcrumbs).getByText('Applied Mathematics for Data Science and AI – Live Session 5 (30 / 9 / 2026)');
    expect(lectureTitle).toBeInTheDocument();
    expect(lectureTitle).toHaveAttribute('aria-label', 'Applied Mathematics for Data Science and AI – Live Session 5 (30 / 9 / 2026)');
  });

  it('renders native video tag and "Cloud Storage Video" badge when gcs_video_url is present', () => {
    const activeData = {
      videoId: '1234158181',
      title: 'Introduction to AI in Healthcare Live session -3',
      course_name: 'Introduction to AI in Healthcare',
      duration: '1:00:00',
      total_cues: 50,
      cues: [{ time: '00:00', text: 'Welcome' }],
      gcs_video_url: 'https://storage.googleapis.com/lecturescribe-resources/video.mp4',
      captions_vtt_url: 'https://storage.googleapis.com/lecturescribe-resources/captions.vtt'
    };

    render(
      <LecturePlayer
        activeData={activeData}
        activeCourseData={{ course_name: 'Introduction to AI in Healthcare' }}
        selectedCourse="Introduction to AI in Healthcare"
        setSelectedCourse={vi.fn()}
        userLibrary={[]}
        effectiveCourses={[]}
        setActiveData={vi.fn()}
        navigateTo={vi.fn()}
        iframeRef={{ current: null }}
        copied={false}
        handleCopyTranscript={vi.fn()}
        googleUser={null}
        openUploadModal={vi.fn()}
        lectureResources={[]}
        lectureResourcesLoading={false}
        handleDeleteResource={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    // Verify Cloud Storage Video badge is rendered
    expect(screen.getByText(/Cloud Storage Video/i)).toBeInTheDocument();

    // Verify video tag is rendered instead of iframe
    const videoEl = document.querySelector('video');
    expect(videoEl).toBeInTheDocument();
    expect(videoEl).toHaveAttribute('src', 'https://storage.googleapis.com/lecturescribe-resources/video.mp4');

    const trackEl = document.querySelector('track');
    expect(trackEl).toBeInTheDocument();
    expect(trackEl).toHaveAttribute('src', 'https://storage.googleapis.com/lecturescribe-resources/captions.vtt');

    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders custom player controls with skip buttons, playback speed, and volume', () => {
    const activeData = {
      videoId: '1234158181',
      title: 'AI in Healthcare',
      course_name: 'AI in Healthcare',
      duration: '45:00',
      total_cues: 10,
      cues: [{ time: '00:00', text: 'Welcome' }],
      gcs_video_url: 'https://storage.googleapis.com/lecturescribe-resources/video.mp4',
      captions_vtt_url: 'https://storage.googleapis.com/lecturescribe-resources/captions.vtt'
    };

    render(
      <LecturePlayer
        activeData={activeData}
        currentTheme={mockTheme}
        iframeRef={{ current: document.createElement('video') }}
      />
    );

    // Play button & big center play button
    expect(screen.getByRole('button', { name: /Play Video/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Play$/i })).toBeInTheDocument();

    // Skip backward / forward 10s buttons
    expect(screen.getByRole('button', { name: /Rewind 10 seconds/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fast forward 10 seconds/i })).toBeInTheDocument();

    // Timeline Scrubber
    expect(screen.getByRole('slider', { name: /Video scrubber timeline/i })).toBeInTheDocument();

    // Playback Speed button
    const speedBtn = screen.getByRole('button', { name: /Playback speed/i });
    expect(speedBtn).toBeInTheDocument();
    expect(speedBtn).toHaveTextContent('1x');

    // Subtitles and Fullscreen buttons
    expect(screen.getByRole('button', { name: /Disable Subtitles/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fullscreen/i })).toBeInTheDocument();
  });
});

