import React from 'react';
import { Clock } from 'lucide-react';
import { formatResponseTime } from '../../utils/formatters';

export default function ResponseTimeBadge({
  ms,
  prefix = '',
  size = 'xs',
  className = '',
  style = {}
}) {
  const formatted = formatResponseTime(ms);
  if (!formatted) return null;

  const isSmall = size === 'sm';
  const iconSize = isSmall ? 12 : 11;

  return (
    <span
      className={`ai-response-time-badge ${className}`.trim()}
      data-testid="ai-response-time"
      title={`AI response time: ${formatted}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: isSmall ? '0.73rem' : '0.68rem',
        fontWeight: 600,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        color: 'var(--text-secondary, #64748b)',
        background: 'rgba(148, 163, 184, 0.12)',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        padding: isSmall ? '2px 8px' : '1px 6px',
        borderRadius: '999px',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style
      }}
    >
      <Clock size={iconSize} style={{ flexShrink: 0, opacity: 0.85 }} />
      <span>{prefix ? `${prefix}${formatted}` : formatted}</span>
    </span>
  );
}

