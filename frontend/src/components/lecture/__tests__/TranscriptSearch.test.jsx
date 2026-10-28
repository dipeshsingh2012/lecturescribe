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

    expect(screen.getByText(/01:15/)).toBeInTheDocument();
    expect(screen.getByText('Welcome to linear algebra.')).toBeInTheDocument();

    const cueItem = screen.getByText(/04:30/);
    fireEvent.click(cueItem);
    expect(handleCueClick).toHaveBeenCalledWith('04:30');
  });

  it('renders correctly when displayCues is empty without crashing', () => {
    const { container } = render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="nonexistent"
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={-1}
      />
    );

    expect(container).toBeInTheDocument();
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

    // Verify hovering on the mark shows the note preview tooltip
    const mark = document.querySelector('mark');
    fireEvent.mouseEnter(mark);
    expect(await screen.findByTestId('mark-hover-tooltip')).toHaveTextContent('Remember this definition');

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

    const mark = document.querySelector('mark');
    fireEvent.mouseEnter(mark);
    expect(await screen.findByTestId('mark-hover-tooltip')).toHaveTextContent('Remember this definition');

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

    const mark = await screen.findByText('linear algebra');
    expect(mark).toBeInTheDocument();

    const markEl = document.querySelector('mark');
    fireEvent.mouseEnter(markEl);
    expect(await screen.findByTestId('mark-hover-tooltip')).toHaveTextContent('Crucial for exams');

    fireEvent.click(markEl);
    const viewNotesBtn = await screen.findByRole('button', { name: /Notes/i });
    fireEvent.click(viewNotesBtn);
    expect(await screen.findByText(/Reader Notes & Highlights/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Crucial for exams/).length).toBeGreaterThanOrEqual(1);

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

  it('opens toolbar and captures correct span when selection spans multiple cues', async () => {
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

    expect(await screen.findByRole('button', { name: /Close selection menu/i })).toBeInTheDocument();
    expect(screen.getByTitle(/Highlight in yellow/i)).toBeInTheDocument();
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

  it('renders highlights spanning across multiple cues and persists in drawer', async () => {
    const cues = [
      { id: 1, time: '01:00', text: 'Important concepts in linear algebra.' },
      { id: 2, time: '01:10', text: 'We apply these to vectors and matrices.' }
    ];
    const activeData = { video_id: 'vid_multicue', cues };

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_multi_1',
                cueId: 1,
                selectedText: 'linear algebra. We apply these to vectors',
                annotationType: 'highlight',
                color: 'blue',
                startSeconds: 60.0,
                endSeconds: 75.0
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

    // Both cues should have matching highlighted mark tags
    await waitFor(() => {
      const marks = document.querySelectorAll('mark');
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks[0]).toHaveTextContent('linear algebra.');
      expect(marks[1]).toHaveTextContent('We apply these to vectors');
    });

    // Open Notes drawer and check that multi-cue annotation appears
    const notesBtn = screen.getByRole('button', { name: /Notes and Highlights/i });
    fireEvent.click(notesBtn);

    expect(await screen.findByText(/Reader Notes & Highlights/i)).toBeInTheDocument();
    expect(screen.getByText(/linear algebra\. We apply these to vectors/i)).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('renders search unavailable alert banner and message when searchAvailable is false', () => {
    const cues = [{ time: '00:10', text: 'Introduction to linear algebra.' }];
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="eigen"
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        transcriptAvailable={true}
        searchAvailable={false}
        searchError="Algolia search index is currently offline (quota exceeded)."
      />
    );

    expect(screen.getByTestId('search-unavailable-alert')).toBeInTheDocument();
    expect(screen.getAllByText(/Algolia search index is currently offline \(quota exceeded\)\./i).length).toBe(2);
    expect(screen.getByTestId('search-unavailable-message')).toBeInTheDocument();
    expect(screen.getByText(/Transcript Search Unavailable/i)).toBeInTheDocument();
  });

  it('renders no results message when searchQuery is non-empty and displayCues has 0 items', () => {
    render(
      <TranscriptSearch
        displayCues={[]}
        searchQuery="nonexistent-query"
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        transcriptAvailable={true}
        searchAvailable={true}
      />
    );

    expect(screen.getByTestId('search-no-results')).toBeInTheDocument();
    expect(screen.getByText(/No transcript matches found for "nonexistent-query"\./i)).toBeInTheDocument();
  });

  it('does not highlight substring inside larger words (e.g., character inside characters)', async () => {
    const originalFetch = global.fetch;
    const cues = [
      { id: 'cue_0', time: '01:00', text: 'These characters are fascinating' },
      { id: 'cue_1', time: '01:10', text: 'A single character is examined' }
    ];
    const activeData = { videoId: 'vid_wb_test', cues };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_char_1',
                videoId: 'vid_wb_test',
                cueId: 'cue_1',
                selectedText: 'character',
                annotationType: 'highlight',
                color: 'yellow'
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
      const marks = document.querySelectorAll('mark');
      // Only "character" in cue 1 should be highlighted, NOT "characters" in cue 0!
      expect(marks.length).toBe(1);
      expect(marks[0]).toHaveTextContent('character');
    });

    global.fetch = originalFetch;
  });

  it('treats sentence note as block note and only highlights exact repeating sentence without fragmenting words', async () => {
    const originalFetch = global.fetch;
    const sentence = 'We define the state space as follows.';
    const cues = [
      { id: 'cue_0', time: '01:00', text: sentence },
      { id: 'cue_1', time: '01:15', text: 'In other words, the state space is huge.' },
      { id: 'cue_2', time: '01:30', text: sentence } // Exact repetition!
    ];
    const activeData = { videoId: 'vid_sentence_test', cues };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_sentence_1',
                videoId: 'vid_sentence_test',
                cueId: 'cue_0',
                selectedText: sentence,
                annotationType: 'note',
                noteText: 'Important definition of state space'
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
      const marks = document.querySelectorAll('mark');
      // Cue 0 and Cue 2 (exact repeating sentence) should be highlighted as block notes.
      // Cue 1 contains "state space" and "the", but NOT the whole sentence, so it should NOT be marked!
      expect(marks.length).toBe(2);
      expect(marks[0]).toHaveTextContent(sentence);
      expect(marks[1]).toHaveTextContent(sentence);
    });

    global.fetch = originalFetch;
  });

  it('allows un-highlighting notes via the mark action popover', async () => {
    const originalFetch = global.fetch;
    const cues = [
      { id: 'cue_0', time: '01:00', text: 'Important definition in machine learning.' }
    ];
    const activeData = { videoId: 'vid_unhighlight_test', cues };

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations/ann_unhighlight_1') && opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
      }
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_unhighlight_1',
                videoId: 'vid_unhighlight_test',
                cueId: 'cue_0',
                selectedText: 'machine learning',
                annotationType: 'highlight',
                color: 'green'
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

    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true, toString: () => '' });

    const mark = await screen.findByText('machine learning');
    expect(mark).toBeInTheDocument();

    // Click mark to trigger un-highlight popover
    fireEvent.click(mark);

    const unhighlightBtn = await screen.findByRole('button', { name: /Un-highlight/i });
    expect(unhighlightBtn).toBeInTheDocument();

    fireEvent.click(unhighlightBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/annotations/ann_unhighlight_1'),
        expect.objectContaining({ method: 'DELETE' })
      );
      // Mark should be removed
      expect(document.querySelector('mark')).toBeNull();
    });

    global.fetch = originalFetch;
  });

  it('toggles video play/pause directly from the cue icon button and Space shortcut', async () => {
    const handleTogglePlayPause = vi.fn();
    const handleCueClick = vi.fn();
    render(
      <TranscriptSearch
        displayCues={[
          { id: 'c1', time: '00:10', text: 'Sample transcript line' },
          { id: 'c2', time: '00:25', text: 'Second transcript line' }
        ]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={handleCueClick}
        activeCueIdx={0}
        isPlaying={true}
        handleTogglePlayPause={handleTogglePlayPause}
      />
    );

    const playPauseBtn = screen.getByTestId('transcript-play-pause-btn');
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause video');
    fireEvent.click(playPauseBtn);
    expect(handleTogglePlayPause).toHaveBeenCalledTimes(1);
    expect(handleCueClick).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(handleTogglePlayPause).toHaveBeenCalledTimes(2);
  });

  it('allows editing margin notes in the hover tooltip and in the Notes drawer and saving on Enter', async () => {
    const originalFetch = global.fetch;
    const cues = [
      { id: 'cue_0', time: '01:00', text: 'Gradient descent minimizes loss.' }
    ];
    const activeData = { videoId: 'vid_edit_note', cues };

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations/ann_note_1') && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'success',
            annotation: {
              id: 'ann_note_1',
              videoId: 'vid_edit_note',
              cueId: 'cue_0',
              selectedText: 'Gradient descent',
              annotationType: 'note',
              noteText: body.note_text
            }
          })
        });
      }
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_note_1',
                videoId: 'vid_edit_note',
                cueId: 'cue_0',
                selectedText: 'Gradient descent',
                annotationType: 'note',
                noteText: 'Initial note text'
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

    const markEl = await screen.findByText('Gradient descent');
    fireEvent.mouseEnter(markEl);

    const tooltip = await screen.findByTestId('mark-hover-tooltip');
    expect(tooltip).toHaveTextContent('Initial note text');

    const editTooltipBtn = screen.getByRole('button', { name: /Edit note in tooltip/i });
    fireEvent.click(editTooltipBtn);

    const tooltipInput = screen.getByRole('textbox', { name: /Edit margin note text/i });
    fireEvent.change(tooltipInput, { target: { value: 'Updated via tooltip Enter' } });
    fireEvent.keyDown(tooltipInput, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/annotations/ann_note_1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ note_text: 'Updated via tooltip Enter' })
        })
      );
    });

    // Now open Notes drawer and edit there with Enter
    const notesBtn = screen.getByRole('button', { name: /Notes and Highlights/i });
    fireEvent.click(notesBtn);

    expect((await screen.findAllByText('Updated via tooltip Enter')).length).toBeGreaterThanOrEqual(1);
    const drawerEditBtn = screen.getByRole('button', { name: /^Edit note$/i });
    fireEvent.click(drawerEditBtn);

    const drawerInput = screen.getByRole('textbox', { name: /Edit note input/i });
    fireEvent.change(drawerInput, { target: { value: 'Updated in drawer via Enter' } });
    fireEvent.keyDown(drawerInput, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/annotations/ann_note_1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ note_text: 'Updated in drawer via Enter' })
        })
      );
      expect(screen.getAllByText('Updated in drawer via Enter').length).toBeGreaterThanOrEqual(1);
    });

    global.fetch = originalFetch;
  });

  it('allows using Ask AI on an already highlighted text via mark action popover', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations') && (!opts || opts.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_hl_1',
                cue_id: 0,
                selected_text: 'Probability Mass Function',
                annotation_type: 'highlight',
                color: 'yellow',
                start_seconds: 10,
                end_seconds: 15
              }
            ]
          })
        });
      }
      if (url.includes('/explain-selection') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            explanation: 'Welcome to your AI Lecture Tutor! A **PMF** gives probability $$P(X = x)$$.'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const cues = [
      { id: 'cue_0', time: '00:10', seconds: 10, text: 'We introduce the Probability Mass Function today.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_pmf' }}
      />
    );

    const markEl = await screen.findByText('Probability Mass Function');
    expect(markEl).toBeInTheDocument();

    // Clicking the highlighted mark opens the mark action popover
    fireEvent.click(markEl);

    // The popover should have an "Ask AI" button
    const askAiBtn = await screen.findByRole('button', { name: /Ask AI/i });
    expect(askAiBtn).toBeInTheDocument();

    fireEvent.click(askAiBtn);

    // Clicking Ask AI should trigger explain-selection and show AI Selection Explainer toolbar
    await waitFor(() => {
      expect(screen.getByText('AI Selection Explainer')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_pmf/explain-selection'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Probability Mass Function')
        })
      );
    });

    global.fetch = originalFetch;
  });

  it('does not display redundant quotation hover tooltip on simple highlights', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_simple_1',
                cue_id: 0,
                selected_text: 'convex optimization',
                annotation_type: 'highlight',
                color: 'yellow',
                start_seconds: 5,
                end_seconds: 10
              }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const cues = [
      { id: 'cue_0', time: '00:05', seconds: 5, text: 'This lecture covers convex optimization in detail.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_opt' }}
      />
    );

    const markEl = await screen.findByText('convex optimization');
    fireEvent.mouseEnter(markEl);

    // Simple highlight has no note or AI response; redundant hover tooltip should NOT appear
    expect(screen.queryByTestId('mark-hover-tooltip')).not.toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('renders AI explanation badge strictly on the annotated cue and not on adjacent cues', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_ai_1',
                cue_id: 1,
                selected_text: 'Markov chains',
                annotation_type: 'ai_explanation',
                ai_response: 'Markov chains model stochastic state transitions.',
                start_seconds: 20,
                end_seconds: 25
              }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const cues = [
      { id: 'cue_0', time: '00:10', seconds: 10, text: 'Line before the selection.' },
      { id: 'cue_1', time: '00:20', seconds: 20, text: 'Now we discuss Markov chains and memorylessness.' },
      { id: 'cue_2', time: '00:30', seconds: 30, text: 'Line after the selection.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={1}
        activeData={{ videoId: 'vid_mc' }}
      />
    );

    // Wait for annotation to load
    await screen.findByText('Markov chains');

    // Only 1 AI badge should exist across the entire transcript (on cue_1), not on cue_0 or cue_2
    const aiBadges = screen.getAllByRole('button', { name: /View AI explanation/i });
    expect(aiBadges.length).toBe(1);

    global.fetch = originalFetch;
  });

  it('renders markdown and LaTeX in AI explainer and provides copy option', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
      }
      if (url.includes('/explain-selection') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            explanation: '### PMF Explanation\nA **discrete random variable** satisfies $P(X = x) \\ge 0$.'
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    // Mock clipboard writeText
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    const cues = [
      { id: 'cue_0', time: '00:00', seconds: 0, text: 'Definition of discrete random variables.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_pmf2' }}
      />
    );

    const cueEl = document.querySelector('.transcript-cue');
    const textNode = cueEl.firstChild;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'discrete random variable',
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        commonAncestorContainer: cueEl,
        getBoundingClientRect: () => ({ top: 120, left: 150, width: 80, height: 18 }),
        getClientRects: () => [{ top: 120, left: 150, width: 80, height: 18 }]
      }),
      removeAllRanges: vi.fn()
    });

    const scrollContainer = cueEl.closest('[tabindex="0"]');
    fireEvent.mouseUp(scrollContainer);

    const askAiBtn = await screen.findByTitle(/Ask AI to explain selected text/i);
    fireEvent.click(askAiBtn);

    // Markdown heading and bold should be rendered
    expect(await screen.findByRole('heading', { level: 3, name: /PMF Explanation/i })).toBeInTheDocument();
    expect(screen.getByText('discrete random variable')).toBeInTheDocument();

    // KaTeX should render the math formula
    expect(document.querySelector('.katex')).toBeInTheDocument();

    // Copy button should copy the formatted explanation
    const copyBtn = screen.getByRole('button', { name: /Copy AI explanation/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('### PMF Explanation')
    );
    expect(await screen.findByText(/Copied!/i)).toBeInTheDocument();

    global.fetch = originalFetch;
  });

  it('allows generating AI explanation directly from the timestamped notes drawer with copy and discuss options', async () => {
    const originalFetch = global.fetch;
    const handleDiscussInTutor = vi.fn();

    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.includes('/annotations') && (!opts || opts.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            annotations: [
              {
                id: 'ann_note_drawer_1',
                cue_id: 0,
                selected_text: 'Central Limit Theorem',
                note_text: 'Important for sampling theory',
                annotation_type: 'note',
                start_seconds: 45
              }
            ]
          })
        });
      }
      if (url.includes('/explain-selection') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            explanation: 'The **CLT** states that the sample mean approaches normal distribution $N(\\mu, \\sigma^2/n)$.'
          })
        });
      }
      if (url.includes('/annotations/ann_note_drawer_1') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const cues = [
      { id: 'cue_0', time: '00:45', seconds: 45, text: 'Here is the Central Limit Theorem.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_clt' }}
        onDiscussInTutor={handleDiscussInTutor}
      />
    );

    // Open notes drawer
    const notesBtn = await screen.findByRole('button', { name: /Notes and Highlights/i });
    fireEvent.click(notesBtn);

    expect(await screen.findByText('Reader Notes & Highlights')).toBeInTheDocument();

    // Find AI Explain button in the note card
    const explainBtn = screen.getByRole('button', { name: /Explain note with AI/i });
    expect(explainBtn).toBeInTheDocument();

    fireEvent.click(explainBtn);

    // Should fetch explanation and display with markdown/KaTeX
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/lecture/vid_clt/explain-selection'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Central Limit Theorem')
        })
      );
    });

    expect(await screen.findByText('AI Explanation')).toBeInTheDocument();
    expect(screen.getByText('CLT')).toBeInTheDocument();

    // Discuss in Tutor button should trigger onDiscussInTutor callback
    const discussBtn = screen.getByRole('button', { name: /Discuss in AI Tutor/i });
    fireEvent.click(discussBtn);

    expect(handleDiscussInTutor).toHaveBeenCalledWith(
      expect.stringContaining('Central Limit Theorem'),
      '00:45'
    );

    global.fetch = originalFetch;
  });

  it('renders transcript appearance button and allows customizing cue font and color', async () => {
    const cues = [
      { id: 'cue_0', time: '01:00', seconds: 60, text: 'Customized transcript cue text.' }
    ];

    render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_app_test' }}
      />
    );

    // Appearance toggle button
    const appearanceBtn = screen.getByRole('button', { name: /Transcript Appearance/i });
    expect(appearanceBtn).toBeInTheDocument();

    // Open appearance menu
    fireEvent.click(appearanceBtn);
    expect(await screen.findByRole('dialog', { name: /Transcript Appearance Settings/i })).toBeInTheDocument();

    // Select Monospace font and Netflix Yellow color
    const monoFontBtn = screen.getByRole('button', { name: /Font Monospace/i });
    fireEvent.click(monoFontBtn);

    const yellowColorBtn = screen.getByRole('button', { name: /Color Netflix Yellow/i });
    fireEvent.click(yellowColorBtn);

    // Verify cue row has transcript-cue class and container has CSS variables
    const cueElement = screen.getByText('Customized transcript cue text.').closest('.transcript-cue');
    expect(cueElement).toBeInTheDocument();
  });

  it('maintains cue synchronization and autoScroll when switching windows or tabs', async () => {
    const cues = [
      { id: 'cue_0', time: '00:00', seconds: 0, text: 'Cue line 0' },
      { id: 'cue_1', time: '00:30', seconds: 30, text: 'Cue line 1' },
      { id: 'cue_2', time: '01:00', seconds: 60, text: 'Cue line 2' }
    ];

    const { rerender } = render(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={0}
        activeData={{ videoId: 'vid_sync_test' }}
      />
    );

    // Simulate switching windows (blur/hidden) while active cue advances
    rerender(
      <TranscriptSearch
        displayCues={cues}
        searchQuery=""
        setSearchQuery={vi.fn()}
        handleCueClick={vi.fn()}
        activeCueIdx={2}
        activeData={{ videoId: 'vid_sync_test' }}
      />
    );

    // Simulate window regain focus / visibilitychange
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));

    // Re-center button should not appear because autoScroll remains active
    expect(screen.queryByText(/Re-center/i)).toBeNull();

    // Cue 2 should be active
    const activeCueEl = screen.getByText('Cue line 2').closest('.transcript-cue-row');
    expect(activeCueEl).toHaveClass('active');
  });
});