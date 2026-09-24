import { randomUUID } from 'crypto';
import prisma from '../db/client.js';
import { resolveRedisConfig } from '../cache/redis.js';
import logger from '../config/logger.js';

// AMM state lives in PostgreSQL (source of truth) with a Redis read-through
// cache and Pub/Sub fan-out so every backend instance shares one view of pool
// reserves (#1290). Reserve mutations use optimistic locking on
// AmmPool.version, so concurrent trades on different instances can never
// both apply against the same reserves.

const riskConfig = {
  maxExposurePerAsset: 100000,
  maxSlippageBps: 150,
  minReserveRatio: 0.05,
};

const POOL_CACHE_PREFIX = 'amm:pool:';
const POOL_CACHE_TTL_SECONDS = 300;
const POOL_UPDATE_CHANNEL = 'amm:pool-updates';
const MAX_OPTIMISTIC_RETRIES = 5;

// Only writes the cached pool if it is newer than what is already cached, so
// an out-of-order write from a slower instance can't roll the cache back.
const SET_IF_NEWER_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and decoded and decoded.version and tonumber(decoded.version) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

// ── Redis plumbing ───────────────────────────────────────────────────────────

let redisInit = null;
let publisher = null;
let subscriber = null;

// Per-process L1 cache kept coherent by Pub/Sub messages from other instances.
const localPoolCache = new Map();

async function initRedis() {
  const resolved = resolveRedisConfig();
  if (!resolved) return;
  let Redis;
  try {
    ({ default: Redis } = await import('ioredis'));
  } catch {
    return;
  }

  const make = () => (resolved.url ? new Redis(resolved.url, resolved.options) : new Redis(resolved.options));
  try {
    publisher = make();
    publisher.on('error', () => {});
    await publisher.connect();

    subscriber = make();
    subscriber.on('error', () => {});
    await subscriber.connect();
    await subscriber.subscribe(POOL_UPDATE_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel !== POOL_UPDATE_CHANNEL) return;
      try {
        const pool = JSON.parse(message);
        const cached = localPoolCache.get(pool.poolId);
        if (!cached || cached.version < pool.version) localPoolCache.set(pool.poolId, pool);
      } catch { /* ignore malformed messages */ }
    });
  } catch (err) {
    logger.warn('amm.redis.unavailable', { error: err.message });
    publisher = null;
    subscriber = null;
  }
}

function ensureRedis() {
  if (!redisInit) redisInit = initRedis().catch(() => {});
  return redisInit;
}

function redisReady(client) {
  return client && client.status === 'ready';
}

