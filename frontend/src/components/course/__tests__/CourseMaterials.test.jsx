import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseMaterials from '../CourseMaterials';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseMaterials', () => {
  it('renders loading indicator when courseResourcesLoading is true', () => {
    render(
      <CourseMaterials
        courseResourcesLoading={true}
        courseResources={[]}
        googleUser={null}
        selectedCourse="AI 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Loading course materials...')).toBeInTheDocument();
  });

  it('renders empty state when there are no course materials', () => {
    render(
      <CourseMaterials
        courseResourcesLoading={false}
        courseResources={[]}
        googleUser={null}
        selectedCourse="AI 101"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('No Course Materials Yet')).toBeInTheDocument();
  });

  it('renders resource items and allows deletion if authenticated owner', () => {
    const handleDeleteResource = vi.fn();
    const resources = [
      {
        id: 'res-1',
        title: 'Syllabus PDF',
        filename: 'syllabus.pdf',
        file_type: 'pdf',
        file_size_bytes: 1048576,
        download_url: 'https://storage.googleapis.com/test/syllabus.pdf',
        created_at: '2026-09-01T00:00:00Z',
        source_type: 'file',
        lecture_title: 'Intro',
        user_email: 'prof@example.com'
      }
    ];

    render(
      <CourseMaterials
        courseResourcesLoading={false}
        courseResources={resources}
        googleUser={{ email: 'prof@example.com' }}
        selectedCourse="AI 101"
        handleDeleteResource={handleDeleteResource}
        openUploadModal={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Syllabus PDF')).toBeInTheDocument();
    expect(screen.getByText('1 MB')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: /Delete Resource/i });
    fireEvent.click(deleteBtn);
    expect(handleDeleteResource).toHaveBeenCalledWith('res-1', undefined, 'AI 101');
  });

  it('triggers openPreviewModal when View button is clicked', () => {
    const openPreviewModal = vi.fn();
    const resources = [
      {
        id: 'res-2',
        title: 'Neural Networks Notes',
        filename: 'notes.pdf',
        file_type: 'pdf',
        file_size_bytes: 500000,
        view_url: 'https://storage.googleapis.com/test/notes.pdf?inline=1',
        download_url: 'https://storage.googleapis.com/test/notes.pdf',
        created_at: '2026-09-02T00:00:00Z',
        source_type: 'file',
        user_email: 'prof@example.com'
      }
    ];

    render(
      <CourseMaterials
        courseResourcesLoading={false}
        courseResources={resources}
        googleUser={{ email: 'prof@example.com' }}
        selectedCourse="AI 101"
        handleDeleteResource={vi.fn()}
        openUploadModal={vi.fn()}
        openPreviewModal={openPreviewModal}
        currentTheme={mockTheme}
      />
    );

    const viewBtn = screen.getByRole('button', { name: /View/i });
    fireEvent.click(viewBtn);
    expect(openPreviewModal).toHaveBeenCalledWith(resources[0]);
  });

  it('falls back to window.open when openPreviewModal is omitted and View is clicked', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    const resources = [
      {
        id: 'res-3',
        title: 'Project Guidelines',
        filename: 'guidelines.pdf',
        file_type: 'pdf',
        view_url: 'https://storage.googleapis.com/test/guidelines.pdf',
        created_at: '2026-09-03T00:00:00Z'
      }
    ];

    render(
      <CourseMaterials
        courseResourcesLoading={false}
        courseResources={resources}
        googleUser={null}
        selectedCourse="AI 101"
        currentTheme={mockTheme}
      />
    );

    const viewBtn = screen.getByRole('button', { name: /View/i });
    fireEvent.click(viewBtn);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://storage.googleapis.com/test/guidelines.pdf',
      '_blank',
      'noopener,noreferrer'
    );
    windowOpenSpy.mockRestore();
  });
});
