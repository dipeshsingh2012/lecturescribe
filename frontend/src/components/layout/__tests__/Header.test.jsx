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

    const summaryBtn = screen.getByRole('button', { name: /Summary/i });
    const tutorBtn = screen.getByRole('button', { name: /AI Tutor/i });
    const quizBtn = screen.getByRole('button', { name: /Quiz/i });
    const searchBtn = screen.getByRole('button', { name: /Search/i });
    const gdriveBtn = screen.getByRole('button', { name: /Save to Google Drive/i });

    expect(summaryBtn).toBeInTheDocument();
    expect(tutorBtn).toBeInTheDocument();
    expect(quizBtn).toBeInTheDocument();
    expect(searchBtn).toBeInTheDocument();
    expect(gdriveBtn).toBeInTheDocument();

    fireEvent.click(summaryBtn);
    expect(setActiveTab).toHaveBeenCalledWith('summary');

    fireEvent.click(tutorBtn);
    expect(setActiveTab).toHaveBeenCalledWith('tutor');

    fireEvent.click(quizBtn);
    expect(setActiveTab).toHaveBeenCalledWith('quiz');

    fireEvent.click(searchBtn);
    expect(setActiveTab).toHaveBeenCalledWith('transcript');

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

  it('renders "Saved in Google Drive" state on Google Drive button when drive_folder_url is present', () => {
    const openDownloadModal = vi.fn();
    const activeData = {
      videoId: '123',
      title: 'Calculus 101',
      drive_folder_url: 'https://drive.google.com/drive/folders/calc101'
    };

    render(
      <Header
        activeData={activeData}
        activeTab="transcript"
        setActiveTab={vi.fn()}
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

    const gdriveBtn = screen.getByRole('button', { name: /Saved in Google Drive/i });
    expect(gdriveBtn).toBeInTheDocument();
    expect(screen.getByTitle('Saved in Drive')).toBeInTheDocument();

    fireEvent.click(gdriveBtn);
    expect(openDownloadModal).toHaveBeenCalledTimes(1);
  });
});
