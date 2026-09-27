import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownWithTimestamps from '../MarkdownWithTimestamps';

describe('MarkdownWithTimestamps', () => {
  it('renders plain text markdown properly', () => {
    render(<MarkdownWithTimestamps content="This is **bold** text." />);
    expect(screen.getByText(/This is/)).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('detects inline timestamps and converts them to clickable jump buttons', () => {
    const handleCueClick = vi.fn();
    render(
      <MarkdownWithTimestamps
        content="Check this topic at [05:23] and also at [1:12:45]."
        onCueClick={handleCueClick}
      />
    );

    const button1 = screen.getByRole('button', { name: /05:23/i });
    const button2 = screen.getByRole('button', { name: /1:12:45/i });
    expect(button1).toBeInTheDocument();
    expect(button2).toBeInTheDocument();

    fireEvent.click(button1);
    expect(handleCueClick).toHaveBeenCalledWith('05:23');

    fireEvent.click(button2);
    expect(handleCueClick).toHaveBeenCalledWith('1:12:45');
  });

  it('renders empty content gracefully', () => {
    const { container } = render(<MarkdownWithTimestamps content="" />);
    expect(container.firstChild).toBeNull();
  });
});
