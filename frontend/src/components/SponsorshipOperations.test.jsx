/**
 * #1147 — SponsorshipOperations.jsx drives Stellar reserve sponsorship. The
 * backend wraps each request in a begin/end-sponsoring-future-reserves pair;
 * these tests verify the component sends the correct sponsor (source secret),
 * sponsored account, and asset parameters to each sponsored-create endpoint,
 * and that invalid input never reaches the API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SponsorshipOperations } from './SponsorshipOperations.jsx';

vi.mock('../api/client.js', () => ({
  default: { post: vi.fn() },
}));

vi.mock('../hooks/useMessages', () => ({
  useMessages: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import apiClient from '../api/client.js';

const SPONSOR_SECRET = 'S'.repeat(56);
const SPONSORED = 'G'.repeat(56);

function submitButton(label) {
  return screen.getAllByRole('button', { name: label }).find((b) => b.type === 'submit');
}

describe('SponsorshipOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('secretKey', SPONSOR_SECRET);
  });

  afterEach(() => localStorage.clear());

  it('creates a sponsored account with sponsor, sponsored key and starting balance', async () => {
    apiClient.post.mockResolvedValue({ data: { hash: 'abc123' } });
    const { container } = render(<SponsorshipOperations publicKey="GSPONSOR" />);

    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: SPONSORED } });
    fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: '5' } });
    fireEvent.click(submitButton('Create Sponsored Account'));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/account/sponsored-create', {
      sourceSecret: SPONSOR_SECRET,
      sponsoredAccount: SPONSORED,
      initialBalance: '5',
    });
    expect(await screen.findByText(/abc123/)).toBeInTheDocument();
  });

  it('rejects an invalid sponsored account key without calling the API', async () => {
    const { container } = render(<SponsorshipOperations publicKey="GSPONSOR" />);

    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: 'GSHORT' } });
    fireEvent.click(submitButton('Create Sponsored Account'));

    expect(await screen.findByText('Please enter a valid account public key')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects a negative initial balance', async () => {
    const { container } = render(<SponsorshipOperations publicKey="GSPONSOR" />);

    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: SPONSORED } });
    fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: '-1' } });
    fireEvent.click(submitButton('Create Sponsored Account'));

    expect(await screen.findByText('Initial balance must be non-negative')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('creates a sponsored trustline with asset code and issuer', async () => {
    apiClient.post.mockResolvedValue({ data: { hash: 'def456' } });
    const { container } = render(<SponsorshipOperations publicKey="GSPONSOR" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Create Sponsored Trustline' })[0]);
    const [accountInput, issuerInput] = container.querySelectorAll('input[type="text"]');
    fireEvent.change(accountInput, { target: { value: SPONSORED } });
    fireEvent.change(issuerInput, { target: { value: 'GISSUER' } });
    fireEvent.click(submitButton('Create Sponsored Trustline'));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/trustline/sponsored-create', {
      sourceSecret: SPONSOR_SECRET,
      sponsoredAccount: SPONSORED,
      assetCode: 'USDC',
      assetIssuer: 'GISSUER',
    });
  });

  it('surfaces a backend error', async () => {
    apiClient.post.mockRejectedValue({ response: { data: { error: 'op_low_reserve' } } });
    const { container } = render(<SponsorshipOperations publicKey="GSPONSOR" />);

    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: SPONSORED } });
    fireEvent.click(submitButton('Create Sponsored Account'));

    expect(await screen.findByText('op_low_reserve')).toBeInTheDocument();
  });
});
