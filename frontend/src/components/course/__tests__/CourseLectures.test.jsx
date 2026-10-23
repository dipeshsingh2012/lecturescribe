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
        video_url: 'https://video.lecturescribe.local/998877',
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
    expect(handleTranscribe).toHaveBeenCalledWith('https://video.lecturescribe.local/998877', true, 'Physics 101');

    const deleteBtn = screen.getByRole('button', { name: /Remove from My Library/i });
    fireEvent.click(deleteBtn);
    expect(handleDeleteFromLibrary).toHaveBeenCalledWith('998877');
  });

  it('renders Google Drive badges (header icon, chip, and action button) when drive_folder_url is present', () => {
    const lectures = [
      {
        video_id: '998877',
        video_url: 'https://video.lecturescribe.local/998877',
        video_title: 'Classical Mechanics Lecture 1',
        drive_folder_url: 'https://drive.google.com/drive/folders/test-folder-123',
        total_duration_seconds: 3600,
        cue_count: 50
      }
    ];

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={lectures}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    const chip = screen.getByRole('link', { name: /^In Google Drive$/i });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute('href', 'https://drive.google.com/drive/folders/test-folder-123');
    expect(chip).toHaveAttribute('target', '_blank');

    const actionDriveBtn = screen.getByRole('link', { name: /^Open in Google Drive$/i });
    expect(actionDriveBtn).toBeInTheDocument();
    expect(actionDriveBtn).toHaveAttribute('href', 'https://drive.google.com/drive/folders/test-folder-123');

    const headerDriveBadge = screen.getByRole('link', { name: /^Saved in Google Drive$/i });
    expect(headerDriveBadge).toBeInTheDocument();
    expect(headerDriveBadge).toHaveAttribute('href', 'https://drive.google.com/drive/folders/test-folder-123');
  });

  it('renders progress bar and resume button when playback progress exists', () => {
    const handleTranscribe = vi.fn();
    const lectures = [
      {
        video_id: '998877',
        video_url: 'https://video.lecturescribe.local/998877',
        video_title: 'Classical Mechanics Lecture 1',
        total_duration_seconds: 3600,
        progress: {
          last_timestamp: '24:15',
          last_seconds: 1455,
          duration_seconds: 3600,
          progress_percent: 40.4
        }
      }
    ];

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={lectures}
        handleTranscribe={handleTranscribe}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Resume at 24:15/i)).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();

    const resumeBtn = screen.getByRole('button', { name: /Resume \(24:15\) →/i });
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);
    expect(handleTranscribe).toHaveBeenCalledWith('https://video.lecturescribe.local/998877', true, 'Physics 101');
  });

  it('sorts lectures by title by default and allows sorting and filtering', () => {
    const multiLectures = [
      {
        video_id: 'l10',
        video_title: 'Lecture 10: Advanced Kinematics',
        created_at: '2026-09-01T10:00:00Z',
        progress: { progress_percent: 100 }
      },
      {
        video_id: 'l2',
        video_title: 'Lecture 2: Vectors & Motion',
        created_at: '2026-09-05T10:00:00Z',
        progress: { progress_percent: 35, last_seconds: 300 }
      },
      {
        video_id: 'l1',
        video_title: 'Lecture 1: Course Overview',
        created_at: '2026-09-10T10:00:00Z',
        progress: null
      }
    ];

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={multiLectures}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    // Filter toolbar should be rendered
    expect(screen.getByText(/Filter:/i)).toBeInTheDocument();
    expect(screen.getByText(/Sort by:/i)).toBeInTheDocument();

    // Default sorting must be Title A-Z (Lecture 1, Lecture 2, Lecture 10)
    const titles = screen.getAllByRole('heading', { level: 6 }).map(h => h.textContent);
    expect(titles).toEqual([
      'Lecture 1: Course Overview',
      'Lecture 2: Vectors & Motion',
      'Lecture 10: Advanced Kinematics'
    ]);

    // Click quick sort chip "Title" to toggle direction to Z-A
    const titleSortChip = screen.getByRole('button', { name: /^Sort by Title$/i });
    fireEvent.click(titleSortChip);

    const reversedTitles = screen.getAllByRole('heading', { level: 6 }).map(h => h.textContent);
    expect(reversedTitles).toEqual([
      'Lecture 10: Advanced Kinematics',
      'Lecture 2: Vectors & Motion',
      'Lecture 1: Course Overview'
    ]);

    // Click quick sort chip "Progress"
    const progressSortChip = screen.getByRole('button', { name: /^Sort by Progress$/i });
    fireEvent.click(progressSortChip);

    const progressTitles = screen.getAllByRole('heading', { level: 6 }).map(h => h.textContent);
    expect(progressTitles[0]).toBe('Lecture 10: Advanced Kinematics'); // 100%
    expect(progressTitles[1]).toBe('Lecture 2: Vectors & Motion'); // 35%
    expect(progressTitles[2]).toBe('Lecture 1: Course Overview'); // 0%

    // Filter by "In Progress"
    const inProgressChip = screen.getByRole('button', { name: /^Filter by In Progress$/i });
    fireEvent.click(inProgressChip);

    expect(screen.queryByText('Lecture 10: Advanced Kinematics')).not.toBeInTheDocument();
    expect(screen.queryByText('Lecture 1: Course Overview')).not.toBeInTheDocument();
    expect(screen.getByText('Lecture 2: Vectors & Motion')).toBeInTheDocument();

    // Filter by "Completed"
    const completedChip = screen.getByRole('button', { name: /^Filter by Completed$/i });
    fireEvent.click(completedChip);

    expect(screen.getByText('Lecture 10: Advanced Kinematics')).toBeInTheDocument();
    expect(screen.queryByText('Lecture 2: Vectors & Motion')).not.toBeInTheDocument();

    // Filter back to "All"
    const allChip = screen.getByRole('button', { name: /^Filter by All$/i });
    fireEvent.click(allChip);

    expect(screen.getByText('Lecture 1: Course Overview')).toBeInTheDocument();
    expect(screen.getByText('Lecture 2: Vectors & Motion')).toBeInTheDocument();
    expect(screen.getByText('Lecture 10: Advanced Kinematics')).toBeInTheDocument();
  });

  it('renders empty filtered state and allows resetting to all lectures', () => {
    const uncompletedLectures = [
      {
        video_id: 'l1',
        video_title: 'Lecture 1: Course Overview',
        progress: null
      }
    ];

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={uncompletedLectures}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    // Click Completed filter when no lecture is completed
    const completedChip = screen.getByRole('button', { name: /^Filter by Completed$/i });
    fireEvent.click(completedChip);

    expect(screen.getByText(/No lectures found for filter “Completed”/i)).toBeInTheDocument();
    const showAllBtn = screen.getByRole('button', { name: /Show All Lectures/i });
    expect(showAllBtn).toBeInTheDocument();

    // Click Show All Lectures to reset filter
    fireEvent.click(showAllBtn);
    expect(screen.getByText('Lecture 1: Course Overview')).toBeInTheDocument();
  });
});
