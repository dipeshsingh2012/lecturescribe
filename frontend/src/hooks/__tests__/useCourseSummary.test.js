import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCourseSummary from '../useCourseSummary';

describe('useCourseSummary hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('initializes with default empty state and loads summary for course', async () => {
    const mockSummary = {
      course_name: 'Linear Algebra',
      executive_summary: 'Comprehensive overview of linear spaces and transformations.',
      thematic_modules: [
        {
          module_title: 'Vector Spaces',
          lectures_covered: ['Lecture 1', 'Lecture 2'],
          core_themes: 'Basis and dimension',
          key_takeaways: ['Subspaces must contain 0']
        }
      ],
      core_formulas_and_definitions: [
        { term: 'Orthogonality', formula_or_def: 'v \\cdot w = 0', significance: 'Right angles' }
      ],
      lecture_summaries: [
        { lecture_id: 'vid_1', lecture_title: 'Lecture 1', key_points: ['Point A'], synopsis: 'Intro' }
      ],
      master_exam_checklist: ['Perform Gaussian elimination']
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        course_slug: 'linear-algebra',
        course_name: 'Linear Algebra',
        summary: mockSummary
      })
    });

    const { result } = renderHook(() => useCourseSummary('Linear Algebra'));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.summaryData).toEqual(mockSummary);
    expect(result.current.error).toBe(null);
  });

  it('regenerates summary when regenerateSummary is called', async () => {
    const mockSummary = {
      course_name: 'Linear Algebra',
      executive_summary: 'Regenerated summary.'
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ summary: mockSummary })
    });

    const { result } = renderHook(() => useCourseSummary('Linear Algebra'));

    await act(async () => {
      await result.current.regenerateSummary();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/course/linear-algebra/summary'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true })
      })
    );
    expect(result.current.summaryData).toEqual(mockSummary);
  });

  it('handles error gracefully when fetch fails', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Failed to generate course summary' })
    });

    const { result } = renderHook(() => useCourseSummary('Linear Algebra'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.summaryData).toBe(null);
    expect(result.current.error).toBe('Failed to generate course summary');
  });

  it('correctly unwraps summary objects returned directly without a .summary wrapper', async () => {
    const directSummary = {
      course_name: 'Machine Learning',
      course_slug: 'machine-learning',
      executive_summary: 'Supervised vs Unsupervised learning.'
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => directSummary
    });

    const { result } = renderHook(() => useCourseSummary('Machine Learning'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.hasFetched).toBe(true);
    expect(result.current.summaryData).toEqual(directSummary);
    expect(result.current.error).toBe(null);
  });
});

