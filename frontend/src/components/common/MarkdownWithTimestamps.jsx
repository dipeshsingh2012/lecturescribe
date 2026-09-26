import React from 'react';
import ReactMarkdown from 'react-markdown';

export default function MarkdownWithTimestamps({ content, onCueClick }) {
  // Parse inline timestamps in bot messages and make them clickable
  const renderMessageWithTimestamps = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
    if (parts.length === 1) return text;
    return parts.map((part, pIdx) => {
      const match = part.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/);
      if (match) {
        const ts = match[1];
        return (
          <button
            key={pIdx}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (typeof onCueClick === 'function') {
                onCueClick(ts);
              }
            }}
            title={`Jump video to ${ts}`}
            style={{
              background: 'var(--highlight-bg)',
              color: 'var(--theme-primary)',
              border: '1px solid rgba(0, 117, 237, 0.3)',
              borderRadius: '4px',
              padding: '1px 6px',
              margin: '0 2px',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              verticalAlign: 'baseline',
              transition: 'all 0.15s ease'
            }}
          >
            ⏱️ {ts}
          </button>
        );
      }
      return part;
    });
  };

  // Recursively process children to find text and turn timestamps into clickable buttons
  const renderChildrenWithTimestamps = (children) => {
    if (!children) return null;
    if (typeof children === 'string') {
      return renderMessageWithTimestamps(children);
    }
    if (Array.isArray(children)) {
      return children.map((child, idx) => {
        if (typeof child === 'string') {
          return <React.Fragment key={idx}>{renderMessageWithTimestamps(child)}</React.Fragment>;
        }
        return child;
      });
    }
    return children;
  };

  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p style={{ margin: '0.4rem 0', lineHeight: 1.6 }}>{renderChildrenWithTimestamps(children)}</p>
        ),
        li: ({ children }) => (
          <li style={{ marginBottom: '0.25rem', lineHeight: 1.5 }}>{renderChildrenWithTimestamps(children)}</li>
        ),
        strong: ({ children }) => (
          <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
        ),
        em: ({ children }) => (
          <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{children}</em>
        ),
        h1: ({ children }) => (
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0.6rem 0 0.3rem', color: 'var(--text-primary)' }}>{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0.5rem 0 0.25rem', color: 'var(--text-primary)' }}>{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0.4rem 0 0.2rem', color: 'var(--text-primary)' }}>{children}</h3>
        ),
        ul: ({ children }) => (
          <ul style={{ paddingLeft: '1.3rem', margin: '0.4rem 0' }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ paddingLeft: '1.3rem', margin: '0.4rem 0' }}>{children}</ol>
        ),
        code: ({ children }) => (
          <code style={{
            background: 'var(--panel-bg)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: 'var(--theme-primary)'
          }}>{children}</code>
        ),
        pre: ({ children }) => (
          <pre style={{
            background: 'var(--panel-bg)',
            padding: '0.8rem',
            borderRadius: '8px',
            overflow: 'auto',
            margin: '0.5rem 0'
          }}>{children}</pre>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--theme-primary)', textDecoration: 'underline' }}
          >
            {children}
          </a>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
