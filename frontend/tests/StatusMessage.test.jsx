import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatusMessage } from '../src/components/StatusMessage';

const makeMsg = (overrides = {}) => ({
  id: 1,
  type: 'success',
  message: 'All good',
  icon: '✅',
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('StatusMessage', () => {
  it('renders nothing when messages array is empty', () => {
    const { container } = render(<StatusMessage messages={[]} onRemove={vi.fn()} />);
    // Only the wrapper div should be present, no alert
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a success message', () => {
    render(<StatusMessage messages={[makeMsg()]} onRemove={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders an error message with assertive aria-live', () => {
    render(
      <StatusMessage
        messages={[makeMsg({ type: 'error', message: 'Something failed', icon: '⚠️' })]}
        onRemove={vi.fn()}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('calls onRemove when dismiss button is clicked', () => {
    const onRemove = vi.fn();
    render(<StatusMessage messages={[makeMsg({ id: 42 })]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(onRemove).toHaveBeenCalledWith(42);
  });

  it('renders a Retry button when message has retry fn', () => {
    const retry = vi.fn();
    render(
      <StatusMessage
        messages={[makeMsg({ retry })]}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('calls retry fn when Retry button is clicked', () => {
    const retry = vi.fn();
    const onRemove = vi.fn();
    render(
      <StatusMessage
        messages={[makeMsg({ id: 7, retry })]}
        onRemove={onRemove}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders multiple messages', () => {
    const messages = [
      makeMsg({ id: 1, message: 'First' }),
      makeMsg({ id: 2, message: 'Second', type: 'error', icon: '⚠️' }),
    ];
    render(<StatusMessage messages={messages} onRemove={vi.fn()} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('shows history toggle when showHistory=true and history is non-empty', () => {
    const history = [makeMsg({ id: 99, message: 'Old message' })];
    render(
      <StatusMessage messages={[]} onRemove={vi.fn()} showHistory history={history} />
    );
    expect(screen.getByText(/Message history/i)).toBeInTheDocument();
  });

  it('expands history list on toggle click', () => {
    const history = [makeMsg({ id: 99, message: 'Old message' })];
    render(
      <StatusMessage messages={[]} onRemove={vi.fn()} showHistory history={history} />
    );
    fireEvent.click(screen.getByText(/Message history/i));
    expect(screen.getByText('Old message')).toBeInTheDocument();
  });

  it('does not show history toggle when history is empty', () => {
    render(<StatusMessage messages={[]} onRemove={vi.fn()} showHistory history={[]} />);
    expect(screen.queryByText(/Message history/i)).not.toBeInTheDocument();
  });
});
