import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLectureSummary from '../useLectureSummary';

describe('useLectureSummary hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useLectureSummary(null));
    expect(result.current.summaries).toEqual({});
    expect(result.current.activeSummaryType).toBe('15_min');
    expect(result.current.viewMode).toBe('study');
    expect(result.current.loading).toBe(false);
    expect(result.current.generating).toBe(false);
  });

  it('fetches saved lecture summaries on video change', async () => {
    const mockSummaries = {
      '15_min': {
        id: 1,
        videoId: 'v100',
        summaryType: '15_min',
        markdownText: '15 min summary text',
        submissionText: '15 min submission text',
        wordCount: 110
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        summaries: mockSummaries
      })
    });

    const activeData = { videoId: 'v100', cues: [{ time: '00:00', text: 'Intro' }] };
    let hookResult;
    await act(async () => {
      hookResult = renderHook(() => useLectureSummary(activeData, 'user@example.com'));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/summary/lecture?video_id=v100&user_email=user%40example.com')
    );
    expect(hookResult.result.current.summaries).toEqual(mockSummaries);
    expect(hookResult.result.current.currentSummary).toEqual(mockSummaries['15_min']);
  });

  it('generateSummary calls generate endpoint and updates state', async () => {
    const generatedSummary = {
      id: 5,
      videoId: 'v200',
      summaryType: 'comprehensive',
      markdownText: 'Full generated report',
      submissionText: 'Full submission prose',
      wordCount: 350
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/summary/lecture')) {
        return Promise.resolve({ ok: true, json: async () => ({ summaries: {} }) });
      }
      if (url.includes('/api/summary/generate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            summary: generatedSummary
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const activeData = { videoId: 'v200', title: 'Deep Learning', cues: [{ time: '00:00', text: 'Intro' }] };
    const { result } = renderHook(() => useLectureSummary(activeData, null));

    await act(async () => {
      await result.current.generateSummary('comprehensive', true);
    });

    expect(result.current.summaries['comprehensive']).toEqual(generatedSummary);
  });

  it('copyText writes to clipboard and sets copiedField for 2 seconds', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock }
    });

    const { result } = renderHook(() => useLectureSummary(null));

    act(() => {
      result.current.copyText('Sample academic text', 'submission');
    });

    expect(writeTextMock).toHaveBeenCalledWith('Sample academic text');
    expect(result.current.copiedField).toBe('submission');
  });
});

