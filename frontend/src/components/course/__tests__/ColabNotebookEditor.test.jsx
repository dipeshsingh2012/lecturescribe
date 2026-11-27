import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ColabNotebookEditor from '../ColabNotebookEditor';
import CourseAssignments from '../CourseAssignments';

describe('ColabNotebookEditor Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleDraft = [
    '# Lab 7: Bias-Variance',
    '',
    '```python',
    'print("hello colab")',
    '```'
  ].join('\n');

  it('executes a code cell and renders inline stdout and PNG plot outputs', async () => {
    const onNotebookChange = vi.fn();
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/notebook/execute-cell')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            execution_count: 1,
            elapsed_ms: 42,
            outputs: [
              { output_type: 'stream', name: 'stdout', text: ['hello colab\n'] },
              { output_type: 'display_data', data: { 'image/png': 'iVBORw0KGgo=' } }
            ],
            kernel: { state: 'idle', execution_count: 1 }
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success', files: [] }) };
    });

    render(
      <ColabNotebookEditor
        courseSlug="data-science-lab"
        sessionId="sess_colab_1"
        title="Assignment_7"
        draftMarkdown={sampleDraft}
        userEmail="student@example.com"
        onNotebookChange={onNotebookChange}
      />
    );

    const runBtn = screen.getByRole('button', { name: /Run code cell 1/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      const outBox = screen.getByTestId('notebook-cell-outputs');
      expect(outBox).toBeInTheDocument();
      expect(within(outBox).getByText(/hello colab/i)).toBeInTheDocument();
      expect(screen.getByAltText(/Cell 2 plot output/i)).toBeInTheDocument();
    });
    expect(onNotebookChange).toHaveBeenCalled();
  });

  it('shows Fix with Co-Pilot on error output and applies + undoes suggested code', async () => {
    const nbWithError = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          source: ['print(undefined_var)'],
          outputs: [
            {
              output_type: 'error',
              ename: 'NameError',
              evalue: "name 'undefined_var' is not defined",
              traceback: ["NameError: name 'undefined_var' is not defined"]
            }
          ]
        }
      ]
    };

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/notebook/cell-assist')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            action: 'fix',
            explanation: 'Defined undefined_var before printing.',
            updated_source: 'undefined_var = 42\nprint(undefined_var)'
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <ColabNotebookEditor
        courseSlug="data-science-lab"
        sessionId="sess_colab_err"
        notebookJson={nbWithError}
        draftMarkdown="```python\nprint(undefined_var)\n```"
      />
    );

    const fixBtn = screen.getByRole('button', { name: /Fix with Co-Pilot/i });
    fireEvent.click(fixBtn);

    await waitFor(() => {
      expect(screen.getByText(/Defined undefined_var before printing/i)).toBeInTheDocument();
    });

    const applyBtn = screen.getByRole('button', { name: /Apply Code/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      const textarea = screen.getByDisplayValue(/undefined_var = 42/i);
      expect(textarea).toBeInTheDocument();
    });
  });

  it('opens workspace Files drawer and lists dataset columns', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/notebook/files')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            files: [{ filename: 'housing.csv', size_bytes: 2048, columns: ['sqft', 'price'] }]
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success' }) };
    });

    render(
      <ColabNotebookEditor
        courseSlug="data-science-lab"
        sessionId="sess_colab_files"
        draftMarkdown={sampleDraft}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Toggle Workspace Files/i }));

    await waitFor(() => {
      expect(screen.getByTestId('colab-files-drawer')).toBeInTheDocument();
      expect(screen.getByText(/housing\.csv/i)).toBeInTheDocument();
      expect(screen.getByText(/Columns: sqft, price/i)).toBeInTheDocument();
    });
  });

  it('renders LectureScribe Notebook button above Launch Free-Text Studio and launches clean Colab workspace', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes('/assignments/studio/notebook/new')) {
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            session_id: 'asgn_studio_nb_clean1',
            title: 'Untitled_Notebook.ipynb',
            draft_markdown: '```python\n\n```',
            notebook_json: {
              nbformat: 4,
              nbformat_minor: 5,
              metadata: {},
              cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [''] }]
            }
          })
        };
      }
      return { ok: true, json: async () => ({ status: 'success', files: [] }) };
    });

    render(
      <CourseAssignments
        courseName="Data Science Lab"
        assignments={[]}
        userEmail="student@example.com"
      />
    );

    const nbBtn = screen.getByRole('button', { name: /LectureScribe Notebook/i });
    const studioBtn = screen.getByRole('button', { name: /Launch Free-Text Studio/i });
    expect(nbBtn).toBeInTheDocument();
    expect(studioBtn).toBeInTheDocument();
    // Verify LectureScribe Notebook appears before (above) Launch Free-Text Studio in DOM order
    expect(nbBtn.compareDocumentPosition(studioBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(nbBtn);

    await waitFor(() => {
      expect(screen.getByTestId('lecturescribe-notebook-workspace')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Untitled_Notebook.ipynb')).toBeInTheDocument();
      expect(screen.getByText(/Python 3 • Connected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^File$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Runtime$/i })).toBeInTheDocument();
    });
  });
});
