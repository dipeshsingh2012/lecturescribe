import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranscriptAppearanceMenu from '../TranscriptAppearanceMenu';
import { useTranscriptAppearanceStore } from '../../../store/transcriptAppearanceStore';

describe('TranscriptAppearanceMenu', () => {
  beforeEach(() => {
    useTranscriptAppearanceStore.getState().resetDefaults();
  });

  it('renders null when open is false', () => {
    const { container } = render(
      <TranscriptAppearanceMenu open={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders menu dialog and live preview when open is true', () => {
    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    expect(screen.getByRole('dialog', { name: /Transcript Appearance Settings/i })).toBeInTheDocument();
    expect(screen.getByTestId('appearance-preview-box')).toBeInTheDocument();
  });

  it('updates font family when a font button is clicked', () => {
    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    const monoBtn = screen.getByRole('button', { name: /Font Monospace/i });
    fireEvent.click(monoBtn);

    expect(useTranscriptAppearanceStore.getState().fontFamily).toBe('mono');
  });

  it('updates color when a color swatch is clicked', () => {
    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    const yellowBtn = screen.getByRole('button', { name: /Color Netflix Yellow/i });
    fireEvent.click(yellowBtn);

    expect(useTranscriptAppearanceStore.getState().fontColor).toBe('yellow');
  });

  it('updates font size when a size button is clicked', () => {
    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    const largeBtn = screen.getByRole('button', { name: /Size L/i });
    fireEvent.click(largeBtn);

    expect(useTranscriptAppearanceStore.getState().fontSize).toBe('large');
  });

  it('applies preset when a preset button is clicked', () => {
    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    const netflixPresetBtn = screen.getByRole('button', { name: /Preset Netflix Classic/i });
    fireEvent.click(netflixPresetBtn);

    expect(useTranscriptAppearanceStore.getState().fontColor).toBe('yellow');
  });

  it('calls resetDefaults when Reset button is clicked', () => {
    useTranscriptAppearanceStore.getState().setFontColor('cyan');

    render(
      <TranscriptAppearanceMenu open={true} onClose={vi.fn()} />
    );

    const resetBtn = screen.getByRole('button', { name: /Reset to default appearance/i });
    fireEvent.click(resetBtn);

    expect(useTranscriptAppearanceStore.getState().fontColor).toBe('default');
  });

  it('calls onClose when Close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <TranscriptAppearanceMenu open={true} onClose={handleClose} />
    );

    const closeBtn = screen.getByRole('button', { name: /Close appearance settings/i });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledOnce();
  });
});

