import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseLectures from '../CourseLectures';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseLectures', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ today: { all: [] }, upcoming: { all: [] }, quizzes: [] })
    });
  });
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

    const lectureCard = screen.getByRole('button', { name: /Study Classical Mechanics Lecture 1/i });
    fireEvent.click(lectureCard);
    expect(handleTranscribe).toHaveBeenCalledWith('https://video.lecturescribe.local/998877', true, 'Physics 101');

    const deleteBtn = screen.getByRole('button', { name: /Remove from (Course|My) Library/i });
    fireEvent.click(deleteBtn);
    expect(handleDeleteFromLibrary).toHaveBeenCalledWith('998877');
  });

  it('renders Google Drive action button when drive_folder_url is present', () => {
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

    const actionDriveBtn = screen.getByRole('link', { name: /^Open in Google Drive$/i });
    expect(actionDriveBtn).toBeInTheDocument();
    expect(actionDriveBtn).toHaveAttribute('href', 'https://drive.google.com/drive/folders/test-folder-123');
    expect(actionDriveBtn).toHaveAttribute('target', '_blank');
  });

  it('makes the entire card clickable to transcribe/open the lecture', () => {
    const handleTranscribe = vi.fn();
    const lectures = [
      {
        video_id: '998877',
        video_url: 'https://video.lecturescribe.local/998877',
        video_title: 'Classical Mechanics Lecture 1',
        total_duration_seconds: 3600
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

    const lectureCard = screen.getByRole('button', { name: /Study Classical Mechanics Lecture 1/i });
    expect(lectureCard).toBeInTheDocument();
    fireEvent.click(lectureCard);
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

    // Default sorting must be Title Z-A (Lecture 10, Lecture 2, Lecture 1)
    const titles = screen.getAllByRole('heading', { level: 6 }).map(h => h.textContent);
    expect(titles).toEqual([
      'Lecture 10: Advanced Kinematics',
      'Lecture 2: Vectors & Motion',
      'Lecture 1: Course Overview'
    ]);

    // Click quick sort chip "Title" to toggle direction to A-Z
    const titleSortChip = screen.getByRole('button', { name: /^Sort by Title$/i });
    fireEvent.click(titleSortChip);

    const reversedTitles = screen.getAllByRole('heading', { level: 6 }).map(h => h.textContent);
    expect(reversedTitles).toEqual([
      'Lecture 1: Course Overview',
      'Lecture 2: Vectors & Motion',
      'Lecture 10: Advanced Kinematics'
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

  it('renders overall course progress overview card and individual lecture progress indicators', () => {
    const lectures = [
      {
        video_id: 'l1',
        video_title: 'Lecture 1: Completed Lecture',
        progress: { progress_percent: 100, last_timestamp: '45:00' }
      },
      {
        video_id: 'l2',
        video_title: 'Lecture 2: In Progress Lecture',
        progress: { progress_percent: 40, last_timestamp: '18:25' }
      },
      {
        video_id: 'l3',
        video_title: 'Lecture 3: Unstarted Lecture',
        progress: null
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

    // Course Progress header card
    expect(screen.getByText('Course Progress')).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 lectures completed • 1 in progress/i)).toBeInTheDocument();
    // Overall progress: (100 + 40 + 0) / 3 = 47%
    expect(screen.getByText('47%')).toBeInTheDocument();

    // Lecture-level progress
    expect(screen.getByText(/⏱️ Completed/i)).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    expect(screen.getByText(/⏱️ Resume at 18:25/i)).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();

    expect(screen.getByText(/⏱️ Not started/i)).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders combined Course Pulse card with Key Dates date badge and Predicted Quiz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T08:00:00Z'));

    const mockLectures = [
      {
        video_id: 'v101',
        video_title: 'Quantum Physics Lecture 1',
        progress: { progress_percent: 50, last_timestamp: '25:00' }
      }
    ];

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/calendar/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            today: { all: [] },
            upcoming: [
              {
                id: 'evt-1',
                title: 'Midterm Exam: Quantum Mechanics',
                course_name: 'Physics 101',
                date_iso: '2026-10-27',
                date_formatted: 'Tuesday, Oct 27, 2026',
                start_time_formatted: '10:00 AM'
              }
            ],
            all_events: [
              {
                id: 'evt-past',
                title: 'Old Classical Physics Lecture (Past)',
                course_name: 'Physics 101',
                date_iso: '2025-01-10',
                date_formatted: 'Friday, Jan 10, 2025',
                start_time_formatted: '09:00 AM'
              }
            ]
          })
        });
      }
      if (String(url).includes('/api/reminders/upcoming-quizzes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            quizzes: [
              {
                id: 'q-1',
                quiz_title: 'Pop Quiz: Wave-Particle Duality',
                course_name: 'Physics 101',
                predicted_date: 'Friday',
                confidence: 0.95,
                cue_time: '12:40'
              }
            ]
          })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    try {
      render(
        <CourseLectures
          courseLoading={false}
          filteredCourseLectures={mockLectures}
          handleTranscribe={vi.fn()}
          handleDeleteFromLibrary={vi.fn()}
          handleClearCourse={vi.fn()}
          selectedCourse="Physics 101"
          currentTheme={mockTheme}
        />
      );

      expect(screen.getByText('Course Progress')).toBeInTheDocument();
      expect(screen.getByText('Key Dates')).toBeInTheDocument();
      expect(screen.getByText('Predicted Quiz')).toBeInTheDocument();

      // Verify true upcoming event is shown, not the past one
      expect(await screen.findByText('Midterm Exam: Quantum Mechanics')).toBeInTheDocument();
      expect(screen.queryByText('Old Classical Physics Lecture (Past)')).not.toBeInTheDocument();

      // Verify date badge: day 27, month OCT, and time 10:00 AM
      expect(screen.getByText('27')).toBeInTheDocument();
      expect(screen.getByText('OCT')).toBeInTheDocument();
      expect(screen.getByText(/10:00 AM/i)).toBeInTheDocument();

      expect(screen.getByText('Pop Quiz: Wave-Particle Duality')).toBeInTheDocument();
      expect(screen.getByText(/95% match/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to Cue/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders "No upcoming key dates for this course." when course has no upcoming calendar events', async () => {
    const mockLectures = [
      {
        video_id: 'v101',
        video_title: 'Quantum Physics Lecture 1',
        progress: { progress_percent: 50, last_timestamp: '25:00' }
      }
    ];

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/calendar/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            today: { all: [] },
            upcoming: [],
            all_events: [
              {
                id: 'past-evt',
                title: 'Past Event for Chemistry',
                course_name: 'Chemistry 101',
                date_iso: '2024-05-01'
              }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ quizzes: [] })
      });
    });

    render(
      <CourseLectures
        courseLoading={false}
        filteredCourseLectures={mockLectures}
        handleTranscribe={vi.fn()}
        handleDeleteFromLibrary={vi.fn()}
        handleClearCourse={vi.fn()}
        selectedCourse="Physics 101"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText(/No upcoming key dates for this course\./i)).toBeInTheDocument();
  });
});
