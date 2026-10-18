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

  it('handleTogglePin appends pinned courses in FIFO order and updates filteredCourses', async () => {
    const mockCourses = [
      { course_name: 'Biology', course_slug: 'biology', lecture_count: 1 },
      { course_name: 'Physics', course_slug: 'physics', lecture_count: 2 },
      { course_name: 'Chemistry', course_slug: 'chemistry', lecture_count: 3 }
    ];

    let mockPinnedList = [];
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/api/user/courses/pin') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (mockPinnedList.includes(body.course_slug)) {
          mockPinnedList = mockPinnedList.filter(s => s !== body.course_slug);
        } else {
          mockPinnedList.push(body.course_slug);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            is_pinned: mockPinnedList.includes(body.course_slug),
            pinned_courses: [...mockPinnedList]
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ courses: mockCourses, library: [] })
      });
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));
    await act(async () => {});

    // 1. Pin Physics first
    await act(async () => {
      await result.current.handleTogglePin('physics');
    });

    expect(result.current.pinnedCourses).toEqual(['physics']);
    expect(result.current.filteredCourses[0].course_slug).toBe('physics');
    expect(result.current.filteredCourses[0].is_pinned).toBe(true);

    // 2. Pin Chemistry second -> must append to back of pinned list (physics, chemistry)
    await act(async () => {
      await result.current.handleTogglePin('chemistry');
    });

    expect(result.current.pinnedCourses).toEqual(['physics', 'chemistry']);
    expect(result.current.filteredCourses[0].course_slug).toBe('physics');
    expect(result.current.filteredCourses[1].course_slug).toBe('chemistry');
    expect(result.current.filteredCourses[2].course_slug).toBe('biology');
    expect(result.current.filteredCourses[2].is_pinned).toBe(false);

    // 3. Toggle Physics -> should unpin Physics, leaving Chemistry as #1
    await act(async () => {
      await result.current.handleTogglePin('physics');
    });

    expect(result.current.pinnedCourses).toEqual(['chemistry']);
    expect(result.current.filteredCourses[0].course_slug).toBe('chemistry');
  });
});

