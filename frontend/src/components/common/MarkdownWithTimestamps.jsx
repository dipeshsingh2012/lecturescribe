import React from 'react';
import ReactMarkdown from 'react-markdown';

export default function MarkdownWithTimestamps({
  content,
  onCueClick,
  citations = [],
  onCrossLectureClick
}) {
  // Parse inline timestamps and tool citations in bot messages and make them clickable
  const renderMessageWithTimestamps = (text) => {
    if (!text) return null;
    const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\]|【[^】]+】)/g);
    if (parts.length === 1) return text;
    return parts.map((part, pIdx) => {
      const match = part.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/);
      if (match) {
        const ts = match[1];
        const crossCite = (citations || []).find(c => c.cross_lecture && c.timestamp === ts);
        if (crossCite && typeof onCrossLectureClick === 'function') {
          return (
            <button
              key={pIdx}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCrossLectureClick(crossCite.video_id, crossCite.timestamp, crossCite.video_title);
              }}
              title={`Open ${crossCite.video_title || 'lecture'} at ${ts}`}
              style={{
                background: 'rgba(0, 117, 237, 0.12)',
                color: 'var(--theme-primary)',
                border: '1px solid var(--theme-primary)',
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

      const bracketMatch = part.match(/^【([^】]+)】$/);
      if (bracketMatch) {
        const rawTag = bracketMatch[1];

        // 1. Check if this bracket contains a web URL (e.g. {"url":"https://...", "Web Result 1"})
        const urlMatch = rawTag.match(/https?:\/\/[^\s"'\\}]+/i);
        if (urlMatch) {
          const webUrl = urlMatch[0];
          let domainName = '';
          try {
            const parsed = new URL(webUrl);
            domainName = parsed.hostname.replace(/^www\./i, '');
          } catch {}

          let webLabel = '';
          const resultNumMatch = rawTag.match(/Web\s*Result\s*\d+/i);
          if (resultNumMatch) {
            webLabel = domainName ? `${domainName} (${resultNumMatch[0]})` : resultNumMatch[0];
          } else if (domainName) {
            webLabel = domainName;
          } else {
            webLabel = 'Web Source';
          }

          return (
            <a
              key={pIdx}
              href={webUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open source: ${webUrl}`}
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '4px',
                padding: '1px 7px',
                margin: '0 3px',
                fontWeight: 600,
                fontSize: '0.78rem',
                textDecoration: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                verticalAlign: 'baseline',
                transition: 'all 0.15s ease'
              }}
            >
              🌐 {webLabel} ↗
            </a>
          );
        }

        const crossCite = (citations || []).find(c => c.cross_lecture);
        const matchedCite = (rawTag.includes('course') || rawTag.includes('cross'))
          ? (crossCite || (citations || [])[0])
          : (citations || []).find(c => !c.cross_lecture) || (citations || [])[0];

        const isCross = Boolean(matchedCite?.cross_lecture);
        let label = 'Source';
        if (rawTag === 'search_course_lectures') {
          label = matchedCite?.video_title
            ? `📚 ${matchedCite.video_title.length > 24 ? matchedCite.video_title.slice(0, 22) + '…' : matchedCite.video_title}${matchedCite.timestamp ? ` [${matchedCite.timestamp}]` : ''}`
            : '📚 Course Search';
        } else if (rawTag === 'search_lecture_cues') {
          label = matchedCite?.timestamp ? `⏱️ Lecture [${matchedCite.timestamp}]` : '⏱️ Lecture Transcript';
        } else if (rawTag === 'search_web_context') {
          label = '🌐 Web Reference';
        } else {
          label = `🔍 ${rawTag.replace(/_/g, ' ')}`;
        }

        return (
          <button
            key={pIdx}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isCross && matchedCite?.video_id && typeof onCrossLectureClick === 'function') {
                onCrossLectureClick(matchedCite.video_id, matchedCite.timestamp, matchedCite.video_title);
              } else if (matchedCite?.timestamp && typeof onCueClick === 'function') {
                onCueClick(matchedCite.timestamp);
              } else if (crossCite?.video_id && typeof onCrossLectureClick === 'function') {
                onCrossLectureClick(crossCite.video_id, crossCite.timestamp, crossCite.video_title);
              }
            }}
            title={matchedCite ? `Jump to ${matchedCite.video_title || 'lecture'} ${matchedCite.timestamp ? `at ${matchedCite.timestamp}` : ''}` : `Source citation: ${rawTag}`}
            style={{
              background: isCross ? 'rgba(0, 117, 237, 0.12)' : 'var(--highlight-bg)',
              color: 'var(--theme-primary)',
              border: '1px solid ' + (isCross ? 'var(--theme-primary)' : 'rgba(0, 117, 237, 0.35)'),
              borderRadius: '4px',
              padding: '1px 7px',
              margin: '0 3px',
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              verticalAlign: 'baseline',
              transition: 'all 0.15s ease'
            }}
          >
            {label}
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
          <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{renderChildrenWithTimestamps(children)}</strong>
        ),
        em: ({ children }) => (
          <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{renderChildrenWithTimestamps(children)}</em>
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
