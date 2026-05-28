/**
 * Accessibility tests
 * Verifies ARIA roles, labels, live regions, and keyboard-accessible patterns.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { NetworkBadge } from '../src/components/NetworkBadge';
import { StatusMessage } from '../src/components/StatusMessage';
import { QRCodeModal } from '../src/components/QRCodeModal';

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn(() => Promise.resolve()) },
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

function Bomb() { throw new Error('boom'); }

const networkStatus = { network: 'testnet', online: true, horizonUrl: 'https://horizon-testnet.stellar.org' };
const PUBLIC_KEY = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';

describe('Accessibility', () => {
  describe('ErrorBoundary', () => {
    it('uses role="alert" on the fallback container', () => {
      render(<ErrorBoundary><Bomb /></ErrorBoundary>);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('Try again button is keyboard focusable', () => {
      render(<ErrorBoundary><Bomb /></ErrorBoundary>);
      const btn = screen.getByRole('button', { name: /Try again/i });
      btn.focus();
      expect(document.activeElement).toBe(btn);
    });
  });

  describe('NetworkBadge', () => {
    it('toggle button has aria-label', () => {
      render(<NetworkBadge status={networkStatus} />);
      expect(screen.getByRole('button', { name: /Network status/i })).toBeInTheDocument();
    });

    it('toggle button has aria-expanded attribute', () => {
      render(<NetworkBadge status={networkStatus} />);
      expect(screen.getByRole('button', { name: /Network status/i }))
        .toHaveAttribute('aria-expanded');
    });

    it('expanded panel has role="tooltip"', () => {
      render(<NetworkBadge status={networkStatus} />);
      fireEvent.click(screen.getByRole('button', { name: /Network status/i }));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
  });

  describe('StatusMessage', () => {
    it('messages have role="alert"', () => {
      const msg = { id: 1, type: 'success', message: 'OK', icon: '✅', timestamp: new Date().toISOString() };
      render(<StatusMessage messages={[msg]} onRemove={vi.fn()} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('error messages use aria-live="assertive"', () => {
      const msg = { id: 1, type: 'error', message: 'Fail', icon: '⚠️', timestamp: new Date().toISOString() };
      render(<StatusMessage messages={[msg]} onRemove={vi.fn()} />);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    });

    it('non-error messages use aria-live="polite"', () => {
      const msg = { id: 1, type: 'success', message: 'OK', icon: '✅', timestamp: new Date().toISOString() };
      render(<StatusMessage messages={[msg]} onRemove={vi.fn()} />);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    });

    it('dismiss button has aria-label="Dismiss"', () => {
      const msg = { id: 1, type: 'info', message: 'Hi', icon: 'ℹ️', timestamp: new Date().toISOString() };
      render(<StatusMessage messages={[msg]} onRemove={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
    });
  });

  describe('QRCodeModal', () => {
    it('dialog has role="dialog"', () => {
      render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('dialog has aria-modal="true"', () => {
      render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('close button has aria-label="Close"', () => {
      render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
    });

    it('amount input has aria-label', () => {
      render(<QRCodeModal publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
      expect(screen.getByRole('spinbutton', { name: /Payment amount/i })).toBeInTheDocument();
    });
  });
});
