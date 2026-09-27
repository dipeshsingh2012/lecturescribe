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

  it('extracts video ID from complex Vimeo URL during ingestion', async () => {
    const lecturePayload = {
      videoId: '55443322',
      title: 'Advanced Machine Learning',
      cues: [{ time: '00:00', text: 'Intro' }],
      course_name: 'CS'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => lecturePayload
    });

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
      await result.current.handleTranscribe('https://vimeo.com/55443322?autoplay=1&muted=true#t=1m');
    });

    expect(result.current.activeData.videoId).toBe('55443322');
    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('55443322'));
  });

  it('extracts video ID on clipboard paste and alerts if already cached', () => {
    const cachedItem = {
      videoId: '12345678',
      title: 'Deep Learning',
      cues: [],
      course_name: 'AI'
    };
    localStorage.setItem('lecturescribe_cached_videos', JSON.stringify({ '12345678': cachedItem }));

    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: null,
        selectedCourse: null,
        setSelectedCourse: vi.fn(),
        activeCourseData: null,
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo: vi.fn(),
        initChatMessages: vi.fn()
      })
    );

    act(() => {
      const mockEvent = {
        clipboardData: {
          getData: () => 'https://vimeo.com/12345678?param=1'
        }
      };
      result.current.handlePasteUrl(mockEvent);
    });

    expect(result.current.cacheNotice).toContain('Pasted video is already cached');
  });
});
