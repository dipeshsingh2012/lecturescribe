import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoCueOverlay from '../VideoCueOverlay';

describe('VideoCueOverlay', () => {
  const sampleCues = [
    { time: '00:00', text: 'Welcome to Lecture 1 on Machine Learning.' },
    { time: '00:10', text: 'Today we discuss gradient descent and optimization.' },
    { time: '00:30', text: 'Here is the key loss equation: $L(\\theta) = \\frac{1}{2m} \\sum (h_\\theta(x) - y)^2$.' },
    { time: '02:00', text: 'Moving on to regularized logistic regression.' }
  ];

  it('renders null when visible is false or cues array is empty', () => {
    const { container: c1 } = render(
      <VideoCueOverlay cues={sampleCues} currentTime={5} visible={false} />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <VideoCueOverlay cues={[]} currentTime={5} visible={true} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('renders the correct cue matching currentTime', () => {
    render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={2}
        visible={true}
        showControls={true}
      />
    );

    expect(screen.getByText(/Welcome to Lecture 1/i)).toBeInTheDocument();
  });

  it('updates cue when currentTime moves to next cue', () => {
    const { rerender } = render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={5}
        visible={true}
      />
    );
    expect(screen.getByText(/Welcome to Lecture 1/i)).toBeInTheDocument();

    rerender(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={15}
        visible={true}
      />
    );
    expect(screen.getByText(/gradient descent and optimization/i)).toBeInTheDocument();
  });

  it('renders LaTeX math equations inside cue text', () => {
    render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={35}
        visible={true}
      />
    );

    expect(screen.getByText(/Here is the key loss equation:/i)).toBeInTheDocument();
    // KaTeX expression span should be present
    const mathSpan = document.querySelector('.cue-math-expression');
    expect(mathSpan).toBeInTheDocument();
  });

  it('invokes onCueClick with timestamp when the caption pill is clicked', () => {
    const handleCueClick = vi.fn();
    render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={12}
        visible={true}
        onCueClick={handleCueClick}
      />
    );

    const overlay = screen.getByTestId('video-cue-overlay');
    fireEvent.click(overlay);
    expect(handleCueClick).toHaveBeenCalledWith('00:10');
  });

  it('fades out during prolonged silence before the next distant cue', () => {
    // Cue at 00:30, next cue at 02:00 (90 seconds gap).
    // At 1 minute 15 seconds (75s), the 00:30 cue should have faded out.
    const { container } = render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={75}
        visible={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('applies yellow accent color when specified in appearance', () => {
    render(
      <VideoCueOverlay
        cues={sampleCues}
        currentTime={2}
        visible={true}
        appearance={{ fontColor: 'yellow' }}
      />
    );

    const overlay = screen.getByTestId('video-cue-overlay');
    // MUI Box resolves color in computed style / style attribute
    expect(overlay).toHaveStyle({ color: '#facc15' });
  });
});

