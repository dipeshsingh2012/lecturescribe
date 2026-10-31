import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssignmentStudio from '../AssignmentStudio';

describe('AssignmentStudio Component', () => {
  const mockTheme = {
    palette: {
      primary: '#3b82f6',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#64748b'
    }
  };

  const mockModelsData = {
    status: 'success',
    models: [
      { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (Recommended)', provider: 'Google Gemini', contextWindow: 1048576, isRecommended: true },
      { id: 'openai/gpt-oss-120b', displayName: 'Groq GPT-OSS 120B', provider: 'Groq', contextWindow: 131072, isRecommended: false }
    ],
    recommended_model: 'gemini-3.8-flash'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/api/llm/available-models')) {
        return {
          ok: true,
          json: async () => mockModelsData
        };
      }
      return {
        ok: true,
        json: async () => ({ status: 'success' })
      };
    });
  });

  it('renders initial setup form when no initialSessionId is provided', async () => {
    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId={null}
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Co-Create Grounded Assignment & Research Solutions/i)).toBeInTheDocument();
    expect(screen.getByText(/Launch Studio Co-Pilot/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste or type the problem statement/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/AI Model \(Discovered dynamically via Redis\):/i)).toBeInTheDocument();
    });
  });

  it('submits a free-text problem prompt and transitions to split studio layout', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/api/llm/available-models')) {
        return {
          ok: true,
          json: async () => mockModelsData
        };
      }
      if (url.includes('/assignments/studio/start')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_test1',
            title: 'Attention Analysis',
            selected_model: 'gemini-3.8-flash',
            chat_history: [
              { role: 'user', content: 'Compare Bahdanau vs Luong attention.', timestamp: '2026-10-31T06:00:00Z' },
              { role: 'assistant', content: 'Here is the proposed outline for Attention Analysis.', timestamp: '2026-10-31T06:00:01Z' }
            ],
            draft_markdown: '',
            citations: [{ video_title: 'Lecture 6', timestamp: '14:20', text: 'Attention models' }]
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId={null}
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    const promptInput = screen.getByPlaceholderText(/Paste or type the problem statement/i);
    fireEvent.change(promptInput, { target: { value: 'Compare Bahdanau vs Luong attention.' } });

    const launchBtn = screen.getByText(/Launch Studio Co-Pilot/i);
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Attention Analysis/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Studio Co-Pilot/i)).toBeInTheDocument();
      expect(screen.getByText(/Live Document Preview/i)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Preview/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders active session with draft preview and allows toggling to Edit Raw mode', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/api/llm/available-models')) {
        return {
          ok: true,
          json: async () => mockModelsData
        };
      }
      if (url.includes('/assignments/studio/asgn_studio_active')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_active',
            title: 'Transformer Research',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'Research on Self-Attention',
            chat_history: [
              { role: 'user', content: 'Research on Self-Attention', timestamp: '2026-10-31T06:00:00Z' },
              { role: 'assistant', content: 'First draft synthesized.', timestamp: '2026-10-31T06:00:01Z' }
            ],
            draft_markdown: '# Self-Attention\n\n$$A = \\text{softmax}(QK^T)V$$\n\nSelf-attention connects all pairs.',
            citations: [],
            studio_status: 'drafting',
            download_pdf_url: null
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_active"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Transformer Research/i)).toBeInTheDocument();
      expect(screen.getByText(/Self-attention connects all pairs/i)).toBeInTheDocument();
    });

    // Toggle to Edit Raw mode
    const editBtn = screen.getByText(/Edit Raw/i);
    fireEvent.click(editBtn);

    expect(screen.getByText(/Raw Markdown Editor/i)).toBeInTheDocument();
    const rawEditor = screen.getByDisplayValue(/# Self-Attention/i);
    expect(rawEditor).toBeInTheDocument();
  });

  it('compiles PDF and renders Download PDF button', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/api/llm/available-models')) {
        return {
          ok: true,
          json: async () => mockModelsData
        };
      }
      if (url.includes('/compile-pdf')) {
        return {
          ok: true,
          json: async () => ({
            status: 'completed',
            session_id: 'asgn_studio_compile',
            title: 'Optimization Convexity',
            pdf_blob_name: 'asgn_studio_compile.pdf',
            pdf_filename: 'optimization_convexity.pdf',
            pdf_url: '/api/course/cs-229/assignments/asgn_studio_compile/download/pdf'
          })
        };
      }
      if (url.includes('/assignments/studio/asgn_studio_compile')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_compile',
            title: 'Optimization Convexity',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'Show Hessian is positive semi-definite',
            chat_history: [
              { role: 'user', content: 'Show Hessian is positive semi-definite', timestamp: '2026-10-31T06:00:00Z' }
            ],
            draft_markdown: '# Convexity\n\nProof of convexity.',
            citations: [],
            studio_status: 'drafting'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_compile"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Optimization Convexity/i)).toBeInTheDocument();
    });

    const compileBtn = screen.getByText(/Compile to PDF/i);
    fireEvent.click(compileBtn);

    await waitFor(() => {
      expect(screen.getByText(/Download PDF/i)).toBeInTheDocument();
    });
  });

  it('restores unsaved problem prompt and title from localStorage on setup form', async () => {
    localStorage.setItem(
      'lecturescribe_studio_draft_setup_cs-229',
      JSON.stringify({
        title: 'Unsaved Proof of SGD Convergence',
        problemPrompt: 'Derive the learning rate bound for non-convex functions.'
      })
    );

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId={null}
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Restored unsaved problem prompt from your previous tab\/session/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue(/Unsaved Proof of SGD Convergence/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue(/Derive the learning rate bound for non-convex functions/i)).toBeInTheDocument();
    });

    // Clicking "Clear & Start Fresh" clears the restored prompt
    const clearBtn = screen.getByText(/Clear & Start Fresh/i);
    fireEvent.click(clearBtn);

    expect(screen.queryByText(/Restored unsaved problem prompt/i)).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThanOrEqual(2);
  });

  it('auto-saves raw draft edits immediately to localStorage and calls draft update endpoint', async () => {
    let putDraftCalled = false;
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/llm/available-models')) {
        return { ok: true, json: async () => mockModelsData };
      }
      if (url.includes('/draft') && opts?.method === 'PUT') {
        putDraftCalled = true;
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      if (url.includes('/assignments/studio/asgn_studio_persist')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_persist',
            title: 'Neural ODEs',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'ODE Solvers',
            chat_history: [{ role: 'user', content: 'ODE Solvers', timestamp: '2026-10-31T06:00:00Z' }],
            draft_markdown: '# Neural ODE\nInitial text.',
            citations: [],
            studio_status: 'drafting'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_persist"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Neural ODEs/i)).toBeInTheDocument();
    });

    // Switch to Edit Raw
    fireEvent.click(screen.getByText(/Edit Raw/i));
    const textarea = screen.getByDisplayValue(/# Neural ODE/i);

    fireEvent.change(textarea, { target: { value: '# Neural ODE\nUpdated with adjoint sensitivity method.' } });

    // Local storage should immediately contain the keystrokes
    const cached = JSON.parse(localStorage.getItem('lecturescribe_studio_draft_cs-229_asgn_studio_persist') || '{}');
    expect(cached.content).toContain('adjoint sensitivity method');

    // Trigger blur to flush save
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(putDraftCalled).toBe(true);
    });
  });

  it('clicking preview button uses last complete assistant response and avoids retriggering LLM chat calls', async () => {
    let chatEndpointCalled = false;
    let putDraftPayload = null;

    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/llm/available-models')) {
        return { ok: true, json: async () => mockModelsData };
      }
      if (url.includes('/assignments/studio/asgn_studio_preview_reuse/draft')) {
        putDraftPayload = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      if (url.includes('/assignments/studio/asgn_studio_preview_reuse/chat')) {
        chatEndpointCalled = true;
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      if (url.includes('/assignments/studio/asgn_studio_preview_reuse')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_preview_reuse',
            title: 'Multi-Head Attention Studio',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'Design an attention layer.',
            chat_history: [
              { role: 'user', content: 'Design an attention layer.', timestamp: '2026-10-31T06:00:00Z' },
              { role: 'assistant', content: '# Multi-Head Attention Architecture\n\nComplete response outline.', timestamp: '2026-10-31T06:00:01Z' }
            ],
            draft_markdown: '',
            citations: [],
            studio_status: 'discussing'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_preview_reuse"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    // Verify session loaded with existing data from backend
    await waitFor(() => {
      expect(screen.getByText(/Multi-Head Attention Studio/i)).toBeInTheDocument();
      expect(screen.getByText(/Live Document Preview/i)).toBeInTheDocument();
    });

    // Find and click the Preview button in the empty placeholder
    const previewBtns = screen.getAllByRole('button', { name: /^Preview$/i });
    fireEvent.click(previewBtns[previewBtns.length - 1]);

    // Verify that the assistant response was rendered in the preview pane
    await waitFor(() => {
      expect(screen.getAllByText(/Multi-Head Attention Architecture/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(/Complete response outline/i).length).toBeGreaterThanOrEqual(2);
    });

    // Verify draft was flushed to backend draft endpoint without triggering an LLM chat turn
    expect(putDraftPayload).not.toBeNull();
    expect(putDraftPayload.draft_markdown).toContain('Multi-Head Attention Architecture');
    expect(chatEndpointCalled).toBe(false);
  });

  it('toggles to split mode and tightly couples live markdown edits to rendered preview side-by-side', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/api/llm/available-models')) {
        return { ok: true, json: async () => mockModelsData };
      }
      if (url.includes('/assignments/studio/asgn_studio_split')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_split',
            title: 'Split Sync Studio',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'Live split testing',
            chat_history: [],
            draft_markdown: '# Live Architecture\nInitial overview.',
            citations: [],
            studio_status: 'drafting'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_split"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Split Sync Studio/i)).toBeInTheDocument();
      expect(screen.getByText(/Initial overview/i)).toBeInTheDocument();
    });

    // Click Split mode button
    const splitBtn = screen.getByRole('button', { name: /Split/i });
    fireEvent.click(splitBtn);

    // Verify side-by-side panes are visible
    expect(screen.getByText(/MARKDOWN SOURCE/i)).toBeInTheDocument();
    expect(screen.getByText(/LIVE PREVIEW/i)).toBeInTheDocument();

    // Type live into markdown textarea
    const textarea = screen.getByDisplayValue(/Initial overview/i);
    fireEvent.change(textarea, { target: { value: '# Live Architecture\nInstant synchronization test.' } });

    // Verify preview immediately reflects the keystroke
    expect(screen.getAllByText(/Instant synchronization test/i).length).toBeGreaterThanOrEqual(1);
  });

  it('pressing Enter in chat input sends message, while Shift+Enter does not send', async () => {
    let sentMessage = null;

    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/llm/available-models')) {
        return { ok: true, json: async () => mockModelsData };
      }
      if (url.includes('/assignments/studio/asgn_studio_enter/chat')) {
        const body = JSON.parse(opts.body);
        sentMessage = body.message;
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            reply: 'Understood, expanding ablation studies.',
            chat_history: [
              { role: 'user', content: body.message, timestamp: '2026-10-31T08:50:00Z' },
              { role: 'assistant', content: 'Understood, expanding ablation studies.', timestamp: '2026-10-31T08:50:01Z' }
            ],
            draft_markdown: '# Updated with ablations',
            studio_status: 'refining'
          })
        };
      }
      if (url.includes('/assignments/studio/asgn_studio_enter')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_enter',
            title: 'Enter Key Studio',
            selected_model: 'gemini-3.8-flash',
            problem_statement: 'Testing Enter key submission',
            chat_history: [],
            draft_markdown: '# Baseline Draft',
            citations: [],
            studio_status: 'drafting'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <AssignmentStudio
        courseName="CS 229"
        initialSessionId="asgn_studio_enter"
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Enter Key Studio/i)).toBeInTheDocument();
    });

    const chatInput = screen.getByPlaceholderText(/Ask Co-Pilot to refine or expand draft/i);

    // 1. Shift+Enter should NOT send
    fireEvent.change(chatInput, { target: { value: 'Draft multi-line message' } });
    fireEvent.keyDown(chatInput, { key: 'Enter', shiftKey: true });
    expect(sentMessage).toBeNull();

    // 2. Plain Enter should send the message
    fireEvent.keyDown(chatInput, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(sentMessage).toBe('Draft multi-line message');
      expect(screen.getByText(/Understood, expanding ablation studies/i)).toBeInTheDocument();
    });
  });
});
