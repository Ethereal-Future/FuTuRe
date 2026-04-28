import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../src/design-system/Button';
import { Badge } from '../src/design-system/Badge';
import { Card } from '../src/design-system/Card';
import { Input } from '../src/design-system/Input';
import { Modal } from '../src/design-system/Modal';

// ---- Button ----
describe('Button', () => {
  it('renders children', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('is disabled and aria-busy when loading', () => {
    render(<Button loading>Send</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Send</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies variant class', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });

  it('applies size class', () => {
    render(<Button size="lg">Big</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-lg');
  });

  it('applies btn-full when fullWidth', () => {
    render(<Button fullWidth>Full</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-full');
  });

  it('calls onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ---- Badge ----
describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Testnet</Badge>);
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('applies variant class', () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    expect(container.firstChild).toHaveClass('badge-success');
  });

  it('defaults to badge-default', () => {
    const { container } = render(<Badge>X</Badge>);
    expect(container.firstChild).toHaveClass('badge-default');
  });
});

// ---- Card ----
describe('Card', () => {
  it('renders children in body', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders header when provided', () => {
    render(<Card header="Title">Body</Card>);
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    render(<Card footer="Footer">Body</Card>);
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('does not render header/footer when not provided', () => {
    const { container } = render(<Card>Body</Card>);
    expect(container.querySelector('.card-header')).toBeNull();
    expect(container.querySelector('.card-footer')).toBeNull();
  });
});

// ---- Input ----
describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Amount" />);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });

  it('shows error message and sets aria-invalid', () => {
    render(<Input label="Amount" error="Too high" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too high');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows hint when no error', () => {
    render(<Input label="Amount" hint="Min 1 XLM" />);
    expect(screen.getByText('Min 1 XLM')).toBeInTheDocument();
  });

  it('does not show hint when error is present', () => {
    render(<Input label="Amount" error="Bad" hint="Min 1 XLM" />);
    expect(screen.queryByText('Min 1 XLM')).toBeNull();
  });
});

// ---- Modal ----
describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Test" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open', () => {
    render(<Modal open onClose={() => {}} title="Confirm">Content</Modal>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">Body</Modal>);
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">Body</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T">Body</Modal>);
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
