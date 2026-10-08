import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownWithTimestamps from '../MarkdownWithTimestamps';

describe('MarkdownWithTimestamps', () => {
  it('renders plain text markdown properly', () => {
    render(<MarkdownWithTimestamps content="This is **bold** text." />);
    expect(screen.getByText(/This is/)).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('detects inline timestamps and converts them to clickable jump buttons', () => {
    const handleCueClick = vi.fn();
    render(
      <MarkdownWithTimestamps
        content="Check this topic at [05:23] and also at [1:12:45]."
        onCueClick={handleCueClick}
      />
    );

    const button1 = screen.getByRole('button', { name: /05:23/i });
    const button2 = screen.getByRole('button', { name: /1:12:45/i });
    expect(button1).toBeInTheDocument();
    expect(button2).toBeInTheDocument();

    fireEvent.click(button1);
    expect(handleCueClick).toHaveBeenCalledWith('05:23');

    fireEvent.click(button2);
    expect(handleCueClick).toHaveBeenCalledWith('1:12:45');
  });

  it('renders empty content gracefully', () => {
    const { container } = render(<MarkdownWithTimestamps content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('converts tool citation brackets 【search_course_lectures】 into clickable buttons', () => {
    const onCueClick = vi.fn();
    const onCrossLectureClick = vi.fn();
    const citations = [
      {
        video_id: '1229247139',
        video_title: 'Data Science Lab Live session - 2',
        timestamp: '37:46',
        cross_lecture: true
      }
    ];

    render(
      <MarkdownWithTimestamps
        content="The term appears at **[37:46]** in the transcript【search_course_lectures】."
        onCueClick={onCueClick}
        citations={citations}
        onCrossLectureClick={onCrossLectureClick}
      />
    );

    // The tool bracket 【search_course_lectures】 should be rendered as a button, not plain text
    const searchBtn = screen.getByTitle(/Jump to Data Science Lab Live session - 2 at 37:46/i);
    expect(searchBtn).toBeInTheDocument();
    fireEvent.click(searchBtn);
    expect(onCrossLectureClick).toHaveBeenCalledWith('1229247139', '37:46', 'Data Science Lab Live session - 2');

    // The timestamp [37:46] for a cross-lecture citation should also call onCrossLectureClick
    const timestampBtn = screen.getByTitle(/Open Data Science Lab Live session - 2 at 37:46/i);
    expect(timestampBtn).toBeInTheDocument();
    fireEvent.click(timestampBtn);
    expect(onCrossLectureClick).toHaveBeenCalledWith('1229247139', '37:46', 'Data Science Lab Live session - 2');
    expect(onCueClick).not.toHaveBeenCalled();
  });

  it('converts bracketed web result citations with URLs into clickable web links', () => {
    render(
      <MarkdownWithTimestamps
        content='Explanation of default newline【"Web Result 1","url":"https://www.geeksforgeeks.org/python/python-new-line-add-print-a-new-line/"}】'
      />
    );

    const link = screen.getByRole('link', { name: /geeksforgeeks\.org/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://www.geeksforgeeks.org/python/python-new-line-add-print-a-new-line/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders mathematical formulas with KaTeX typesetting', () => {
    const { container } = render(
      <MarkdownWithTimestamps
        content="The foundational baseline is $E=mc^2$ and the sigmoid is $$\sigma(z) = \frac{1}{1 + e^{-z}}$$"
      />
    );

    const katexSpans = container.querySelectorAll('.katex');
    expect(katexSpans.length).toBeGreaterThan(0);
    expect(container.querySelector('.katex-mathml')).toBeInTheDocument();
  });

  it('repairs a bracketed bare equation with malformed subscript markers', () => {
    const { container } = render(
      <MarkdownWithTimestamps
        content={String.raw`[
\hat{\beta}*{1} \sim \mathcal{N}!\left(\beta*{1},; \frac{\sigma^{2}}{\sum (x_i-\bar{x})^{2}}\right)
]`}
      />
    );

    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex-mathml')).toHaveTextContent(/beta/);
    expect(container.textContent).not.toContain('*{1}');
  });

  it('renders standard inline and display LaTeX delimiters without damaging markdown', () => {
    const { container } = render(
      <MarkdownWithTimestamps
        content={String.raw`A **probability density function** \(f_X(x)\) is non-negative.

### Probability Density Function (PDF)

1. **Non-negativity**
   \[
   f_X(x) \ge 0 \quad \text{for all } x \in \mathbb{R}.
   \]

| Property | Description |
|----------|-------------|
| **Normalised** | \(\int_{-\infty}^{\infty} f_X(x)\,dx = 1\). |

### References

- [Probability density function](https://en.wikipedia.org/wiki/Probability_density_function)`}
      />
    );

    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('h3')).toHaveTextContent('Probability Density Function (PDF)');
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Probability density function' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Probability_density_function');
    expect(container.textContent).not.toContain('\\[');
    expect(container.textContent).not.toContain('\\]');
  });

  it('renders lecture summary with mixed math and timestamps without corrupting delimiters', () => {
    const handleCueClick = vi.fn();
    const content = `Announcements and Schedule Updates
## Review of Linearly Independent Sets and Span [08:00] The lecture transitions into revisiting core linear algebra concepts from previous reading assignments, specifically focusing on linear independence and vector spaces [08:34, 13:26]. [13:31] A set of vectors $\{v_1, v_2, \\dots, v_k\}$ in $\\mathbb{R}^n$ is defined as **linearly independent** if the only way to generate the zero vector via a linear combination is by setting all scalars to zero ($c_1v_1 + c_2v_2 + \\dots + c_kv_k = 0 \\implies c_1 = c_2 = \\dots = c_k = 0$) [13:31, 14:52]. [22:23] The **span** of a set of vectors is introduced as the set of all possible linear combinations of those vectors, representing the smallest vector space that contains the given set of vectors [29:00, 30:05]. ## Four Fundamental Subspaces of a Matrix [41:06] The professor reviews the four fundamental subspaces associated with an $m \\times n$ matrix $A$: 1. **Null space of $A$** ($\\text{Nul}(A)$), which is a subset of $\\mathbb{R}^n$ [42:19]. 2. **Column space of $A$** ($\\text{Col}(A)$) or range of $A$, which is a subset of $\\mathbb{R}^m$ [42:33]. 3. **Null space of $A^T$** ($\\text{Nul}(A^T)$), which is a subset of $\\mathbb{R}^m$ [42:49]. 4. **Column space of $A^T$** ($\\text{Col}(A^T)$) or the row space of $A$, which is a subset of $\\mathbb{R}^n$ [43:02, 43:33]. ## Linear Transformations [50:32] A **linear transformation** $T: \\mathbb{R}^n \\to \\mathbb{R}^m$ is a mapping from a vector $x$ in $\\mathbb{R}^n$ to a vector $b$ in $\\mathbb{R}^m$ via matrix multiplication ($Ax = b$) that satisfies three key properties [51:14, 1:01:22]: 1. **Zero mapping:** $T(0) = 0$ (the zero vector in $\\mathbb{R}^n$ maps to the zero vector in $\\mathbb{R}^m$) [1:01:31]. 2. **Superposition (Additivity):** $T(u + v) = T(u) + T(v)$ for all vectors $u, v$ in $\\mathbb{R}^n$ [1:02:39]. 3. **Homogeneity:** $T(cu) = cT(u)$ for any vector $u$ and scalar $c$ [1:03:04, 1:07:44]. Geometric implications of linear transformations include mapping lines or planes passing through the origin in $\\mathbb{R}^n$ to lines or planes passing through the origin in $\\mathbb{R}^m$ [1:15:09, 1:18:26].`;

    const { container } = render(
      <MarkdownWithTimestamps content={content} onCueClick={handleCueClick} />
    );

    // Mathematical formulas are preserved and rendered via KaTeX
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0);
    // Crucially: no stray $$ display math delimiters were injected around timestamps or prose
    expect(container.textContent).not.toContain('$$');
    // Headings are intact
    const headings = Array.from(container.querySelectorAll('h2')).map(h => h.textContent);
    expect(headings.some(t => t.includes('Review of Linearly Independent Sets'))).toBe(true);
    expect(headings.some(t => t.includes('Four Fundamental Subspaces'))).toBe(true);
    expect(headings.some(t => t.includes('Linear Transformations'))).toBe(true);
    // Timestamps are converted to clickable buttons, including comma-separated lists
    const btn08 = screen.getByRole('button', { name: /08:00/i });
    expect(btn08).toBeInTheDocument();
    fireEvent.click(btn08);
    expect(handleCueClick).toHaveBeenCalledWith('08:00');

    expect(screen.getByRole('button', { name: /08:34/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /13:26/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /13:31/i }).length).toBe(2);
    expect(screen.getByRole('button', { name: /14:52/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /42:19/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /42:33/i })).toBeInTheDocument();
  });

  it('repairs and correctly renders previously corrupted timestamp math delimiters', () => {
    const handleCueClick = vi.fn();
    const corruptedContent = `subset of $\\mathbb{R}^n$ [42:19$$. 2. **Column space of $A$** ($\\text{Col}(A)$) or range of $A$, which is a subset of $\\mathbb{R}^m$ $$42:33].`;
    const { container } = render(
      <MarkdownWithTimestamps content={corruptedContent} onCueClick={handleCueClick} />
    );

    expect(container.textContent).not.toContain('42:19$$');
    expect(container.textContent).not.toContain('$$42:33');
    expect(screen.getByRole('button', { name: /42:19/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /42:33/i })).toBeInTheDocument();
  });
});
