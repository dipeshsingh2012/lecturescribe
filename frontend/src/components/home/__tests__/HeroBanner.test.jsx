import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HeroBanner from '../HeroBanner';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('HeroBanner', () => {
  it('renders guest state when no googleUser', () => {
    render(
      <HeroBanner
        googleUser={null}
        userLibrary={[]}
        handleGoogleSignIn={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Welcome back, Scholar!/i)).toBeInTheDocument();
    expect(screen.getByText(/Personal Learning Management System/i)).toBeInTheDocument();
  });

  it('renders authenticated user profile and stats when googleUser is provided', () => {
    const user = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      picture: 'https://example.com/avatar.jpg'
    };
    const library = [
      { course_name: 'CS101', drive_folder_url: 'https://drive.google.com/1' },
      { course_name: 'CS101', drive_folder_url: null },
      { course_name: 'MATH201', drive_folder_url: 'https://drive.google.com/2' }
    ];

    render(
      <HeroBanner
        googleUser={user}
        userLibrary={library}
        handleGoogleSignIn={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Welcome back, Ada!/i)).toBeInTheDocument();
    expect(screen.getByText('Total Lectures')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Google Drive Synced')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});