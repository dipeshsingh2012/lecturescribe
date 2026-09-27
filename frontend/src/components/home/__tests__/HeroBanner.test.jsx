import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HeroBanner from '../HeroBanner';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('HeroBanner', () => {
  it('renders guest state with sign in button when no googleUser', () => {
    const handleGoogleSignIn = vi.fn();
    render(
      <HeroBanner
        googleUser={null}
        userLibrary={[]}
        handleGoogleSignIn={handleGoogleSignIn}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Welcome back, Scholar!/i)).toBeInTheDocument();
    const signInBtn = screen.getByRole('button', { name: /Sign in with Google/i });
    expect(signInBtn).toBeInTheDocument();

    fireEvent.click(signInBtn);
    expect(handleGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders authenticated user profile and stats when googleUser is provided', () => {
    const user = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      picture: 'https://example.com/avatar.jpg'
    };
    const library = [
      { course_name: 'CS101', total_duration_seconds: 3600 },
      { course_name: 'CS101', total_duration_seconds: 1800 },
      { course_name: 'MATH201', total_duration_seconds: 7200 }
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
  });
});
