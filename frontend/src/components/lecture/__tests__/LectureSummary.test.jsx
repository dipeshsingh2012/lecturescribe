import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureSummary from '../LectureSummary';

describe('LectureSummary component', () => {
  const sampleSummary = {
    id: 1,
    videoId: 'v123',
    summaryType: '15_min',
    markdownText: '## Key Concepts\n- Point 1 [01:10]\n- Point 2 [04:20]',
    submissionText: 'This lecture covered neural architectures and gradient descent optimizations for deep learning models.',
    citations: [{ time: '01:10', text: 'Point 1' }],
    wordCount: 14
  };

  const createHookMock = (overrides = {}) => ({
    summaries: { '15_min': sampleSummary },
    currentSummary: sampleSummary,
    activeSummaryType: '15_min',
    setActiveSummaryType: vi.fn(),
    viewMode: 'study',
    setViewMode: vi.fn(),
    loading: false,
    generating: false,
    error: null,
    copiedField: null,
    copyText: vi.fn(),
    generateSummary: vi.fn(),
    transcriptAvailable: true,
    ...overrides
  });

  it('renders study notes with markdown content when viewMode is study', () => {
    const hook = createHookMock();
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    expect(screen.getByText('Summary & Submissions')).toBeInTheDocument();
    expect(screen.getByText('Key Concepts')).toBeInTheDocument();
    expect(screen.getByText('Study Notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy Markdown/i })).toBeInTheDocument();
  });

  it('renders submission prose and target word count when viewMode is submission', () => {
    const hook = createHookMock({ viewMode: 'submission' });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    expect(screen.getByText(/Canvas \/ LMS Assignment Submission/i)).toBeInTheDocument();
    expect(screen.getByText(sampleSummary.submissionText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy for Submission/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Target: 100–150 words/i).length).toBeGreaterThan(0);
  });

  it('switches summary depth between 15-min and comprehensive when clicked', () => {
    const setActiveSummaryType = vi.fn();
    const hook = createHookMock({ setActiveSummaryType });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    const compBtn = screen.getByRole('button', { name: /Comprehensive Report/i });
    fireEvent.click(compBtn);
    expect(setActiveSummaryType).toHaveBeenCalledWith('comprehensive');
  });

  it('switches view mode between study and submission when clicked', () => {
    const setViewMode = vi.fn();
    const hook = createHookMock({ setViewMode });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    const subModeBtn = screen.getByRole('button', { name: /Assignment Submission View/i });
    fireEvent.click(subModeBtn);
    expect(setViewMode).toHaveBeenCalledWith('submission');
  });

  it('triggers copyText when clicking copy submission button', () => {
    const copyText = vi.fn();
    const hook = createHookMock({ viewMode: 'submission', copyText });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    const copyBtn = screen.getByRole('button', { name: /Copy for Submission/i });
    fireEvent.click(copyBtn);
    expect(copyText).toHaveBeenCalledWith(sampleSummary.submissionText, 'submission');
  });

  it('renders loading and generating states properly', () => {
    const loadingHook = createHookMock({ loading: true, currentSummary: null });
    const { rerender } = render(<LectureSummary summaryHook={loadingHook} />);
    expect(screen.getByText(/Loading lecture summaries/i)).toBeInTheDocument();

    const genHook = createHookMock({ generating: true, currentSummary: null });
    rerender(<LectureSummary summaryHook={genHook} />);
    expect(screen.getByText(/Synthesizing 15-Minute Overview/i)).toBeInTheDocument();
  });

  it('renders empty state when no summary is generated and calls generateSummary on button click', () => {
    const generateSummary = vi.fn();
    const emptyHook = createHookMock({ currentSummary: null, generateSummary });
    render(<LectureSummary summaryHook={emptyHook} />);

    expect(screen.getByText(/No 15-Min Overview Generated Yet/i)).toBeInTheDocument();
    const genBtn = screen.getByRole('button', { name: /Generate 15-Min Overview/i });
    fireEvent.click(genBtn);
    expect(generateSummary).toHaveBeenCalledWith('15_min', true);
  });

  it('warns when transcript is unavailable', () => {
    const noTransHook = createHookMock({ transcriptAvailable: false });
    render(<LectureSummary summaryHook={noTransHook} />);

    expect(screen.getByText(/imported without a transcript/i)).toBeInTheDocument();
  });
});
