import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CourseGrid from '../CourseGrid';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseGrid', () => {
  it('renders empty state when filteredCourses is empty', () => {
    render(
      <CourseGrid
        filteredCourses={[]}
        handleSelectCourse={vi.fn()}
        librarySearch=""
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Your Course Library is Empty')).toBeInTheDocument();
  });

  it('renders search empty state when search term has no results', () => {
    render(
      <CourseGrid
        filteredCourses={[]}
        handleSelectCourse={vi.fn()}
        librarySearch="Quantum Computing"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('No matching courses found')).toBeInTheDocument();
    expect(screen.getByText(/matched "Quantum Computing"/i)).toBeInTheDocument();
  });

  it('renders course cards and triggers handleSelectCourse upon card click', () => {
    const handleSelectCourse = vi.fn();
    const courses = [
      {
        course_name: 'Machine Learning',
        lecture_count: 2,
        lectures: [
          { video_id: '101', title: 'Intro to ML' },
          { video_id: '102', title: 'Neural Networks' }
        ],
        total_duration_seconds: 7200,
        latest_timestamp: '2026-09-01T12:00:00Z'
      }
    ];

    render(
      <CourseGrid
        filteredCourses={courses}
        handleSelectCourse={handleSelectCourse}
        librarySearch=""
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Machine Learning')).toBeInTheDocument();
    expect(screen.getByText('2 lectures')).toBeInTheDocument();

    const openCourseBtn = screen.getByRole('button', { name: /View Lectures/i });
    fireEvent.click(openCourseBtn);
    expect(handleSelectCourse).toHaveBeenCalledWith('Machine Learning');
  });

  it('opens confirmation dialog and calls handleDeleteCourse when confirmed', async () => {
    const handleSelectCourse = vi.fn();
    const handleDeleteCourse = vi.fn().mockResolvedValue(true);
    const courses = [
      {
        course_name: 'Machine Learning',
        lecture_count: 2,
        lectures: [
          { video_id: '101', title: 'Intro to ML' },
          { video_id: '102', title: 'Neural Networks' }
        ]
      }
    ];

    render(
      <CourseGrid
        filteredCourses={courses}
        handleSelectCourse={handleSelectCourse}
        handleDeleteCourse={handleDeleteCourse}
        librarySearch=""
        currentTheme={mockTheme}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete Machine Learning/i });
    fireEvent.click(deleteBtn);

    // Should not navigate into course when clicking trash icon
    expect(handleSelectCourse).not.toHaveBeenCalled();

    // Confirmation dialog should appear
    expect(screen.getByText('Delete Course?')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /^Delete Course$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleDeleteCourse).toHaveBeenCalledWith('Machine Learning');
    });
  });

  it('renders pin button and calls handleTogglePin without selecting course', () => {
    const handleSelectCourse = vi.fn();
    const handleTogglePin = vi.fn();
    const courses = [
      {
        course_name: 'Machine Learning',
        course_slug: 'machine-learning',
        lecture_count: 1,
        is_pinned: false,
        lectures: [{ video_id: '101', title: 'Intro' }]
      }
    ];

    render(
      <CourseGrid
        filteredCourses={courses}
        handleSelectCourse={handleSelectCourse}
        handleTogglePin={handleTogglePin}
        librarySearch=""
        currentTheme={mockTheme}
      />
    );

    const pinBtn = screen.getByRole('button', { name: /Pin Machine Learning to top/i });
    expect(pinBtn).toBeInTheDocument();

    fireEvent.click(pinBtn);
    expect(handleTogglePin).toHaveBeenCalledWith('machine-learning');
    expect(handleSelectCourse).not.toHaveBeenCalled();
  });

  it('renders active pinned state and unpin label when course is pinned', () => {
    const handleTogglePin = vi.fn();
    const courses = [
      {
        course_name: 'Quantum Physics',
        course_slug: 'quantum-physics',
        lecture_count: 2,
        is_pinned: true,
        lectures: [{ video_id: '102', title: 'Intro' }]
      }
    ];

    render(
      <CourseGrid
        filteredCourses={courses}
        handleTogglePin={handleTogglePin}
        librarySearch=""
        currentTheme={mockTheme}
      />
    );

    const unpinBtn = screen.getByRole('button', { name: /Unpin Quantum Physics/i });
    expect(unpinBtn).toBeInTheDocument();
  });
});

