import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileBottomNav from '../MobileBottomNav';

describe('MobileBottomNav Component', () => {
  const currentTheme = {
    palette: {
      primary: '#0075ED',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#64748b'
    }
  };

  it('renders global navigation items when outside of a course', () => {
    const onNavigateHome = vi.fn();
    const onNavigateCalendar = vi.fn();
    const onCreateNewNote = vi.fn();

    render(
      <MobileBottomNav
        selectedCourse={null}
        onNavigateHome={onNavigateHome}
        onNavigateCalendar={onNavigateCalendar}
        onCreateNewNote={onCreateNewNote}
        currentTheme={currentTheme}
      />
    );

    expect(screen.getByRole('navigation', { name: /Global Mobile Navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Courses Hub/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Academic Calendar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Note/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Academic Calendar/i }));
    expect(onNavigateCalendar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /New Note/i }));
    expect(onCreateNewNote).toHaveBeenCalledTimes(1);
  });

  it('renders primary course tabs and opens more drawer when selectedCourse is provided', () => {
    const setCourseViewTab = vi.fn();

    render(
      <MobileBottomNav
        selectedCourse="Machine Learning"
        courseViewTab="lectures"
        setCourseViewTab={setCourseViewTab}
        isTutor={true}
        currentTheme={currentTheme}
      />
    );

    expect(screen.getByRole('navigation', { name: /Course Bottom Navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Syllabus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lectures' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Tutor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grades' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More Course Tools/i })).toBeInTheDocument();

    // Clicking a primary tab invokes setCourseViewTab
    fireEvent.click(screen.getByRole('button', { name: 'AI Tutor' }));
    expect(setCourseViewTab).toHaveBeenCalledWith('tutor');

    // Opening "More" drawer displays secondary study, collab, and tutor tools
    fireEvent.click(screen.getByRole('button', { name: /More Course Tools/i }));
    expect(screen.getByText(/Course Modules & Tools/i)).toBeInTheDocument();
    expect(screen.getByText(/Course Quiz & Exam/i)).toBeInTheDocument();
    expect(screen.getByText(/Course Discussions & Q&A/i)).toBeInTheDocument();
    expect(screen.getByText(/Assignments & SpeedGrader/i)).toBeInTheDocument();

    // Selecting a secondary tool calls setCourseViewTab
    fireEvent.click(screen.getByText(/Course Quiz & Exam/i));
    expect(setCourseViewTab).toHaveBeenCalledWith('quiz');
  });
});

