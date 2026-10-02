import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
