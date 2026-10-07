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

  it('activates an imported video and marks its transcript unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        videoId: '1233458452',
        title: 'Introduction to Generative AI',
        cues: [],
        transcript_available: false,
        transcript_message: 'This video was imported, but Vimeo has no caption tracks.'
      })
    });

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

    await act(async () => {
      await result.current.handleTranscribe('https://vimeo.com/1233458452');
    });

    expect(result.current.activeData.videoId).toBe('1233458452');
    expect(result.current.activeData.transcript_available).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('generates a transcript and updates the active lecture and local cache', async () => {
    const lecturePayload = {
      videoId: '1233458452',
      title: 'Introduction to Generative AI',
      cues: [{ time: '00:00', text: 'Welcome to class.' }],
      transcript_available: true
    };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ videoId: '1233458452', title: lecturePayload.title, cues: [], transcript_available: false })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => lecturePayload
      });

    const initChatMessages = vi.fn();
    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: 'student@example.com',
        selectedCourse: null,
        setSelectedCourse: vi.fn(),
        activeCourseData: null,
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo: vi.fn(),
        initChatMessages
      })
    );

    await act(async () => {
      await result.current.handleTranscribe('https://vimeo.com/1233458452');
    });
    await act(async () => {
      await result.current.handleGenerateTranscript();
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/lecture/1233458452/transcribe?email=student%40example.com'),
      { method: 'POST' }
    );
    expect(result.current.activeData.cues).toEqual(lecturePayload.cues);
    expect(result.current.activeData.transcript_available).toBe(true);
    expect(result.current.transcriptionError).toBeNull();
    expect(initChatMessages).toHaveBeenLastCalledWith(
      lecturePayload.title,
      '1233458452',
      lecturePayload.cues
    );
    const cached = JSON.parse(localStorage.getItem('lecturescribe_cached_videos') || '{}');
    expect(cached['1233458452'].cues).toEqual(lecturePayload.cues);
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

  it('clears the video input box once the video is ingested from API', async () => {
    const lecturePayload = {
      videoId: '11223344',
      title: 'Quantum Computing',
      cues: [{ time: '00:01', text: 'Qubits' }],
      course_name: 'Physics'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => lecturePayload
    });

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
      result.current.setUrlInput('https://vimeo.com/11223344');
    });
    expect(result.current.urlInput).toBe('https://vimeo.com/11223344');

    await act(async () => {
      await result.current.handleTranscribe();
    });

    // Verification: activeData is set and urlInput is cleared
    expect(result.current.activeData.videoId).toBe('11223344');
    expect(result.current.urlInput).toBe('');
  });

  it('clears the video input box once cached video is loaded', async () => {
    const cachedItem = {
      videoId: '88776655',
      title: 'Operating Systems',
      cues: [],
      course_name: 'CS'
    };
    localStorage.setItem('lecturescribe_cached_videos', JSON.stringify({ '88776655': cachedItem }));

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
      result.current.setUrlInput('https://vimeo.com/88776655');
    });
    expect(result.current.urlInput).toBe('https://vimeo.com/88776655');

    await act(async () => {
      await result.current.handleTranscribe();
    });

    expect(result.current.activeData.videoId).toBe('88776655');
    expect(result.current.urlInput).toBe('');
  });

  it('preserves the video input box content if ingestion fails with an error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Video not found or private' })
    });

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
      result.current.setUrlInput('https://vimeo.com/invalid-video');
    });

    await act(async () => {
      await result.current.handleTranscribe();
    });

    // The input should remain so user can fix it, but error is shown
    expect(result.current.urlInput).toBe('https://vimeo.com/invalid-video');
    expect(result.current.error).toContain('Video not found or private');
    expect(result.current.activeData).toBeNull();
  });

  it('adds lecture to course without navigating or opening workspace when stayOnCoursePage is true (API ingestion)', async () => {
    const lecturePayload = {
      videoId: '11223344',
      title: 'Course Lecture 1',
      cues: [{ time: '00:00', text: 'Hello class' }],
      course_name: 'Media Studies'
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => lecturePayload
    });

    const navigateTo = vi.fn();
    const onLectureIngested = vi.fn();

    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: 'student@example.com',
        selectedCourse: 'Media Studies',
        setSelectedCourse: vi.fn(),
        activeCourseData: { course_name: 'Media Studies' },
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo,
        initChatMessages: vi.fn(),
        onLectureIngested
      })
    );

    act(() => {
      result.current.setUrlInput('https://vimeo.com/11223344');
    });

    await act(async () => {
      await result.current.handleTranscribe('https://vimeo.com/11223344', false, 'Media Studies', true);
    });

    // Should NOT navigate away or activate workspace
    expect(navigateTo).not.toHaveBeenCalled();
    expect(result.current.activeData).toBeNull();
    expect(result.current.urlInput).toBe('');
    expect(onLectureIngested).toHaveBeenCalledWith('Media Studies', '11223344', expect.objectContaining({ course_name: 'Media Studies' }));
    expect(result.current.cacheNotice).toContain('Course Lecture 1');
    expect(result.current.cacheNotice).toContain('Media Studies');
  });

  it('adds cached lecture to course without navigating when stayOnCoursePage is true (client cache hit)', async () => {
    const cachedItem = {
      videoId: '998877',
      title: 'Cached Intro to AI',
      cues: [],
      course_name: 'Old Course'
    };
    localStorage.setItem('lecturescribe_cached_videos', JSON.stringify({ '998877': cachedItem }));

    const navigateTo = vi.fn();
    const onLectureIngested = vi.fn();

    const { result } = renderHook(() =>
      useLectureIngestion({
        userEmail: null,
        selectedCourse: 'Data Science',
        setSelectedCourse: vi.fn(),
        activeCourseData: { course_name: 'Data Science' },
        effectiveCourses: [],
        fetchUserLibrary: vi.fn(),
        navigateTo,
        initChatMessages: vi.fn(),
        onLectureIngested
      })
    );

    await act(async () => {
      await result.current.handleTranscribe('998877', false, 'Data Science', true);
    });

    expect(navigateTo).not.toHaveBeenCalled();
    expect(result.current.activeData).toBeNull();
    expect(onLectureIngested).toHaveBeenCalledWith('Data Science', '998877', expect.objectContaining({ course_name: 'Data Science' }));
    expect(result.current.cacheNotice).toContain('Cached Intro to AI');
    expect(result.current.cacheNotice).toContain('Data Science');

    // Stored course_name should now be updated to Data Science
    const stored = JSON.parse(localStorage.getItem('lecturescribe_cached_videos') || '{}');
    expect(stored['998877'].course_name).toBe('Data Science');
  });
});
