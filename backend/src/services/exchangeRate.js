import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { getIssuer, SUPPORTED_ASSETS } from '../config/assets.js';
import { broadcastToAccount } from './websocket.js';
import { onConfigChange } from '../config/env.js';
import { getHorizonServer } from './stellar.js';
import { redisBackend } from '../cache/appCache.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS = (parseInt(process.env.RATE_CACHE_TTL_S, 10) || 60) * 1000;
/** Interval of the background CoinGecko refresh worker (see scheduler.js). */
export const RATE_REFRESH_INTERVAL_MS = (parseInt(process.env.RATE_REFRESH_INTERVAL_S, 10) || 60) * 1000;
/**
 * How long a stored rate matrix may be served after it was fetched. Kept well
 * above the refresh interval so a single failed refresh doesn't take rates down.
 */
const MATRIX_MAX_AGE_MS = Math.max(RATE_REFRESH_INTERVAL_MS * 5, CACHE_TTL_MS);
/** Minimum gap between two CoinGecko refreshes (free-tier guard). */
const API_MIN_GAP_MS = 2_000;
const RATES_REDIS_KEY = 'rates:all';

/** Timeout (ms) for exchange rate API calls. Reads EXCHANGE_RATE_TIMEOUT_MS env var, default 5 000. */
function getExchangeRateTimeout() {
  return parseInt(process.env.EXCHANGE_RATE_TIMEOUT_MS ?? '5000', 10);
}

// CoinGecko coin IDs for supported assets
const COINGECKO_IDS = { XLM: 'stellar', USDC: 'usd-coin' };

// Fiat currencies supported as vs_currencies by CoinGecko
const FIAT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'PHP', 'INR', 'MXN', 'BRL', 'AUD', 'CAD', 'CHF', 'SGD', 'HKD', 'KRW', 'NGN']);

// ---------------------------------------------------------------------------
// Rate matrix  { fetchedAt, prices: { XLM: { usd, eur, ... }, USDC: {...} } }
//
// The full matrix is fetched in ONE batched CoinGecko call by a background
// worker and stored in Redis under `rates:all` (plus an in-process copy).
// Request paths only ever read it, so concurrent lookups for distinct pairs
// never contend for CoinGecko's rate limit.
// ---------------------------------------------------------------------------
let matrix = null;
let refreshInFlight = null;
let lastFetchAt = 0;

// DEX fallback cache for pairs CoinGecko can't price  { key: { rate, fetchedAt } }
const dexCache = new Map();
const lastRates = new Map(); // for change detection

// Clear cache when config changes (e.g., STELLAR_NETWORK switches)
onConfigChange(() => {
  matrix = null;
  dexCache.clear();
  lastRates.clear();
  lastFetchAt = 0;
  redisBackend.delete(RATES_REDIS_KEY).catch(() => {});
  logger.info('exchangeRate.cache.cleared', { reason: 'config reload' });
});

function cacheKey(from, to) {
  return `${from}:${to}`;
}

function isFresh(m) {
  return m != null && Date.now() - m.fetchedAt <= MATRIX_MAX_AGE_MS;
}

/**
 * Fetch every supported coin priced in every supported fiat currency with a
 * single CoinGecko request.
 * @returns {Promise<Object<string, Object<string, number>>|null>} prices keyed by asset code, or null on failure
 */
