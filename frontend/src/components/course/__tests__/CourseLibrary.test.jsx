import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CourseLibrary from '../CourseLibrary';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseLibrary Component', () => {
  const mockBooks = [
    {
      id: 1,
      title: 'Pattern Recognition and Machine Learning',
      author: 'Christopher Bishop',
      edition: '1st Edition, 2006',
      category: 'primary_textbook',
      reading_type: 'book',
      source_context: 'Lecture 1 [04:15] & Intro.pptx',
      cover_url: 'https://example.com/bishop.jpg',
      preview_url: 'https://books.google.com/bishop'
    }
  ];

  const mockSlides = [
    {
      id: 101,
      title: 'Week 1 Lecture Slides',
      filename: 'lecture1.pptx',
      file_type: 'pptx',
      file_size_bytes: 2048576,
      created_at: '2026-09-01T00:00:00Z',
      user_email: 'prof@university.edu'
    }
  ];

  it('renders lecture slides and extracted books', () => {
    render(
      <CourseLibrary
        courseResources={mockSlides}
        courseReadings={mockBooks}
        selectedCourse="Machine Learning"
        currentTheme={mockTheme}
      />
    );

    // Verify slides section
    expect(screen.getByText('Week 1 Lecture Slides')).toBeInTheDocument();
    expect(screen.getByText('SLIDES')).toBeInTheDocument();

    // Verify books section
    expect(screen.getByText('Pattern Recognition and Machine Learning')).toBeInTheDocument();
    expect(screen.getByText(/by Christopher Bishop/i)).toBeInTheDocument();
    expect(screen.getByText('Primary Textbook')).toBeInTheDocument();
    expect(screen.getByText('Lecture 1 [04:15] & Intro.pptx')).toBeInTheDocument();
  });

  it('triggers triggerExtractReadings when Scan & Extract Books is clicked', async () => {
    const triggerExtractReadings = vi.fn().mockResolvedValue({ status: 'success', newly_extracted_count: 2, count: 2 });
    render(
      <CourseLibrary
        courseResources={mockSlides}
        courseReadings={mockBooks}
        triggerExtractReadings={triggerExtractReadings}
        selectedCourse="Machine Learning"
        currentTheme={mockTheme}
      />
    );

    const extractBtn = screen.getAllByRole('button', { name: /Scan & Extract Books/i })[0];
    fireEvent.click(extractBtn);

    expect(triggerExtractReadings).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Discovered 2 new recommended readings!/i)).toBeInTheDocument();
    });
  });

  it('opens web search modal when Search Web is clicked', async () => {
    const searchReadingWeb = vi.fn().mockResolvedValue([
      { title: 'Free PDF: PRML Bishop', snippet: 'Full text available online at Microsoft Research', url: 'https://research.microsoft.com/prml.pdf' }
    ]);

    render(
      <CourseLibrary
        courseResources={mockSlides}
        courseReadings={mockBooks}
        searchReadingWeb={searchReadingWeb}
        selectedCourse="Machine Learning"
        currentTheme={mockTheme}
      />
    );

    const searchWebBtn = screen.getByRole('button', { name: /Search Web/i });
    fireEvent.click(searchWebBtn);

    expect(searchReadingWeb).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Free PDF: PRML Bishop')).toBeInTheDocument();
      expect(screen.getByText(/Full text available online/i)).toBeInTheDocument();
    });
  });
});
