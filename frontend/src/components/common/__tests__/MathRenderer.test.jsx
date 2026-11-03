import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MathRenderer from '../MathRenderer';

describe('MathRenderer Component', () => {
  it('returns plain text unchanged when no $ delimiters exist', () => {
    const { container } = render(<MathRenderer text="Introduction to Matrices" />);
    expect(container.textContent).toBe('Introduction to Matrices');
    expect(container.querySelector('.cue-math-expression')).toBeNull();
  });

  it('renders inline formulas with KaTeX when $ delimiters are present', () => {
    const { container } = render(<MathRenderer text="Let $x^2 + y^2 = 1$ be a circle." />);
    expect(container.textContent).toContain('Let');
    expect(container.textContent).toContain('be a circle.');

    const mathSpan = container.querySelector('.cue-math-expression');
    expect(mathSpan).toBeInTheDocument();
    expect(mathSpan.querySelector('.katex')).toBeInTheDocument();
  });

  it('handles invalid LaTeX gracefully by falling back to raw expression', () => {
    const { container } = render(<MathRenderer text="Formula $\\undefinedMacro{invalid$ here" />);
    expect(container.textContent).toContain('Formula');
  });

  it('applies active styling when isActive is true', () => {
    const { container } = render(<MathRenderer text="Active formula $E = mc^2$" isActive={true} />);
    const mathSpan = container.querySelector('.cue-math-expression');
    expect(mathSpan).toHaveStyle({ color: 'var(--theme-primary)' });
  });

  it('renders display math $$...$$ and \\[...\\] as well as inline \\(...\\)', () => {
    const { container } = render(
      <MathRenderer text={'Display $$\\int_0^1 x^2 dx$$ and bracket \\[a^2 + b^2 = c^2\\] and paren \\(\\alpha + \\beta\\)'} />
    );
    const mathSpans = container.querySelectorAll('.cue-math-expression');
    expect(mathSpans.length).toBe(3);
    expect(container.querySelectorAll('.cue-math-display').length).toBe(2);
    expect(container.querySelectorAll('.katex').length).toBe(3);
  });
});

