import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('renders mathematical equations formatted with KaTeX in cue text', () => {
    const cues = [
      { time: '02:15', text: 'Notice that $y = mx + c$ represents the line equation.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    // KaTeX renders .katex HTML element
    const mathEl = document.querySelector('.cue-math-expression');
    expect(mathEl).toBeInTheDocument();
    expect(mathEl.innerHTML).toContain('katex');
  });

  it('allows manual inline cue editing and notifies summaryHook on save', async () => {
    const markOutdatedMock = vi.fn();
    const setActiveDataMock = vi.fn();
    const cues = [
      { id: 'cue_0', time: '01:00', text: 'Original line text' }
    ];
    const activeData = {
      videoId: 'vid_123',
      cues
    };

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={activeData}
        setActiveData={setActiveDataMock}
        summaryHook={{ markOutdated: markOutdatedMock }}
      />
    );

    // Edit button should be rendered for the active cue
    const editBtn = screen.getByRole('button', { name: /Edit cue 0/i });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);

    // Input should appear
    const editInput = screen.getByLabelText(/Edit cue at 01:00/i);
    expect(editInput).toBeInTheDocument();
    expect(editInput).toHaveValue('Original line text');

    // Change value and save
    fireEvent.change(editInput, { target: { value: 'Corrected line text with $E = mc^2$' } });
    const saveBtn = screen.getByRole('button', { name: /Save cue/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(markOutdatedMock).toHaveBeenCalled();
      expect(setActiveDataMock).toHaveBeenCalled();
    });
  });

  it('opens AI Review drawer when Review button is clicked', () => {
    const activeData = { videoId: 'vid_123', cues: [] };
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        activeData={activeData}
      />
    );

    const reviewBtn = screen.getByRole('button', { name: /AI Transcript Review/i });
    expect(reviewBtn).toBeInTheDocument();
    fireEvent.click(reviewBtn);

    expect(screen.getByText(/AI Transcript Review/i)).toBeInTheDocument();
  });

  it('opens Notes and Highlights drawer when Notes button is clicked', () => {
    const activeData = { videoId: 'vid_123', cues: [] };
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        activeData={activeData}
      />
    );

    const notesBtn = screen.getByRole('button', { name: /Notes and Highlights/i });
    expect(notesBtn).toBeInTheDocument();
    fireEvent.click(notesBtn);

    expect(screen.getByText(/Reader Notes & Highlights/i)).toBeInTheDocument();
  });

  it('renders visual highlights and comment badges on annotated transcript text', async () => {
    const cues = [
      { id: 'cue_1', time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    // Mock fetch for annotations
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_1',
                cue_id: 'cue_1',
                selected_text: 'linear algebra',
                annotation_type: 'highlight',
                color: 'green'
              },
              {
                id: 'ann_2',
                cue_id: 'cue_1',
                selected_text: 'linear algebra',
                annotation_type: 'note',
                note_text: 'Remember this definition'
              }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={activeData}
      />
    );

    // Verify mark element is rendered around 'linear algebra'
    await waitFor(() => {
      const mark = document.querySelector('mark');
      expect(mark).toBeInTheDocument();
      expect(mark).toHaveTextContent('linear algebra');
    });

    // Verify note badge is rendered on cue row
    const noteBadge = screen.getByRole('button', { name: /View cue comment/i });
    expect(noteBadge).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('pauses auto-scroll on wheel interaction and displays floating Re-center button', () => {
    const handleCueClick = vi.fn();
    const cues = [
      { id: 'cue_0', time: '00:10', text: 'Introduction' },
      { id: 'cue_1', time: '00:30', text: 'Second point' },
      { id: 'cue_2', time: '01:00', text: 'Third point' }
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

    // Initially sync is ON, recenter button is not shown
    expect(screen.queryByTestId('recenter-cue-btn')).not.toBeInTheDocument();
    expect(screen.getByText(/Sync ON/i)).toBeInTheDocument();

    // Trigger wheel on transcript container
    const scrollContainer = screen.getByText('Introduction').closest('[tabindex="0"]');
    expect(scrollContainer).toBeInTheDocument();
    fireEvent.wheel(scrollContainer);

    // Now Sync should be OFF and the floating Re-center button should appear
    expect(screen.getByText(/Sync OFF/i)).toBeInTheDocument();
    const recenterBtn = screen.getByTestId('recenter-cue-btn');
    expect(recenterBtn).toBeInTheDocument();
    expect(recenterBtn).toHaveTextContent(/Re-center \[00:30\]/i);

    // Clicking Re-center button resumes sync and hides the recenter button
    fireEvent.click(recenterBtn);
    expect(screen.getByText(/Sync ON/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recenter-cue-btn')).not.toBeInTheDocument();
  });

  it('toggles sync button and re-centers active cue when turned back ON', () => {
    const cues = [
      { id: 'cue_0', time: '00:10', text: 'Introduction' },
      { id: 'cue_1', time: '00:30', text: 'Active playback cue' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={1}
      />
    );

    const syncBtn = screen.getByRole('button', { name: /Pause auto-scroll sync/i });
    fireEvent.click(syncBtn);

    // Should be OFF and show recenter button
    expect(screen.getByText(/Sync OFF/i)).toBeInTheDocument();
    expect(screen.getByTestId('recenter-cue-btn')).toBeInTheDocument();

    // Clicking sync button again turns it ON and dismisses recenter button
    const resumeBtn = screen.getByRole('button', { name: /Resume auto-scroll sync/i });
    fireEvent.click(resumeBtn);

    expect(screen.getByText(/Sync ON/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recenter-cue-btn')).not.toBeInTheDocument();
  });

  it('renders live KaTeX formula preview when editing text contains LaTeX $ formula', () => {
    const cues = [
      { id: 'cue_0', time: '00:15', text: 'Velocity formula is v = d / t.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
      />
    );

    // Hover on cue to reveal edit button
    const cueRow = screen.getByText('Velocity formula is v = d / t.').closest('.transcript-cue-row');
    fireEvent.mouseEnter(cueRow);

    const editBtn = screen.getByRole('button', { name: /Edit cue 0/i });
    fireEvent.click(editBtn);

    const input = screen.getByLabelText(/Edit cue at 00:15/i);
    expect(input).toBeInTheDocument();

    // Type LaTeX formula with dollar signs
    fireEvent.change(input, { target: { value: 'Formula is $E = mc^2$' } });

    // Live preview container should appear
    const preview = screen.getByTestId('katex-edit-preview');
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent(/Preview:/i);
    expect(preview.querySelector('.cue-math-expression')).toBeInTheDocument();
  });
});