import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CourseNotepadView from '../CourseNotepadView';

describe('CourseNotepadView', () => {
  const mockTheme = {
    palette: {
      primary: '#3b82f6',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#64748b',
      badgeBg: '#f1f5f9',
      cardShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }
  };

  const mockNote = {
    note_id: 'note_123456',
    title: 'Thesis Literature Notes',
    content: '<p>Initial thoughts on Transformer attention complexity.</p>',
    updated_at: '2026-10-11T12:00:00Z'
  };

  const mockUser = {
    email: 'student@mtech.edu',
    name: 'MTech Student'
  };

  it('renders note title and content correctly in Word-style editor', () => {
    const { container } = render(
      <CourseNotepadView
        courseName="Master of Technology"
        noteId={mockNote.note_id}
        activeNote={mockNote}
        activeNoteLoading={false}
        saveStatus="saved"
        saveNote={vi.fn()}
        deleteNote={vi.fn()}
        onNavigateBack={vi.fn()}
        googleUser={mockUser}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByDisplayValue('Thesis Literature Notes')).toBeInTheDocument();
    expect(container.querySelector('.ql-editor')).toHaveTextContent(/Initial thoughts on Transformer attention complexity/);
    expect(screen.getByText(/MASTER OF TECHNOLOGY \/ NOTEPAD/i)).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(container.querySelector('.ql-toolbar')).toBeInTheDocument();
  });

  it('navigates back when back button is clicked', () => {
    const onNavigateBack = vi.fn();
    render(
      <CourseNotepadView
        courseName="Master of Technology"
        noteId={mockNote.note_id}
        activeNote={mockNote}
        activeNoteLoading={false}
        saveStatus="saved"
        saveNote={vi.fn()}
        deleteNote={vi.fn()}
        onNavigateBack={onNavigateBack}
        googleUser={mockUser}
        currentTheme={mockTheme}
      />
    );

    const backBtn = screen.getByRole('button', { name: /back to course/i });
    fireEvent.click(backBtn);
    expect(onNavigateBack).toHaveBeenCalled();
  });

  it('does not auto-save on edit, but saves when Save button is clicked', async () => {
    vi.useFakeTimers();
    const saveNote = vi.fn().mockResolvedValue({ status: 'success' });

    render(
      <CourseNotepadView
        courseName="Master of Technology"
        noteId={mockNote.note_id}
        activeNote={mockNote}
        activeNoteLoading={false}
        saveStatus="saved"
        saveNote={saveNote}
        deleteNote={vi.fn()}
        onNavigateBack={vi.fn()}
        googleUser={mockUser}
        currentTheme={mockTheme}
      />
    );

    const titleInput = screen.getByPlaceholderText('Untitled Note');
    fireEvent.change(titleInput, { target: { value: 'Updated Thesis Notes Title' } });

    // Advance time - verify NO auto-save was triggered
    vi.advanceTimersByTime(3000);
    expect(saveNote).not.toHaveBeenCalled();

    // Verify unsaved changes indicator is shown
    expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument();

    // Click explicit Save button
    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveBtn);

    expect(saveNote).toHaveBeenCalledWith(
      'Master of Technology',
      mockNote.note_id,
      mockUser.email,
      expect.objectContaining({
        title: 'Updated Thesis Notes Title'
      })
    );

    vi.useRealTimers();
  });

  it('shows delete confirmation dialog on delete button click', () => {
    const deleteNote = vi.fn();
    render(
      <CourseNotepadView
        courseName="Master of Technology"
        noteId={mockNote.note_id}
        activeNote={mockNote}
        activeNoteLoading={false}
        saveStatus="saved"
        saveNote={vi.fn()}
        deleteNote={deleteNote}
        onNavigateBack={vi.fn()}
        googleUser={mockUser}
        currentTheme={mockTheme}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /delete note/i });
    fireEvent.click(deleteBtn);

    expect(screen.getByText(/Delete Notepad Note\?/i)).toBeInTheDocument();
  });

  it('saves when Ctrl+S shortcut is pressed', () => {
    const saveNote = vi.fn().mockResolvedValue({ status: 'success' });

    render(
      <CourseNotepadView
        courseName="Master of Technology"
        noteId={mockNote.note_id}
        activeNote={mockNote}
        activeNoteLoading={false}
        saveStatus="saved"
        saveNote={saveNote}
        deleteNote={vi.fn()}
        onNavigateBack={vi.fn()}
        googleUser={mockUser}
        currentTheme={mockTheme}
      />
    );

    const titleInput = screen.getByPlaceholderText('Untitled Note');
    fireEvent.change(titleInput, { target: { value: 'Shortcut Saved Title' } });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(saveNote).toHaveBeenCalledWith(
      'Master of Technology',
      mockNote.note_id,
      mockUser.email,
      expect.objectContaining({
        title: 'Shortcut Saved Title'
      })
    );
  });
});
