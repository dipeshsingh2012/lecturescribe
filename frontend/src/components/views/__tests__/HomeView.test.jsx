import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomeView from '../HomeView';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('HomeView', () => {
  const baseProps = {
    selectedCourse: null,
    googleUser: null,
    userLibrary: [],
    handleGoogleSignIn: vi.fn(),
    urlInput: '',
    setUrlInput: vi.fn(),
    setCacheNotice: vi.fn(),
    cacheNotice: null,
    handlePasteUrl: vi.fn(),
    handleTranscribe: vi.fn(),
    loading: false,
    error: null,
    handleClearCourse: vi.fn(),
    activeCourseData: null,
    filteredCourseLectures: [],
    filteredCourses: [],
    fetchUserLibrary: vi.fn(),
    libraryLoading: false,
    librarySearch: '',
    setLibrarySearch: vi.fn(),
    courseViewTab: 'lectures',
    setCourseViewTab: vi.fn(),
    courseResources: [],
    openUploadModal: vi.fn(),
    handleSelectCourse: vi.fn(),
    courseResourcesLoading: false,
    handleDeleteResource: vi.fn(),
    courseLoading: false,
    handleDeleteFromLibrary: vi.fn(),
    currentTheme: mockTheme
  };

  it('renders home hub view with My Courses and empty grid when selectedCourse is null', () => {
    render(<HomeView {...baseProps} />);

    expect(screen.getByText('My Courses')).toBeInTheDocument();
    expect(screen.getByText('Your Course Library is Empty')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste any lecture video URL or ID/i)).toBeInTheDocument();
  });

  it('renders selected course view with back button and lectures when selectedCourse is provided', () => {
    const handleClearCourse = vi.fn();
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        handleClearCourse={handleClearCourse}
      />
    );

    expect(screen.getByText('Biostatistics')).toBeInTheDocument();

    const backBtn = screen.getAllByRole('button', { name: /All Courses/i })[0];
    fireEvent.click(backBtn);
    expect(handleClearCourse).toHaveBeenCalledTimes(1);
  });
});
