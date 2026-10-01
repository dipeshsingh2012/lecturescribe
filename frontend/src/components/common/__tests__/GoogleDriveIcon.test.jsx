import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GoogleDriveIcon from '../GoogleDriveIcon';

describe('GoogleDriveIcon', () => {
  it('renders svg with specified size', () => {
    const { container } = render(<GoogleDriveIcon size={20} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });
});
