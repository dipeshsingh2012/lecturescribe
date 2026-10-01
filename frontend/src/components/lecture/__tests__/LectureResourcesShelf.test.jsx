import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureResourcesShelf from '../LectureResourcesShelf';

describe('LectureResourcesShelf', () => {
  it('renders empty notice when lectureResources is empty', () => {
    render(
      <LectureResourcesShelf
        lectureResources={[]}
        lectureResourcesLoading={false}
        googleUser={null}
        handleDeleteResource={vi.fn()}
        activeData={{ videoId: '123' }}
        selectedCourse="Math"
      />
    );

    expect(screen.getByText(/No materials or slides attached to this lecture yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign in to upload resources/i)).toBeInTheDocument();
  });

  it('renders resource cards and triggers handleDeleteResource when delete is clicked', () => {
    const handleDeleteResource = vi.fn();
    const resources = [
      {
        id: 'res-lecture-1',
        title: 'Lecture Slides Chapter 1',
        filename: 'slides_ch1.pptx',
        file_type: 'ppt',
        file_size_bytes: 2048000,
        download_url: 'https://storage.googleapis.com/test/slides.pptx',
        source_type: 'file',
        created_at: '2026-09-15T08:00:00Z',
        user_email: 'student@example.com'
      }
    ];

    render(
      <LectureResourcesShelf
        lectureResources={resources}
        lectureResourcesLoading={false}
        googleUser={{ email: 'student@example.com' }}
        handleDeleteResource={handleDeleteResource}
        activeData={{ videoId: '123' }}
        selectedCourse="Math"
      />
    );

    expect(screen.getByText('Lecture Slides Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('2 MB')).toBeInTheDocument();

    const deleteBtn = screen.getByTitle('Delete Resource');
    fireEvent.click(deleteBtn);
    expect(handleDeleteResource).toHaveBeenCalledWith('res-lecture-1', '123', 'Math');
  });

  it('triggers openPreviewModal when View button is clicked', () => {
    const openPreviewModal = vi.fn();
    const resources = [
      {
        id: 'res-lecture-2',
        title: 'Midterm Review',
        filename: 'midterm.pdf',
        file_type: 'pdf',
        file_size_bytes: 1024000,
        view_url: 'https://storage.googleapis.com/test/midterm.pdf',
        download_url: 'https://storage.googleapis.com/test/midterm.pdf',
        source_type: 'file',
        created_at: '2026-09-15T08:00:00Z',
        user_email: 'student@example.com'
      }
    ];

    render(
      <LectureResourcesShelf
        lectureResources={resources}
        lectureResourcesLoading={false}
        googleUser={{ email: 'student@example.com' }}
        handleDeleteResource={vi.fn()}
        activeData={{ videoId: '123' }}
        selectedCourse="Math"
        openPreviewModal={openPreviewModal}
      />
    );

    const viewBtn = screen.getByRole('button', { name: /View/i });
    fireEvent.click(viewBtn);
    expect(openPreviewModal).toHaveBeenCalledWith(resources[0]);
  });
});
