import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRate, getAllRates } from '../src/services/exchangeRate.js';
import * as StellarSDK from '@stellar/stellar-sdk';

// Mock Stellar SDK for DEX fallback
vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        orderbook: vi.fn().mockReturnThis(),
        call: vi.fn().mockResolvedValue({
          asks: [{ price: '0.1234' }]
        })
      }))
    }
  };
});

// Mock global fetch for CoinGecko
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Third-party Integration: ExchangeRate + CoinGecko + Stellar DEX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the internal cache if possible (exchangeRate.js uses a module-level Map)
    // Since we can't easily clear the private Map, we'll use unique pairs for some tests
  });

  it('should fetch rate from CoinGecko when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        stellar: { usd: 0.11 }
      })
    });

    const rate = await getRate('XLM', 'USD');
    expect(rate).toBe(0.11);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.coingecko.com'),
      expect.any(Object)
    );
  });

  it('should fallback to Stellar DEX when CoinGecko fails', async () => {
    // Mock CoinGecko failure
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    // Use a pair that hasn't been cached yet
    const rate = await getRate('XLM', 'USDC');
    
    expect(rate).toBe(0.1234); // Value from our Stellar SDK mock
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should return 1 for same assets', async () => {
    const rate = await getRate('XLM', 'XLM');
    expect(rate).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch all rates for supported assets', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        stellar: { usd: 0.11 },
        'usd-coin': { usd: 1.0 }
      })
    });

    const rates = await getAllRates();
    expect(rates.length).toBeGreaterThan(0);
    expect(rates.find(r => r.from === 'XLM' && r.to === 'USDC')).toBeDefined();
  });
});
