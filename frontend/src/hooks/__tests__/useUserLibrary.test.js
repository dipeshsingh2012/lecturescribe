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

  it('hydrates both userCourses and userLibrary from single /api/user/courses call when library is included', async () => {
    const mockLecture = { video_id: 'v200', course_name: 'Deep Learning', title: 'CNNs' };
    const mockCourses = [
      { course_name: 'Deep Learning', course_slug: 'deep-learning', lecture_count: 1, lectures: [mockLecture] }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        courses: mockCourses,
        library: [mockLecture],
        pinned_courses: ['deep-learning']
      })
    });

    const { result } = renderHook(() => useUserLibrary('fast@example.com'));
    await act(async () => {});

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/user/courses');
    expect(result.current.userLibrary).toEqual([mockLecture]);
    expect(result.current.pinnedCourses).toEqual(['deep-learning']);
  });

  it('handleRenameCourse updates userCourses, userLibrary, and pinnedCourses', async () => {
    const mockLecture = { video_id: 'v300', course_name: 'ML Intro', title: 'Session 1' };
    const mockCourses = [
      { course_name: 'ML Intro', course_slug: 'ml-intro', lecture_count: 1, lectures: [mockLecture] }
    ];

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            course_name: 'Machine Learning',
            course_slug: 'machine-learning',
            old_name: 'ML Intro',
            old_slug: 'ml-intro',
            aliases: ['ml-intro']
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'success',
          courses: mockCourses,
          library: [mockLecture],
          pinned_courses: ['ml-intro']
        })
      });
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));
    await act(async () => {});

    expect(result.current.filteredCourses[0].course_name).toBe('ML Intro');
    expect(result.current.pinnedCourses).toEqual(['ml-intro']);

    await act(async () => {
      await result.current.handleRenameCourse('ml-intro', 'Machine Learning');
    });

    expect(result.current.userCourses[0].course_name).toBe('Machine Learning');
    expect(result.current.userCourses[0].course_slug).toBe('machine-learning');
    expect(result.current.userLibrary[0].course_name).toBe('Machine Learning');
    expect(result.current.pinnedCourses).toEqual(['machine-learning']);
  });

  it('handleRenameLecture updates lecture titles in userLibrary and userCourses', async () => {
    const mockLecture = {
      video_id: 'vid-99',
      course_name: 'CS101',
      title: 'Old Lecture Title',
      video_title: 'Old Lecture Title'
    };
    const mockCourses = [
      {
        course_name: 'CS101',
        course_slug: 'cs101',
        lecture_count: 1,
        lectures: [mockLecture]
      }
    ];

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'PATCH' && url.includes('/api/videos/vid-99')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            video_id: 'vid-99',
            title: 'New Improved Title'
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'success',
          courses: mockCourses,
          library: [mockLecture]
        })
      });
    });

    const { result } = renderHook(() => useUserLibrary('user@example.com'));
    await act(async () => {});

    expect(result.current.userLibrary[0].title).toBe('Old Lecture Title');

    await act(async () => {
      await result.current.handleRenameLecture('vid-99', 'New Improved Title');
    });

    expect(result.current.userLibrary[0].title).toBe('New Improved Title');
    expect(result.current.userLibrary[0].video_title).toBe('New Improved Title');
    expect(result.current.userCourses[0].lectures[0].title).toBe('New Improved Title');
  });
});

