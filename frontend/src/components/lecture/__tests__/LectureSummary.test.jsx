import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LectureSummary from '../LectureSummary';

describe('LectureSummary component', () => {
  const sampleSummary = {
    id: 1,
    videoId: 'v123',
    summaryType: 'comprehensive',
    markdownText: '## Key Concepts\n- Point 1 [01:10]\n- Point 2 [04:20]',
    submissionText: 'This lecture covered neural architectures and gradient descent optimizations for deep learning models.',
    citations: [{ time: '01:10', text: 'Point 1' }],
    wordCount: 14
  };

  const createHookMock = (overrides = {}) => ({
    summaries: { 'comprehensive': sampleSummary },
    currentSummary: sampleSummary,
    activeSummaryType: 'comprehensive',
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

  it('renders submission prose and word count when viewMode is submission', () => {
    const hook = createHookMock({ viewMode: 'submission' });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    expect(screen.getByText(sampleSummary.submissionText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy for Submission/i })).toBeInTheDocument();
    expect(screen.getByText(/14 words/i)).toBeInTheDocument();
  });

  it('renders mathematical formulas in submission prose using KaTeX', () => {
    const mathSubmission = {
      ...sampleSummary,
      submissionText: 'Formal definitions were provided: \\(d_{i,j}\\) denotes the edit distance for source string \\(X\\).'
    };
    const hook = createHookMock({
      viewMode: 'submission',
      currentSummary: mathSubmission
    });
    const { container } = render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('\\(d_{i,j}\\)');
  });

  it('triggers generateSummary when clicking regenerate button', () => {
    const generateSummary = vi.fn();
    const hook = createHookMock({ generateSummary });
    render(<LectureSummary summaryHook={hook} handleCueClick={vi.fn()} />);

    const regenBtn = screen.getByRole('button', { name: /Regenerate summary/i });
    fireEvent.click(regenBtn);
    expect(generateSummary).toHaveBeenCalledWith('comprehensive', true);
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
    expect(screen.getByText(/Synthesizing Full Summary/i)).toBeInTheDocument();
  });

  it('renders empty state when no summary is generated and calls generateSummary on button click', () => {
    const generateSummary = vi.fn();
    const emptyHook = createHookMock({ currentSummary: null, generateSummary });
    render(<LectureSummary summaryHook={emptyHook} />);

    expect(screen.getByText(/No Summary Generated Yet/i)).toBeInTheDocument();
    const genBtn = screen.getByRole('button', { name: /Generate Full Summary/i });
    fireEvent.click(genBtn);
    expect(generateSummary).toHaveBeenCalledWith('comprehensive', true);
  });

  it('warns when transcript is unavailable', () => {
    const noTransHook = createHookMock({ transcriptAvailable: false });
    render(<LectureSummary summaryHook={noTransHook} />);

    expect(screen.getByText(/imported without a transcript/i)).toBeInTheDocument();
  });
});
