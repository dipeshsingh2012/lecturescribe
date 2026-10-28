import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTranscriptAppearanceStore,
  FONT_FAMILIES,
  FONT_COLORS,
  FONT_SIZES,
  LINE_SPACINGS,
  PRESETS
} from '../transcriptAppearanceStore';

describe('transcriptAppearanceStore', () => {
  beforeEach(() => {
    useTranscriptAppearanceStore.getState().resetDefaults();
  });

  it('initializes with default options', () => {
    const state = useTranscriptAppearanceStore.getState();
    expect(state.fontFamily).toBe('sans');
    expect(state.fontColor).toBe('default');
    expect(state.fontSize).toBe('medium');
    expect(state.lineSpacing).toBe('normal');
  });

  it('updates font family, font color, size, and line spacing', () => {
    const store = useTranscriptAppearanceStore.getState();
    store.setFontFamily('mono');
    store.setFontColor('yellow');
    store.setFontSize('large');
    store.setLineSpacing('relaxed');

    const updated = useTranscriptAppearanceStore.getState();
    expect(updated.fontFamily).toBe('mono');
    expect(updated.fontColor).toBe('yellow');
    expect(updated.fontSize).toBe('large');
    expect(updated.lineSpacing).toBe('relaxed');
  });

  it('applies Netflix Classic preset correctly', () => {
    const store = useTranscriptAppearanceStore.getState();
    store.applyPreset('netflix');

    const updated = useTranscriptAppearanceStore.getState();
    expect(updated.fontColor).toBe('yellow');
    expect(updated.fontFamily).toBe('sans');
  });

  it('applies Terminal preset correctly', () => {
    const store = useTranscriptAppearanceStore.getState();
    store.applyPreset('terminal');

    const updated = useTranscriptAppearanceStore.getState();
    expect(updated.fontFamily).toBe('mono');
    expect(updated.fontColor).toBe('green');
    expect(updated.fontSize).toBe('small');
  });

  it('computes correct CSS variables', () => {
    const store = useTranscriptAppearanceStore.getState();
    store.setFontFamily('serif');
    store.setFontColor('yellow');
    store.setFontSize('xlarge');
    store.setLineSpacing('relaxed');

    const vars = store.getCssVariables();
    expect(vars['--cue-font-family']).toContain('Georgia');
    expect(vars['--cue-color']).toBe('#facc15');
    expect(vars['--cue-font-size']).toBe('1.12rem');
    expect(vars['--cue-line-height']).toBe('1.75');
  });

  it('resets to defaults when resetDefaults is called', () => {
    const store = useTranscriptAppearanceStore.getState();
    store.setFontFamily('casual');
    store.setFontColor('cyan');
    store.resetDefaults();

    const resetState = useTranscriptAppearanceStore.getState();
    expect(resetState.fontFamily).toBe('sans');
    expect(resetState.fontColor).toBe('default');
  });
});

