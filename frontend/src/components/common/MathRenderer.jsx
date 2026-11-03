import React from 'react';
import katex from 'katex';
import { repairCorruptedLatex } from '../../utils/formatters';

export const hasLatexMath = (text) => {
  if (!text || typeof text !== 'string') return false;
  return text.includes('$') || text.includes('\\(') || text.includes('\\[');
};

/**
 * Pure component to parse inline ($...$, \(...\)) and display ($$...$$, \[...\])
 * LaTeX expressions and render KaTeX formulas.
 */
export default function MathRenderer({ text, isActive = false, className = '' }) {
  if (!text || typeof text !== 'string') return text || null;

  const normalized = repairCorruptedLatex(text);
  if (!hasLatexMath(normalized)) {
    return normalized;
  }

  const parts = [];
  const regex = /\$\$([\s\S]+?)\$\$|\\{1,2}\[([\s\S]+?)\\{1,2}\]|\\{1,2}\(([\s\S]+?)\\{1,2}\)|\$([^$]+)\$/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      parts.push(normalized.slice(lastIndex, match.index));
    }
    const isDisplay = match[1] !== undefined || match[2] !== undefined;
    const rawFormula = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    const formula = rawFormula.trim();

    if (!formula) {
      parts.push(match[0]);
      lastIndex = regex.lastIndex;
      continue;
    }

    try {
      const rendered = katex.renderToString(formula, {
        throwOnError: false,
        displayMode: isDisplay
      });
      parts.push(
        <span
          key={`katex-${match.index}`}
          className={`cue-math-expression ${isDisplay ? 'cue-math-display' : ''} ${className}`.trim()}
          style={{
            display: isDisplay ? 'inline-block' : undefined,
            padding: isDisplay ? '2px 4px' : '0 2px',
            color: isActive ? 'var(--theme-primary)' : 'inherit',
            fontWeight: 600
          }}
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      );
    } catch {
      parts.push(match[0]);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < normalized.length) {
    parts.push(normalized.slice(lastIndex));
  }

  return <>{parts}</>;
}


