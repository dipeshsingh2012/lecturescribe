import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLectureIngestion } from '../useLectureIngestion';

describe('useLectureIngestion hook functionality', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('transcribes video via API when not in client cache', async () => {
    const lecturePayload = {
      videoId: '76979871',
      title: 'The New Normal',
      cues: [{ time: '00:10', text: 'Opening remarks' }],
      course_name: 'Media Studies'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => lecturePayload
    });

    const navigateTo = vi.fn();
    const initChatMessages = vi.fn();

    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: 'student@example.com',
        selectedCourse: 'Media Studies',
        setSelectedCourse: vi.fn(),
        activeCourseData: null,
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo,
        initChatMessages
      })
    );

    await act(async () => {
      await result.current.handleTranscribe('https://vimeo.com/76979871', true, 'Media Studies');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/transcript?url=')
    );

    expect(result.current.activeData.videoId).toBe('76979871');
    expect(result.current.activeData.title).toBe('The New Normal');
    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('76979871'));
    expect(initChatMessages).toHaveBeenCalled();

    // Verify written to localStorage cache
    const stored = JSON.parse(localStorage.getItem('lecturescribe_cached_videos') || '{}');
    expect(stored['76979871']).toBeDefined();
  });

  it('loads instantly from client cache if already cached', async () => {
    const cachedItem = {
      videoId: '999',
      title: 'Cached Lecture',
      cues: [],
      course_name: 'History'
    };
    localStorage.setItem('lecturescribe_cached_videos', JSON.stringify({ '999': cachedItem }));

    global.fetch = vi.fn();
    const navigateTo = vi.fn();

    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: null,
        selectedCourse: null,
        setSelectedCourse: vi.fn(),
        activeCourseData: null,
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo,
        initChatMessages: vi.fn()
      })
    );

    await act(async () => {
      await result.current.handleTranscribe('999', true, null);
    });

    // Should NOT call the backend API because cache hit
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.activeData.videoId).toBe('999');
    expect(result.current.activeData.cached).toBe(true);
  });
});
