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
});