async function readCachedPool(poolId) {
  await ensureRedis();
  if (!redisReady(publisher)) return null;
  try {
    const raw = await publisher.get(`${POOL_CACHE_PREFIX}${poolId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Write a freshly-committed pool snapshot to Redis and broadcast it to the
 * other instances. Failures are logged but never fail the caller: Postgres
 * already holds the committed state.
 */
async function publishPool(pool) {
  const cachedLocal = localPoolCache.get(pool.poolId);
  if (!cachedLocal || cachedLocal.version < pool.version) localPoolCache.set(pool.poolId, pool);

  await ensureRedis();
  if (!redisReady(publisher)) return;
  try {
    const payload = JSON.stringify(pool);
    await publisher.eval(
      SET_IF_NEWER_LUA,
      1,
      `${POOL_CACHE_PREFIX}${pool.poolId}`,
      payload,
      String(pool.version),
      String(POOL_CACHE_TTL_SECONDS)
    );
    await publisher.publish(POOL_UPDATE_CHANNEL, payload);
  } catch (err) {
    logger.warn('amm.redis.publish.failed', { poolId: pool.poolId, error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAsset(asset) {
  return String(asset || '').toUpperCase();
}

function toPool(row) {
  return {
    poolId: row.poolId,
    assetA: row.assetA,
    assetB: row.assetB,
    reserveA: Number(row.reserveA),
    reserveB: Number(row.reserveB),
    feeBps: row.feeBps,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function withDerived(pool) {
  return {
    ...pool,
    midPrice: pool.reserveB / pool.reserveA,
    liquidity: Math.sqrt(pool.reserveA * pool.reserveB),
  };
}

/**
 * Read a pool for quoting/display. Checks the Pub/Sub-coherent L1 cache, then
 * Redis, then Postgres. Never used as the basis for a reserve mutation.
 */
async function getPool(poolId) {
  await ensureRedis();
  // The L1 copy is only trustworthy while Pub/Sub keeps it coherent.
  const local = redisReady(subscriber) ? localPoolCache.get(poolId) : null;
  if (local) return local;

  const cached = await readCachedPool(poolId);
  if (cached) {
    localPoolCache.set(poolId, cached);
    return cached;
  }

  const row = await prisma.ammPool.findUnique({ where: { poolId } });
  if (!row) throw new Error(`Unknown pool: ${poolId}`);
  const pool = toPool(row);
  await publishPool(pool);
  return pool;
}

async function getPoolFromDb(client, poolId) {
  const row = await client.ammPool.findUnique({ where: { poolId } });
  if (!row) throw new Error(`Unknown pool: ${poolId}`);
  return toPool(row);
}

function computeQuote(pool, inputAsset, amountIn) {
  const inAsset = normalizeAsset(inputAsset);
  const amount = Number(amountIn);
  if (!(amount > 0)) throw new Error('amountIn must be positive');

  const fromAtoB = inAsset === pool.assetA;
  if (!fromAtoB && inAsset !== pool.assetB) {
    throw new Error('inputAsset does not belong to pool');
  }

  const reserveIn = fromAtoB ? pool.reserveA : pool.reserveB;
  const reserveOut = fromAtoB ? pool.reserveB : pool.reserveA;
  const feeMultiplier = 1 - (pool.feeBps / 10000);
  const effectiveIn = amount * feeMultiplier;

  const output = (reserveOut * effectiveIn) / (reserveIn + effectiveIn);
  const priceImpact = (effectiveIn / (reserveIn + effectiveIn));

  return {
    poolId: pool.poolId,
    inputAsset: inAsset,
    outputAsset: fromAtoB ? pool.assetB : pool.assetA,
    amountIn: amount,
    amountOut: output,
    feePaid: amount - effectiveIn,
    priceImpact,
  };
}

class OptimisticLockError extends Error {}

/**
 * Apply `mutate` to a pool's reserves with optimistic locking. `mutate`
 * receives the committed pool state and a transaction client and returns
 * `{ reserveA, reserveB, result }`; the reserve update only commits if the
 * pool version is unchanged, otherwise the whole transaction is retried
 * against fresh state.
 */
async function mutatePool(poolId, mutate) {
  for (let attempt = 1; attempt <= MAX_OPTIMISTIC_RETRIES; attempt++) {
    try {
      const { pool, result } = await prisma.$transaction(async (tx) => {
        const current = await getPoolFromDb(tx, poolId);
        const next = await mutate(current, tx);

        if (!(next.reserveA > 0) || !(next.reserveB > 0)) {
          throw new Error('Operation would deplete pool reserves');
        }
        // k = x * y may only grow (fees accrue to the pool) — never shrink.
        if (next.reserveA * next.reserveB < current.reserveA * current.reserveB * (1 - 1e-12)) {
          throw new Error('Constant-product invariant violated');
        }

        const { count } = await tx.ammPool.updateMany({
          where: { poolId, version: current.version },
          data: {
            reserveA: next.reserveA.toString(),
            reserveB: next.reserveB.toString(),
            version: { increment: 1 },
          },
        });
        if (count !== 1) throw new OptimisticLockError('Pool was modified concurrently');

        const updated = await getPoolFromDb(tx, poolId);
        return { pool: updated, result: next.result };
      });

      await publishPool(pool);
      return { pool, result };
    } catch (err) {
      if (err instanceof OptimisticLockError && attempt < MAX_OPTIMISTIC_RETRIES) {
        localPoolCache.delete(poolId);
        continue;
      }
      if (err instanceof OptimisticLockError) {
        throw new Error('Pool is busy, please retry the trade');
      }
      throw err;
    }
  }
  throw new Error('Pool is busy, please retry the trade');
}

function toTrade(row) {
  return {
    tradeId: row.tradeId,
    traderId: row.traderId,
    poolId: row.poolId,
    inputAsset: row.inputAsset,
    outputAsset: row.outputAsset,
    amountIn: Number(row.amountIn),
    amountOut: Number(row.amountOut),
    feePaid: Number(row.feePaid),
    priceImpact: Number(row.priceImpact),
    timestamp: new Date(row.createdAt).toISOString(),
  };
}

function toPosition(row) {
  return {
    providerId: row.providerId,
    poolId: row.poolId,
    shares: Number(row.shares),
    depositedA: Number(row.depositedA),
    depositedB: Number(row.depositedB),
    timestamp: new Date(row.updatedAt).toISOString(),
  };
}

async function listPools() {
  const rows = await prisma.ammPool.findMany();
  return rows.map(toPool);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a new persistent constant-product (x*y=k) AMM pool.
 * @param {object} opts
 * @param {string} opts.poolId - Unique id for the pool
 * @param {string} opts.assetA - First asset code
 * @param {string} opts.assetB - Second asset code
 * @param {number} opts.reserveA - Initial reserve of `assetA` (must be > 0)
 * @param {number} opts.reserveB - Initial reserve of `assetB` (must be > 0)
 * @param {number} [opts.feeBps=30] - Swap fee in basis points
 * @returns {Promise<object>} The created pool record
 * @throws {Error} If `poolId` is missing, either reserve is non-positive, or the pool already exists
 */
export async function registerPool({ poolId, assetA, assetB, reserveA, reserveB, feeBps = 30 }) {
  if (!poolId || !(Number(reserveA) > 0) || !(Number(reserveB) > 0)) {
    throw new Error('poolId, reserveA and reserveB are required');
  }

  let row;
  try {
    row = await prisma.ammPool.create({
      data: {
        poolId,
        assetA: normalizeAsset(assetA),
        assetB: normalizeAsset(assetB),
        reserveA: Number(reserveA).toString(),
        reserveB: Number(reserveB).toString(),
        feeBps: Number(feeBps),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') throw new Error(`Pool already exists: ${poolId}`);
    throw err;
  }

  const pool = toPool(row);
  await publishPool(pool);
  return pool;
}

/**
 * Get a pool's current state, including derived mid-price and liquidity.
 * @param {string} poolId - Pool id
 * @returns {Promise<object>} Pool record plus `midPrice` (reserveB/reserveA) and `liquidity` (sqrt(reserveA*reserveB))
 * @throws {Error} If the pool is unknown
 */
export async function getPoolState(poolId) {
  return withDerived(await getPool(poolId));
}

/**
 * Quote the output amount for a swap, without executing it, using the constant-product formula.
 * @param {string} poolId - Pool id
 * @param {string} inputAsset - Asset code being swapped in (must belong to the pool)
 * @param {number|string} amountIn - Amount of `inputAsset` to swap
 * @returns {Promise<{poolId: string, inputAsset: string, outputAsset: string, amountIn: number, amountOut: number, feePaid: number, priceImpact: number}>} Swap quote
 * @throws {Error} If the pool is unknown, `amountIn` is non-positive, or `inputAsset` doesn't belong to the pool
 */
export async function quoteSwap(poolId, inputAsset, amountIn) {
  return computeQuote(await getPool(poolId), inputAsset, amountIn);
}

/**
 * Execute a swap against a pool, atomically updating its reserves and recording the trade.
 * The quote is recomputed against committed reserves inside the transaction, so
 * concurrent trades on any instance can't corrupt reserves.
 * @param {object} opts
 * @param {string} opts.poolId - Pool id
 * @param {string} opts.inputAsset - Asset code being swapped in
 * @param {number|string} opts.amountIn - Amount of `inputAsset` to swap
 * @param {string} [opts.traderId='system'] - Identifier recorded with the trade
 * @param {number} [opts.maxSlippageBps=riskConfig.maxSlippageBps] - Max acceptable price impact, in basis points
 * @returns {Promise<object>} The recorded trade, including the quote fields plus `tradeId`, `traderId`, and `timestamp`
 * @throws {Error} If the pool is unknown, the quote is invalid, or price impact exceeds `maxSlippageBps`
 */
export async function executeSwap({ poolId, inputAsset, amountIn, traderId = 'system', maxSlippageBps = riskConfig.maxSlippageBps }) {
  const { result } = await mutatePool(poolId, async (pool, tx) => {
    const quote = computeQuote(pool, inputAsset, amountIn);
    if (quote.priceImpact * 10000 > maxSlippageBps) {
      throw new Error('Slippage exceeds configured threshold');
    }

    const fromAtoB = quote.inputAsset === pool.assetA;
    const reserveA = fromAtoB ? pool.reserveA + quote.amountIn : pool.reserveA - quote.amountOut;
    const reserveB = fromAtoB ? pool.reserveB - quote.amountOut : pool.reserveB + quote.amountIn;

    const row = await tx.ammTrade.create({
      data: {
        tradeId: `trade_${randomUUID()}`,
        poolId,
        traderId,
        inputAsset: quote.inputAsset,
        outputAsset: quote.outputAsset,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        feePaid: quote.feePaid.toString(),
        priceImpact: quote.priceImpact.toString(),
      },
    });

    return { reserveA, reserveB, result: toTrade(row) };
  });
  return result;
}

/**
 * Run a simple automated trading strategy against a pool based on recent market prices.
 * @param {object} opts
 * @param {'momentum'|'mean-reversion'} [opts.strategy='momentum'] - Strategy to apply
 * @param {string} opts.poolId - Pool id to trade against
 * @param {number[]} [opts.marketPrices=[]] - Recent external market prices, oldest first; at least 2 required to act
 * @returns {Promise<object>} The executed trade (see {@link executeSwap}), or `{strategy, action: 'hold', ...}` if no trade was made
 * @throws {Error} If the pool is unknown
 */
export async function runAutomatedStrategy({ strategy = 'momentum', poolId, marketPrices = [] }) {
  const pool = await getPool(poolId);
  if (marketPrices.length < 2) {
    return { strategy, action: 'hold', reason: 'insufficient_market_data' };
  }

  const currentPrice = pool.reserveB / pool.reserveA;
  const lastPrice = marketPrices[marketPrices.length - 1];
  const previousPrice = marketPrices[marketPrices.length - 2];
  const trend = lastPrice - previousPrice;

  if (strategy === 'momentum' && trend > 0) {
    return executeSwap({
      poolId,
      inputAsset: pool.assetA,
      amountIn: Math.min(50, pool.reserveA * 0.01),
      traderId: 'bot_momentum',
    });
  }

  if (strategy === 'mean-reversion' && lastPrice > currentPrice * 1.05) {
    return executeSwap({
      poolId,
      inputAsset: pool.assetB,
      amountIn: Math.min(50, pool.reserveB * 0.01),
      traderId: 'bot_mean_reversion',
    });
  }

  return { strategy, action: 'hold', trend };
}

/**
 * Find arbitrage spread between pools quoting the same asset pair.
 * @param {[string, string]} targetPair - Two asset codes making up the pair to check
 * @returns {Promise<Array<{buyPool: string, sellPool: string, spread: number, spreadPct: number}>>} A single-element array with the best opportunity, or `[]` if fewer than 2 matching pools exist or there's no positive spread
 */
export async function detectArbitrageOpportunities(targetPair) {
  const [assetA, assetB] = targetPair.map(normalizeAsset);
  const rows = await prisma.ammPool.findMany({
    where: {
      OR: [
        { assetA, assetB },
        { assetA: assetB, assetB: assetA },
      ],
    },
  });
  const matching = rows.map(toPool).map(pool => ({
    poolId: pool.poolId,
    price: pool.reserveB / pool.reserveA,
  }));

  if (matching.length < 2) return [];
  let min = matching[0];
  let max = matching[0];
  for (const quote of matching) {
    if (quote.price < min.price) min = quote;
    if (quote.price > max.price) max = quote;
  }
  const spread = max.price - min.price;
  if (spread <= 0) return [];

  return [{
    buyPool: min.poolId,
    sellPool: max.poolId,
    spread,
    spreadPct: spread / min.price,
  }];
}

/**
 * Deposit liquidity into a pool on behalf of a provider, split between assets by `targetWeightA`.
 * @param {object} opts
 * @param {string} opts.providerId - Identifier for the liquidity provider
 * @param {string} opts.poolId - Pool id to deposit into
 * @param {number} [opts.targetWeightA=0.5] - Fraction of `capital` (0-1) allocated to `assetA`; the remainder is converted to `assetB` at the pool's current price
 * @param {number} [opts.capital=1000] - Total capital to deposit, denominated in `assetA` units
 * @returns {Promise<{providerId: string, poolId: string, shares: number, depositedA: number, depositedB: number, timestamp: string}>} The liquidity position
 * @throws {Error} If the pool is unknown
 */
export async function automateLiquidityProvision({ providerId, poolId, targetWeightA = 0.5, capital = 1000 }) {
  const { result } = await mutatePool(poolId, async (pool, tx) => {
    const amountA = capital * targetWeightA;
    const amountB = capital * (1 - targetWeightA) * (pool.reserveB / pool.reserveA);
    const shares = Math.sqrt(amountA * amountB);

    const row = await tx.ammPosition.upsert({
      where: { providerId_poolId: { providerId, poolId } },
      create: {
        providerId,
        poolId,
        shares: shares.toString(),
        depositedA: amountA.toString(),
        depositedB: amountB.toString(),
      },
      update: {
        shares: { increment: shares.toString() },
        depositedA: { increment: amountA.toString() },
        depositedB: { increment: amountB.toString() },
      },
    });

    return {
      reserveA: pool.reserveA + amountA,
      reserveB: pool.reserveB + amountB,
      result: toPosition(row),
    };
  });
  return result;
}

/**
 * Project annualized yield for an existing liquidity position.
 * @param {object} opts
 * @param {string} opts.providerId - Liquidity provider identifier
 * @param {string} opts.poolId - Pool id the position belongs to
 * @param {number} [opts.rewardRateAnnual=0.12] - Assumed annual reward rate (as a fraction, e.g. 0.12 = 12%)
 * @param {number} [opts.feeShare=0.01] - Assumed annual fee income rate (as a fraction of principal)
 * @returns {Promise<{providerId: string, poolId: string, principal: number, expectedReward: number, feeIncome: number, projectedApy: number}>} Yield projection
 * @throws {Error} If no liquidity position exists for `providerId`/`poolId`
 */
export async function estimateYieldFarming({ providerId, poolId, rewardRateAnnual = 0.12, feeShare = 0.01 }) {
  const row = await prisma.ammPosition.findUnique({
    where: { providerId_poolId: { providerId, poolId } },
  });
  if (!row) throw new Error('No liquidity position found');
  const position = toPosition(row);

  const principal = position.depositedA + position.depositedB;
  const expectedReward = principal * rewardRateAnnual;
  const feeIncome = principal * feeShare;
  const projectedApy = (expectedReward + feeIncome) / principal;

  return {
    providerId,
    poolId,
    principal,
    expectedReward,
    feeIncome,
    projectedApy,
  };
}

/**
 * Get aggregate AMM analytics across all pools and recorded trades.
 * @returns {Promise<{pools: number, positions: number, trades: number, totalVolume: number, totalFees: number, avgTradeSize: number}>} Analytics snapshot
 */
export async function getAMMAnalytics() {
  const [poolCount, positionCount, tradeAgg] = await Promise.all([
    prisma.ammPool.count(),
    prisma.ammPosition.count(),
    prisma.ammTrade.aggregate({
      _count: { _all: true },
      _sum: { amountIn: true, feePaid: true },
    }),
  ]);
  const tradeCount = tradeAgg._count._all;
  const volume = Number(tradeAgg._sum.amountIn ?? 0);
  const fees = Number(tradeAgg._sum.feePaid ?? 0);
  return {
    pools: poolCount,
    positions: positionCount,
    trades: tradeCount,
    totalVolume: volume,
    totalFees: fees,
    avgTradeSize: tradeCount === 0 ? 0 : volume / tradeCount,
  };
}

/**
 * Check aggregate per-asset exposure across all pools against `riskConfig.maxExposurePerAsset`.
 * @returns {Promise<{exposure: Object<string, number>, breaches: Array<{asset: string, amount: number, limit: number}>, healthy: boolean}>} Exposure totals and any threshold breaches
 */
export async function runRiskChecks() {
  const exposure = {};
  for (const pool of await listPools()) {
    exposure[pool.assetA] = (exposure[pool.assetA] || 0) + pool.reserveA;
    exposure[pool.assetB] = (exposure[pool.assetB] || 0) + pool.reserveB;
  }

  const breaches = Object.entries(exposure)
    .filter(([, amount]) => amount > riskConfig.maxExposurePerAsset)
    .map(([asset, amount]) => ({ asset, amount, limit: riskConfig.maxExposurePerAsset }));

  return {
    exposure,
    breaches,
    healthy: breaches.length === 0,
  };
}

/**
 * Produce an operational summary (hot pools, batchable trade count, rebalance
 * suggestions) that can feed monitoring/ops automation.
 * @returns {Promise<{cacheHotPools: string[], batchableTrades: number, suggestedRebalance: Array<{poolId: string, action: string}>}>} Optimization summary
 */
export async function optimizeAMMPerformance() {
  const [pools, tradeCount] = await Promise.all([listPools(), prisma.ammTrade.count()]);
  return {
    cacheHotPools: [...pools]
      .sort((a, b) => (b.reserveA + b.reserveB) - (a.reserveA + a.reserveB))
      .slice(0, 5)
      .map(pool => pool.poolId),
    batchableTrades: Math.max(0, Math.floor(tradeCount / 10)),
    suggestedRebalance: pools
      .filter(pool => {
        const ratio = pool.reserveA / pool.reserveB;
        return ratio > 1.3 || ratio < 0.7;
      })
      .map(pool => ({ poolId: pool.poolId, action: 'rebalance' })),
  };
}

/**
 * List all registered pools with their derived mid-price and liquidity.
 * @returns {Promise<object[]>} All pool records, each augmented with `midPrice` and `liquidity`
 */
export async function getAllPools() {
  return (await listPools()).map(withDerived);
}

/**
 * Clear all pools, positions, and trade history, plus local/Redis caches (useful in tests).
 * @returns {Promise<void>}
 */
export function resetAMMState() {
  pools.clear();
  positions.clear();
  trades.length = 0;
}

// ── ISSUE-050: Fee-aware arbitrage calculation ────────────────────────────────

/**
 * Default minimum profitability thresholds for arbitrage opportunities.
 * Both conditions must be met for `isProfitable` to be `true`.
 */
const ARBITRAGE_MIN_PROFIT_USD = 0.50;
const ARBITRAGE_MIN_ROI_PCT    = 0.2;    // 0.2%

/**
 * Pool swap fee in basis points (Stellar AMM constant = 30 bps = 0.3%).
 */
const POOL_FEE_BPS = 30;

/**
 * Evaluate an arbitrage opportunity between two pools that trade the same pair,
 * incorporating all on-chain costs to produce an accurate net-profit figure.
 *
 * Costs deducted from gross profit:
 *   1. AMM pool swap fee: `POOL_FEE_BPS / 10 000` of the input amount (applied
 *      to each swap leg, so twice for a round-trip arb).
 *   2. Horizon base fee: `baseFeeStroops * operationsCount` stroops, converted
 *      to asset value using `xlmExchangeRate`.
 *
 * The function also returns `isProfitable` which is `true` only when:
 *   - `netProfit > ARBITRAGE_MIN_PROFIT_USD`   AND
 *   - `netProfit / inputAmount > ARBITRAGE_MIN_ROI_PCT / 100`
 *
 * @param {object} opts
 * @param {string}  opts.buyPoolId       - Pool ID to buy from (lower price pool)
 * @param {string}  opts.sellPoolId      - Pool ID to sell into (higher price pool)
 * @param {string}  opts.inputAsset      - Asset code to start with
 * @param {number}  opts.inputAmount     - Amount of `inputAsset` to trade
 * @param {number}  [opts.baseFeeStroops=100]    - Horizon base fee per operation in stroops
 * @param {number}  [opts.operationsCount=2]     - Number of on-chain operations (swap legs)
 * @param {number}  [opts.xlmExchangeRate=0.12]  - XLM price in USD (used to value the network fee)
 * @param {number}  [opts.minProfitUsd=ARBITRAGE_MIN_PROFIT_USD]   - Minimum net profit threshold in USD
 * @param {number}  [opts.minRoiPct=ARBITRAGE_MIN_ROI_PCT]         - Minimum ROI threshold (percentage)
 * @returns {{
 *   buyPoolId: string,
 *   sellPoolId: string,
 *   inputAsset: string,
 *   inputAmount: number,
 *   grossProfit: number,
 *   poolFee: number,
 *   networkFeeUsd: number,
 *   totalFees: number,
 *   netProfit: number,
 *   roiPct: number,
 *   isProfitable: boolean,
 * }}
 * @throws {Error} If either pool is unknown or `inputAmount` is non-positive
 */
export function calculateArbitrage({
  buyPoolId,
  sellPoolId,
  inputAsset,
  inputAmount,
  baseFeeStroops = 100,
  operationsCount = 2,
  xlmExchangeRate = 0.12,
  minProfitUsd = ARBITRAGE_MIN_PROFIT_USD,
  minRoiPct = ARBITRAGE_MIN_ROI_PCT,
}) {
  if (!buyPoolId || !sellPoolId || !inputAsset || !inputAmount) {
    throw new Error('buyPoolId, sellPoolId, inputAsset and inputAmount are required');
  }
  if (Number(inputAmount) <= 0) {
    throw new Error('inputAmount must be positive');
  }

  // Step 1: Quote the buy leg (inputAsset → outputAsset) on the cheaper pool.
  const buyQuote  = quoteSwap(buyPoolId,  inputAsset, inputAmount);

  // Step 2: Quote the sell leg (outputAsset → inputAsset) on the dearer pool.
  const sellQuote = quoteSwap(sellPoolId, buyQuote.outputAsset, buyQuote.amountOut);

  // Gross profit = final output minus original input, denominated in inputAsset.
  const grossProfit = sellQuote.amountOut - Number(inputAmount);

  // Step 3: Deduct AMM pool swap fees (both legs already have the fee baked in
  //         via quoteSwap's feeMultiplier, but we surface them explicitly here
  //         so callers see a clear breakdown).
  const poolFeeRate = POOL_FEE_BPS / 10_000;
  const poolFee =
    Number(inputAmount) * poolFeeRate +
    buyQuote.amountOut   * poolFeeRate;

  // Step 4: Deduct estimated Horizon network fees.
  //   baseFeeStroops per operation, converted from stroops → XLM → USD.
  const networkFeeXlm = (baseFeeStroops * operationsCount) / 10_000_000;
  const networkFeeUsd = networkFeeXlm * xlmExchangeRate;

  const totalFees = poolFee + networkFeeUsd;
  const netProfit = grossProfit - totalFees;
  const roiPct    = (netProfit / Number(inputAmount)) * 100;

  const isProfitable =
    netProfit  > minProfitUsd &&
    roiPct     > minRoiPct;

  return {
    buyPoolId,
    sellPoolId,
    inputAsset,
    inputAmount: Number(inputAmount),
    grossProfit,
    poolFee,
    networkFeeUsd,
    totalFees,
    netProfit,
    roiPct,
    isProfitable,
  };
}
export async function resetAMMState() {
  const pools = await prisma.ammPool.findMany({ select: { poolId: true } });
  await prisma.$transaction([
    prisma.ammTrade.deleteMany({}),
    prisma.ammPosition.deleteMany({}),
    prisma.ammPool.deleteMany({}),
  ]);
  localPoolCache.clear();
  await ensureRedis();
  if (redisReady(publisher) && pools.length > 0) {
    try {
      await publisher.del(...pools.map(p => `${POOL_CACHE_PREFIX}${p.poolId}`));
    } catch { /* ignore */ }
  }
}

/**
 * Close the Redis connections used for pool caching / Pub/Sub (graceful shutdown).
 * @returns {Promise<void>}
 */
export async function closeAMMState() {
  const clients = [publisher, subscriber].filter(Boolean);
  publisher = null;
  subscriber = null;
  redisInit = null;
  await Promise.all(clients.map(c => c.quit().catch(() => {})));
}
