import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranscriptSearch from '../TranscriptSearch';

describe('TranscriptSearch', () => {
  it('renders search input and updates query when user types', () => {
    const setSearchQuery = vi.fn();
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="vectors"
        setSearchQuery={setSearchQuery}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
      />
    );

    const input = screen.getByPlaceholderText(/Search transcript by keywords/i);
    expect(input).toHaveValue('vectors');

    fireEvent.change(input, { target: { value: 'matrices' } });
    expect(setSearchQuery).toHaveBeenCalledWith('matrices');
  });

  it('renders cue items with timestamps and calls handleCueClick on selection', () => {
    const handleCueClick = vi.fn();
    const cues = [
      { time: '01:15', text: 'Welcome to linear algebra.' },
      { time: '04:30', text: 'Today we discuss dot products.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={handleCueClick}
        activeCueIdx={1}
      />
    );

    expect(screen.getByText(/2\s*hits/i)).toBeInTheDocument();
    expect(screen.getByText(/01:15/)).toBeInTheDocument();
    expect(screen.getByText('Welcome to linear algebra.')).toBeInTheDocument();

    const cueItem = screen.getByText(/04:30/);
    fireEvent.click(cueItem);
    expect(handleCueClick).toHaveBeenCalledWith('04:30');
  });

  it('renders 0 hits count when displayCues is empty', () => {
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="nonexistent"
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
      />
    );

    expect(screen.getByText(/0\s*hits/i)).toBeInTheDocument();
  });

  it('explains when transcript search is unavailable', () => {
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        transcriptAvailable={false}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/video was imported.*no transcript or captions/i);
    expect(screen.getByPlaceholderText(/Transcript unavailable/i)).toBeDisabled();
  });

  it('renders Copy Transcript button and triggers handleCopyTranscript on click', () => {
    const handleCopyTranscript = vi.fn();
    const { rerender } = render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        copied={false}
        handleCopyTranscript={handleCopyTranscript}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy Transcript/i });
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    expect(handleCopyTranscript).toHaveBeenCalledTimes(1);

    rerender(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        copied={true}
        handleCopyTranscript={handleCopyTranscript}
      />
    );

    expect(screen.getByText(/Copied Transcript!/i)).toBeInTheDocument();
  });

  it('renders chevron button to move to end of transcripts and scrolls on click', () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const cues = Array.from({ length: 15 }, (_, i) => ({
      time: `0${i}:00`,
      text: `Lecture segment ${i + 1}`
    }));

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    const endButtons = screen.getAllByRole('button', { name: /Move to end of transcript/i });
    expect(endButtons.length).toBeGreaterThan(0);

    fireEvent.click(endButtons[0]);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('renders chevron button to move to start of transcripts and scrolls on click', () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const cues = Array.from({ length: 15 }, (_, i) => ({
      time: `0${i}:00`,
      text: `Lecture segment ${i + 1}`
    }));

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    const startButtons = screen.getAllByRole('button', { name: /Move to start of transcript/i });
    expect(startButtons.length).toBeGreaterThan(0);

    fireEvent.click(startButtons[0]);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('highlights active cue with playing indicator and active styling', () => {
    const cues = [
      { time: '01:00', text: 'First point' },
      { time: '02:00', text: 'Second point in discussion' }
    ];

    const { rerender } = render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    // Active cue should show volume/speaker icon
    expect(screen.getByLabelText(/Current playback cue/i)).toBeInTheDocument();
    const rows = document.querySelectorAll('.transcript-cue-row');
    expect(rows[0]).toHaveClass('active');
    expect(rows[1]).not.toHaveClass('active');

    // Rerender with activeCueIdx = 1
    rerender(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={1}
      />
    );
    expect(rows[1]).toHaveClass('active');
    expect(rows[0]).not.toHaveClass('active');
  });

  it('toggles auto-scroll sync ON and OFF when clicking the sync button', () => {
    render(
      <TranscriptSearch
        displayCues={[{ time: '00:10', text: 'Intro' }]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    const syncButton = screen.getByRole('button', { name: /Pause auto-scroll sync/i });
    expect(syncButton).toHaveTextContent(/Sync ON/i);

    fireEvent.click(syncButton);
    expect(syncButton).toHaveTextContent(/Sync OFF/i);
    expect(syncButton).toHaveAttribute('aria-label', expect.stringMatching(/Resume auto-scroll sync/i));

    fireEvent.click(syncButton);
    expect(syncButton).toHaveTextContent(/Sync ON/i);
  });

  it('automatically scrolls active cue into view when activeCueIdx changes', () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const cues = [
      { time: '00:10', text: 'Intro' },
      { time: '00:30', text: 'Detail' }
    ];

    const { rerender } = render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
    scrollIntoViewMock.mockClear();

    rerender(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={1}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', block: 'center' })
    );
  });

  it('renders clear search button only when searchQuery is non-empty and resets search when clicked', () => {
    const setSearchQuery = vi.fn();
    const { rerender } = render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={setSearchQuery}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
      />
    );

    expect(screen.queryByRole('button', { name: /Clear transcript search/i })).not.toBeInTheDocument();

    rerender(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="eigen"
        setSearchQuery={setSearchQuery}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
      />
    );

    const clearBtn = screen.getByRole('button', { name: /Clear transcript search/i });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });
});