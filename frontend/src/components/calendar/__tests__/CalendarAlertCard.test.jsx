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
        location: 'LH-1'
      },
      {
        id: 'evt_2',
        title: 'Applied Math Assignment 3 Due',
        category: 'assignment',
        start_time_formatted: '06:00 PM',
        end_time_formatted: '11:59 PM',
        is_all_day: false,
        day_slot: 'evening'
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
        location: 'LH-1'
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
        day_slot: 'evening'
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
    }
  ]
};

describe('CalendarAlertCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (url.includes('/api/calendar/events')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockAgendaData
        });
      }
      if (url.includes('/api/calendar/test-alert')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            events_included: 2,
            dispatch_result: {
              status: 'simulated',
              recipient: '+919876543210'
            }
          })
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('renders Moodle agenda with event counts and today events', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} />);

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
    render(<CalendarAlertCard currentTheme={mockTheme} />);

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

  it('triggers test alert dispatch on button click', async () => {
    render(<CalendarAlertCard currentTheme={mockTheme} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Test WhatsApp Alert/i })).toBeInTheDocument();
    });

    const testBtn = screen.getByRole('button', { name: /Test WhatsApp Alert/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/calendar/test-alert', { method: 'POST' });
      expect(screen.getByText(/Twilio credentials not configured yet/i)).toBeInTheDocument();
    });
  });
});
