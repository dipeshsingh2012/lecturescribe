import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLecturePlayer } from '../useLecturePlayer';

describe('useLecturePlayer hook functionality', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof document !== 'undefined') {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
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

  it('re-syncs activeCueIdx when window gains focus or tab becomes visible', async () => {
    const videoEl = document.createElement('video');
    Object.defineProperty(videoEl, 'paused', { value: false, writable: true });
    Object.defineProperty(videoEl, 'currentTime', { value: 0, writable: true });

    const activeData = {
      videoId: 'v_window_sync',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '01:00', text: 'Topic 1' },
        { time: '02:00', text: 'Topic 2' }
      ]
    };

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData);
      hook.iframeRef.current = videoEl;
      return hook;
    });

    expect(result.current.activeCueIdx).toBe(0);

    // Simulate video playing in background to 02:15 while user is on another window
    videoEl.currentTime = 135;

    // Window focus occurs when user switches back
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current.activeCueIdx).toBe(2);
  });

  it('dynamically detects video element mounting after initial render and restores progress from DB', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        progress: {
          last_timestamp: '05:30',
          last_seconds: 330,
          duration_seconds: 1800,
          progress_percent: 18.3,
          active_cue_idx: 1
        }
      })
    });

    const activeData = {
      videoId: 'v_dynamic_mount',
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '05:30', text: 'Section 2' }
      ]
    };

    // Render hook with no element initially attached (iframeRef.current is null)
    const { result } = renderHook(() => useLecturePlayer(activeData, 'user@test.com'));

    // Video mounts late in DOM
    const videoEl = document.createElement('video');
    Object.defineProperty(videoEl, 'readyState', { value: 1, configurable: true });
    Object.defineProperty(videoEl, 'duration', { value: 1800, configurable: true });
    videoEl.currentTime = 0;
    videoEl.play = vi.fn().mockResolvedValue(undefined);
    videoEl.pause = vi.fn();

    await act(async () => {
      result.current.iframeRef.current = videoEl;
      window.dispatchEvent(new CustomEvent('lecturescribe:videomounted'));
      await new Promise(r => setTimeout(r, 50));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/progress/lecture?video_id=v_dynamic_mount&user_email=user%40test.com')
    );
    expect(result.current.activeCueIdx).toBe(1);
    expect(videoEl.currentTime).toBe(330);
  });

  it('periodically saves progress to backend during continuous playback every 10 seconds', async () => {
    const postCalls = [];
    global.fetch = vi.fn((url, options) => {
      if (options?.method === 'POST') {
        postCalls.push(JSON.parse(options.body));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success' })
      });
    });

    const activeData = {
      videoId: 'v_playback_save',
      duration: 600,
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '00:10', text: 'Ten Sec' },
        { time: '00:20', text: 'Twenty Sec' }
      ]
    };

    const videoEl = document.createElement('video');
    videoEl.currentTime = 0;
    Object.defineProperty(videoEl, 'paused', { value: false, writable: true });
    Object.defineProperty(videoEl, 'duration', { value: 600, configurable: true });

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData, 'student@playback.com');
      hook.iframeRef.current = videoEl;
      return hook;
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Simulate playback timeupdate at 5s (less than 10s difference from 0s)
    act(() => {
      videoEl.currentTime = 5;
      videoEl.dispatchEvent(new Event('timeupdate'));
    });
    expect(postCalls.length).toBe(0);

    // Simulate playback reaching 10s (>= 10s difference)
    act(() => {
      videoEl.currentTime = 10;
      videoEl.dispatchEvent(new Event('timeupdate'));
    });
    expect(postCalls.length).toBe(1);
    expect(postCalls[0].last_seconds).toBe(10);
    expect(postCalls[0].video_id).toBe('v_playback_save');

    // Simulate playback reaching 20s (>= 10s difference from 10s)
    act(() => {
      videoEl.currentTime = 20;
      videoEl.dispatchEvent(new Event('timeupdate'));
    });
    expect(postCalls.length).toBe(2);
    expect(postCalls[1].last_seconds).toBe(20);
  });

  it('saves progress immediately on pause and seeked events', async () => {
    const postCalls = [];
    global.fetch = vi.fn((url, options) => {
      if (options?.method === 'POST') {
        postCalls.push(JSON.parse(options.body));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success' })
      });
    });

    const activeData = {
      videoId: 'v_pause_seek',
      duration: 300,
      cues: [
        { time: '00:00', text: 'Intro' },
        { time: '00:45', text: 'Point 1' }
      ]
    };

    const videoEl = document.createElement('video');
    videoEl.currentTime = 45;
    Object.defineProperty(videoEl, 'paused', { value: false, writable: true });
    Object.defineProperty(videoEl, 'duration', { value: 300, configurable: true });

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData, 'student@test.com');
      hook.iframeRef.current = videoEl;
      return hook;
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // User pauses video at 45s
    act(() => {
      videoEl.paused = true;
      videoEl.dispatchEvent(new Event('pause'));
    });

    expect(postCalls.some(c => c.last_seconds === 45 && c.video_id === 'v_pause_seek')).toBe(true);

    // User seeks to 75s
    act(() => {
      videoEl.currentTime = 75;
      videoEl.dispatchEvent(new Event('seeked'));
    });

    expect(postCalls.some(c => c.last_seconds === 75 && c.video_id === 'v_pause_seek')).toBe(true);
  });

  it('saves progress with keepalive when visibilitychange is hidden', async () => {
    let capturedOptions = null;
    global.fetch = vi.fn((url, options) => {
      if (options?.method === 'POST') {
        capturedOptions = options;
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success' })
      });
    });

    const activeData = {
      videoId: 'v_visibility',
      duration: 400,
      cues: [{ time: '00:00', text: 'Intro' }, { time: '01:00', text: 'Main' }]
    };

    const videoEl = document.createElement('video');
    videoEl.currentTime = 60;
    Object.defineProperty(videoEl, 'paused', { value: false, writable: true });
    Object.defineProperty(videoEl, 'duration', { value: 400, configurable: true });

    const { result } = renderHook(() => {
      const hook = useLecturePlayer(activeData, 'student@visibility.com');
      hook.iframeRef.current = videoEl;
      return hook;
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Simulate tab being minimized / hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions.keepalive).toBe(true);
    expect(capturedOptions.body).toContain('"last_seconds":60');
    expect(capturedOptions.body).toContain('"video_id":"v_visibility"');

    // Reset visibilityState
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does not repeatedly fetch progress in a loop when activeData reference changes or component re-renders', async () => {
    let getCallCount = 0;
    const callTraces = [];
    global.fetch = vi.fn((url, options) => {
      if (!options || options.method === 'GET' || !options.method) {
        if (url.includes('/api/progress/lecture') && url.includes('v_no_loop_123')) {
          getCallCount++;
          callTraces.push(new Error().stack);
        }
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'success',
          progress: {
            last_timestamp: '02:00',
            last_seconds: 120,
            duration_seconds: 600,
            progress_percent: 20,
            active_cue_idx: 1
          }
        })
      });
    });

    const activeData = {
      videoId: 'v_no_loop_123',
      cues: [{ time: '00:00', text: 'Intro' }, { time: '02:00', text: 'Next' }]
    };

    const videoEl = document.createElement('video');
    Object.defineProperty(videoEl, 'readyState', { value: 1, configurable: true });
    Object.defineProperty(videoEl, 'duration', { value: 600, configurable: true });
    videoEl.currentTime = 0;

    const { result, rerender } = renderHook(
      ({ data }) => {
        const hook = useLecturePlayer(data, 'student@loopcheck.com');
        hook.iframeRef.current = videoEl;
        return hook;
      },
      { initialProps: { data: activeData } }
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });

    expect(getCallCount).toBe(1);

    // Simulate multiple re-renders with new object references for activeData (e.g. state updates elsewhere)
    for (let i = 0; i < 5; i++) {
      act(() => {
        rerender({ data: { ...activeData, dummy: i } });
      });
    }

    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });

    // Must still be exactly 1 call, NEVER looping!
    expect(getCallCount).toBe(1);
  });
});


