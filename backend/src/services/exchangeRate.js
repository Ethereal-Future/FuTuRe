import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { getIssuer, SUPPORTED_ASSETS } from '../config/assets.js';
import { broadcastToAccount } from './websocket.js';
import { onConfigChange } from '../config/env.js';
import { getHorizonServer } from './stellar.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS   = (parseInt(process.env.RATE_CACHE_TTL_S, 10) || 60) * 1000;
const API_MIN_GAP_MS = 2_000; // minimum ms between CoinGecko calls (rate-limit guard)

// CoinGecko coin IDs for supported assets
const COINGECKO_IDS = { XLM: 'stellar', USDC: 'usd-coin' };

// ---------------------------------------------------------------------------
// In-memory cache  { key: { rate, fetchedAt } }
// ---------------------------------------------------------------------------
const cache = new Map();
const lastRates = new Map(); // for change detection
let lastFetchAt = 0;

// Clear cache when config changes (e.g., STELLAR_NETWORK switches)
onConfigChange(() => {
  cache.clear();
  lastRates.clear();
  lastFetchAt = 0;
  logger.info('exchangeRate.cache.cleared', { reason: 'config reload' });
});

function cacheKey(from, to) { return `${from}:${to}`; }

function getCached(from, to) {
  const entry = cache.get(cacheKey(from, to));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) { cache.delete(cacheKey(from, to)); return null; }
  return entry.rate;
}

function setCache(from, to, rate) {
  cache.set(cacheKey(from, to), { rate, fetchedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Primary source: CoinGecko
// ---------------------------------------------------------------------------
async function fetchFromCoinGecko(from, to) {
  const now = Date.now();
  if (now - lastFetchAt < API_MIN_GAP_MS) return null; // rate-limit guard
  lastFetchAt = now;

  const fromId = COINGECKO_IDS[from];
  const toId   = COINGECKO_IDS[to];
  if (!fromId || !toId) return null;

  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${fromId}&vs_currencies=${toId === 'usd-coin' ? 'usd' : toId}`,
      { headers, signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    const vsCurrency = toId === 'usd-coin' ? 'usd' : toId;
    const rate = data[fromId]?.[vsCurrency];
    if (rate == null) return null;
    logger.debug('exchangeRate.coingecko', { from, to, rate });
    return rate;
  } catch (err) {
    logger.warn('exchangeRate.coingecko.failed', { from, to, error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback source: Stellar DEX orderbook
// ---------------------------------------------------------------------------
async function fetchFromStellarDex(from, to) {
  try {
    const fromAsset = from === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(from, getIssuer(from));
    const toAsset   = to   === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(to,   getIssuer(to));
    const orderbook = await getHorizonServer().orderbook(fromAsset, toAsset).call();
    const rate = orderbook.asks?.[0]?.price ? parseFloat(orderbook.asks[0].price) : null;
    if (rate != null) logger.debug('exchangeRate.stellarDex', { from, to, rate });
    return rate;
  } catch (err) {
    logger.warn('exchangeRate.stellarDex.failed', { from, to, error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get rate from→to, using cache → CoinGecko → Stellar DEX. */
export async function getRate(from, to) {
  if (from === to) return 1;

  const cached = getCached(from, to);
  if (cached != null) return cached;

  let rate = await fetchFromCoinGecko(from, to);
  if (rate == null) rate = await fetchFromStellarDex(from, to);

  if (rate != null) {
    setCache(from, to, rate);
    notifyIfChanged(from, to, rate);
  }

  return rate;
}

/** Convert an amount from one asset to another. */
export async function convert(amount, from, to) {
  const rate = await getRate(from, to);
  if (rate == null) return null;
  return parseFloat((amount * rate).toFixed(7));
}

/** Fetch all supported pair rates at once via a single batched CoinGecko request. */
export async function getAllRates() {
  // Collect assets that have a CoinGecko ID and aren't fully cached yet
  const needed = SUPPORTED_ASSETS.filter(a => COINGECKO_IDS[a]);

  // Single batched request: all coin IDs vs USD (USDC is pegged 1:1 to USD)
  const pricesUsd = {};
  try {
    const ids = needed.map(a => COINGECKO_IDS[a]).join(',');
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd`,
      { headers, signal: AbortSignal.timeout(5_000) }
    );
    if (res.ok) {
      const data = await res.json();
      for (const asset of needed) {
        const usd = data[COINGECKO_IDS[asset]]?.usd;
        if (usd != null) pricesUsd[asset] = usd;
      }
      lastFetchAt = Date.now();
    }
  } catch (err) {
    logger.warn('exchangeRate.getAllRates.coingecko.failed', { error: err.message });
  }

  // Derive all pairs from USD prices, fall back to getRate for anything missing
  const results = [];
  for (const from of SUPPORTED_ASSETS) {
    for (const to of SUPPORTED_ASSETS) {
      if (from === to) continue;
      let rate = getCached(from, to);
      if (rate == null && pricesUsd[from] != null && pricesUsd[to] != null) {
        rate = pricesUsd[from] / pricesUsd[to];
        setCache(from, to, rate);
        notifyIfChanged(from, to, rate);
      }
      if (rate == null) rate = await getRate(from, to); // fallback (DEX / cache)
      results.push({ from, to, rate });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rate-change notifications via WebSocket broadcast
// ---------------------------------------------------------------------------
const CHANGE_THRESHOLD = 0.005; // 0.5%

function notifyIfChanged(from, to, rate) {
  const key = cacheKey(from, to);
  const prev = lastRates.get(key);
  lastRates.set(key, rate);
  if (prev == null) return;
  const change = Math.abs(rate - prev) / prev;
  if (change >= CHANGE_THRESHOLD) {
    logger.info('exchangeRate.changed', { from, to, prev, rate, changePct: (change * 100).toFixed(2) });
    // Broadcast to the 'rates' channel (clients subscribed with publicKey='rates')
    broadcastToAccount('rates', { type: 'rateChange', from, to, rate, prev, timestamp: Date.now() });
  }
}
