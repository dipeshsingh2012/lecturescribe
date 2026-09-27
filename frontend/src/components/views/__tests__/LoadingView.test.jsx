import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingView from '../LoadingView';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('LoadingView', () => {
  it('renders ingestion loading message and subtitle', () => {
    render(<LoadingView currentTheme={mockTheme} />);

    expect(screen.getByText('Ingesting Lecture...')).toBeInTheDocument();
    expect(screen.getByText(/Downloading audio, extracting verbatim captions/i)).toBeInTheDocument();
  });
});
