import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as exchangeRate from '../src/services/exchangeRate.js';
import { cacheDel, keys as cacheKeys } from '../src/cache/appCache.js';

describe('ExchangeRate Redis-backed caching', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await cacheDel(cacheKeys.rate('XLM', 'USDC'));
    await cacheDel(cacheKeys.rate('USDC', 'XLM'));
    await cacheDel('rates:all');
  });

  it('caches exchange rate results and avoids repeated CoinGecko requests', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.12 },
      }),
    });

    const first = await exchangeRate.getRate('XLM', 'USDC');
    const second = await exchangeRate.getRate('XLM', 'USDC');

    expect(first).toBe(0.12);
    expect(second).toBe(0.12);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses cached /rates results when the endpoint is accessed repeatedly', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.12 },
        'usd-coin': { usd: 1 },
      }),
    });

    const first = await exchangeRate.getAllRates();
    const second = await exchangeRate.getAllRates();

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
