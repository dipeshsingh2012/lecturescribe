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
    const viewButton = screen.getByRole('button', { name: /^View$/i });
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

  it('renders course-specific QuickAddBar when selectedCourse is active and calls handleTranscribe with stayOnCoursePage=true', () => {
    const handleTranscribe = vi.fn();
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        urlInput="https://video.lecturescribe.local/123456"
        handleTranscribe={handleTranscribe}
      />
    );

    const input = screen.getByPlaceholderText(/Add video URL or ID to this course \(Biostatistics\)...*/i);
    expect(input).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /Add to Course/i });
    expect(addBtn).toBeInTheDocument();

    fireEvent.click(addBtn);
    expect(handleTranscribe).toHaveBeenCalledWith(
      'https://video.lecturescribe.local/123456',
      false,
      'Biostatistics',
      true
    );
  });

  it('omnibar does not show Add to Course button for normal lecture search keywords', () => {
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        librarySearch="Normal Lecture Title"
      />
    );

    expect(screen.queryByRole('button', { name: /Add to Course/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear search/i })).toBeInTheDocument();
  });

  it('triggers transcription when pressing Enter on a video URL in the omnibar', () => {
    const handleTranscribe = vi.fn();
    const setLibrarySearch = vi.fn();
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        librarySearch="https://video.lecturescribe.local/998877"
        setLibrarySearch={setLibrarySearch}
        handleTranscribe={handleTranscribe}
      />
    );

    const input = screen.getByPlaceholderText(/Add video URL or ID to this course/i);
    expect(screen.getByRole('button', { name: /Add to Course/i })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(handleTranscribe).toHaveBeenCalledWith(
      'https://video.lecturescribe.local/998877',
      false,
      'Biostatistics',
      true
    );
    expect(setLibrarySearch).toHaveBeenCalledWith('');
  });

  it('calls handlePasteUrl when pasting into the course omnibar', () => {
    const handlePasteUrl = vi.fn();
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        handlePasteUrl={handlePasteUrl}
      />
    );

    const input = screen.getByPlaceholderText(/Add video URL or ID to this course/i);
    fireEvent.paste(input, { clipboardData: { getData: () => 'https://youtu.be/sample' } });
    expect(handlePasteUrl).toHaveBeenCalled();
  });

  it('renders cacheNotice banner with Check icon without throwing error', () => {
    render(
      <HomeView
        {...baseProps}
        selectedCourse="Biostatistics"
        cacheNotice="⚡ Lecture successfully added to course!"
      />
    );

    expect(screen.getByText(/Lecture successfully added to course!/i)).toBeInTheDocument();
  });

  it('does not render calendar card when googleUser is null', () => {
    render(<HomeView {...baseProps} googleUser={null} />);
    expect(screen.queryByText(/Academic Schedule & Alerts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Syncing Moodle calendar events.../i)).not.toBeInTheDocument();
  });

  it('renders calendar card when googleUser is signed in', () => {
    const mockUser = { email: 'student@iiitdwd.ac.in', name: 'Test Student' };
    render(<HomeView {...baseProps} googleUser={mockUser} />);
    expect(screen.getByText(/Syncing Moodle calendar events.../i)).toBeInTheDocument();
  });

  it('does not render main hub QuickAddBar when googleUser is logged in', () => {
    const mockUser = { email: 'student@iiitdwd.ac.in', name: 'Test Student' };
    render(<HomeView {...baseProps} googleUser={mockUser} selectedCourse={null} />);
    expect(screen.queryByPlaceholderText(/Paste any lecture video URL or ID/i)).not.toBeInTheDocument();
  });

  it('does not render course-level QuickAddBar when googleUser is logged in and selectedCourse is active', () => {
    const mockUser = { email: 'student@iiitdwd.ac.in', name: 'Test Student' };
    render(
      <HomeView
        {...baseProps}
        googleUser={mockUser}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
      />
    );
    expect(screen.queryByPlaceholderText(/Add video URL or ID to this course/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to Course/i })).not.toBeInTheDocument();
  });

  it('navigates to the expected lecture via handleTranscribe when Jump to Cue is clicked in QuizRemindersCard', async () => {
    const handleTranscribe = vi.fn();
    const handleCueClick = vi.fn();

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/reminders/upcoming-quizzes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            quizzes: [
              {
                id: 'pq_1',
                video_id: '11223344',
                course_name: 'Data Structures',
                course_slug: 'data-structures',
                quiz_title: 'Pop Quiz 1',
                predicted_date: 'This Friday',
                cue_time: '03:10',
                cue_text: 'We will have our first pop quiz this Friday.'
              }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <HomeView
        {...baseProps}
        handleTranscribe={handleTranscribe}
        handleCueClick={handleCueClick}
      />
    );

    const jumpBtn = await screen.findByRole('button', { name: /Jump to Cue/i });
    fireEvent.click(jumpBtn);

    expect(handleTranscribe).toHaveBeenCalledWith(
      '11223344',
      true,
      'Data Structures',
      false,
      '03:10'
    );
  });

  it('shows Assignments tab and QuickAddBar for Tutor role, and allows Assignments while hiding QuickAddBar for Student role', () => {
    const mockTutor = { email: 'tutor@iiitdwd.ac.in', name: 'Prof Tutor' };
    const { rerender } = render(
      <HomeView
        {...baseProps}
        googleUser={mockTutor}
        userRole="tutor"
        isTutor={true}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
      />
    );

    expect(screen.getByRole('button', { name: /Course Assignments/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Add video URL or ID to this course/i)).toBeInTheDocument();

    rerender(
      <HomeView
        {...baseProps}
        googleUser={mockTutor}
        userRole="student"
        isTutor={false}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
      />
    );

    expect(screen.getByRole('button', { name: /Course Assignments/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Add video URL or ID to this course/i)).not.toBeInTheDocument();
  });

  it('does not render the redundant top-level New button, and provides Upload Slides button in the slides section', () => {
    const mockTutor = { email: 'tutor@iiitdwd.ac.in', name: 'Test Tutor' };
    const mockOpenUpload = vi.fn();
    const { rerender } = render(
      <HomeView
        {...baseProps}
        googleUser={mockTutor}
        userRole="tutor"
        isTutor={true}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        courseViewTab="lectures"
        openUploadModal={mockOpenUpload}
      />
    );

    // Redundant top-level "New" button must NOT exist on any tab
    expect(screen.queryByRole('button', { name: /New resource or note/i })).not.toBeInTheDocument();

    // Switch to library tab
    rerender(
      <HomeView
        {...baseProps}
        googleUser={mockTutor}
        userRole="tutor"
        isTutor={true}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        courseViewTab="library"
        openUploadModal={mockOpenUpload}
      />
    );

    // Still no redundant top-level "New" button
    expect(screen.queryByRole('button', { name: /New resource or note/i })).not.toBeInTheDocument();

    // Inside library, the "Upload Slides / Files" button is available in the slides section header
    const uploadBtn = screen.getByRole('button', { name: /Upload Slides or Files/i });
    expect(uploadBtn).toBeInTheDocument();

    fireEvent.click(uploadBtn);
    expect(mockOpenUpload).toHaveBeenCalledWith({
      courseName: 'Biostatistics',
      videoId: null
    });
  });

  it('only shows the key date section in the lectures section and not on other course tabs like quiz or summary', () => {
    const mockUser = { email: 'student@iiitdwd.ac.in', name: 'Test Student' };
    const { rerender } = render(
      <HomeView
        {...baseProps}
        googleUser={mockUser}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        courseViewTab="quiz"
      />
    );

    // On Course Quiz tab, the standalone Key dates card must NOT be present
    expect(screen.queryByRole('heading', { name: /Key dates/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/No upcoming key dates for this course/i)).not.toBeInTheDocument();

    // On Course Summary tab, Key dates must also NOT be present
    rerender(
      <HomeView
        {...baseProps}
        googleUser={mockUser}
        selectedCourse="Biostatistics"
        activeCourseData={{ course_name: 'Biostatistics' }}
        courseViewTab="summary"
      />
    );
    expect(screen.queryByRole('heading', { name: /Key dates/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/No upcoming key dates for this course/i)).not.toBeInTheDocument();
  });
});

