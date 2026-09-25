/**
 * #1142 — LiquidityPoolDepositWithdraw.jsx builds real money-moving AMM
 * deposit/withdraw requests with no prior test coverage. These tests cover
 * the request payload shape sent to
 * backend/src/routes/stellar/pool-operations.js and error-state handling.
 *
 * While writing these tests, a drift was found and fixed directly in
 * LiquidityPoolDepositWithdraw.jsx: the UI collects slippage tolerance as a
 * percentage (0-50, e.g. "1" meaning 1%) but sent that raw number straight
 * through. The backend's slippageTolerance validator requires a fraction in
 * [0, 1] — any slippage entry above 1 (i.e. any value above "1%") would have
 * been rejected by the backend with a 400. The component now divides by 100
 * before sending.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { LiquidityPoolDepositWithdraw } from './LiquidityPoolDepositWithdraw.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../api/client.js';

// AmountInput/StatusMessage (rendered by this component) resolve their
// accessible labels via useTranslation — wrap with the real i18n instance so
// those labels match what actually renders in the app.
function renderPool(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LiquidityPoolDepositWithdraw {...props} />
    </I18nextProvider>,
  );
}

const ACCOUNT_ID = 'G'.repeat(56);

const POOL = {
  poolId: 'pool-1',
  assetA: 'XLM',
  assetB: 'USDC',
  reserveA: 1000,
  reserveB: 2000,
  midPrice: 2,
  feeBps: 30,
};

function mockPools(pools = [POOL]) {
  apiClient.get.mockResolvedValue({ data: { pools } });
}

async function renderAndSelectPool() {
  mockPools();
  renderPool({ accountId: ACCOUNT_ID });
  await waitFor(() => expect(screen.getByRole('option', { name: /xlm \/ usdc/i })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/^pool:/i), { target: { value: 'pool-1' } });
  await screen.findByText(/pool details/i);
}

describe('LiquidityPoolDepositWithdraw', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  it('lists pools and shows pool details on selection', async () => {
    await renderAndSelectPool();
    expect(screen.getByText(/price:/i)).toHaveTextContent('2');
  });

  it('auto-calculates the paired deposit amount from the pool ratio', async () => {
    await renderAndSelectPool();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    // ratio = reserveB / reserveA = 2000 / 1000 = 2
    expect(screen.getByLabelText(/auto-calculated/i)).toHaveValue(20);
  });

  it('converts the percentage slippage input into the backend-expected fraction on fee estimate', async () => {
    await renderAndSelectPool();
    apiClient.post.mockResolvedValue({ data: { baseFee: '0.00001', networkFee: '0.00001', ratioShiftPct: 0.1 } });

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    // slippage defaults to '1' (meaning 1%)
    fireEvent.click(screen.getByRole('button', { name: /estimate fees/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/amm/deposit/estimate', {
        poolId: 'pool-1',
        amountA: 10,
        amountB: 20,
        slippageTolerance: 0.01,
      }),
    );
  });

  it('submits a deposit payload matching the backend validators', async () => {
    await renderAndSelectPool();
    apiClient.post.mockResolvedValue({ data: { sharesReceived: '14.14' } });

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /^deposit$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/amm/deposit', {
        sourceSecret: '',
        poolId: 'pool-1',
        amountA: 10,
        amountB: 20,
        slippageTolerance: 0.01,
      }),
    );
    expect(await screen.findByText(/received 14.14 lp tokens/i)).toBeInTheDocument();
  });

  it('submits a withdraw payload matching the backend validators', async () => {
    await renderAndSelectPool();
    apiClient.post.mockResolvedValue({ data: { amountA: '5', amountB: '10' } });

    fireEvent.change(screen.getByLabelText(/operation:/i), { target: { value: 'withdraw' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /^withdraw$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/stellar/amm/withdraw', {
        sourceSecret: '',
        poolId: 'pool-1',
        shares: 7,
        slippageTolerance: 0.01,
      }),
    );
    expect(await screen.findByText(/withdrawal successful/i)).toBeInTheDocument();
  });

  it('surfaces a deposit error instead of failing silently', async () => {
    await renderAndSelectPool();
    apiClient.post.mockRejectedValue({ normalized: { message: 'Slippage tolerance exceeded' } });

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /^deposit$/i }));

    expect(await screen.findByText('Slippage tolerance exceeded')).toBeInTheDocument();
  });

  it('surfaces a pool-fetch error instead of failing silently', async () => {
    apiClient.get.mockRejectedValue(new Error('network down'));
    renderPool({ accountId: ACCOUNT_ID });
    expect(await screen.findByText(/failed to fetch pools/i)).toBeInTheDocument();
  });
});
