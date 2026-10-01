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
});