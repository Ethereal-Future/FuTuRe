const pools = new Map();
const positions = new Map();
const trades = [];

const riskConfig = {
  maxExposurePerAsset: 100000,
  maxSlippageBps: 150,
  minReserveRatio: 0.05,
};

function normalizeAsset(asset) {
  return String(asset || '').toUpperCase();
}

function getPool(poolId) {
  const pool = pools.get(poolId);
  if (!pool) throw new Error(`Unknown pool: ${poolId}`);
  return pool;
}

function getK(pool) {
  return pool.reserveA * pool.reserveB;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Register a new in-memory constant-product (x*y=k) AMM pool.
 * @param {object} opts
 * @param {string} opts.poolId - Unique id for the pool
 * @param {string} opts.assetA - First asset code
 * @param {string} opts.assetB - Second asset code
 * @param {number} opts.reserveA - Initial reserve of `assetA` (must be > 0)
 * @param {number} opts.reserveB - Initial reserve of `assetB` (must be > 0)
 * @param {number} [opts.feeBps=30] - Swap fee in basis points
 * @returns {object} The created pool record
 * @throws {Error} If `poolId` is missing or either reserve is non-positive
 */
export function registerPool({ poolId, assetA, assetB, reserveA, reserveB, feeBps = 30 }) {
  if (!poolId || reserveA <= 0 || reserveB <= 0) {
    throw new Error('poolId, reserveA and reserveB are required');
  }

  const pool = {
    poolId,
    assetA: normalizeAsset(assetA),
    assetB: normalizeAsset(assetB),
    reserveA: Number(reserveA),
    reserveB: Number(reserveB),
    feeBps: Number(feeBps),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  pools.set(poolId, pool);
  return pool;
}

/**
 * Get a pool's current state, including derived mid-price and liquidity.
 * @param {string} poolId - Pool id
 * @returns {object} Pool record plus `midPrice` (reserveB/reserveA) and `liquidity` (sqrt(reserveA*reserveB))
 * @throws {Error} If the pool is unknown
 */
export function getPoolState(poolId) {
  const pool = getPool(poolId);
  return {
    ...pool,
    midPrice: pool.reserveB / pool.reserveA,
    liquidity: Math.sqrt(pool.reserveA * pool.reserveB),
  };
}

/**
 * Quote the output amount for a swap, without executing it, using the constant-product formula.
 * @param {string} poolId - Pool id
 * @param {string} inputAsset - Asset code being swapped in (must belong to the pool)
 * @param {number|string} amountIn - Amount of `inputAsset` to swap
 * @returns {{poolId: string, inputAsset: string, outputAsset: string, amountIn: number, amountOut: number, feePaid: number, priceImpact: number}} Swap quote
 * @throws {Error} If the pool is unknown, `amountIn` is non-positive, or `inputAsset` doesn't belong to the pool
 */
export function quoteSwap(poolId, inputAsset, amountIn) {
  const pool = getPool(poolId);
  const inAsset = normalizeAsset(inputAsset);
  const amount = Number(amountIn);
  if (amount <= 0) throw new Error('amountIn must be positive');

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
    poolId,
    inputAsset: inAsset,
    outputAsset: fromAtoB ? pool.assetB : pool.assetA,
    amountIn: amount,
    amountOut: output,
    feePaid: amount - effectiveIn,
    priceImpact,
  };
}

/**
 * Execute a swap against a pool, updating its reserves and recording the trade.
 * @param {object} opts
 * @param {string} opts.poolId - Pool id
 * @param {string} opts.inputAsset - Asset code being swapped in
 * @param {number|string} opts.amountIn - Amount of `inputAsset` to swap
 * @param {string} [opts.traderId='system'] - Identifier recorded with the trade
 * @param {number} [opts.maxSlippageBps=riskConfig.maxSlippageBps] - Max acceptable price impact, in basis points
 * @returns {object} The recorded trade, including the quote fields plus `tradeId`, `traderId`, and `timestamp`
 * @throws {Error} If the pool is unknown, the quote is invalid, or price impact exceeds `maxSlippageBps`
 */
export function executeSwap({ poolId, inputAsset, amountIn, traderId = 'system', maxSlippageBps = riskConfig.maxSlippageBps }) {
  const pool = getPool(poolId);
  const quote = quoteSwap(poolId, inputAsset, amountIn);
  if (quote.priceImpact * 10000 > maxSlippageBps) {
    throw new Error('Slippage exceeds configured threshold');
  }

  if (quote.inputAsset === pool.assetA) {
    pool.reserveA += quote.amountIn;
    pool.reserveB -= quote.amountOut;
  } else {
    pool.reserveB += quote.amountIn;
    pool.reserveA -= quote.amountOut;
  }
  pool.updatedAt = nowIso();

  const trade = {
    tradeId: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    traderId,
    ...quote,
    timestamp: nowIso(),
  };
  trades.push(trade);
  return trade;
}

/**
 * Run a simple automated trading strategy against a pool based on recent market prices.
 * @param {object} opts
 * @param {'momentum'|'mean-reversion'} [opts.strategy='momentum'] - Strategy to apply
 * @param {string} opts.poolId - Pool id to trade against
 * @param {number[]} [opts.marketPrices=[]] - Recent external market prices, oldest first; at least 2 required to act
 * @returns {object} The executed trade (see {@link executeSwap}), or `{strategy, action: 'hold', ...}` if no trade was made
 * @throws {Error} If the pool is unknown
 */
export function runAutomatedStrategy({ strategy = 'momentum', poolId, marketPrices = [] }) {
  const pool = getPool(poolId);
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
 * @returns {Array<{buyPool: string, sellPool: string, spread: number, spreadPct: number}>} A single-element array with the best opportunity, or `[]` if fewer than 2 matching pools exist or there's no positive spread
 */
export function detectArbitrageOpportunities(targetPair) {
  const [assetA, assetB] = targetPair.map(normalizeAsset);
  const matching = Array.from(pools.values())
    .filter(pool => {
      const pair = [pool.assetA, pool.assetB].sort().join(':');
      return pair === [assetA, assetB].sort().join(':');
    })
    .map(pool => ({
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
 * @returns {{providerId: string, poolId: string, shares: number, depositedA: number, depositedB: number, timestamp: string}} The created liquidity position
 * @throws {Error} If the pool is unknown
 */
export function automateLiquidityProvision({ providerId, poolId, targetWeightA = 0.5, capital = 1000 }) {
  const pool = getPool(poolId);
  const amountA = capital * targetWeightA;
  const amountB = capital * (1 - targetWeightA) * (pool.reserveB / pool.reserveA);

  pool.reserveA += amountA;
  pool.reserveB += amountB;
  pool.updatedAt = nowIso();

  const position = {
    providerId,
    poolId,
    shares: Math.sqrt(amountA * amountB),
    depositedA: amountA,
    depositedB: amountB,
    timestamp: nowIso(),
  };

  const key = `${providerId}:${poolId}`;
  positions.set(key, position);
  return position;
}

/**
 * Project annualized yield for an existing liquidity position.
 * @param {object} opts
 * @param {string} opts.providerId - Liquidity provider identifier
 * @param {string} opts.poolId - Pool id the position belongs to
 * @param {number} [opts.rewardRateAnnual=0.12] - Assumed annual reward rate (as a fraction, e.g. 0.12 = 12%)
 * @param {number} [opts.feeShare=0.01] - Assumed annual fee income rate (as a fraction of principal)
 * @returns {{providerId: string, poolId: string, principal: number, expectedReward: number, feeIncome: number, projectedApy: number}} Yield projection
 * @throws {Error} If no liquidity position exists for `providerId`/`poolId`
 */
export function estimateYieldFarming({ providerId, poolId, rewardRateAnnual = 0.12, feeShare = 0.01 }) {
  const key = `${providerId}:${poolId}`;
  const position = positions.get(key);
  if (!position) throw new Error('No liquidity position found');

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
 * @returns {{pools: number, positions: number, trades: number, totalVolume: number, totalFees: number, avgTradeSize: number}} Analytics snapshot
 */
export function getAMMAnalytics() {
  const volume = trades.reduce((sum, trade) => sum + trade.amountIn, 0);
  const fees = trades.reduce((sum, trade) => sum + trade.feePaid, 0);
  return {
    pools: pools.size,
    positions: positions.size,
    trades: trades.length,
    totalVolume: volume,
    totalFees: fees,
    avgTradeSize: trades.length === 0 ? 0 : volume / trades.length,
  };
}

/**
 * Check aggregate per-asset exposure across all pools against `riskConfig.maxExposurePerAsset`.
 * @returns {{exposure: Object<string, number>, breaches: Array<{asset: string, amount: number, limit: number}>, healthy: boolean}} Exposure totals and any threshold breaches
 */
export function runRiskChecks() {
  const exposure = {};
  for (const pool of pools.values()) {
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
 * @returns {{cacheHotPools: string[], batchableTrades: number, suggestedRebalance: Array<{poolId: string, action: string}>}} Optimization summary
 */
export function optimizeAMMPerformance() {
  // Optimization summary that can feed into monitoring/ops automation.
  return {
    cacheHotPools: Array.from(pools.values())
      .sort((a, b) => (b.reserveA + b.reserveB) - (a.reserveA + a.reserveB))
      .slice(0, 5)
      .map(pool => pool.poolId),
    batchableTrades: Math.max(0, Math.floor(trades.length / 10)),
    suggestedRebalance: Array.from(pools.values())
      .filter(pool => {
        const ratio = pool.reserveA / pool.reserveB;
        return ratio > 1.3 || ratio < 0.7;
      })
      .map(pool => ({ poolId: pool.poolId, action: 'rebalance' })),
  };
}

/**
 * List all registered pools with their derived mid-price and liquidity.
 * @returns {object[]} All pool records, each augmented with `midPrice` and `liquidity`
 */
export function getAllPools() {
  return Array.from(pools.values()).map(pool => ({
    ...pool,
    midPrice: pool.reserveB / pool.reserveA,
    liquidity: Math.sqrt(pool.reserveA * pool.reserveB),
  }));
}

/**
 * Clear all pools, positions, and trade history (useful in tests).
 * @returns {void}
 */
export function resetAMMState() {
  pools.clear();
  positions.clear();
  trades.length = 0;
}