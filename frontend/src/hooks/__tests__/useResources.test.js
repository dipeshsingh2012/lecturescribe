import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResources } from '../useResources';

describe('useResources hook functionality', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches lecture resources when activeVideoId changes', async () => {
    const mockRes = [{ id: 'res-1', title: 'Cheat Sheet', file_type: 'pdf' }];
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/lecture/video-123/resources')) {
        return Promise.resolve({ ok: true, json: async () => ({ resources: mockRes }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ resources: [] }) });
    });

    const { result } = renderHook(() => useResources('video-123', null, null));
    await act(async () => {});

    expect(result.current.lectureResources).toEqual(mockRes);
  });

  it('opens and configures upload modal via openUploadModal', () => {
    const { result } = renderHook(() => useResources(null, null, null));
    expect(result.current.uploadModalOpen).toBe(false);

    act(() => {
      result.current.openUploadModal({ videoId: 'v10', courseName: 'Robotics' });
    });

    expect(result.current.uploadModalOpen).toBe(true);
    expect(result.current.uploadTarget).toEqual({ videoId: 'v10', courseName: 'Robotics' });
  });

  it('handleDeleteResource sends DELETE request and removes resource from state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/api/lecture/v1/resources')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ resources: [{ id: 'res-del-1' }, { id: 'res-keep-2' }] })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ resources: [] }) });
    });

    const { result } = renderHook(() => useResources('v1', null, { email: 'user@test.com' }));
    await act(async () => {});

    await act(async () => {
      await result.current.handleDeleteResource('res-del-1', 'v1', null);
    });

    expect(result.current.lectureResources.map(r => r.id)).toEqual(['res-keep-2']);
  });

  it('openPreviewModal sets previewResource for non-link file resources with fallbacks', () => {
    const { result } = renderHook(() => useResources(null, null, null));
    expect(result.current.previewResource).toBeNull();

    const fileRes = {
      id: 'res-pdf-1',
      title: 'Course Syllabus',
      filename: 'syllabus.pdf',
      file_type: 'pdf',
      file_url: 'https://storage.googleapis.com/test/syllabus.pdf'
    };

    act(() => {
      result.current.openPreviewModal(fileRes);
    });

    expect(result.current.previewResource).toBeTruthy();
    expect(result.current.previewResource.id).toBe('res-pdf-1');
    expect(result.current.previewResource.view_url).toBe('https://storage.googleapis.com/test/syllabus.pdf');

    act(() => {
      result.current.closePreviewModal();
    });
    expect(result.current.previewResource).toBeNull();
  });

  it('openPreviewModal opens target URL in new tab for link and gdrive resources', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    const { result } = renderHook(() => useResources(null, null, null));

    const linkRes = {
      id: 'res-link-1',
      title: 'Google Doc Notes',
      file_type: 'gdrive',
      download_url: 'https://docs.google.com/document/d/123'
    };

    act(() => {
      result.current.openPreviewModal(linkRes);
    });

    expect(result.current.previewResource).toBeNull();
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://docs.google.com/document/d/123',
      '_blank',
      'noopener,noreferrer'
    );
    windowOpenSpy.mockRestore();
  });

  it('merges course-wide materials into lectureResources for any lecture in the course', async () => {
    const lectureRes = [{ id: 'res-lec-1', video_id: 'vid-1', title: 'Lecture 1 Slides' }];
    const courseRes = [
      { id: 'res-course-1', video_id: null, title: 'Full Course Syllabus' },
      { id: 'res-lec-2', video_id: 'vid-2', title: 'Lecture 2 Notes' }
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/lecture/vid-1/resources')) {
        return Promise.resolve({ ok: true, json: async () => ({ resources: lectureRes }) });
      }
      if (url.includes('/api/course/cs101/resources') || url.includes('/api/course/CS101/resources')) {
        return Promise.resolve({ ok: true, json: async () => ({ resources: courseRes }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ resources: [] }) });
    });

    const { result } = renderHook(() => useResources('vid-1', 'CS101', null));
    await act(async () => {});

    // Should include both lecture-specific resource and course-level resource, but not lecture 2 resource
    const ids = result.current.lectureResources.map(r => r.id);
    expect(ids).toContain('res-lec-1');
    expect(ids).toContain('res-course-1');
    expect(ids).not.toContain('res-lec-2');
  });

  it('handleUploadResource uploads multiple files sequentially using pre-signed URLs', async () => {
    const user = { email: 'student@example.com' };
    const { result } = renderHook(() => useResources(null, 'CS101', user));

    act(() => {
      result.current.openUploadModal({ courseName: 'CS101', videoId: null });
      result.current.setUploadFiles([
        new File(['content-1'], 'week1_notes.pdf', { type: 'application/pdf' }),
        new File(['content-2'], 'week2_slides.pptx', { type: 'application/vnd.ms-powerpoint' })
      ]);
    });

    const presignCalls = [];
    const gcsPuts = [];
    const confirmCalls = [];

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/resources/presign-upload')) {
        const body = JSON.parse(opts.body);
        presignCalls.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            signed_url: `https://storage.googleapis.com/test-bucket/${body.filename}?sig=xyz`,
            blob_name: `courses/cs101/general/${body.filename}`
          })
        });
      }
      if (opts?.method === 'PUT') {
        gcsPuts.push(url);
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/api/resources/confirm-upload')) {
        const body = JSON.parse(opts.body);
        confirmCalls.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            resource: {
              id: `id-${body.filename}`,
              title: body.title,
              filename: body.filename,
              blob_name: body.blob_name,
              course_name: body.course_name
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ resources: [], readings: [] }) });
    });

    await act(async () => {
      await result.current.handleUploadResource();
    });

    expect(presignCalls.length).toBe(2);
    expect(presignCalls[0].filename).toBe('week1_notes.pdf');
    expect(presignCalls[1].filename).toBe('week2_slides.pptx');

    expect(gcsPuts.length).toBe(2);
    expect(confirmCalls.length).toBe(2);

    expect(result.current.uploadModalOpen).toBe(false);
    expect(result.current.courseResources.length).toBe(2);
  });
});
