import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserLibrary } from '../useUserLibrary';

describe('useUserLibrary hook functionality', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches library and course data when userEmail is provided', async () => {
    const mockLibrary = [
      { video_id: 'v100', course_name: 'Algorithms', video_title: 'Sorting' }
    ];
    const mockCourses = [
      { course_name: 'Algorithms', lecture_count: 1 }
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/user/library')) {
        return Promise.resolve({ ok: true, json: async () => ({ library: mockLibrary }) });
      }
      if (url.includes('/api/user/courses')) {
        return Promise.resolve({ ok: true, json: async () => ({ courses: mockCourses }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));

    // Wait for useEffect fetch to complete
    await act(async () => {});

    expect(result.current.userLibrary).toEqual(mockLibrary);
    expect(result.current.effectiveCourses).toEqual(mockCourses);
  });

  it('filters courses according to librarySearch', async () => {
    const mockCourses = [
      { course_name: 'Quantum Physics', lecture_count: 3 },
      { course_name: 'Organic Chemistry', lecture_count: 2 }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ courses: mockCourses, library: [] })
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));
    await act(async () => {});

    act(() => {
      result.current.setLibrarySearch('Quantum');
    });

    expect(result.current.filteredCourses.length).toBe(1);
    expect(result.current.filteredCourses[0].course_name).toBe('Quantum Physics');
  });

  it('handleDeleteFromLibrary calls DELETE endpoint and removes item from state', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ library: [{ video_id: 'del-1' }, { video_id: 'del-2' }], courses: [] })
      });
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));
    await act(async () => {});

    await act(async () => {
      await result.current.handleDeleteFromLibrary('del-1');
    });

    expect(result.current.userLibrary.map(i => i.video_id)).toEqual(['del-2']);
  });
});
