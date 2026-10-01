import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResourcePreviewModal from '../ResourcePreviewModal';

describe('ResourcePreviewModal', () => {
  it('returns null when open is false or resource is null', () => {
    const { container: c1 } = render(
      <ResourcePreviewModal open={false} onClose={vi.fn()} resource={null} />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <ResourcePreviewModal open={true} onClose={vi.fn()} resource={null} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('renders modal with PDF preview iframe, action buttons, and closes on X click', () => {
    const onClose = vi.fn();
    const pdfResource = {
      id: 1,
      title: 'Deep Learning Lecture 1 Slides',
      filename: 'lecture1_slides.pdf',
      file_type: 'pdf',
      file_size_bytes: 2048576,
      view_url: 'https://storage.googleapis.com/test/lecture1_slides.pdf?inline=1',
      download_url: 'https://storage.googleapis.com/test/lecture1_slides.pdf?download=1',
      created_at: new Date().toISOString()
    };

    const { container } = render(
      <ResourcePreviewModal
        open={true}
        onClose={onClose}
        resource={pdfResource}
      />
    );

    expect(screen.getByText('Deep Learning Lecture 1 Slides')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New Tab/i })).toHaveAttribute(
      'href',
      'https://storage.googleapis.com/test/lecture1_slides.pdf?inline=1'
    );
    expect(screen.getByRole('link', { name: /Download/i })).toHaveAttribute(
      'href',
      'https://storage.googleapis.com/test/lecture1_slides.pdf?download=1'
    );

    // PDF iframe exists
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'https://storage.googleapis.com/test/lecture1_slides.pdf?inline=1');

    // Close button
    const closeBtn = screen.getByLabelText('Close preview');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders image preview for image resources', () => {
    const imgResource = {
      id: 2,
      title: 'Neural Network Diagram',
      filename: 'nn_diagram.png',
      file_type: 'png',
      file_size_bytes: 512000,
      view_url: 'https://storage.googleapis.com/test/nn_diagram.png',
      download_url: 'https://storage.googleapis.com/test/nn_diagram.png'
    };

    render(
      <ResourcePreviewModal
        open={true}
        onClose={vi.fn()}
        resource={imgResource}
      />
    );

    expect(screen.getByText('Neural Network Diagram')).toBeInTheDocument();
    expect(screen.getByText('IMG')).toBeInTheDocument();
    const img = screen.getByAltText('Neural Network Diagram');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://storage.googleapis.com/test/nn_diagram.png');
  });
});

