import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResponseTimeBadge from '../ResponseTimeBadge';

describe('ResponseTimeBadge component', () => {
  it('renders nothing when ms is null, undefined, zero, or negative', () => {
    const { container, rerender } = render(<ResponseTimeBadge ms={null} />);
    expect(container.firstChild).toBeNull();

    rerender(<ResponseTimeBadge ms={undefined} />);
    expect(container.firstChild).toBeNull();

    rerender(<ResponseTimeBadge ms={0} />);
    expect(container.firstChild).toBeNull();

    rerender(<ResponseTimeBadge ms={-150} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders formatted milliseconds, seconds, and minutes with tooltip', () => {
    const { rerender } = render(<ResponseTimeBadge ms={345} />);
    const badge = screen.getByTestId('ai-response-time');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('345ms');
    expect(badge).toHaveAttribute('title', 'AI response time: 345ms');

    rerender(<ResponseTimeBadge ms={2430} />);
    expect(screen.getByTestId('ai-response-time')).toHaveTextContent('2.4s');
    expect(screen.getByTestId('ai-response-time')).toHaveAttribute('title', 'AI response time: 2.4s');

    rerender(<ResponseTimeBadge ms={72340} />);
    expect(screen.getByTestId('ai-response-time')).toHaveTextContent('1m 12.3s');
  });

  it('supports prefix and size="sm" props', () => {
    render(<ResponseTimeBadge ms={1820} prefix="Generated in " size="sm" />);
    const badge = screen.getByTestId('ai-response-time');
    expect(badge).toHaveTextContent('Generated in 1.8s');
    expect(badge.style.fontSize).toBe('0.73rem');
  });
});

