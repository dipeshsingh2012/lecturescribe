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

  it('renders Authorize Google Drive button when googleUser is signed in but drive token is missing', () => {
    const handleGoogleSignIn = vi.fn();
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '123', title: 'Intro to Python' }}
        gdriveStatus={{ configured: true, client_id: 'test-client-id' }}
        gdriveAccessToken=""
        googleUser={{ email: 'prof@harvard.edu' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleGoogleSignIn={handleGoogleSignIn}
      />
    );

    expect(screen.getByText(/Authorize Google Drive Access for/i)).toBeInTheDocument();
    expect(screen.getAllByText('prof@harvard.edu').length).toBeGreaterThan(0);

    const authBtn = screen.getByRole('button', { name: /Authorize Google Drive/i });
    expect(authBtn).toBeInTheDocument();
    fireEvent.click(authBtn);
    expect(handleGoogleSignIn).toHaveBeenCalledWith(false);
  });

  it('renders Resume Upload to Google Drive button when upload fails and partial files exist', () => {
    const handleStartGdriveUpload = vi.fn();
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '123', title: 'Intro to Python' }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={{
          status: 'FAILED',
          progress: 60,
          error: 'Connection timeout',
          folder_url: 'https://drive.google.com/drive/folders/123',
          files: [{ id: 'f1', name: 'summary.md', url: 'https://drive.google.com/file/d/f1/view' }]
        }}
        gdriveUploading={false}
        handleStartGdriveUpload={handleStartGdriveUpload}
      />
    );

    expect(screen.getByText(/Partially Uploaded \(1 saved in Google Drive\)/i)).toBeInTheDocument();
    const resumeBtn = screen.getByRole('button', { name: /Resume Upload to Google Drive/i });
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);
    expect(handleStartGdriveUpload).toHaveBeenCalledTimes(1);
  });

  it('renders Resuming Upload button label while actively resuming', () => {
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '123', title: 'Intro to Python' }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={{
          status: 'FAILED',
          progress: 55,
          files: [{ id: 'f1', name: 'summary.md' }]
        }}
        gdriveUploading={true}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Resuming Upload to Google Drive\.\.\./i })).toBeInTheDocument();
  });

  it('renders already synced messaging, Open in Google Drive link, and Re-upload button when drive_folder_url is present', () => {
    const handleStartGdriveUpload = vi.fn();
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{
          videoId: '123',
          title: 'Intro to Python',
          drive_folder_url: 'https://drive.google.com/drive/folders/folder-xyz'
        }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleStartGdriveUpload={handleStartGdriveUpload}
      />
    );

    expect(screen.getByText('Lecture Bundle Synced to Google Drive')).toBeInTheDocument();
    expect(screen.getByText('Already Synced to Google Drive')).toBeInTheDocument();

    const openDriveLink = screen.getByRole('link', { name: /Open in Google Drive/i });
    expect(openDriveLink).toBeInTheDocument();
    expect(openDriveLink).toHaveAttribute('href', 'https://drive.google.com/drive/folders/folder-xyz');

    const reuploadBtn = screen.getByRole('button', { name: /Re-upload Bundle to Google Drive/i });
    expect(reuploadBtn).toBeInTheDocument();
    fireEvent.click(reuploadBtn);
    expect(handleStartGdriveUpload).toHaveBeenCalledTimes(1);
  });

  it('renders Re-upload button and Re-uploading label when gdriveJob status is COMPLETED and uploading is initiated', () => {
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '123', title: 'Intro to Python' }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={{
          status: 'COMPLETED',
          progress: 100,
          folder_url: 'https://drive.google.com/drive/folders/folder-abc',
          files: [{ id: 'f1', name: 'summary.md' }]
        }}
        gdriveUploading={true}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Re-uploading Bundle to Google Drive\.\.\./i })).toBeInTheDocument();
  });

  it('detects already synced state when drive_folder_url is supplied via userLibrary prop', () => {
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '1230001154', title: 'Machine Learning Paradigms' }}
        userLibrary={[
          { video_id: '1230001154', drive_folder_url: 'https://drive.google.com/drive/folders/from-user-lib' }
        ]}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(screen.getByText('Lecture Bundle Synced to Google Drive')).toBeInTheDocument();
    expect(screen.getByText('Already Synced to Google Drive')).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: /Open in Google Drive/i });
    expect(openLink).toHaveAttribute('href', 'https://drive.google.com/drive/folders/from-user-lib');
    expect(screen.getByRole('button', { name: /Re-upload Bundle to Google Drive/i })).toBeInTheDocument();
  });

  it('detects already synced state when driveFolderUrl is supplied via effectiveCourses prop', () => {
    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ video_id: '1230001154', title: 'Machine Learning Paradigms' }}
        effectiveCourses={[
          {
            course_name: 'ML',
            lectures: [
              { videoId: '1230001154', driveFolderUrl: 'https://drive.google.com/drive/folders/from-course' }
            ]
          }
        ]}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(screen.getByText('Lecture Bundle Synced to Google Drive')).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: /Open in Google Drive/i });
    expect(openLink).toHaveAttribute('href', 'https://drive.google.com/drive/folders/from-course');
    expect(screen.getByRole('button', { name: /Re-upload Bundle to Google Drive/i })).toBeInTheDocument();
  });

  it('fetches library fallback when open and sets synced state if matching drive_folder_url found', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          lectures: [
            { videoId: '999', drive_folder_url: 'https://drive.google.com/drive/folders/fallback-url' }
          ]
        })
      })
    );

    render(
      <DownloadModal
        open={true}
        onClose={vi.fn()}
        activeData={{ videoId: '999', title: 'Deep Learning' }}
        gdriveStatus={{ configured: true }}
        gdriveAccessToken="mock-token"
        googleUser={{ email: 'user@example.com' }}
        gdriveJob={null}
        gdriveUploading={false}
        handleStartGdriveUpload={vi.fn()}
      />
    );

    expect(await screen.findByText('Lecture Bundle Synced to Google Drive')).toBeInTheDocument();
    expect(await screen.findByText('Already Synced to Google Drive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Google Drive/i })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/fallback-url');
    fetchSpy.mockRestore();
  });
});

