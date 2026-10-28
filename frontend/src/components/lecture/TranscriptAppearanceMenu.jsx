import React, { useEffect, useRef, useMemo } from 'react';
import { X, RotateCcw, Check, Type, Sparkles } from 'lucide-react';
import {
  useTranscriptAppearanceStore,
  computeAppearanceCssVariables,
  FONT_FAMILIES,
  FONT_COLORS,
  FONT_SIZES,
  LINE_SPACINGS,
  PRESETS
} from '../../store/transcriptAppearanceStore';

export default function TranscriptAppearanceMenu({ open, onClose, anchorRef }) {
  const menuRef = useRef(null);

  const {
    fontFamily,
    fontColor,
    fontSize,
    lineSpacing,
    setFontFamily,
    setFontColor,
    setFontSize,
    setLineSpacing,
    applyPreset,
    resetDefaults,
    getCssVariables
  } = useTranscriptAppearanceStore();

  // Close on Escape or click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  const cssVars = useMemo(() => computeAppearanceCssVariables({
    fontFamily,
    fontColor,
    fontSize,
    lineSpacing
  }), [fontFamily, fontColor, fontSize, lineSpacing]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Transcript Appearance Settings"
      data-testid="transcript-appearance-menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        width: '320px',
        maxWidth: '92vw',
        background: 'var(--card-bg, #18181b)',
        color: 'var(--text-primary, #ffffff)',
        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
        borderRadius: '10px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        padding: '14px',
        zIndex: 100,
        fontSize: '0.82rem',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.86rem' }}>
          <Type size={15} color="var(--theme-primary, #0075ed)" />
          <span>Transcript Appearance</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={resetDefaults}
            title="Reset to default theme appearance"
            aria-label="Reset to default appearance"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 6px',
              borderRadius: '4px',
              fontSize: '0.72rem',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary, #fff)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)'; }}
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close appearance settings"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              cursor: 'pointer',
              padding: '3px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Live Mini Preview Box */}
      <div
        data-testid="appearance-preview-box"
        style={{
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          borderRadius: '6px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px'
        }}
      >
        <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>
          Live Preview
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
          <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginTop: '2px' }}>
            [01:23]
          </span>
          <span
            style={{
              fontFamily: cssVars['--cue-font-family'],
              fontVariant: cssVars['--cue-font-variant'],
              color: cssVars['--cue-color'] === 'inherit' ? 'var(--text-primary, #ffffff)' : cssVars['--cue-color'],
              fontSize: cssVars['--cue-font-size'],
              lineHeight: cssVars['--cue-line-height'],
              transition: 'all 0.15s ease'
            }}
          >
            In this lecture, we explore gradient descent formulas.
          </span>
        </div>
      </div>

      {/* Quick Presets */}
      <div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginBottom: '6px' }}>
          Presets
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              aria-label={`Preset ${p.name}`}
              style={{
                background: (fontFamily === p.fontFamily && fontColor === p.fontColor && fontSize === p.fontSize)
                  ? 'var(--theme-primary, #0075ed)'
                  : 'rgba(255, 255, 255, 0.06)',
                color: (fontFamily === p.fontFamily && fontColor === p.fontColor && fontSize === p.fontSize)
                  ? '#ffffff'
                  : 'var(--text-primary, #ffffff)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                borderRadius: '14px',
                padding: '2px 9px',
                fontSize: '0.72rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Font Family Selection */}
      <div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginBottom: '6px' }}>
          Font Family
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFontFamily(f.id)}
              aria-label={`Font ${f.name}`}
              style={{
                background: fontFamily === f.id ? 'rgba(0, 117, 237, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: fontFamily === f.id ? '1px solid var(--theme-primary, #0075ed)' : '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                borderRadius: '5px',
                padding: '5px 4px',
                color: fontFamily === f.id ? 'var(--theme-primary, #0075ed)' : 'var(--text-primary, #fff)',
                fontFamily: f.value,
                fontVariant: f.fontVariant || 'normal',
                fontSize: '0.74rem',
                fontWeight: fontFamily === f.id ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s ease'
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* Font Color Palette */}
      <div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginBottom: '6px' }}>
          Font Color
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {FONT_COLORS.map((c) => {
            const isSelected = fontColor === c.id;
            const isDefault = c.id === 'default';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setFontColor(c.id)}
                title={c.name}
                aria-label={`Color ${c.name}`}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: isDefault ? 'var(--text-primary, #ffffff)' : c.value,
                  border: isSelected
                    ? '2px solid var(--theme-primary, #0075ed)'
                    : '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: isSelected ? '0 0 0 2px rgba(0, 117, 237, 0.35)' : 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  transition: 'transform 0.15s ease'
                }}
              >
                {isSelected && (
                  <Check size={13} color={c.id === 'white' || c.id === 'yellow' || isDefault ? '#000000' : '#ffffff'} strokeWidth={3} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font Size & Line Spacing */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {/* Size */}
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginBottom: '6px' }}>
            Size
          </div>
          <div style={{ display: 'flex', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.05)', padding: '2px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' }}>
            {FONT_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setFontSize(s.id)}
                aria-label={`Size ${s.label}`}
                style={{
                  flex: 1,
                  background: fontSize === s.id ? 'var(--theme-primary, #0075ed)' : 'transparent',
                  color: fontSize === s.id ? '#ffffff' : 'var(--text-primary, #fff)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '0.72rem',
                  fontWeight: fontSize === s.id ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Spacing */}
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #94a3b8)', fontWeight: 600, marginBottom: '6px' }}>
            Spacing
          </div>
          <div style={{ display: 'flex', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.05)', padding: '2px', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' }}>
            {LINE_SPACINGS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLineSpacing(l.id)}
                aria-label={`Spacing ${l.label}`}
                style={{
                  flex: 1,
                  background: lineSpacing === l.id ? 'var(--theme-primary, #0075ed)' : 'transparent',
                  color: lineSpacing === l.id ? '#ffffff' : 'var(--text-primary, #fff)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '0.68rem',
                  fontWeight: lineSpacing === l.id ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
