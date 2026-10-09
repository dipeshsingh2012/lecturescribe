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

  it('sends the required review request body when starting an AI review', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job: { id: 'job_123', status: 'running' }, suggestions: [] })
    });
    vi.stubGlobal('fetch', mockFetch);
    const activeData = { videoId: 'vid_123', cues: [] };
    const { unmount } = render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
        activeData={activeData}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /AI Transcript Review/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Review/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_123/review'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_mode: 'audio_grounded' })
        }
      );
    });

    unmount();
    vi.unstubAllGlobals();
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

  it('renders visual highlights and comment badges with camelCase backend annotation data', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_1',
                cueId: 1,
                selectedText: 'linear algebra',
                annotationType: 'highlight',
                color: 'green',
                startSeconds: 60.0
              },
              {
                id: 'ann_2',
                cueId: 1,
                selectedText: 'linear algebra',
                annotationType: 'note',
                noteText: 'Remember this definition',
                startSeconds: 60.0
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

    await waitFor(() => {
      const mark = document.querySelector('mark');
      expect(mark).toBeInTheDocument();
      expect(mark).toHaveTextContent('linear algebra');
      expect(mark).toHaveStyle({ backgroundColor: 'rgba(187, 247, 208, 0.55)' });
    });

    const noteBadge = screen.getByRole('button', { name: /View cue comment/i });
    expect(noteBadge).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('opens text selection toolbar when user selects text within a single cue', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

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

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'linear algebra',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    expect(await screen.findByRole('button', { name: /Close selection menu/i })).toBeInTheDocument();
    expect(screen.getByTitle(/Highlight in yellow/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Add margin comment\/note/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Ask AI to explain selected text/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Copy selected quote/i)).toBeInTheDocument();
  });

  it('creates highlight on click, calls API, and renders <mark> on transcript', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations') && (!opts || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
      }
      if (url.includes('/annotations') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotation: {
              id: 'ann_new_1',
              cueId: body.cue_id,
              selectedText: body.selected_text,
              annotationType: 'highlight',
              color: body.color,
              startSeconds: body.start_seconds
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'linear algebra',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    const greenBtn = await screen.findByTitle(/Highlight in green/i);
    fireEvent.click(greenBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_123/annotations'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"color":"green"')
        })
      );
    });

    await waitFor(() => {
      const mark = document.querySelector('mark');
      expect(mark).toBeInTheDocument();
      expect(mark).toHaveTextContent('linear algebra');
    });

    expect(screen.queryByTitle(/Highlight in green/i)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('creates margin note, calls API, shows note badge, and note is visible in drawer', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations') && (!opts || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
      }
      if (url.includes('/annotations') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotation: {
              id: 'ann_note_1',
              cueId: body.cue_id,
              selectedText: body.selected_text,
              annotationType: 'note',
              noteText: body.note_text,
              startSeconds: body.start_seconds
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'linear algebra',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    const noteBtn = await screen.findByTitle(/Add margin comment\/note/i);
    fireEvent.click(noteBtn);

    const textarea = screen.getByPlaceholderText(/Write study notes/i);
    fireEvent.change(textarea, { target: { value: 'Crucial for exams' } });

    const saveBtn = screen.getByRole('button', { name: /Save Note/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_123/annotations'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"note_text":"Crucial for exams"')
        })
      );
    });

    const badge = await screen.findByRole('button', { name: /View cue comment/i });
    expect(badge).toBeInTheDocument();

    fireEvent.click(badge);
    expect(await screen.findByText(/Reader Notes & Highlights/i)).toBeInTheDocument();
    expect(screen.getByText('Crucial for exams')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('asks AI for selection explanation and pins AI explanation as annotation note', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/explain-selection')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            explanation: 'Linear algebra is the branch of math concerning linear equations and matrices.'
          })
        });
      }
      if (url.includes('/annotations') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotation: {
              id: 'ann_ai_1',
              cueId: body.cue_id,
              selectedText: body.selected_text,
              annotationType: 'ai_explanation',
              aiResponse: body.ai_response,
              aiPrompt: body.ai_prompt,
              startSeconds: body.start_seconds
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'linear algebra',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    const askAiBtn = await screen.findByTitle(/Ask AI to explain selected text/i);
    fireEvent.click(askAiBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_123/explain-selection'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"selected_text":"linear algebra"')
        })
      );
    });

    expect(await screen.findByText(/branch of math concerning linear equations/i)).toBeInTheDocument();

    const pinBtn = screen.getByRole('button', { name: /Pin as Note/i });
    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_123/annotations'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"annotation_type":"ai_explanation"')
        })
      );
    });

    vi.unstubAllGlobals();
  });

  it('does NOT open toolbar when selection spans multiple cues', () => {
    const cues = [
      { id: 1, time: '01:00', text: 'First line of speech.' },
      { id: 2, time: '01:10', text: 'Second line of speech.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

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

    const cueRows = document.querySelectorAll('.transcript-cue-row');
    const cue0TextNode = cueRows[0].querySelector('.transcript-cue').firstChild;
    const cue1TextNode = cueRows[1].querySelector('.transcript-cue').firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'First line of speech. Second line of speech.',
      getRangeAt: () => ({
        startContainer: cue0TextNode,
        endContainer: cue1TextNode,
        commonAncestorContainer: document.body,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 200, height: 40 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueRows[0].closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    expect(screen.queryByRole('button', { name: /Close selection menu/i })).not.toBeInTheDocument();
  });

  it('does not seek video when selecting text or dragging mouse inside cue', () => {
    const handleCueClick = vi.fn();
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={handleCueClick}
        activeCueIdx={0}
        activeData={activeData}
      />
    );

    const cueRow = document.querySelector('.transcript-cue-row');

    // Drag simulation with distance > 5px
    fireEvent.mouseDown(cueRow, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(cueRow, { clientX: 140, clientY: 100 });
    fireEvent.click(cueRow, { clientX: 140, clientY: 100 });

    expect(handleCueClick).not.toHaveBeenCalled();
  });

  it('surfaces API error in selection toolbar when annotation creation fails', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' }
    ];
    const activeData = { videoId: 'vid_123', cues };

    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: 'Database connection failed' })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'linear algebra',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 })
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    const yellowBtn = await screen.findByTitle(/Highlight in yellow/i);
    fireEvent.click(yellowBtn);

    expect(await screen.findByText('Database connection failed')).toBeInTheDocument();
    // Toolbar remains open so user sees the error
    expect(screen.getByRole('button', { name: /Close selection menu/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
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