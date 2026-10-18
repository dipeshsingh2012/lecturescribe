import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BookReaderModal from '../BookReaderModal';

describe('BookReaderModal', () => {
  beforeEach(() => {
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve())
      }
    });
  });

  it('returns null when open is false or book is null', () => {
    const { container: c1 } = render(
      <BookReaderModal open={false} onClose={vi.fn()} book={null} />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <BookReaderModal open={true} onClose={vi.fn()} book={null} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('renders interactive book reader iframe when embed_url is provided', () => {
    const onClose = vi.fn();
    const testBook = {
      id: 4,
      title: 'Pattern Classification',
      author: 'Duda and Hart',
      edition: '2001',
      embed_url: 'https://archive.org/embed/patternclassific0000rich_2ed?ui=embed',
      reader_type: 'archive_org',
      preview_url: 'https://archive.org/details/patternclassific0000rich_2ed',
      source_context: 'Lecture 1 [04:15]'
    };

    const { container } = render(
      <BookReaderModal
        open={true}
        onClose={onClose}
        book={testBook}
      />
    );

    expect(screen.getByText('Pattern Classification')).toBeInTheDocument();
    expect(screen.getByText('FULL BOOK (NO LOGIN)')).toBeInTheDocument();
    expect(screen.getByText(/Duda and Hart/i)).toBeInTheDocument();
    expect(screen.getByText('Lecture 1 [04:15]')).toBeInTheDocument();

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'https://archive.org/embed/patternclassific0000rich_2ed?ui=embed');

    // Close button
    const closeBtn = screen.getByTitle('Close reader (Esc)');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders lending copy banner and badge when is_lending is true', () => {
    const testBook = {
      id: 5,
      title: 'Deep Learning',
      author: 'Goodfellow',
      embed_url: 'https://archive.org/embed/deeplearning0000good?ui=embed',
      is_lending: true,
      reader_type: 'archive_org'
    };

    render(
      <BookReaderModal
        open={true}
        onClose={vi.fn()}
        book={testBook}
      />
    );

    expect(screen.getByText('LENDING COPY (BORROW FOR 1 HR)')).toBeInTheDocument();
    expect(screen.getByText(/1-hour lending edition/i)).toBeInTheDocument();
  });

  it('toggles fullscreen state on click', () => {
    const testBook = {
      id: 7,
      title: 'Pattern Recognition and Machine Learning',
      author: 'Christopher M. Bishop',
      embed_url: 'https://www.microsoft.com/en-us/research/uploads/prod/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf',
      reader_type: 'pdf'
    };

    render(
      <BookReaderModal
        open={true}
        onClose={vi.fn()}
        book={testBook}
      />
    );

    const fsBtn = screen.getByTitle('Fullscreen Reader');
    expect(fsBtn).toBeInTheDocument();
    fireEvent.click(fsBtn);
    expect(screen.getByTitle('Exit Fullscreen')).toBeInTheDocument();
  });

  it('renders rich abstract & metadata reader for restricted academic papers (e.g. Sepsis-3 JAMA) without failing iframe', () => {
    const sepsisPaper = {
      id: 101,
      title: 'The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3)',
      author: 'Mervyn Singer, Clifford S. Deutschman, Christopher Warren Seymour, et al.',
      journal: 'JAMA',
      edition: '2016',
      doi: '10.1001/jama.2016.0287',
      preview_url: 'https://jamanetwork.com/journals/jama/fullarticle/2492881',
      abstract: 'Practice guidelines have defined sepsis as a systemic inflammatory response syndrome... Sepsis should be defined as life-threatening organ dysfunction caused by a dysregulated host response to infection.',
      reading_type: 'journal',
      is_open_access: true
    };

    const { container } = render(
      <BookReaderModal
        open={true}
        onClose={vi.fn()}
        book={sepsisPaper}
      />
    );

    // Verify no broken iframe is mounted
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeNull();

    // Verify publisher advisory banner
    expect(screen.getByText(/Publisher Embed Protection \(JAMA Network\)/i)).toBeInTheDocument();
    expect(screen.getByText(/X-Frame-Options: SAMEORIGIN/i)).toBeInTheDocument();

    // Verify abstract and metadata are displayed
    expect(screen.getAllByText('The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3)')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Mervyn Singer/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/Practice guidelines have defined sepsis/i)).toBeInTheDocument();

    // Verify action buttons
    const openBtn = screen.getByRole('link', { name: /Open Full Article on JAMA Network/i });
    expect(openBtn).toBeInTheDocument();
    expect(openBtn).toHaveAttribute('href', 'https://jamanetwork.com/journals/jama/fullarticle/2492881');
    expect(openBtn).toHaveAttribute('target', '_blank');

    // Test Copy Citation button
    const copyCitationBtn = screen.getByRole('button', { name: /Copy Citation/i });
    expect(copyCitationBtn).toBeInTheDocument();
    fireEvent.click(copyCitationBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
