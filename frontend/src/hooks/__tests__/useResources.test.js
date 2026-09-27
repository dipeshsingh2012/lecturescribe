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
});
