import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ResearchLiteratureModal from '../ResearchLiteratureModal';

const mockTheme = {
  palette: {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    cardBg: '#1e1e24',
    cardBorder: 'rgba(255,255,255,0.1)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af'
  }
};

describe('ResearchLiteratureModal Component', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <ResearchLiteratureModal
        open={false}
        onClose={vi.fn()}
        currentTheme={mockTheme}
      />
    );
    expect(screen.queryByText(/Research Academic Literature & Books/i)).not.toBeInTheDocument();
  });

  it('renders modal when open is true', () => {
    render(
      <ResearchLiteratureModal
        open={true}
        onClose={vi.fn()}
        courseDisplayName="Medical Sciences"
        currentTheme={mockTheme}
      />
    );
    expect(screen.getByText(/Research Academic Literature & Books/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/e\.g\. Singer et al\. \(2016\) Sepsis-3 JAMA/i)
    ).toBeInTheDocument();
  });

  it('performs literature search and displays results', async () => {
    const mockSearch = vi.fn().mockResolvedValue([
      {
        title: 'The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3)',
        author: 'Singer M, Deutschman CS, Seymour CW',
        edition: '2016',
        journal: 'JAMA',
        reading_type: 'journal',
        doi: '10.1001/jama.2016.0287',
        is_open_access: true,
        source_provider: 'Crossref (JAMA)'
      }
    ]);

    render(
      <ResearchLiteratureModal
        open={true}
        onClose={vi.fn()}
        courseDisplayName="Critical Care Medicine"
        searchLiterature={mockSearch}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByPlaceholderText(/e\.g\. Singer et al\. \(2016\) Sepsis-3 JAMA/i);
    fireEvent.change(input, { target: { value: 'Singer et al. (2016) Sepsis-3 JAMA' } });

    const searchBtn = screen.getByRole('button', { name: /^Search$/i });
    fireEvent.click(searchBtn);

    expect(mockSearch).toHaveBeenCalledWith('Singer et al. (2016) Sepsis-3 JAMA', 'Critical Care Medicine', 8);

    await waitFor(() => {
      expect(screen.getByText(/The Third International Consensus Definitions for Sepsis and Septic Shock \(Sepsis-3\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Singer M, Deutschman CS, Seymour CW/i)).toBeInTheDocument();
      expect(screen.getByText(/Open Access/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add to Course/i })).toBeInTheDocument();
    });
  });

  it('calls addCourseReading when Add to Course button is clicked', async () => {
    const mockSearch = vi.fn().mockResolvedValue([
      {
        title: 'Introduction to Algorithms',
        author: 'Thomas H. Cormen',
        edition: '4th Edition',
        reading_type: 'book',
        source_provider: 'Google Books'
      }
    ]);
    const mockAdd = vi.fn().mockResolvedValue({ id: 99, title: 'Introduction to Algorithms' });

    render(
      <ResearchLiteratureModal
        open={true}
        onClose={vi.fn()}
        courseDisplayName="CS101"
        searchLiterature={mockSearch}
        addCourseReading={mockAdd}
        currentTheme={mockTheme}
      />
    );

    const input = screen.getByPlaceholderText(/e\.g\. Singer et al\. \(2016\) Sepsis-3 JAMA/i);
    fireEvent.change(input, { target: { value: 'Cormen Algorithms' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add to Course/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /Add to Course/i });
    fireEvent.click(addBtn);

    expect(mockAdd).toHaveBeenCalledWith('CS101', expect.objectContaining({
      title: 'Introduction to Algorithms',
      author: 'Thomas H. Cormen'
    }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Added to Course/i })).toBeDisabled();
    });
  });
});

