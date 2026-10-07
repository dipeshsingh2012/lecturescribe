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
});
