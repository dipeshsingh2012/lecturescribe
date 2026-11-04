import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CourseQuickSolvesTab from '../CourseQuickSolvesTab';

describe('CourseQuickSolvesTab Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no quick solves are available', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    });

    render(<CourseQuickSolvesTab courseName="Physics 101" userEmail="test@example.com" />);

    expect(screen.getByText(/Quick Solves & Exam Archive/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No Handwritten Solves for Physics 101/i)).toBeInTheDocument();
    });
  });

  it('renders list of solves and handles snap trigger', async () => {
    const mockSolves = [
      {
        solve_id: 'solve_abc',
        course_name: 'Physics 101',
        user_email: 'test@example.com',
        prompt: 'Calculate velocity',
        final_answer: '**Answer:** $v = 9.8\\text{ m/s}$',
        detailed_solution: 'Using $v = gt$...',
        created_at: new Date().toISOString()
      }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSolves
    });

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<CourseQuickSolvesTab courseName="Physics 101" userEmail="test@example.com" />);

    await waitFor(() => {
      expect(screen.getByText(/"Calculate velocity"/i)).toBeInTheDocument();
    });

    // Click Snap button
    const snapBtn = screen.getByRole('button', { name: /⚡ Snap & Solve Question/i });
    fireEvent.click(snapBtn);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'open-quick-solver',
        detail: { course: 'Physics 101' }
      })
    );
  });
});

