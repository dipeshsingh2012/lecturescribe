import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuickAddBar from '../QuickAddBar';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('QuickAddBar', () => {
  it('renders input with placeholder and calls setUrlInput on change', () => {
    const setUrlInput = vi.fn();
    const setCacheNotice = vi.fn();
    render(
      <QuickAddBar
        urlInput="https://vimeo.com/123456"
        setUrlInput={setUrlInput}
        setCacheNotice={setCacheNotice}
        handlePasteUrl={vi.fn()}
        handleTranscribe={vi.fn()}
        loading={false}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByPlaceholderText(/Paste any lecture video URL or ID/i);
    expect(input).toHaveValue('https://vimeo.com/123456');

    fireEvent.change(input, { target: { value: 'https://vimeo.com/999' } });
    expect(setUrlInput).toHaveBeenCalledWith('https://vimeo.com/999');
    expect(setCacheNotice).toHaveBeenCalledWith(null);
  });

  it('triggers handleTranscribe when Transcribe button is clicked or Enter is pressed', () => {
    const handleTranscribe = vi.fn();
    render(
      <QuickAddBar
        urlInput="https://vimeo.com/123456"
        setUrlInput={vi.fn()}
        setCacheNotice={vi.fn()}
        handlePasteUrl={vi.fn()}
        handleTranscribe={handleTranscribe}
        loading={false}
        currentTheme={mockTheme}
      />
    );

    const btn = screen.getByRole('button', { name: /Transcribe & Study/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(handleTranscribe).toHaveBeenCalledWith('https://vimeo.com/123456', true);

    const input = screen.getByPlaceholderText(/Paste any lecture video URL or ID/i);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(handleTranscribe).toHaveBeenCalledTimes(2);
  });

  it('disables transcribe button when loading or input is empty', () => {
    const { rerender } = render(
      <QuickAddBar
        urlInput=""
        setUrlInput={vi.fn()}
        setCacheNotice={vi.fn()}
        handlePasteUrl={vi.fn()}
        handleTranscribe={vi.fn()}
        loading={false}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByRole('button', { name: /Transcribe & Study/i })).toBeDisabled();

    rerender(
      <QuickAddBar
        urlInput="https://vimeo.com/123456"
        setUrlInput={vi.fn()}
        setCacheNotice={vi.fn()}
        handlePasteUrl={vi.fn()}
        handleTranscribe={vi.fn()}
        loading={true}
        currentTheme={mockTheme}
      />
    );
    expect(screen.getByRole('button', { name: /Ingesting.../i })).toBeDisabled();
  });

  it('renders custom placeholder and custom buttonLabel when provided', () => {
    const handleTranscribe = vi.fn();
    const { rerender } = render(
      <QuickAddBar
        urlInput="https://vimeo.com/76979871"
        setUrlInput={vi.fn()}
        setCacheNotice={vi.fn()}
        handlePasteUrl={vi.fn()}
        handleTranscribe={handleTranscribe}
        loading={false}
        currentTheme={mockTheme}
        placeholder="Add video URL or ID to this course (Biology)..."
        buttonLabel="Add to Course"
      />
    );

    expect(screen.getByPlaceholderText('Add video URL or ID to this course (Biology)...')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Add to Course/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(handleTranscribe).toHaveBeenCalledWith('https://vimeo.com/76979871', true);

    // When loading is true with custom buttonLabel, it shows 'Adding...'
    rerender(
      <QuickAddBar
        urlInput="https://vimeo.com/76979871"
        setUrlInput={vi.fn()}
        setCacheNotice={vi.fn()}
        handlePasteUrl={vi.fn()}
        handleTranscribe={handleTranscribe}
        loading={true}
        currentTheme={mockTheme}
        placeholder="Add video URL or ID to this course (Biology)..."
        buttonLabel="Add to Course"
      />
    );
    expect(screen.getByRole('button', { name: /Adding.../i })).toBeDisabled();
  });
});
