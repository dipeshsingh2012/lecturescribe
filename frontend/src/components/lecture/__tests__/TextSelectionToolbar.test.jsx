import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TextSelectionToolbar from '../TextSelectionToolbar';

describe('TextSelectionToolbar - AI Explainer Expand Button', () => {
  const defaultProps = {
    position: { x: 300, y: 300 },
    selectedText: 'Gradient Descent Optimization',
    cueId: 'cue_1',
    startSeconds: 12,
    endSeconds: 18,
    videoId: 'vid_ml_101',
    userEmail: 'student@example.com',
    onClose: vi.fn(),
    onAnnotationCreated: vi.fn(),
    onDeleteAnnotation: vi.fn(),
    initialMode: 'ai',
    onDiscussInTutor: vi.fn()
  };

  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          explanation: 'Mock AI explanation of gradient descent.'
        })
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders expand button in the AI Selection Explainer toolbar header', async () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    expect(screen.getByText('AI Selection Explainer')).toBeInTheDocument();
    const expandBtn = screen.getByRole('button', { name: /Expand explainer/i });
    expect(expandBtn).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Mock AI explanation of gradient descent.')).toBeInTheDocument());
  });

  it('toggles expansion state when clicking expand and collapse button', async () => {
    const { container } = render(<TextSelectionToolbar {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Mock AI explanation of gradient descent.')).toBeInTheDocument());

    const expandBtn = screen.getByRole('button', { name: /Expand explainer/i });
    const toolbar = container.querySelector('.text-selection-toolbar');

    expect(toolbar).not.toHaveClass('ai-explainer-expanded');
    expect(container.querySelector('.ai-explainer-backdrop')).not.toBeInTheDocument();

    // Click to Expand
    fireEvent.click(expandBtn);

    expect(toolbar).toHaveClass('ai-explainer-expanded');
    expect(container.querySelector('.ai-explainer-backdrop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse explainer/i })).toBeInTheDocument();

    // Click to Collapse
    const collapseBtn = screen.getByRole('button', { name: /Collapse explainer/i });
    fireEvent.click(collapseBtn);

    expect(toolbar).not.toHaveClass('ai-explainer-expanded');
    expect(container.querySelector('.ai-explainer-backdrop')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand explainer/i })).toBeInTheDocument();
  });

  it('collapses explainer when clicking the backdrop', async () => {
    const { container } = render(<TextSelectionToolbar {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Mock AI explanation of gradient descent.')).toBeInTheDocument());

    const expandBtn = screen.getByRole('button', { name: /Expand explainer/i });
    fireEvent.click(expandBtn);

    const backdrop = container.querySelector('.ai-explainer-backdrop');
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(backdrop);

    const toolbar = container.querySelector('.text-selection-toolbar');
    expect(toolbar).not.toHaveClass('ai-explainer-expanded');
    expect(container.querySelector('.ai-explainer-backdrop')).not.toBeInTheDocument();
  });

  it('collapses explainer when pressing Escape key', async () => {
    const { container } = render(<TextSelectionToolbar {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Mock AI explanation of gradient descent.')).toBeInTheDocument());

    const expandBtn = screen.getByRole('button', { name: /Expand explainer/i });
    fireEvent.click(expandBtn);

    expect(container.querySelector('.text-selection-toolbar')).toHaveClass('ai-explainer-expanded');

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(container.querySelector('.text-selection-toolbar')).not.toHaveClass('ai-explainer-expanded');
    expect(container.querySelector('.ai-explainer-backdrop')).not.toBeInTheDocument();
  });
});
