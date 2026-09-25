import crypto from 'crypto';
import logger from '../config/logger.js';
import { redisBackend } from '../cache/appCache.js';

/**
 * Conversion quotes with a guaranteed validity window.
 *
 * GET /convert returns a quote carrying `quoteId`, `guaranteedRate` and
 * `validUntil`. The quote is persisted in Redis under `quote:${quoteId}` with a
 * TTL equal to its validity window; executing a conversion must present the
 * quoteId and is rejected once the window has passed.
 *
 * When Redis isn't configured, quotes fall back to an in-process map so single
 * instance / dev deployments keep working.
 */

export const QUOTE_TTL_S = parseInt(process.env.QUOTE_TTL_S, 10) || 60;

const memoryQuotes = new Map();

function quoteKey(quoteId) {
  return `quote:${quoteId}`;
}

function useRedis() {
  return redisBackend.isAvailable();
}

function pruneMemoryQuotes() {
  const now = Date.now();
  for (const [id, quote] of memoryQuotes) {
    if (Date.parse(quote.validUntil) < now) memoryQuotes.delete(id);
  }
}

/**
 * Create and persist a conversion quote.
 * @param {{from: string, to: string, amount: number, rate: number}} opts
 * @returns {Promise<{quoteId: string, from: string, to: string, amount: number, guaranteedRate: number, converted: number, createdAt: string, validUntil: string}>}
 */
export async function createQuote({ from, to, amount, rate }) {
  const now = Date.now();
  const quote = {
    quoteId: crypto.randomUUID(),
    from,
    to,
    amount,
    guaranteedRate: rate,
    converted: parseFloat((amount * rate).toFixed(7)),
    createdAt: new Date(now).toISOString(),
    validUntil: new Date(now + QUOTE_TTL_S * 1000).toISOString(),
  };

  if (useRedis()) {
    await redisBackend.set(quoteKey(quote.quoteId), quote, QUOTE_TTL_S);
  } else {
    pruneMemoryQuotes();
    memoryQuotes.set(quote.quoteId, quote);
  }
  return quote;
}

/**
 * Look up a quote and check it is still within its validity window.
 * @param {string} quoteId
 * @returns {Promise<{status: 'valid', quote: object}|{status: 'expired'|'not_found'}>}
 */
export async function getValidQuote(quoteId) {
  const quote = useRedis()
    ? await redisBackend.get(quoteKey(quoteId))
    : memoryQuotes.get(quoteId) ?? null;

  // Redis expires keys on its own TTL, so a missing key is most often an expired quote.
  if (!quote) return { status: 'not_found' };
  if (new Date() > new Date(quote.validUntil)) return { status: 'expired' };
  return { status: 'valid', quote };
}

/**
 * Atomically mark a quote as consumed so it can be executed at most once.
 * @param {object} quote
 * @returns {Promise<boolean>} true if this caller claimed the quote
 */
export async function consumeQuote(quote) {
  if (useRedis()) {
    try {
      const claimed = await redisBackend.setNX(`${quoteKey(quote.quoteId)}:used`, 1, QUOTE_TTL_S);
      if (claimed) await redisBackend.delete(quoteKey(quote.quoteId));
      return claimed;
    } catch (err) {
      logger.warn('conversionQuote.consume.redisFailed', { quoteId: quote.quoteId, error: err.message });
      return false;
    }
  }
  return memoryQuotes.delete(quote.quoteId);
}
