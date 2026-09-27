import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
