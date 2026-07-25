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

export function getPoolState(poolId) {
  const pool = getPool(poolId);
  return {
    ...pool,
    midPrice: pool.reserveB / pool.reserveA,
    liquidity: Math.sqrt(pool.reserveA * pool.reserveB),
  };
}

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

export function getAllPools() {
  return Array.from(pools.values()).map(pool => ({
    ...pool,
    midPrice: pool.reserveB / pool.reserveA,
    liquidity: Math.sqrt(pool.reserveA * pool.reserveB),
  }));
}

export function resetAMMState() {
  pools.clear();
  positions.clear();
  trades.length = 0;
}