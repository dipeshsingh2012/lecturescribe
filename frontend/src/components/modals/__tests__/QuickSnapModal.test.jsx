import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuickSnapModal from '../QuickSnapModal';

describe('QuickSnapModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the floating quick solver button with hotkey label', () => {
    render(<QuickSnapModal courseContext="Calculus I" />);
    const btn = screen.getByRole('button', { name: /Quick Snap & Solve/i });
    expect(btn).toBeInTheDocument();
    expect(screen.getByText('Quick Solver')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+V')).toBeInTheDocument();
  });

  it('opens modal when clicking the floating button', () => {
    render(<QuickSnapModal courseContext="Linear Algebra" />);
    const trigger = screen.getByRole('button', { name: /Quick Snap & Solve/i });
    fireEvent.click(trigger);

    expect(screen.getByText('Quick Snap & Solve')).toBeInTheDocument();
    expect(screen.getByText(/Paste screenshot here/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Linear Algebra')).toBeInTheDocument();
  });

  it('closes modal when clicking close X button', () => {
    render(<QuickSnapModal courseContext="" />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Snap & Solve/i }));
    expect(screen.getByText('Quick Snap & Solve')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/Paste screenshot here/i)).toBeNull();
  });

  it('toggles open via Ctrl+Shift+V hotkey', () => {
    render(<QuickSnapModal courseContext="Machine Learning" />);
    
    // Press Ctrl+Shift+V
    fireEvent.keyDown(window, { key: 'V', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('Quick Snap & Solve')).toBeInTheDocument();

    // Press Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Paste screenshot here/i)).toBeNull();
  });

  it('opens modal when receiving open-quick-solver custom event', () => {
    render(<QuickSnapModal courseContext="Physics 101" />);
    expect(screen.queryByText(/Paste screenshot here/i)).toBeNull();

    fireEvent(window, new CustomEvent('open-quick-solver'));
    expect(screen.getByText('Quick Snap & Solve')).toBeInTheDocument();
    expect(screen.getByText(/Paste screenshot here/i)).toBeInTheDocument();
  });

  it('locks background scrolling on body and html when opened and restores on close', () => {
    render(<QuickSnapModal courseContext="Calculus" />);
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /Quick Snap & Solve/i }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.documentElement.style.overflow).toBe('hidden');

    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    fireEvent.click(closeBtn);
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('displays mapped course badge and switches to history tab', async () => {
    // Mock fetch for history
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          solve_id: 'solve_123',
          course_name: 'Calculus I',
          user_email: 'test@example.com',
          final_answer: '**Answer: Option (A)**',
          created_at: new Date().toISOString()
        }
      ]
    });

    render(<QuickSnapModal courseContext="Calculus I" userEmail="test@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Snap & Solve/i }));

    // Check course mapped badge
    expect(screen.getByText('Mapped')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Calculus I')).toBeInTheDocument();

    // Click History tab
    const historyTabBtn = screen.getByRole('button', { name: /history/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Final Solution|Answer: Option/i)).toBeInTheDocument();
    });
  });

  it('hides the floating quick solver button when hideFloatingButton is true', () => {
    render(<QuickSnapModal courseContext="Calculus I" hideFloatingButton={true} />);
    expect(screen.queryByRole('button', { name: /Quick Snap & Solve/i })).toBeNull();
  });
});
