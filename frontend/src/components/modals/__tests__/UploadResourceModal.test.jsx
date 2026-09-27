import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UploadResourceModal from '../UploadResourceModal';

describe('UploadResourceModal', () => {
  it('returns null when open is false', () => {
    const { container } = render(
      <UploadResourceModal
        open={false}
        onClose={vi.fn()}
        uploadTarget={{}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with mode tabs and allows switching modes', () => {
    const setUploadMode = vi.fn();
    render(
      <UploadResourceModal
        open={true}
        onClose={vi.fn()}
        uploadTarget={{ videoId: '123', courseName: 'Data Science' }}
        uploadMode="file"
        setUploadMode={setUploadMode}
        uploadFile={null}
        setUploadFile={vi.fn()}
        uploadTitle=""
        setUploadTitle={vi.fn()}
        uploadLinkUrl=""
        setUploadLinkUrl={vi.fn()}
        isUploading={false}
        uploadError={null}
        setUploadError={vi.fn()}
        handleUploadResource={vi.fn()}
      />
    );

    expect(screen.getByText('Add Lecture Resource')).toBeInTheDocument();
    expect(screen.getByText(/Attaching to lecture in Data Science/i)).toBeInTheDocument();

    const linkTab = screen.getByRole('button', { name: /External Link/i });
    fireEvent.click(linkTab);
    expect(setUploadMode).toHaveBeenCalledWith('link');
  });

  it('triggers handleUploadResource when save button is clicked in link mode', () => {
    const handleUploadResource = vi.fn();
    render(
      <UploadResourceModal
        open={true}
        onClose={vi.fn()}
        uploadTarget={{ videoId: null, courseName: 'Data Science' }}
        uploadMode="link"
        setUploadMode={vi.fn()}
        uploadFile={null}
        setUploadFile={vi.fn()}
        uploadTitle="Official Docs"
        setUploadTitle={vi.fn()}
        uploadLinkUrl="https://numpy.org"
        setUploadLinkUrl={vi.fn()}
        isUploading={false}
        uploadError={null}
        setUploadError={vi.fn()}
        handleUploadResource={handleUploadResource}
      />
    );

    expect(screen.getByText('Add Course Material')).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: /Save Link/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    expect(handleUploadResource).toHaveBeenCalledTimes(1);
  });
});
