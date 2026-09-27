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

  it('renders video iframe, title, copy transcript button, and upload button', () => {
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

    const copyBtn = screen.getByRole('button', { name: /Copy Transcript/i });
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    expect(handleCopyTranscript).toHaveBeenCalledTimes(1);

    const uploadBtn = screen.getByRole('button', { name: /Upload Resource/i });
    expect(uploadBtn).toBeInTheDocument();
    fireEvent.click(uploadBtn);
    expect(openUploadModal).toHaveBeenCalledWith({
      videoId: '556677',
      courseName: 'CS229'
    });
  });
});
