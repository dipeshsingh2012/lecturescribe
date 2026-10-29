import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('triggers openUploadModal when Upload Resource header button is clicked', () => {
    const openUploadModal = vi.fn();
    render(
      <LectureResourcesShelf
        lectureResources={[]}
        lectureResourcesLoading={false}
        googleUser={{ email: 'student@example.com' }}
        handleDeleteResource={vi.fn()}
        activeData={{ videoId: '123' }}
        activeCourseData={{ course_name: 'CS101' }}
        selectedCourse="CS101"
        openUploadModal={openUploadModal}
      />
    );

    const uploadBtn = screen.getByRole('button', { name: /Upload Resource/i });
    expect(uploadBtn).toBeInTheDocument();
    fireEvent.click(uploadBtn);
    expect(openUploadModal).toHaveBeenCalledWith({
      videoId: '123',
      courseName: 'CS101'
    });
  });

  it('renders Course Material badge for course-level resources', () => {
    const resources = [
      {
        id: 'res-course-1',
        title: 'Full Course Syllabus',
        filename: 'syllabus.pdf',
        file_type: 'pdf',
        file_size_bytes: 512000,
        view_url: 'https://storage.googleapis.com/test/syllabus.pdf',
        video_id: null,
        course_name: 'AI 101',
        created_at: '2026-09-15T08:00:00Z',
        user_email: 'prof@example.com'
      }
    ];

    render(
      <LectureResourcesShelf
        lectureResources={resources}
        lectureResourcesLoading={false}
        googleUser={{ email: 'student@example.com' }}
        handleDeleteResource={vi.fn()}
        activeData={{ videoId: '123' }}
        selectedCourse="AI 101"
      />
    );

    expect(screen.getByText('Full Course Syllabus')).toBeInTheDocument();
    expect(screen.getByText('Course Material')).toBeInTheDocument();
  });

  it('defaults to Z - A sorting for lecture resources and allows switching order', () => {
    const resources = [
      {
        id: 'res-1',
        title: 'Alpha Introduction',
        filename: 'alpha.pdf',
        file_type: 'pdf',
        created_at: '2026-01-01T00:00:00Z'
      },
      {
        id: 'res-2',
        title: 'Zeta Summary',
        filename: 'zeta.pdf',
        file_type: 'pdf',
        created_at: '2026-01-02T00:00:00Z'
      },
      {
        id: 'res-3',
        title: 'Beta Exercises',
        filename: 'beta.pdf',
        file_type: 'pdf',
        created_at: '2026-01-03T00:00:00Z'
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
      />
    );

    // Verify sort controls are visible
    const sortSelect = screen.getByRole('combobox', { name: /Sort resources/i });
    expect(sortSelect).toBeInTheDocument();
    expect(sortSelect.value).toBe('title_desc'); // Z - A is default

    // Verify default Z - A order: Zeta Summary, Beta Exercises, Alpha Introduction
    let titles = screen.getAllByText(/(Alpha Introduction|Beta Exercises|Zeta Summary)/);
    expect(titles.map(t => t.textContent)).toEqual([
      'Zeta Summary',
      'Beta Exercises',
      'Alpha Introduction'
    ]);

    // Change sort to A - Z via select
    fireEvent.change(sortSelect, { target: { value: 'title_asc' } });
    titles = screen.getAllByText(/(Alpha Introduction|Beta Exercises|Zeta Summary)/);
    expect(titles.map(t => t.textContent)).toEqual([
      'Alpha Introduction',
      'Beta Exercises',
      'Zeta Summary'
    ]);

    // Toggle back to Z - A using toggle button
    const toggleBtn = screen.getByRole('button', { name: /Toggle sort order/i });
    fireEvent.click(toggleBtn);
    titles = screen.getAllByText(/(Alpha Introduction|Beta Exercises|Zeta Summary)/);
    expect(titles.map(t => t.textContent)).toEqual([
      'Zeta Summary',
      'Beta Exercises',
      'Alpha Introduction'
    ]);
  });

  it('supports renaming a resource inline', async () => {
    const handleRenameResource = vi.fn().mockResolvedValue(true);
    const resources = [
      {
        id: 'res-1',
        title: 'Original Title',
        filename: 'notes.pdf',
        file_type: 'pdf',
        created_at: '2026-01-01T00:00:00Z',
        user_email: 'student@example.com'
      }
    ];

    render(
      <LectureResourcesShelf
        lectureResources={resources}
        lectureResourcesLoading={false}
        googleUser={{ email: 'student@example.com' }}
        handleDeleteResource={vi.fn()}
        handleRenameResource={handleRenameResource}
        activeData={{ videoId: '123' }}
        selectedCourse="Math"
      />
    );

    const renameBtn = screen.getByRole('button', { name: /Rename resource/i });
    fireEvent.click(renameBtn);

    const input = screen.getByPlaceholderText('Resource title');
    expect(input).toHaveValue('Original Title');

    fireEvent.change(input, { target: { value: 'Updated Title' } });
    const saveBtn = screen.getByRole('button', { name: /Save title/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(handleRenameResource).toHaveBeenCalledWith('res-1', 'Updated Title');
  });
});
