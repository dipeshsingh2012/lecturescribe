/**
 * Utilities for detecting, parsing, and exporting Jupyter Notebook (.ipynb) drafts
 * in Assignment Studio.
 */

const NOTEBOOK_KEYWORDS = [
  'jupyter notebook',
  'jupyter',
  '.ipynb',
  'ipynb',
  'colab notebook',
  'google colab',
  'code cells',
  'executable code cells',
];

/**
 * Detect whether a studio draft or session context represents a Jupyter Notebook.
 */
export function isNotebookContent(draftMarkdown = '', contextText = '') {
  const draft = String(draftMarkdown || '').trim();
  const context = String(contextText || '').toLowerCase();

  // Raw nbformat JSON
  if (draft.startsWith('{') && draft.includes('"cells"') && draft.includes('"nbformat"')) {
    return true;
  }

  // Contains fenced python/py code cells
  if (/```(?:python|py|ipynb)\b/i.test(draft)) {
    return true;
  }

  // Explicit notebook intent in problem statement / title / chat
  return NOTEBOOK_KEYWORDS.some((kw) => context.includes(kw));
}

/**
 * Parse Markdown (with fenced python code blocks) or raw nbformat JSON into an ordered
 * array of Jupyter cells: [{ cell_type: 'markdown' | 'code', source: string }].
 */
export function parseDraftToNotebookCells(draftMarkdown = '') {
  const raw = String(draftMarkdown || '').trim();
  if (!raw) return [];

  // 1. Handle raw .ipynb JSON directly if provided
  if (raw.startsWith('{') && raw.includes('"cells"')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.cells)) {
        return parsed.cells
          .map((c) => ({
            cell_type: c.cell_type === 'code' ? 'code' : 'markdown',
            source: Array.isArray(c.source) ? c.source.join('') : String(c.source || ''),
          }))
          .filter((c) => c.source.trim().length > 0);
      }
    } catch {
      // Fall through to markdown fence parser
    }
  }

  // 2. Split Markdown around fenced python code blocks (```python ... ```)
  const cells = [];
  const fenceRegex = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index).trim();
    if (before) {
      cells.push({ cell_type: 'markdown', source: before });
    }
    const code = (match[1] || '').replace(/\n+$/, '');
    if (code.trim()) {
      cells.push({ cell_type: 'code', source: code });
    }
    lastIndex = fenceRegex.lastIndex;
  }

  const remaining = raw.slice(lastIndex).trim();
  if (remaining) {
    cells.push({ cell_type: 'markdown', source: remaining });
  }

  return cells;
}

/**
 * Convert a draft string into a valid Jupyter Notebook v4 (.ipynb) JSON object.
 */
export function buildIpynbObject(draftMarkdown = '') {
  const parsedCells = parseDraftToNotebookCells(draftMarkdown);
  const toSourceLines = (text) => {
    const lines = String(text || '').split('\n');
    return lines.map((line, idx) => (idx < lines.length - 1 ? `${line}\n` : line));
  };

  return {
    cells: parsedCells.map((cell) => {
      if (cell.cell_type === 'code') {
        return {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: toSourceLines(cell.source),
        };
      }
      return {
        cell_type: 'markdown',
        metadata: {},
        source: toSourceLines(cell.source),
      };
    }),
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.10.0',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Trigger a browser download of the draft as a .ipynb file.
 */
export function downloadDraftAsIpynb(draftMarkdown = '', title = 'assignment_notebook') {
  const nb = buildIpynbObject(draftMarkdown);
  const json = JSON.stringify(nb, null, 2);
  const blob = new Blob([json], { type: 'application/x-ipynb+json;charset=utf-8' });
  const safeName =
    String(title || 'assignment_notebook')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'assignment_notebook';
  const filename = safeName.endsWith('.ipynb') ? safeName : `${safeName}.ipynb`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
