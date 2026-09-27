import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GoogleIcon from '../GoogleIcon';

describe('GoogleIcon', () => {
  it('renders SVG icon with google colored paths', () => {
    const { container } = render(<GoogleIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4);
  });
});
