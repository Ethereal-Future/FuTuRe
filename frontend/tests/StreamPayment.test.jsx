import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StreamPayment, computeStreamSummary } from '../src/components/StreamPayment';

vi.mock('../src/api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../src/api/client.js';

const PUBLIC_KEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN';

describe('computeStreamSummary', () => {
  it('returns null when inputs are incomplete', () => {
    expect(computeStreamSummary('', '7', '2026-12-31')).toBeNull();
    expect(computeStreamSummary('10', '', '2026-12-31')).toBeNull();
    expect(computeStreamSummary('10', '7', '')).toBeNull();
  });

  it('calculates total XLM and payment count', () => {
    const end = new Date();
    end.setDate(end.getDate() + 28);
    const endDate = end.toISOString().split('T')[0];
    const summary = computeStreamSummary('10', '7', endDate);
    expect(summary).not.toBeNull();
    expect(summary.paymentCount).toBeGreaterThanOrEqual(4);
    expect(parseFloat(summary.totalXLM)).toBeGreaterThan(0);
    expect(summary.totalDays).toBeGreaterThanOrEqual(28);
  });
});

describe('StreamPayment form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: [] });
    localStorage.setItem('secretKey', 'SSECRETKEY123');
  });

  it('renders standing order form with plain-language labels', async () => {
    render(<StreamPayment publicKey={PUBLIC_KEY} />);
    fireEvent.click(screen.getByRole('button', { name: /new standing order/i }));

    expect(screen.getByLabelText(/send to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount \(xlm\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/frequency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
    expect(screen.getByText(/send.*weekly/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up standing order/i })).toBeInTheDocument();
  });

  it('shows summary when amount, frequency, and end date are set', async () => {
    render(<StreamPayment publicKey={PUBLIC_KEY} />);
    fireEvent.click(screen.getByRole('button', { name: /new standing order/i }));

    fireEvent.change(screen.getByLabelText(/amount \(xlm\)/i), { target: { value: '5' } });
    const end = new Date();
    end.setDate(end.getDate() + 14);
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: end.toISOString().split('T')[0] },
    });

    await waitFor(() => {
      expect(screen.getByText(/total to be sent/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/15 XLM/);
  });

  it('submits stream creation with interval and end date', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'stream-1' } });
    render(<StreamPayment publicKey={PUBLIC_KEY} />);
    fireEvent.click(screen.getByRole('button', { name: /new standing order/i }));

    fireEvent.change(screen.getByLabelText(/send to/i), {
      target: { value: 'GRECIP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
    });
    fireEvent.change(screen.getByLabelText(/amount \(xlm\)/i), { target: { value: '10' } });
    const end = new Date();
    end.setDate(end.getDate() + 7);
    const endDate = end.toISOString().split('T')[0];
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: endDate } });

    fireEvent.click(screen.getByRole('button', { name: /set up standing order/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/streaming',
        expect.objectContaining({
          senderPublicKey: PUBLIC_KEY,
          recipientPublicKey: 'GRECIP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          rateAmount: 10,
          intervalSeconds: 7 * 24 * 60 * 60,
          assetCode: 'XLM',
          endTime: expect.any(String),
        }),
      );
    });
  });

  it('shows pause and cancel buttons for active streams', async () => {
    apiClient.get.mockResolvedValue({
      data: [
        {
          id: 'stream-1',
          rateAmount: '10',
          assetCode: 'XLM',
          intervalSeconds: 7 * 24 * 60 * 60,
          status: 'ACTIVE',
          totalStreamed: '20',
          recipient: { publicKey: 'GRECIP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
        },
      ],
    });
    render(<StreamPayment publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });
});
