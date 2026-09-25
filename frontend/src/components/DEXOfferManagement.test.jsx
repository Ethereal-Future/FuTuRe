/**
 * #1142 — DEXOfferManagement.jsx builds real money-moving DEX offer
 * requests (create/modify/cancel) with no prior test coverage. These tests
 * cover the request payload shape sent to
 * backend/src/routes/stellar/offers.js, client-side validation, and
 * error-state handling.
 *
 * While writing these tests, a drift was found and fixed directly in
 * DEXOfferManagement.jsx: handleModifyOffer sent `offerId: parseInt(offerId)`
 * (a number), but the backend's /api/stellar/offers/modify route validates
 * offerId with `.isString().trim().notEmpty()` — every modify request would
 * have failed validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { DEXOfferManagement } from './DEXOfferManagement.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../api/client.js';

// AmountInput/StatusMessage (rendered by DEXOfferManagement) resolve their
// accessible labels via useTranslation — wrap with the real i18n instance so
// those labels match what actually renders in the app (e.g. the amount
// field's aria-label is "Amount", not the raw i18n key).
function renderOffers(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DEXOfferManagement {...props} />
    </I18nextProvider>,
  );
}

const ACCOUNT_ID = 'G'.repeat(56);

const OFFER = {
  id: '12345',
  selling: { asset_code: 'XLM' },
  buying: { asset_code: 'USD' },
  amount: '100.0000000',
  price_r: { n: 2, d: 1 },
  created_at: '2026-08-01T00:00:00Z',
};

const ASSETS = [{ code: 'XLM' }, { code: 'USD' }];

function mockLoad({ offers = [OFFER] } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === `/api/stellar/offers/${ACCOUNT_ID}`) return Promise.resolve({ data: { offers } });
    if (url === '/api/stellar/trustline/assets') return Promise.resolve({ data: { assets: ASSETS } });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

describe('DEXOfferManagement', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders existing offers with computed price and offer id', async () => {
    mockLoad();
    renderOffers({ accountId: ACCOUNT_ID });

    expect(await screen.findByText('12345')).toBeInTheDocument();
    expect(screen.getByText('XLM / USD')).toBeInTheDocument();
  });

  it('blocks offer creation and shows an error when amount/price are missing', async () => {
    mockLoad();
    const { container } = renderOffers({ accountId: ACCOUNT_ID });
    await screen.findByText('12345');

    fireEvent.click(screen.getByRole('button', { name: /^create offer$/i }));
    fireEvent.click(within(container.querySelector('form')).getByRole('button', { name: /create offer/i }));

    expect(await screen.findByText(/please fill in all required fields/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('submits a create-offer payload matching the backend validators', async () => {
    mockLoad();
    apiClient.post.mockResolvedValue({ data: { offerId: '99' } });
    const { container } = renderOffers({ accountId: ACCOUNT_ID });
    await screen.findByText('12345');

    fireEvent.click(screen.getByRole('button', { name: /^create offer$/i }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '2.5' } });
    fireEvent.click(within(container.querySelector('form')).getByRole('button', { name: /create offer/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/offers/create', {
      sourceSecret: '',
      sellingAsset: 'XLM',
      buyingAsset: 'USD',
      sellingAmount: 50,
      price: 2.5,
    });
    expect(await screen.findByText(/offer created successfully/i)).toBeInTheDocument();
  });

  it('sends offerId as a string when modifying an offer (matches backend isString() validator)', async () => {
    mockLoad();
    apiClient.post.mockResolvedValue({ data: { ok: true } });
    renderOffers({ accountId: ACCOUNT_ID });
    await screen.findByText('12345');

    fireEvent.click(screen.getByRole('button', { name: /modify/i }));
    fireEvent.click(screen.getByRole('button', { name: /^modify offer$/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/offers/modify',
      expect.objectContaining({ offerId: '12345' }),
    ));
    const [, payload] = apiClient.post.mock.calls[0];
    expect(typeof payload.offerId).toBe('string');
  });

  it('cancels an offer after confirmation, sending its id', async () => {
    mockLoad();
    apiClient.post.mockResolvedValue({ data: { ok: true } });
    renderOffers({ accountId: ACCOUNT_ID });
    await screen.findByText('12345');

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/offers/cancel', {
        sourceSecret: '',
        offerId: '12345',
      }),
    );
    expect(await screen.findByText(/offer canceled successfully/i)).toBeInTheDocument();
  });

  it('surfaces a server error on a rejected create request', async () => {
    mockLoad();
    apiClient.post.mockRejectedValue({ normalized: { message: 'Insufficient balance for offer' } });
    const { container } = renderOffers({ accountId: ACCOUNT_ID });
    await screen.findByText('12345');

    fireEvent.click(screen.getByRole('button', { name: /^create offer$/i }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '2.5' } });
    fireEvent.click(within(container.querySelector('form')).getByRole('button', { name: /create offer/i }));

    expect(await screen.findByText('Insufficient balance for offer')).toBeInTheDocument();
  });
});
