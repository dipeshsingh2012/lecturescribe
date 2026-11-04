import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import CourseRenameDialog from '../CourseRenameDialog';

const mockTheme = {
  palette: {
    primary: '#0075ed',
    primaryHover: '#005bb5',
    cardBg: '#ffffff',
    cardBorder: '#e5e7eb',
    textPrimary: '#111827',
    textSecondary: '#6b7280'
  }
};

describe('CourseRenameDialog', () => {
  it('renders with pre-filled course name and URL slug preview', () => {
    render(
      <CourseRenameDialog
        open={true}
        onClose={vi.fn()}
        course={{ course_name: 'Machine Learning Paradigms', course_slug: 'machine-learning-paradigms' }}
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /course name/i });
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Machine Learning Paradigms');

    // URL preview
    expect(screen.getByText(/\/course\/machine-learning-paradigms/i)).toBeInTheDocument();

    // Save button should be disabled initially (unchanged)
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it('updates live slug preview on input change and enables Save button', () => {
    render(
      <CourseRenameDialog
        open={true}
        onClose={vi.fn()}
        course="1.2 Machine Learning Paradigms"
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /course name/i });
    fireEvent.change(input, { target: { value: 'Advanced ML Systems' } });

    expect(screen.getByText(/\/course\/advanced-ml-systems/i)).toBeInTheDocument();

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeEnabled();
  });

  it('disables Save button when input is empty or too short', () => {
    render(
      <CourseRenameDialog
        open={true}
        onClose={vi.fn()}
        course="Physics 101"
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /course name/i });
    fireEvent.change(input, { target: { value: '   ' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'A' } });
    expect(saveBtn).toBeDisabled();
  });

  it('calls onRename and onClose when Save is clicked', async () => {
    const onRename = vi.fn().mockResolvedValue({ status: 'success' });
    const onClose = vi.fn();

    render(
      <CourseRenameDialog
        open={true}
        onClose={onClose}
        course={{ course_name: 'Biology', course_slug: 'biology' }}
        onRename={onRename}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /course name/i });
    fireEvent.change(input, { target: { value: 'Cellular Biology' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('biology', 'Cellular Biology');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays error alert when onRename throws an error', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('A course with this name already exists.'));
    const onClose = vi.fn();

    render(
      <CourseRenameDialog
        open={true}
        onClose={onClose}
        course="Chemistry"
        onRename={onRename}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /course name/i });
    fireEvent.change(input, { target: { value: 'Organic Chemistry' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('A course with this name already exists.')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

