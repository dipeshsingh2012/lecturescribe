import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CalendarAlertCard from '../CalendarAlertCard';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

const mockAgendaData = {
  status: 'success',
  last_synced: '2026-10-02T10:00:00+05:30',
  counts: {
    today: 2,
    upcoming: 1,
    assignments: 1,
    quizzes: 1,
    exams: 1
  },
  today: {
    all: [
      {
        id: 'evt_1',
        title: 'Machine Learning Quiz 2',
        category: 'quiz',
        start_time_formatted: '11:30 AM',
        end_time_formatted: '01:00 PM',
        is_all_day: false,
        day_slot: 'morning',
        location: 'LH-1',
        description: 'Join Zoom Meeting: https://zoom.us/j/123456789?pwd=test\nMeeting ID: 123 456 789\nPasscode: 998877\nPlease be on time.',
        meeting_url: 'https://zoom.us/j/123456789?pwd=test',
        meeting_platform: 'zoom'
      },
      {
        id: 'evt_2',
        title: 'Applied Math Assignment 3 Due',
        category: 'assignment',
        start_time_formatted: '06:00 PM',
        end_time_formatted: '11:59 PM',
        is_all_day: false,
        day_slot: 'evening',
        location: 'Online at https://meet.google.com/abc-defg-hij',
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        meeting_platform: 'meet'
      }
    ],
    morning: [
      {
        id: 'evt_1',
        title: 'Machine Learning Quiz 2',
        category: 'quiz',
        start_time_formatted: '11:30 AM',
        end_time_formatted: '01:00 PM',
        is_all_day: false,
        day_slot: 'morning',
        location: 'LH-1',
        description: 'Join Zoom Meeting: https://zoom.us/j/123456789?pwd=test\nMeeting ID: 123 456 789\nPasscode: 998877\nPlease be on time.',
        meeting_url: 'https://zoom.us/j/123456789?pwd=test',
        meeting_platform: 'zoom'
      }
    ],
    afternoon: [],
    evening: [
      {
        id: 'evt_2',
        title: 'Applied Math Assignment 3 Due',
        category: 'assignment',
        start_time_formatted: '06:00 PM',
        end_time_formatted: '11:59 PM',
        is_all_day: false,
        day_slot: 'evening',
        location: 'Online at https://meet.google.com/abc-defg-hij',
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        meeting_platform: 'meet'
      }
    ]
  },
  upcoming: [
    {
      id: 'evt_3',
      title: 'Operating Systems Midsem Exam',
      category: 'exam',
      date_formatted: 'Saturday, Oct 03, 2026',
      start_time_formatted: '09:30 AM',
      end_time_formatted: '12:30 PM',
      is_all_day: false,
      location: 'Auditorium'
    },
    {
      id: 'evt_genai_27',
      title: 'Introduction to Generative AI',
      category: 'lecture',
      date_iso: '2026-10-27',
      date_formatted: 'Tuesday, Oct 27, 2026',
      start_time_formatted: '06:30 PM',
      start: '2026-10-27T18:30:00+05:30',
      course_slug: 'course',
      course_name: 'course'
    }
  ]
};

const mockUser = { email: 'student@iiitdwd.ac.in', name: 'Test Student' };

