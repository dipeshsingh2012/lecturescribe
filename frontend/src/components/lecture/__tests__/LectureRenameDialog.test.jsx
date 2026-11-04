import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import LectureRenameDialog from '../LectureRenameDialog';

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

describe('LectureRenameDialog', () => {
  it('renders with pre-filled lecture title and disabled save button initially', () => {
    render(
      <LectureRenameDialog
        open={true}
        onClose={vi.fn()}
        lecture={{ video_id: '12345', title: 'Introduction to Gradient Descent' }}
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /lecture title/i });
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Introduction to Gradient Descent');

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it('enables save button when title is changed and valid', () => {
    render(
      <LectureRenameDialog
        open={true}
        onClose={vi.fn()}
        lecture={{ video_id: '12345', title: 'Old Lecture Name' }}
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /lecture title/i });
    fireEvent.change(input, { target: { value: 'Stochastic Gradient Descent and Adam' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeEnabled();
  });

  it('disables save button when input is empty or shorter than 2 characters', () => {
    render(
      <LectureRenameDialog
        open={true}
        onClose={vi.fn()}
        lecture={{ video_id: '12345', title: 'Lecture 1' }}
        onRename={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /lecture title/i });
    fireEvent.change(input, { target: { value: '   ' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'A' } });
    expect(saveBtn).toBeDisabled();
  });

  it('calls onRename and onClose when save button is clicked', async () => {
    const onRename = vi.fn().mockResolvedValue({ status: 'success' });
    const onClose = vi.fn();

    render(
      <LectureRenameDialog
        open={true}
        onClose={onClose}
        lecture={{ video_id: '12345', title: 'Lecture 1' }}
        onRename={onRename}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /lecture title/i });
    fireEvent.change(input, { target: { value: 'Lecture 1: Foundations of Deep Learning' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('12345', 'Lecture 1: Foundations of Deep Learning');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays error message if onRename rejects', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('Database write failed'));
    const onClose = vi.fn();

    render(
      <LectureRenameDialog
        open={true}
        onClose={onClose}
        lecture={{ video_id: '12345', title: 'Lecture 1' }}
        onRename={onRename}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByRole('textbox', { name: /lecture title/i });
    fireEvent.change(input, { target: { value: 'Lecture 1 - Updated' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Database write failed')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
