import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Mock component that throws an error
const ThrowError = () => {
  throw new Error('Test error');
};

// Mock component that renders normally
const NormalComponent = () => <div>Normal content</div>;

describe('ErrorBoundary - Per-Section Error Isolation', () => {
  beforeEach(() => {
    // Suppress console.error for these tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should show section-specific fallback for non-root context', () => {
    render(
      <ErrorBoundary context="Transaction History">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Transaction History Error/i)).toBeInTheDocument();
    expect(screen.getByText(/Test error/i)).toBeInTheDocument();
  });

  it('should show full-page fallback for root context', () => {
    render(
      <ErrorBoundary context="root">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it('should allow resetting error state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ErrorBoundary context="Stream Payments">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Stream Payments Error/i)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /Try again/i });
    await user.click(button);

    // Rerender with normal component
    rerender(
      <ErrorBoundary context="Stream Payments">
        <NormalComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Normal content/i)).toBeInTheDocument();
  });

  it('should render children when no error', () => {
    render(
      <ErrorBoundary context="Multi-Sig Transactions">
        <NormalComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Normal content/i)).toBeInTheDocument();
  });

  it('should use custom fallback if provided', () => {
    const customFallback = ({ error, reset }) => (
      <div>
        <p>Custom error: {error.message}</p>
        <button onClick={reset}>Custom reset</button>
      </div>
    );

    render(
      <ErrorBoundary context="KYC Form" fallback={customFallback}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Custom error: Test error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Custom reset/i })).toBeInTheDocument();
  });

  it('should isolate errors between multiple boundaries', () => {
    render(
      <div>
        <ErrorBoundary context="Section 1">
          <ThrowError />
        </ErrorBoundary>
        <ErrorBoundary context="Section 2">
          <NormalComponent />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByText(/Section 1 Error/i)).toBeInTheDocument();
    expect(screen.getByText(/Normal content/i)).toBeInTheDocument();
  });
});
