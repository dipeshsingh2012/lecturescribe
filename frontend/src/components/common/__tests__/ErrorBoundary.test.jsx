import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

function ProblemComponent({ shouldThrow }) {
  if (shouldThrow) {
    throw new Error('Test crash in child component');
  }
  return <div>Normal Content</div>;
}

describe('ErrorBoundary Component', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // Suppress React error boundary console.error output during deliberate test crashes
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('catches render error and displays graceful fallback UI with error message', () => {
    render(
      <ErrorBoundary title="Test Error View">
        <ProblemComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Test Error View')).toBeInTheDocument();
    expect(screen.getByText('Test crash in child component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });

  it('allows user to reset error boundary with Try Again button', () => {
    function StatefulTester() {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <ErrorBoundary onReset={() => setShouldThrow(false)}>
          <ProblemComponent shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    render(<StatefulTester />);

    expect(screen.getByText('Test crash in child component')).toBeInTheDocument();

    const tryAgainBtn = screen.getByRole('button', { name: /Try Again/i });
    fireEvent.click(tryAgainBtn);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Normal Content')).toBeInTheDocument();
  });

  it('renders custom function fallback when provided', () => {
    const customFallback = ({ error, resetError }) => (
      <div>
        <span>Custom error: {error.message}</span>
        <button onClick={resetError}>Reset Custom</button>
      </div>
    );

    render(
      <ErrorBoundary fallback={customFallback}>
        <ProblemComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error: Test crash in child component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Custom' })).toBeInTheDocument();
  });
});

