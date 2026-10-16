import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLecturePlayer } from '../useLecturePlayer';

describe('useLecturePlayer hook functionality', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('provides default displayCues from activeData when searchQuery is empty', () => {
    const activeData = {
      videoId: 'v100',
      cues: [
        { time: '01:00', text: 'First point' },
        { time: '02:00', text: 'Second point' }
      ]
    };

    const { result } = renderHook(() => useLecturePlayer(activeData));
    expect(result.current.displayCues).toEqual(activeData.cues);
  });

  it('triggers debounced search when searchQuery is updated', async () => {
    vi.useFakeTimers();
    const searchHits = [{ time: '01:00', text: 'First point match' }];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: searchHits })
    });

    const activeData = { videoId: 'v100', cues: [] };
    const { result } = renderHook(() => useLecturePlayer(activeData));

    act(() => {
      result.current.setSearchQuery('match');
    });

    // Fast forward debounce timer
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search'),
      expect.objectContaining({ method: 'POST' })
    );

    vi.useRealTimers();
  });

  it('maps highlightHtml strictly from Algolia hits without fallback highlighting', async () => {
    vi.useFakeTimers();
    const searchHits = [
      {
        timestamp: '03:15',
        text: 'Eigenvalues and eigenvectors in linear systems.',
        _highlightResult: {
          text: { value: 'Eigenvalues and <mark class="algolia-highlight">eigenvectors</mark> in linear systems.' }
        }
      },
      {
        timestamp: '05:40',
        text: 'Another mention of eigenvectors here.'
      }
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: searchHits, count: 2, available: true })
    });

    const activeData = { videoId: 'v100', cues: [] };
    const { result } = renderHook(() => useLecturePlayer(activeData));

    act(() => {
      result.current.setSearchQuery('eigenvectors');
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.displayCues.length).toBe(2);
    // Hit 1 should have backend highlightHtml
    expect(result.current.displayCues[0].highlightHtml).toContain('<mark class="algolia-highlight">eigenvectors</mark>');
    expect(result.current.displayCues[0].time).toBe('03:15');
    // Hit 2 has no Algolia highlight tag and no fallback highlighting is generated
    expect(result.current.displayCues[1].highlightHtml).toBeNull();
    expect(result.current.displayCues[1].time).toBe('05:40');

    vi.useRealTimers();
  });

  it('sets searchAvailable to false and clears results when search API returns available: false', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: [], count: 0, available: false, error: 'Algolia quota exceeded' })
    });

    const activeData = { videoId: 'v100', cues: [{ time: '00:00', text: 'Intro' }] };
    const { result } = renderHook(() => useLecturePlayer(activeData));

    act(() => {
      result.current.setSearchQuery('eigenvectors');
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.searchAvailable).toBe(false);
    expect(result.current.searchError).toBe('Algolia quota exceeded');
    expect(result.current.displayCues).toEqual([]);

    vi.useRealTimers();
  });

  it('handleCopyTranscript formats cues and writes to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock }
    });

    const activeData = {
      videoId: 'v100',
      cues: [{ time: '01:30', text: 'Key theorem statement.' }]
    };

    const { result } = renderHook(() => useLecturePlayer(activeData));

    await act(async () => {
      await result.current.handleCopyTranscript();
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('[01:30]** Key theorem statement.')
    );
    expect(result.current.copied).toBe(true);
  });

  it('updates activeCueIdx when player emits seeking or seeked events', async () => {
    let eventListeners = {};
    const mockOn = vi.fn((event, handler) => {
      eventListeners[event] = handler;
    });

    const iframe = document.createElement('iframe');
    iframe.__playerAdapter = {
      on: mockOn,
      off: vi.fn(),
      ready: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn().mockResolvedValue(0),
      setCurrentTime: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn()
    };

    const activeData = {
      videoId: 'v100',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '02:00', text: 'Middle' },
        { time: '05:00', text: 'Conclusion' }
      ]
    };

    const { result } = renderHook(() => useLecturePlayer(activeData));

    // Simulate attaching iframe
    act(() => {
      result.current.iframeRef.current = iframe;
    });

    // Re-render hook with activeData
    const { rerender } = renderHook(() => useLecturePlayer(activeData));

    // Verify seeking handler updates cue to Middle (at 130s = 02:10)
    if (eventListeners['seeking']) {
      act(() => {
        eventListeners['seeking']({ seconds: 130 });
      });
      expect(result.current.activeCueIdx).toBe(1);
    }

    // Verify seeked handler updates cue to Conclusion (at 310s = 05:10)
    if (eventListeners['seeked']) {
      act(() => {
        eventListeners['seeked']({ seconds: 310 });
      });
      expect(result.current.activeCueIdx).toBe(2);
    }
  });

  it('silently auto-resumes playback from saved progress in database', async () => {
    const mockSetCurrentTime = vi.fn().mockResolvedValue(undefined);
    const iframe = document.createElement('iframe');
    iframe.__playerAdapter = {
      on: vi.fn(),
      off: vi.fn(),
      ready: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn().mockResolvedValue(0),
      setCurrentTime: mockSetCurrentTime,
      getDuration: vi.fn().mockResolvedValue(3600),
      play: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn()
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        progress: {
          last_timestamp: '14:20',
          last_seconds: 860,
          duration_seconds: 3600,
          progress_percent: 23.9,
          active_cue_idx: 1
        }
      })
    });

    const activeData = {
      videoId: 'v100',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '14:20', text: 'Topic 1' }
      ]
    };

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData, 'student@example.com');
      hook.iframeRef.current = iframe;
      return hook;
    });

    // Wait for async ready resolution
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/progress/lecture?video_id=v100&user_email=student%40example.com')
    );
    expect(mockSetCurrentTime).toHaveBeenCalledWith(860);
  });

  it('handleCueClick saves progress immediately to backend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' })
    });

    const activeData = {
      videoId: 'v100',
      cues: [
        { time: '05:00', text: 'Middle' },
        { time: '10:00', text: 'End' }
      ]
    };

    const { result } = renderHook(() => useLecturePlayer(activeData, 'student@example.com'));

    await act(async () => {
      result.current.handleCueClick('05:00');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/progress/lecture'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"last_timestamp":"05:00"')
      })
    );
    expect(result.current.activeCueIdx).toBe(0);
  });

  it('supports HTML5 video element with custom adapter', async () => {
    const activeData = {
      videoId: 'v100',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '01:00', text: 'Topic 1' }
      ]
    };

    const videoEl = document.createElement('video');
    videoEl.currentTime = 0;
    Object.defineProperty(videoEl, 'duration', { value: 120, configurable: true });
    videoEl.play = vi.fn().mockResolvedValue(undefined);
    videoEl.pause = vi.fn();

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData);
      hook.iframeRef.current = videoEl;
      return hook;
    });

    // Cue seeking on video element
    await act(async () => {
      result.current.handleCueClick('01:00');
    });

    expect(videoEl.currentTime).toBe(60);
    expect(videoEl.play).toHaveBeenCalled();
    expect(result.current.activeCueIdx).toBe(1);
  });

  it('resumes HTML5 video seeker and transcript cue from progress even if active_cue_idx is 0 or video emits initial 0s timeupdate', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        progress: {
          last_timestamp: '14:20',
          last_seconds: 860,
          duration_seconds: 3600,
          progress_percent: 23.9,
          active_cue_idx: 0
        }
      })
    });

    const activeData = {
      videoId: 'v200',
      duration: '1h 0m',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '05:00', text: 'Part 1' },
        { time: '14:20', text: 'Resumed Topic' }
      ],
      progress: {
        last_timestamp: '14:20',
        last_seconds: 860,
        duration_seconds: 3600,
        progress_percent: 23.9,
        active_cue_idx: 0
      }
    };

    const videoEl = document.createElement('video');
    videoEl.currentTime = 0;
    Object.defineProperty(videoEl, 'duration', { value: 3600, configurable: true });
    Object.defineProperty(videoEl, 'readyState', { value: 1, configurable: true });

    const { result, rerender } = renderHook(({ data }) => {
      const hook = useLecturePlayer(data, 'student@example.com');
      hook.iframeRef.current = videoEl;
      return hook;
    }, { initialProps: { data: activeData } });

    // Re-render so effect runs with attached videoEl
    rerender({ data: { ...activeData } });

    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });

    expect(videoEl.currentTime).toBe(860);
    expect(result.current.activeCueIdx).toBe(2);

    // Simulate browser resetting video.currentTime to 0 when src changes to GCS stream URL
    act(() => {
      videoEl.currentTime = 0;
      videoEl.dispatchEvent(new Event('timeupdate'));
      videoEl.dispatchEvent(new Event('loadedmetadata'));
    });

    expect(videoEl.currentTime).toBe(860);
    expect(result.current.activeCueIdx).toBe(2);
  });

  it('plays video cleanly without infinite recursion when readyState is 0 before metadata loads', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        progress: {
          last_timestamp: '14:20',
          last_seconds: 860,
          duration_seconds: 3600,
          progress_percent: 23.9,
          active_cue_idx: 2
        }
      })
    });

    const activeData = {
      videoId: 'v201',
      duration: '1h 0m',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '05:00', text: 'Part 1' },
        { time: '14:20', text: 'Resumed Topic' }
      ],
      progress: {
        last_timestamp: '14:20',
        last_seconds: 860,
        duration_seconds: 3600,
        progress_percent: 23.9,
        active_cue_idx: 2
      }
    };

    const videoEl = document.createElement('video');
    let internalTime = 0;
    let currentReadyState = 0;
    Object.defineProperty(videoEl, 'readyState', {
      get: () => currentReadyState,
      configurable: true
    });
    Object.defineProperty(videoEl, 'currentTime', {
      get: () => internalTime,
      set: (val) => {
        // Real browser behavior: setting currentTime when readyState === 0 is ignored and stays 0
        if (currentReadyState >= 1) {
          internalTime = val;
        }
      },
      configurable: true
    });
    const playSpy = vi.fn().mockImplementation(() => {
      videoEl.dispatchEvent(new Event('play'));
      videoEl.dispatchEvent(new Event('timeupdate'));
      return Promise.resolve();
    });
    videoEl.play = playSpy;

    const { result, rerender } = renderHook(({ data }) => {
      const hook = useLecturePlayer(data, 'student@example.com');
      hook.iframeRef.current = videoEl;
      return hook;
    }, { initialProps: { data: activeData } });

    rerender({ data: { ...activeData } });

    // Trigger timeupdate while readyState is still 0 (must not recurse!)
    act(() => {
      videoEl.dispatchEvent(new Event('timeupdate'));
    });

    expect(result.current.activeCueIdx).toBe(2);

    // Now metadata loads and user plays video
    act(() => {
      currentReadyState = 1;
      videoEl.dispatchEvent(new Event('loadedmetadata'));
      result.current.handleTogglePlayPause();
    });

    expect(internalTime).toBe(860);
    expect(playSpy).toHaveBeenCalled();
  });
});


