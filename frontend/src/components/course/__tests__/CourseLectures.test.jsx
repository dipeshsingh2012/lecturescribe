import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseLectures from '../CourseLectures';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseLectures', () => {
  it('renders loading state when courseLoading is true', () => {
    render(
      <CourseLectures
        courseLoading={true}
        filteredCourseLectures={[]}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Loading course lectures...')).toBeInTheDocument();
  });

  it('renders empty lecture list state when no lectures exist', () => {
    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={[]}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/No lectures in this course yet/i)).toBeInTheDocument();
  });

  it('renders lecture cards, clicking lecture calls handleTranscribe, and delete button works', () => {
    const handleTranscribe = vi.fn();
    const handleDeleteFromLibrary = vi.fn();
    const lectures = [
      {
        video_id: '998877',
        video_url: 'https://vimeo.com/998877',
        video_title: 'Classical Mechanics Lecture 1',
        total_duration_seconds: 3600,
        cue_count: 50,
        resource_count: 2,
        ingested_at: '2026-09-10T10:00:00Z'
      }
    ];

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={lectures}
        handleTranscribe={handleTranscribe}
        handleDeleteFromLibrary={handleDeleteFromLibrary}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Classical Mechanics Lecture 1')).toBeInTheDocument();

    const studyBtn = screen.getByRole('button', { name: /Study Lecture →/i });
    fireEvent.click(studyBtn);
    expect(handleTranscribe).toHaveBeenCalledWith('https://vimeo.com/998877', true, 'Physics 101');

    const deleteBtn = screen.getByRole('button', { name: /Remove from My Library/i });
    fireEvent.click(deleteBtn);
    expect(handleDeleteFromLibrary).toHaveBeenCalledWith('998877');
  });
});
