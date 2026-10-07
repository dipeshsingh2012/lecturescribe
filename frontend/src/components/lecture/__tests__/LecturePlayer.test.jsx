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

  it('renders video iframe, title, and upload button', () => {
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
});
