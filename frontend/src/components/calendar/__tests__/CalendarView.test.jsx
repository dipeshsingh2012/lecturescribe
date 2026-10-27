import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CalendarView from '../../views/CalendarView';
import CalendarAlertCard from '../CalendarAlertCard';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;
const mockUser = { email: 'tutor@iiitdwd.ac.in', name: 'Prof. Test' };

const todayIso = new Date().toISOString().slice(0, 10);

const mockFullCalendarResponse = {
  status: 'success',
  counts: {
    today: 2,
    upcoming: 1,
    total: 2,
    assignments: 0,
    quizzes: 1,
    exams: 1,
    ai_extracted: 2,
    pending_review: 0
  },
  today: {
    all: [
      {
        id: 'cal_pdf_01',
        title: 'End-Semester Exam: Machine Learning (CS301)',
        category: 'exam',
        date_iso: todayIso,
        date_formatted: 'Monday, Oct 26, 2026',
        start_time_formatted: '09:30 AM',
        end_time_formatted: '12:30 PM',
        is_all_day: false,
        day_slot: 'morning',
        location: 'LH-201',
        course_name: 'Machine Learning',
        source_type: 'pdf_ai',
        source_metadata: {
          pdf_filename: 'EndSem_Timetable.pdf',
          page_number: 2
        }
      },
      {
        id: 'cal_tr_02',
        title: 'Quiz 3: Support Vector Machines',
        category: 'quiz',
        date_iso: todayIso,
        date_formatted: 'Monday, Oct 26, 2026',
        start_time_formatted: '02:00 PM',
        end_time_formatted: '03:00 PM',
        is_all_day: false,
        day_slot: 'afternoon',
        course_name: 'Machine Learning',
        source_type: 'transcript_ai',
        source_metadata: {
          video_id: 'vid_svm_12',
          lecture_title: 'Lecture 12: SVM',
          cue_time: '14:22',
          cue_text: 'Quiz 3 on SVM will be held at 2 PM.'
        }
      }
    ],
    morning: [],
    afternoon: [],
    evening: []
  },
  upcoming: [],
  all_events: [
    {
      id: 'cal_pdf_01',
      title: 'End-Semester Exam: Machine Learning (CS301)',
      category: 'exam',
      date_iso: todayIso,
      date_formatted: 'Monday, Oct 26, 2026',
      start_time_formatted: '09:30 AM',
      end_time_formatted: '12:30 PM',
      is_all_day: false,
      day_slot: 'morning',
      location: 'LH-201',
      course_name: 'Machine Learning',
      source_type: 'pdf_ai',
      source_metadata: {
        pdf_filename: 'EndSem_Timetable.pdf',
        page_number: 2
      }
    },
    {
      id: 'cal_tr_02',
      title: 'Quiz 3: Support Vector Machines',
      category: 'quiz',
      date_iso: todayIso,
      date_formatted: 'Monday, Oct 26, 2026',
      start_time_formatted: '02:00 PM',
      end_time_formatted: '03:00 PM',
      is_all_day: false,
      day_slot: 'afternoon',
      course_name: 'Machine Learning',
      source_type: 'transcript_ai',
      source_metadata: {
        video_id: 'vid_svm_12',
        lecture_title: 'Lecture 12: SVM',
        cue_time: '14:22',
        cue_text: 'Quiz 3 on SVM will be held at 2 PM.'
      }
    }
  ]
};

describe('Full CalendarView & Course Calendar Widget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/calendar/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockFullCalendarResponse
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success', events: [] })
      });
    });
  });

  it('renders Full Calendar Page with Month Grid, Timeline Agenda, and AI provenance links', async () => {
    const onSelectLecture = vi.fn();
    render(
      <CalendarView
        currentTheme={mockTheme}
        googleUser={mockUser}
        isTutor={true}
        courses={['Machine Learning', 'Operating Systems']}
        onSelectLecture={onSelectLecture}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('full-calendar-view')).toBeInTheDocument();
      expect(screen.getAllByText(/End-Semester Exam: Machine Learning/i).length).toBeGreaterThan(0);
    });

    // Switch to Timeline Agenda view
    const timelineBtn = screen.getByRole('button', { name: /Timeline Agenda/i });
    fireEvent.click(timelineBtn);

    await waitFor(() => {
      expect(screen.getByText(/Heard in Lecture 12: SVM @ 14:22/i)).toBeInTheDocument();
    });

    // Click transcript deep-link button
    fireEvent.click(screen.getByRole('button', { name: /Heard in Lecture 12: SVM @ 14:22/i }));
    expect(onSelectLecture).toHaveBeenCalledWith('vid_svm_12', '14:22', 'Machine Learning');
  });

  it('opens the AI Exam PDF & Transcript Extractor Modal from CalendarView', async () => {
    render(
      <CalendarView
        currentTheme={mockTheme}
        googleUser={mockUser}
        isTutor={true}
        selectedCourse="Machine Learning"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Upload Exam PDF \(AI\)/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Upload Exam PDF \(AI\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI Academic Calendar & Schedule Injector/i)).toBeInTheDocument();
      expect(screen.getByText(/Click to select Semester Exam Timetable or Syllabus PDF/i)).toBeInTheDocument();
    });
  });

  it('renders course-scoped Upcoming Events & Deadlines in CalendarAlertCard when selectedCourse is passed', async () => {
    render(
      <CalendarAlertCard
        currentTheme={mockTheme}
        googleUser={mockUser}
        selectedCourse="Machine Learning"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Key dates/i)).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/calendar\/events\?refresh=false&days=\d+&course=Machine%20Learning/)
    );
  });
});

