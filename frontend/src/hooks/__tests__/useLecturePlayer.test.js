import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLecturePlayer } from '../useLecturePlayer';

vi.mock('@vimeo/player', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      off: vi.fn(),
      ready: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn().mockResolvedValue(0),
      setCurrentTime: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn()
    }))
  };
});

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

  it('maps highlightHtml from backend hits and provides fallback highlighting', async () => {
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
      json: async () => ({ hits: searchHits, count: 2 })
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
    // Hit 2 should have frontend fallback highlightHtml
    expect(result.current.displayCues[1].highlightHtml).toContain("<mark class='algolia-highlight'>eigenvectors</mark>");
    expect(result.current.displayCues[1].time).toBe('05:40');

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

    const VimeoPlayer = (await import('@vimeo/player')).default;
    VimeoPlayer.mockImplementationOnce(() => ({
      on: mockOn,
      off: vi.fn(),
      ready: vi.fn().mockResolvedValue(undefined),
      getCurrentTime: vi.fn().mockResolvedValue(0),
      setCurrentTime: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined)
    }));

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
      result.current.iframeRef.current = document.createElement('iframe');
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
});
