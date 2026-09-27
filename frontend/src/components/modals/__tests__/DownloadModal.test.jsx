import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DownloadModal from '../DownloadModal';

describe('DownloadModal', () => {
  it('returns null when open is false', () => {
    const { container } = render(
      <DownloadModal
        open={false}
        onClose={vi.fn()}
        activeData={{ title: 'Sample' }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal content when open is true, and clicking close invokes onClose', () => {
    const onClose = vi.fn();
    const activeData = {
      videoId: '123456',
      title: 'Intro to Python',
      course_name: 'CS50'
    };

    render(
      <DownloadModal
        open={true}
        onClose={onClose}
        activeData={activeData}
        gdriveStatus={{ configured: true }}
        gdriveError={null}
        setGdriveError={vi.fn()}
        gdriveAccessToken="mock-token"
        googleUser={{ name: 'Guido van Rossum', email: 'guido@python.org' }}
        googleClientIdInput=""
        setGoogleClientIdInput={vi.fn()}
        gdriveJob={null}
        gdriveUploading={false}
        handleGoogleSignIn={vi.fn()}
        handleGoogleSignOut={vi.fn()}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(screen.getByText('Save Lecture Bundle to Google Drive')).toBeInTheDocument();
    expect(screen.getAllByText(/Intro to Python/i).length).toBeGreaterThan(0);

    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders upload trigger button and starts upload when clicked', () => {
    const handleStartGdriveUpload = vi.fn();
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '123', title: 'Intro to Python' }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleStartGdriveUpload={handleStartGdriveUpload}
      />
    );

    const uploadBtn = screen.getByRole('button', { name: /Upload Full Bundle to Google Drive/i });
    expect(uploadBtn).toBeInTheDocument();
    fireEvent.click(uploadBtn);
    expect(handleStartGdriveUpload).toHaveBeenCalledTimes(1);
  });
});
