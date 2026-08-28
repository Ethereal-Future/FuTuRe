/**
 * #1142 — AMMPoolBrowser.jsx is a read-only surface for AMM pool state and
 * arbitrage opportunities (backed by backend/src/routes/stellar/amm.js) with
 * no prior test coverage. These tests cover rendering of pool/arbitrage
 * data, the refresh action, and error-state handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { AMMPoolBrowser } from './AMMPoolBrowser.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn() },
}));

import apiClient from '../api/client.js';

const POOL_1 = {
  poolId: 'p1',
  assetA: 'XLM',
  assetB: 'USDC',
  reserveA: 1000,
  reserveB: 2000,
  liquidity: 1500,
  midPrice: 2,
  feeBps: 30,
};

const POOL_2 = {
  poolId: 'p2',
  assetA: 'XLM',
  assetB: 'BTC',
  reserveA: 500,
  reserveB: 10,
  liquidity: 300,
  midPrice: 0.02,
  feeBps: 30,
};

function mockPoolsAndArbitrage({ pools = [POOL_1, POOL_2], opportunitiesByPair = {} } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/stellar/amm/pools') return Promise.resolve({ data: { pools } });
    const match = url.match(/^\/api\/stellar\/amm\/arbitrage\/([^/]+)\/([^/]+)$/);
    if (match) {
      const key = `${match[1]}/${match[2]}`;
      return Promise.resolve({ data: { opportunities: opportunitiesByPair[key] ?? [] } });
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderBrowser() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AMMPoolBrowser />
    </I18nextProvider>,
  );
}

describe('AMMPoolBrowser', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('renders pool reserves, price, and fee for each pool', async () => {
    mockPoolsAndArbitrage();
    renderBrowser();

    expect(await screen.findByText('XLM / USDC')).toBeInTheDocument();
    expect(screen.getByText('XLM / BTC')).toBeInTheDocument();
    expect(screen.getAllByText(/30 bps/)).toHaveLength(2);
  });

  it('fetches and renders arbitrage opportunities for each unique asset pair', async () => {
    mockPoolsAndArbitrage({
      opportunitiesByPair: {
        'XLM/USDC': [{ buyPool: 'p1', sellPool: 'p3', spreadPct: 0.005 }],
      },
    });
    renderBrowser();

    expect(await screen.findByText(/arbitrage opportunities/i)).toBeInTheDocument();
    expect(screen.getByText('p1')).toBeInTheDocument();
    expect(screen.getByText('p3')).toBeInTheDocument();
    expect(screen.getByText('0.500%')).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/api/stellar/amm/arbitrage/XLM/USDC');
    expect(apiClient.get).toHaveBeenCalledWith('/api/stellar/amm/arbitrage/XLM/BTC');
  });

  it('shows an empty state when there are no pools', async () => {
    mockPoolsAndArbitrage({ pools: [] });
    renderBrowser();
    expect(await screen.findByText(/no pools registered yet/i)).toBeInTheDocument();
  });

  it('re-fetches pools when the refresh button is clicked', async () => {
    mockPoolsAndArbitrage();
    renderBrowser();
    await screen.findByText('XLM / USDC');

    const callsBeforeRefresh = apiClient.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /refresh amm pools/i }));

    await waitFor(() => expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsBeforeRefresh));
  });

  it('surfaces a load error instead of failing silently', async () => {
    apiClient.get.mockRejectedValue({ response: { data: { error: 'AMM service unavailable' } } });
    renderBrowser();
    expect(await screen.findByText('AMM service unavailable')).toBeInTheDocument();
  });
});
