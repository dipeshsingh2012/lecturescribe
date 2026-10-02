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
    openPreviewModal: vi.fn(),
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

  it('passes openPreviewModal to CourseMaterials and triggers it when clicking View', () => {
    const openPreviewModal = vi.fn();
    const testResource = {
      id: 'res-course-1',
      title: 'Course Syllabus',
      filename: 'syllabus.pdf',
      file_type: 'pdf',
      file_size_bytes: 1024,
      download_url: 'https://example.com/syllabus.pdf',
      created_at: '2026-09-01T00:00:00Z',
      user_email: 'prof@example.com'
    };

    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        courseViewTab="resources"
        courseResources={[testResource]}
        openPreviewModal={openPreviewModal}
      />
    );

    expect(screen.getByText('Course Syllabus')).toBeInTheDocument();
    const viewButton = screen.getByRole('button', { name: /View/i });
    fireEvent.click(viewButton);
    expect(openPreviewModal).toHaveBeenCalledWith(testResource);
  });

  it('renders Course Quiz tab button and switches to course quiz when clicked', () => {
    const setCourseViewTab = vi.fn();
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        courseViewTab="lectures"
        setCourseViewTab={setCourseViewTab}
      />
    );

    const quizTabBtn = screen.getByRole('button', { name: /Course Quiz/i });
    expect(quizTabBtn).toBeInTheDocument();
    fireEvent.click(quizTabBtn);
    expect(setCourseViewTab).toHaveBeenCalledWith('quiz');
  });
});
