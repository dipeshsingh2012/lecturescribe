import React from 'react';
import katex from 'katex';

/**
 * Pure component to parse $...$ inline LaTeX expressions and render KaTeX formulas.
 */
export default function MathRenderer({ text, isActive = false, className = '' }) {
  if (!text || typeof text !== 'string') return text || null;
  if (!text.includes('$')) {
    return text;
  }

  const parts = [];
  const regex = /\$([^\$]+)\$/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const formula = match[1];
    try {
      const rendered = katex.renderToString(formula, { throwOnError: false });
      parts.push(
        <span
          key={`katex-${match.index}`}
          className={`cue-math-expression ${className}`.trim()}
          style={{
            padding: '0 2px',
            color: isActive ? 'var(--theme-primary)' : 'inherit',
            fontWeight: 600
          }}
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      );
    } catch {
      parts.push(`$${formula}$`);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

