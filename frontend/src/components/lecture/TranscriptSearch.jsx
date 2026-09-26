import React from 'react';
import { Search } from 'lucide-react';

export default function TranscriptSearch({
  displayCues = [],
  searchQuery,
  setSearchQuery,
  handleCueClick,
  activeCueIdx
}) {
  return (
    <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column' }}>
      <div className="css-1xdwfcd" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Search size={16} color="var(--theme-primary)" /> Instant Transcript Search
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Showing {displayCues.length} hits</span>
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search transcript by keywords or topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                padding: '10px 14px 10px 36px',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                outline: 'none'
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {displayCues.map((cue, idx) => (
            <div
              key={idx}
              onClick={() => handleCueClick(cue.time)}
              style={{
                display: 'flex',
                gap: '14px',
                padding: '10px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                marginBottom: '4px',
                backgroundColor: activeCueIdx === idx ? 'var(--highlight-bg)' : 'transparent',
                borderLeft: activeCueIdx === idx ? '3px solid var(--theme-primary)' : '3px solid transparent',
                transition: 'background 0.15s ease'
              }}
            >
              <span style={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: 'var(--theme-primary)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                paddingTop: '2px'
              }}>[{cue.time}]</span>
              
              {cue.highlightHtml ? (
                <span
                  style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4 }}
                  dangerouslySetInnerHTML={{ __html: cue.highlightHtml }}
                />
              ) : (
                <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{cue.text}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
