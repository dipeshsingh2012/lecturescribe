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
      expect(result.current.activeCourseData?.course_name).toBe('New External Course');
    });
  });
});
