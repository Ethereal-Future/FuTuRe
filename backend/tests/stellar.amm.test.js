import { beforeEach, describe, expect, it } from 'vitest';
import {
  automateLiquidityProvision,
  detectArbitrageOpportunities,
  estimateYieldFarming,
  executeSwap,
  getAMMAnalytics,
  getPoolState,
  optimizeAMMPerformance,
  registerPool,
  resetAMMState,
  runAutomatedStrategy,
  runRiskChecks,
} from '../src/services/amm.js';

describe('Stellar AMM service', () => {
  beforeEach(() => {
    resetAMMState();
  });

  it('supports AMM pool interactions', () => {
    registerPool({ poolId: 'pool-1', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 10000 });
    const state = getPoolState('pool-1');
    expect(state.midPrice).toBe(1);
  });

  it('runs automated trading strategies', () => {
    registerPool({ poolId: 'pool-1', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 10000 });
    const result = runAutomatedStrategy({
      strategy: 'momentum',
      poolId: 'pool-1',
      marketPrices: [1.0, 1.05],
    });
    expect(result.tradeId || result.action).toBeTruthy();
  });

  it('detects arbitrage opportunities across pools', () => {
    registerPool({ poolId: 'pool-a', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 9000 });
    registerPool({ poolId: 'pool-b', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 11000 });
    const opportunities = detectArbitrageOpportunities(['XLM', 'USDC']);
    expect(opportunities.length).toBe(1);
    expect(opportunities[0].spread).toBeGreaterThan(0);
  });

  it('automates liquidity provision and yield estimation', () => {
    registerPool({ poolId: 'pool-1', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 10000 });
    const position = automateLiquidityProvision({ providerId: 'lp-1', poolId: 'pool-1', capital: 5000, targetWeightA: 0.5 });
    expect(position.shares).toBeGreaterThan(0);

    const yieldProjection = estimateYieldFarming({ providerId: 'lp-1', poolId: 'pool-1' });
    expect(yieldProjection.projectedApy).toBeGreaterThan(0);
  });

  it('generates AMM analytics and risk checks', () => {
    registerPool({ poolId: 'pool-1', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 10000 });
    executeSwap({ poolId: 'pool-1', inputAsset: 'XLM', amountIn: 100, traderId: 'bot-1' });

    const analytics = getAMMAnalytics();
    expect(analytics.trades).toBe(1);

    const risk = runRiskChecks();
    expect(typeof risk.healthy).toBe('boolean');
  });

  it('returns AMM performance optimization hints', () => {
    registerPool({ poolId: 'pool-1', assetA: 'XLM', assetB: 'USDC', reserveA: 10000, reserveB: 6000 });
    const optimization = optimizeAMMPerformance();
    expect(Array.isArray(optimization.cacheHotPools)).toBe(true);
    expect(Array.isArray(optimization.suggestedRebalance)).toBe(true);
  });
});