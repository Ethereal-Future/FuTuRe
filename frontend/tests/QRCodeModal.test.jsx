import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QRCodeModal } from '../src/components/QRCodeModal';

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn(() => Promise.resolve()) },
}));

const PUBLIC_KEY = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';

describe('QRCodeModal', () => {
  it('renders the dialog with correct aria attributes', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /QR Code/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('displays the public key', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.getByText(PUBLIC_KEY)).toBeInTheDocument();
  });

  it('renders a close button', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={onClose} />);
    // Click the overlay (outermost div)
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when clicking inside the modal', () => {
    const onClose = vi.fn();
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog', { name: /QR Code/i }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the amount input', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.getByRole('spinbutton', { name: /Payment amount/i })).toBeInTheDocument();
  });

  it('shows payment request hint when amount is entered', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Payment amount/i }), {
      target: { value: '50' },
    });
    expect(screen.getByText(/payment request for 50 XLM/i)).toBeInTheDocument();
  });

  it('renders the Download PNG button', () => {
    render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Download PNG/i })).toBeInTheDocument();
  });
});
