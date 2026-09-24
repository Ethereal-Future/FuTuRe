/**
 * #1122 — TxLookup processes the backend's direct single-transaction
 * response (`{ transaction }`) instead of scanning a paginated `records`
 * list, so a hash lookup succeeds even when the transaction is older than
 * the account's most recent page of history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TxLookup } from './TxLookup.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn() },
}));

import apiClient from '../api/client.js';

const PUBLIC_KEY = 'GA'.padEnd(56, 'A');
const OLD_HASH = 'b'.repeat(64);

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/account public key/i), {
    target: { value: PUBLIC_KEY },
  });
  fireEvent.change(screen.getByLabelText(/transaction hash/i), {
    target: { value: OLD_HASH },
  });
  fireEvent.click(screen.getByRole('button', { name: /look up/i }));
}

describe('TxLookup', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('renders a transaction returned via direct hash lookup (older than top-50 recent records)', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        transaction: {
          hash: OLD_HASH,
          type: 'payment',
          direction: 'received',
          amount: '12.5000000',
          asset: 'XLM',
          counterparty: 'GBSOMEOTHERKEY',
          date: '2019-05-01T00:00:00Z',
          fee: '100',
          successful: true,
          memo: null,
        },
      },
    });

    render(<TxLookup onClose={() => {}} />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText('Transaction Details')).toBeInTheDocument());

    expect(apiClient.get).toHaveBeenCalledWith(
      `/api/stellar/account/${PUBLIC_KEY}/transactions`,
      { params: { hash: OLD_HASH } },
    );
    expect(screen.getByText(OLD_HASH)).toBeInTheDocument();
    expect(screen.getByText(/12.5000000 XLM/)).toBeInTheDocument();
  });

  it('shows a not-found error when the backend returns 404', async () => {
    apiClient.get.mockRejectedValue({
      response: { data: { error: 'Transaction not found for this account' } },
    });

    render(<TxLookup onClose={() => {}} />);
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText('Transaction not found for this account')).toBeInTheDocument(),
    );
  });

  it('falls back to scanning `records` if the backend ever returns the legacy shape', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        records: [{ hash: OLD_HASH, type: 'payment', date: '2019-05-01T00:00:00Z', fee: '100', successful: true }],
      },
    });

    render(<TxLookup onClose={() => {}} />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText('Transaction Details')).toBeInTheDocument());
    expect(screen.getByText(OLD_HASH)).toBeInTheDocument();
  });
});