describe('CalendarAlertCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/calendar/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockAgendaData
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render and does not fetch calendar events when user is not signed in', () => {
    const { container } = render(<CalendarAlertCard currentTheme={mockTheme} googleUser={null} />);
    expect(container.firstChild).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders Moodle agenda with event counts and today events', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    expect(screen.getByText(/Syncing Moodle calendar events.../i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Academic Schedule & Alerts/i)).toBeInTheDocument();
      expect(screen.getByText(/Moodle Live/i)).toBeInTheDocument();
    });

    // Check event titles
    expect(screen.getByText(/Machine Learning Quiz 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Applied Math Assignment 3 Due/i)).toBeInTheDocument();

    // Check slot headers
    expect(screen.getByText(/Morning Sessions & Classes/i)).toBeInTheDocument();
    expect(screen.getByText(/Evening Deadlines & Submissions/i)).toBeInTheDocument();
  });

  it('switches between Today and Next 7 Days tabs', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Machine Learning Quiz 2/i)).toBeInTheDocument();
    });

    const upcomingTab = screen.getByRole('button', { name: /Next 7 Days/i });
    fireEvent.click(upcomingTab);

    await waitFor(() => {
      expect(screen.getByText(/Operating Systems Midsem Exam/i)).toBeInTheDocument();
      expect(screen.getByText(/Auditorium/i)).toBeInTheDocument();
    });
  });

  it('does not expose a manual WhatsApp test alert action', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Academic Schedule & Alerts/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Test WhatsApp Alert/i })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith('/api/calendar/test-alert', expect.anything());
  });

  it('renders clickable meeting link buttons with correct URLs and target attributes', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Machine Learning Quiz 2/i)).toBeInTheDocument();
    });

    // Zoom link button
    const zoomLinks = screen.getAllByRole('link', { name: /Join Zoom/i });
    expect(zoomLinks.length).toBeGreaterThan(0);
    expect(zoomLinks[0]).toHaveAttribute('href', 'https://zoom.us/j/123456789?pwd=test');
    expect(zoomLinks[0]).toHaveAttribute('target', '_blank');
    expect(zoomLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');

    // Google Meet link button
    const meetLinks = screen.getAllByRole('link', { name: /Join Google Meet/i });
    expect(meetLinks.length).toBeGreaterThan(0);
    expect(meetLinks[0]).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    expect(meetLinks[0]).toHaveAttribute('target', '_blank');
    expect(meetLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('allows copying meeting link to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Copy meeting link/i }).length).toBeGreaterThan(0);
    });

    const copyButtons = screen.getAllByRole('button', { name: /Copy meeting link/i });
    fireEvent.click(copyButtons[0]);

    expect(writeTextMock).toHaveBeenCalledWith('https://zoom.us/j/123456789?pwd=test');
  });

  it('toggles expansion of long meeting details and passcodes', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} googleUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Show details \/ credentials/i }).length).toBeGreaterThan(0);
    });

    const expandBtn = screen.getAllByRole('button', { name: /Show details \/ credentials/i })[0];
    fireEvent.click(expandBtn);

    expect(screen.getAllByRole('button', { name: /Show less/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Passcode: 998877/i).length).toBeGreaterThan(0);

    const collapseBtn = screen.getAllByRole('button', { name: /Show less/i })[0];
    fireEvent.click(collapseBtn);

    expect(screen.getAllByRole('button', { name: /Show details \/ credentials/i }).length).toBeGreaterThan(0);
  });

  it('renders only the corresponding upcoming events when selectedCourse is provided', async () => {
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

    // Should NOT render the Today vs Next 7 Days tabs
    expect(screen.queryByRole('button', { name: /Today's Timeline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next 7 Days/i })).not.toBeInTheDocument();

    // Machine Learning event should be rendered
    expect(screen.getByText(/Machine Learning Quiz 2/i)).toBeInTheDocument();

    // Other course event should NOT be rendered
    expect(screen.queryByText(/Applied Math Assignment 3 Due/i)).not.toBeInTheDocument();
  });

  it('renders friendly empty state when course has no upcoming events', async () => {
    render(
      <CalendarAlertCard
        currentTheme={mockTheme}
        googleUser={mockUser}
        selectedCourse="Robotics"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No upcoming key dates for this course/i)).toBeInTheDocument();
    });
  });

  it('renders Introduction to Generative AI event on 27th Oct for course with prefix like 1.5 Introduction to Generative AI', async () => {
    render(
      <CalendarAlertCard
        currentTheme={mockTheme}
        googleUser={mockUser}
        selectedCourse="1.5 Introduction to Generative AI"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Key dates/i)).toBeInTheDocument();
    });

    // Should display the event title
    expect(screen.getByText('Introduction to Generative AI')).toBeInTheDocument();

    // Should display the 27 OCT badge
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('OCT')).toBeInTheDocument();
  });

  it('does not display past dates for 1-4-introduction-to-computer-vision in Key dates', async () => {
    const agendaWithPastEvents = {
      ...mockAgendaData,
      all_events: [
        {
          id: 'cv_live_1',
          title: 'Introduction to Computer Vision Live session -1 (19/ 9 / 2026)',
          course_name: 'Introduction to Computer Vision',
          course_slug: '1-4-introduction-to-computer-vision',
          date_iso: '2026-09-19',
          start: '2026-09-19T10:00:00+05:30',
          start_time_formatted: '10:00 AM'
        },
        {
          id: 'cv_live_2',
          title: 'Introduction to Computer Vision Live session -2 (26/ 9 / 2026)',
          course_name: 'Introduction to Computer Vision',
          course_slug: '1-4-introduction-to-computer-vision',
          date_iso: '2026-09-26',
          start: '2026-09-26T10:00:00+05:30',
          start_time_formatted: '10:00 AM'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => agendaWithPastEvents
    });

    render(
      <CalendarAlertCard
        currentTheme={mockTheme}
        googleUser={mockUser}
        selectedCourse="1-4-introduction-to-computer-vision"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Key dates' })).toBeInTheDocument();
    });

    // Past events from September must NOT be displayed
    expect(screen.queryByText(/Live session -1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live session -2/i)).not.toBeInTheDocument();

    // Friendly empty state should be rendered instead
    expect(screen.getByText(/No upcoming key dates for this course/i)).toBeInTheDocument();
  });

  it('displays future events while filtering out past events for a course', async () => {
    const agendaWithMixedEvents = {
      ...mockAgendaData,
      all_events: [
        {
          id: 'cv_past',
          title: 'Introduction to Computer Vision Live session -1 (19/ 9 / 2026)',
          course_name: 'Introduction to Computer Vision',
          course_slug: '1-4-introduction-to-computer-vision',
          date_iso: '2026-09-19',
          start: '2026-09-19T10:00:00+05:30',
          start_time_formatted: '10:00 AM'
        },
        {
          id: 'cv_future',
          title: 'Introduction to Computer Vision Final Project Submission',
          course_name: 'Introduction to Computer Vision',
          course_slug: '1-4-introduction-to-computer-vision',
          date_iso: '2026-11-20',
          start: '2026-11-20T23:59:00+05:30',
          start_time_formatted: '11:59 PM'
        }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => agendaWithMixedEvents
    });

    render(
      <CalendarAlertCard
        currentTheme={mockTheme}
        googleUser={mockUser}
        selectedCourse="1-4-introduction-to-computer-vision"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Key dates' })).toBeInTheDocument();
    });

    // Future event should be displayed
    expect(screen.getByText('Introduction to Computer Vision Final Project Submission')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('NOV')).toBeInTheDocument();

    // Past event should NOT be displayed
    expect(screen.queryByText(/Live session -1/i)).not.toBeInTheDocument();
  });
});
