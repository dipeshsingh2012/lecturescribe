import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../Header';
import { LMS_THEMES } from '../../../store/themeStore';

vi.mock('@dipesh.singh/proton', () => ({
  ProtonThemeSelector: () => <div data-testid="proton-theme-selector">ProtonThemeSelector</div>
}));

const mockTheme = LMS_THEMES.academic;

describe('Header', () => {
  it('renders brand name and clicking it invokes handleBackToHub', () => {
    const handleBackToHub = vi.fn();
    render(
      <Header
        activeData={null}
        activeTab="transcript"
        setActiveTab={vi.fn()}
        openDownloadModal={vi.fn()}
        googleUser={null}
        handleGoogleSignIn={vi.fn()}
        handleGoogleSignOut={vi.fn()}
        handleBackToHub={handleBackToHub}
        userLibrary={[]}
        userMenuAnchor={null}
        setUserMenuAnchor={vi.fn()}
        currentThemeId="academic"
        setTheme={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const brand = screen.getByText('LearnScribe LMS');
    expect(brand).toBeInTheDocument();
    fireEvent.click(brand);
    expect(handleBackToHub).toHaveBeenCalledTimes(1);
  });

  it('renders lecture navigation buttons when activeData is present', () => {
    const setActiveTab = vi.fn();
    const openDownloadModal = vi.fn();
    const activeData = { videoId: '123', title: 'Calculus 101' };

    render(
      <Header
        activeData={activeData}
        activeTab="transcript"
        setActiveTab={setActiveTab}
        openDownloadModal={openDownloadModal}
        googleUser={null}
        handleGoogleSignIn={vi.fn()}
        handleGoogleSignOut={vi.fn()}
        handleBackToHub={vi.fn()}
        userLibrary={[]}
        userMenuAnchor={null}
        setUserMenuAnchor={vi.fn()}
        currentThemeId="academic"
        setTheme={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const searchBtn = screen.getByRole('button', { name: /Search Transcript/i });
    const tutorBtn = screen.getByRole('button', { name: /AI Tutor/i });
    const gdriveBtn = screen.getByRole('button', { name: /Save to Google Drive/i });

    expect(searchBtn).toBeInTheDocument();
    expect(tutorBtn).toBeInTheDocument();
    expect(gdriveBtn).toBeInTheDocument();

    fireEvent.click(tutorBtn);
    expect(setActiveTab).toHaveBeenCalledWith('tutor');

    fireEvent.click(gdriveBtn);
    expect(openDownloadModal).toHaveBeenCalledTimes(1);
  });

  it('renders Google sign-in button when logged out', () => {
    const handleGoogleSignIn = vi.fn();
    render(
      <Header
        activeData={null}
        activeTab="transcript"
        setActiveTab={vi.fn()}
        openDownloadModal={vi.fn()}
        googleUser={null}
        handleGoogleSignIn={handleGoogleSignIn}
        handleGoogleSignOut={vi.fn()}
        handleBackToHub={vi.fn()}
        userLibrary={[]}
        userMenuAnchor={null}
        setUserMenuAnchor={vi.fn()}
        currentThemeId="academic"
        setTheme={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const signInBtn = screen.getByRole('button', { name: /Sign In/i });
    expect(signInBtn).toBeInTheDocument();
    fireEvent.click(signInBtn);
    expect(handleGoogleSignIn).toHaveBeenCalledWith(false);
  });
});
