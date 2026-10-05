import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCourseDetail } from '../useCourseDetail';

describe('useCourseDetail hook functionality', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('resolves activeCourseData from effectiveCourses matching selectedCourse', () => {
    const effectiveCourses = [
      {
        course_name: 'Database Systems',
        lectures: [
          { video_id: 'db1', video_title: 'SQL Indexing' },
          { video_id: 'db2', video_title: 'B-Trees' }
        ]
      }
    ];

    const { result } = renderHook(() =>
      useCourseDetail(effectiveCourses, 'user@example.com', '', null)
    );

    act(() => {
      result.current.setSelectedCourse('Database Systems');
    });

    expect(result.current.activeCourseData.course_name).toBe('Database Systems');
    expect(result.current.filteredCourseLectures.length).toBe(2);
  });

  it('filters course lectures by search keyword', () => {
    const effectiveCourses = [
      {
        course_name: 'Database Systems',
        lectures: [
          { video_id: 'db1', video_title: 'SQL Indexing' },
          { video_id: 'db2', video_title: 'B-Trees' }
        ]
      }
    ];

    const { result, rerender } = renderHook(
      ({ search }) => useCourseDetail(effectiveCourses, 'user@example.com', search, null),
      { initialProps: { search: '' } }
    );

    act(() => {
      result.current.setSelectedCourse('Database Systems');
    });

    expect(result.current.filteredCourseLectures.length).toBe(2);

    rerender({ search: 'Indexing' });
    expect(result.current.filteredCourseLectures.length).toBe(1);
    expect(result.current.filteredCourseLectures[0].video_title).toBe('SQL Indexing');
  });

  it('fetches directCourseData when course is not in effectiveCourses', async () => {
    const coursePayload = {
      course_name: 'New External Course',
      lectures: [{ video_id: 'ext-1', video_title: 'Intro' }]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ course: coursePayload })
    });

    const { result } = renderHook(() =>
      useCourseDetail([], 'user@example.com', '', null)
    );

    act(() => {
      result.current.setSelectedCourse('new-external-course');
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
      expect(result.current.activeCourseData?.course_name).toBe('New External Course');
    });
  });

  it('merges new and existing lectures on refetchCourse so no lectures are lost', async () => {
    const initialCoursePayload = {
      course_name: 'Applied Mathematics',
      course_slug: 'applied-mathematics',
      lectures: [
        { video_id: 'm1', video_title: 'Calculus' },
        { video_id: 'm2', video_title: 'Linear Algebra' }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ course: initialCoursePayload })
    });

    const { result } = renderHook(() =>
      useCourseDetail([], 'user@example.com', '', null)
    );

    act(() => {
      result.current.setSelectedCourse('Applied Mathematics');
    });

    await waitFor(() => {
      expect(result.current.activeCourseData?.lectures?.length).toBe(2);
    });

    // Now refetch returns only the newly added lecture or updated lecture list
    const updatedPayload = {
      course_name: 'Applied Mathematics',
      course_slug: 'applied-mathematics',
      lectures: [
        { video_id: 'm3', video_title: 'Probability (Newly Added)' }
      ]
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ course: updatedPayload })
    });

    await act(async () => {
      await result.current.refetchCourse('Applied Mathematics');
    });

    // ALL 3 lectures must be present! None lost!
    expect(result.current.activeCourseData.lectures.length).toBe(3);
    const lectureIds = result.current.activeCourseData.lectures.map(l => l.video_id);
    expect(lectureIds).toContain('m1');
    expect(lectureIds).toContain('m2');
    expect(lectureIds).toContain('m3');
  });

  it('combines lectures from both effectiveCourses and directCourseData', () => {
    const effectiveCourses = [
      {
        course_name: 'Data Science',
        course_slug: 'data-science',
        lectures: [
          { video_id: 'ds1', video_title: 'Python for DS' }
        ]
      }
    ];

    const { result } = renderHook(() =>
      useCourseDetail(effectiveCourses, 'user@example.com', '', null)
    );

    act(() => {
      result.current.setSelectedCourse('Data Science');
      result.current.setDirectCourseData({
        course_name: 'Data Science',
        course_slug: 'data-science',
        lectures: [
          { video_id: 'ds2', video_title: 'Pandas & NumPy' }
        ]
      });
    });

    // Should merge ds1 and ds2
    expect(result.current.activeCourseData.lectures.length).toBe(2);
    const ids = result.current.activeCourseData.lectures.map(l => l.video_id);
    expect(ids).toContain('ds1');
    expect(ids).toContain('ds2');
  });

  it('immediately includes lecture via addLectureToCourse', () => {
    const { result } = renderHook(() =>
      useCourseDetail([], 'user@example.com', '', null)
    );

    act(() => {
      result.current.setSelectedCourse('Biology');
    });

    act(() => {
      result.current.addLectureToCourse({ video_id: 'bio-1', title: 'Cell Biology' }, 'Biology');
    });

    expect(result.current.activeCourseData.lectures.length).toBe(1);
    expect(result.current.activeCourseData.lectures[0].video_id).toBe('bio-1');

    act(() => {
      result.current.addLectureToCourse({ video_id: 'bio-2', title: 'Genetics' }, 'Biology');
    });

    expect(result.current.activeCourseData.lectures.length).toBe(2);
  });
});