async function fetchPriceMatrixFromCoinGecko() {
  const assets = Object.keys(COINGECKO_IDS);
  const ids = assets.map((a) => COINGECKO_IDS[a]).join(',');
  const vs = [...FIAT_CURRENCIES].map((c) => c.toLowerCase()).join(',');

  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
    const res = await fetch(`${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${vs}`, {
      headers,
      signal: AbortSignal.timeout(getExchangeRateTimeout()),
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();

    const prices = {};
    for (const asset of assets) {
      const entry = data[COINGECKO_IDS[asset]];
      if (entry && typeof entry === 'object') prices[asset] = entry;
    }
    if (Object.keys(prices).length === 0) return null;
    return prices;
  } catch (err) {
    logger.warn('exchangeRate.coingecko.failed', { error: err.message });
    return null;
  }
}

/**
 * Refresh the full rate matrix from CoinGecko and store it in Redis.
 * Concurrent callers share one in-flight request, and refreshes closer together
 * than API_MIN_GAP_MS reuse the current matrix instead of hitting the API.
 * Intended to be driven by the background worker in scheduler.js.
 * @returns {Promise<{fetchedAt: number, prices: object}|null>} The current matrix, or null if none is available
 */
export async function refreshAllRates() {
  if (refreshInFlight) return refreshInFlight;
  if (matrix && Date.now() - lastFetchAt < API_MIN_GAP_MS) return matrix;

  refreshInFlight = (async () => {
    lastFetchAt = Date.now();
    const prices = await fetchPriceMatrixFromCoinGecko();
    if (!prices) return matrix;

    const next = { fetchedAt: Date.now(), prices };
    const prev = matrix;
    matrix = next;
    await redisBackend.set(RATES_REDIS_KEY, next, Math.ceil(MATRIX_MAX_AGE_MS / 1000));
    logger.debug('exchangeRate.matrix.refreshed', { assets: Object.keys(prices) });

    if (prev) notifyMatrixChanges(next);
    else seedLastRates(next);
    return next;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Read the rate matrix: in-process copy first, then Redis (shared across
 * instances). Only on a cold start with nothing cached does this trigger a
 * (deduplicated) refresh.
 * @returns {Promise<{fetchedAt: number, prices: object}|null>}
 */
async function getMatrix() {
  if (isFresh(matrix)) return matrix;

  const stored = await redisBackend.get(RATES_REDIS_KEY);
  if (isFresh(stored)) {
    matrix = stored;
    return matrix;
  }

  return refreshAllRates();
}

/**
 * Look up a pair in the matrix. `to` may be a fiat currency or another
 * CoinGecko-priced asset (cross rate via USD).
 */
function rateFromMatrix(m, from, to) {
  if (!m) return null;
  const fromPrices = m.prices[from];
  if (!fromPrices) return null;

  if (FIAT_CURRENCIES.has(to)) {
    const rate = fromPrices[to.toLowerCase()];
    return rate != null ? rate : null;
  }

  const toPrices = m.prices[to];
  if (fromPrices.usd != null && toPrices?.usd) return fromPrices.usd / toPrices.usd;
  return null;
}

// ---------------------------------------------------------------------------
// Fallback source: Stellar DEX orderbook
// ---------------------------------------------------------------------------
async function fetchFromStellarDex(from, to) {
  const key = cacheKey(from, to);
  const cached = dexCache.get(key);
  if (cached && Date.now() - cached.fetchedAt <= CACHE_TTL_MS) return cached.rate;

  try {
    const fromAsset =
      from === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(from, getIssuer(from));
    const toAsset =
      to === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(to, getIssuer(to));
    const orderbook = await getHorizonServer().orderbook(fromAsset, toAsset).call();
    const rate = orderbook.asks?.[0]?.price ? parseFloat(orderbook.asks[0].price) : null;
    if (rate != null) {
      logger.debug('exchangeRate.stellarDex', { from, to, rate });
      dexCache.set(key, { rate, fetchedAt: Date.now() });
      notifyIfChanged(from, to, rate);
    }
    return rate;
  } catch (err) {
    logger.warn('exchangeRate.stellarDex.failed', { from, to, error: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the exchange rate from one asset/currency to another.
 * Resolution order: cached rate matrix (memory → Redis `rates:all`) → Stellar DEX orderbook.
 * CoinGecko is never called per-request; the matrix is refreshed by a background worker.
 * @param {string} from - Source asset code (e.g. "XLM", "USDC")
 * @param {string} to - Target asset/fiat code (e.g. "USD")
 * @returns {Promise<number|null>} Exchange rate, or null if no source could produce one
 */
export async function getRate(from, to) {
  if (from === to) return 1;

  const rate = rateFromMatrix(await getMatrix(), from, to);
  if (rate != null) return rate;

  return fetchFromStellarDex(from, to);
}

/**
 * Convert an amount from one asset/currency to another using {@link getRate}.
 * @param {number} amount - Amount denominated in `from`
 * @param {string} from - Source asset code
 * @param {string} to - Target asset/fiat code
 * @returns {Promise<number|null>} Converted amount rounded to 7 decimal places, or null if no rate is available
 */
export async function convert(amount, from, to) {
  const rate = await getRate(from, to);
  if (rate == null) return null;
  return parseFloat((amount * rate).toFixed(7));
}

/**
 * Rates for every ordered supported asset pair, served from the cached rate
 * matrix, falling back to the DEX orderbook for pairs CoinGecko can't price.
 * @returns {Promise<Array<{from: string, to: string, rate: number|null}>>} One entry per ordered asset pair
 */
export async function getAllRates() {
  const m = await getMatrix();
  const assets = [...SUPPORTED_ASSETS];

  const pairs = [];
  for (const from of assets) {
    for (const to of assets) {
      if (from !== to) pairs.push({ from, to });
    }
  }

  return Promise.all(
    pairs.map(async ({ from, to }) => {
      let rate = rateFromMatrix(m, from, to);
      if (rate == null) rate = await fetchFromStellarDex(from, to);
      return { from, to, rate };
    }),
  );
}

// ---------------------------------------------------------------------------
// Rate-change notifications via WebSocket broadcast
// ---------------------------------------------------------------------------
const CHANGE_THRESHOLD = 0.005; // 0.5%

/** Pairs tracked for change notifications: every CoinGecko asset vs every fiat currency. */
function matrixPairs(m) {
  const out = [];
  for (const from of Object.keys(m.prices)) {
    for (const [vs, rate] of Object.entries(m.prices[from])) {
      if (rate != null) out.push({ from, to: vs.toUpperCase(), rate });
    }
  }
  return out;
}

function seedLastRates(m) {
  for (const { from, to, rate } of matrixPairs(m)) lastRates.set(cacheKey(from, to), rate);
}

function notifyMatrixChanges(m) {
  for (const { from, to, rate } of matrixPairs(m)) notifyIfChanged(from, to, rate);
}

function notifyIfChanged(from, to, rate) {
  const key = cacheKey(from, to);
  const prev = lastRates.get(key);
  lastRates.set(key, rate);
  if (prev == null) return;
  const change = Math.abs(rate - prev) / prev;
  if (change >= CHANGE_THRESHOLD) {
    logger.info('exchangeRate.changed', {
      from,
      to,
      prev,
      rate,
      changePct: (change * 100).toFixed(2),
    });
    // Broadcast to the 'rates' channel (clients subscribed with publicKey='rates')
    broadcastToAccount('rates', {
      type: 'rateChange',
      from,
      to,
      rate,
      prev,
      timestamp: Date.now(),
    });
  }
}
