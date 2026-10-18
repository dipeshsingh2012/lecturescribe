import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizRemindersCard from '../QuizRemindersCard';

describe('QuizRemindersCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders upcoming predicted quizzes on load', async () => {
    const mockQuizzes = [
      {
        id: 'quiz_123',
        video_id: 'vid_1',
        course_name: 'Calculus I',
        quiz_title: 'Quiz 3: Integration by Parts',
        predicted_date: 'Next Monday, Nov 3',
        predicted_date_iso: '2026-11-03',
        confidence: 0.95,
        cue_time: '14:20',
        cue_text: 'Be prepared for Quiz 3 covering integration by parts next Monday.'
      }
    ];

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', quizzes: mockQuizzes })
    });

    render(<QuizRemindersCard />);

    expect(await screen.findByText('Upcoming Predicted Quizzes & Assessments')).toBeInTheDocument();
    expect(screen.getByText('Quiz 3: Integration by Parts')).toBeInTheDocument();
    expect(screen.getByText('Next Monday, Nov 3')).toBeInTheDocument();
    expect(screen.getByText('Calculus I')).toBeInTheDocument();
    expect(screen.getByText(/Spoken at 14:20/i)).toBeInTheDocument();
  });

  it('allows dismissing a quiz reminder', async () => {
    const mockQuizzes = [
      {
        id: 'quiz_dismiss_test',
        video_id: 'vid_1',
        course_name: 'Physics',
        quiz_title: 'Midterm Prep Quiz',
        predicted_date: 'Tomorrow',
        predicted_date_iso: '2026-10-25',
        confidence: 0.88,
        cue_time: '02:00',
        cue_text: 'Tomorrow we have our midterm prep quiz.'
      }
    ];

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', quizzes: mockQuizzes })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success' })
      });

    render(<QuizRemindersCard />);

    expect(await screen.findByText('Midterm Prep Quiz')).toBeInTheDocument();

    const dismissBtn = screen.getByLabelText('Dismiss this reminder');
    fireEvent.click(dismissBtn);

    // Should optimistically be removed
    await waitFor(() => {
      expect(screen.queryByText('Midterm Prep Quiz')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when there are no upcoming quizzes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', quizzes: [] })
    });

    const { container } = render(<QuizRemindersCard />);
    await waitFor(() => {
      expect(screen.queryByText('Upcoming Predicted Quizzes & Assessments')).not.toBeInTheDocument();
    });
    expect(container.firstChild).toBeNull();
  });

  it('calls onSelectLecture with video_id, cue_time, and course_name when Jump to Cue is clicked', async () => {
    const onSelectLecture = vi.fn();
    const mockQuizzes = [
      {
        id: 'quiz_jump_1',
        video_id: 'vid_jump_99',
        course_name: '',
        course_slug: 'data-structures',
        lecture_title: 'Lecture 4: Heaps',
        quiz_title: 'Pop Quiz 1',
        predicted_date: 'This Friday',
        predicted_date_iso: '2026-10-23',
        confidence: 0.85,
        cue_time: '03:10',
        cue_text: 'We will have our first pop quiz this Friday.'
      }
    ];

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', quizzes: mockQuizzes })
    });

    render(<QuizRemindersCard onSelectLecture={onSelectLecture} />);

    expect(await screen.findByText('Pop Quiz 1')).toBeInTheDocument();
    expect(screen.getByText('Data Structures')).toBeInTheDocument();
    expect(screen.getByText(/Lecture 4: Heaps/i)).toBeInTheDocument();

    const jumpBtn = screen.getByRole('button', { name: /Jump to Cue/i });
    fireEvent.click(jumpBtn);

    expect(onSelectLecture).toHaveBeenCalledWith('vid_jump_99', '03:10', 'data-structures');
  });
});

