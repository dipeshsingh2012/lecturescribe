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
});
