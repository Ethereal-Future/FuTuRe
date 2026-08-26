/**
 * Property-based tests for AMM (Automated Market Maker) services.
 *
 * Tests the invariants of constant product pricing, output bounds,
 * and round-trip conversion behavior under various market conditions.
 *
 * Run with: npm run test:property
 */

import * as fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import * as amm from '../backend/src/services/amm.js';

describe('AMM Property Tests', () => {
  beforeEach(() => {
    amm.resetAMMState();
  });

  // Arbitrary generators
  const poolId = () => fc.string({ minLength: 1, maxLength: 32 });
  const assetCode = () => fc.stringMatching(/^[A-Z]{3,12}$/);
  const positiveAmount = () => fc.integer({ min: 1, max: 1_000_000 });
  const feeBps = () => fc.integer({ min: 0, max: 300 });

  describe('Invariant: swap output never exceeds pool reserves', () => {
    it('should never return amountOut > reserveOut for any valid swap', () => {
      fc.assert(
        fc.property(
          poolId(),
          assetCode(),
          assetCode(),
          positiveAmount(),
          positiveAmount(),
          positiveAmount(),
          feeBps(),
          (id, assetA, assetB, reserveA, reserveB, amountIn, fees) => {
            fc.pre(assetA !== assetB);
            fc.pre(amountIn <= reserveA / 2); // Keep swap reasonable

            const pool = amm.registerPool({ poolId: id, assetA, assetB, reserveA, reserveB, feeBps: fees });
            const quote = amm.quoteSwap(id, assetA, amountIn);

            expect(quote.amountOut).toBeGreaterThan(0);
            expect(quote.amountOut).toBeLessThanOrEqual(reserveB);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should decrease output as price impact increases', () => {
      fc.assert(
        fc.property(
          poolId(),
          assetCode(),
          assetCode(),
          fc.integer({ min: 10000, max: 100000 }),
          fc.integer({ min: 10000, max: 100000 }),
          fc.tuple(fc.integer({ min: 100, max: 5000 }), fc.integer({ min: 5001, max: 10000 })),
          (id, assetA, assetB, reserveA, reserveB, [smallIn, largeIn]) => {
            fc.pre(assetA !== assetB);

            const pool = amm.registerPool({ poolId: id, assetA, assetB, reserveA, reserveB });
            const smallQuote = amm.quoteSwap(id, assetA, smallIn);
            const largeQuote = amm.quoteSwap(id, assetA, largeIn);

            expect(largeQuote.amountOut).toBeLessThan(smallQuote.amountOut);
            expect(largeQuote.priceImpact).toBeGreaterThan(smallQuote.priceImpact);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: constant product formula holds (k = reserveA * reserveB)', () => {
    it('should maintain approximate k before/after swap', () => {
      fc.assert(
        fc.property(
          poolId(),
          assetCode(),
          assetCode(),
          fc.integer({ min: 1000, max: 100000 }),
          fc.integer({ min: 1000, max: 100000 }),
          fc.integer({ min: 100, max: 5000 }),
          (id, assetA, assetB, reserveA, reserveB, amountIn) => {
            fc.pre(assetA !== assetB);

            const pool = amm.registerPool({ poolId: id, assetA, assetB, reserveA, reserveB, feeBps: 30 });
            const kBefore = pool.reserveA * pool.reserveB;

            const trade = amm.executeSwap({ poolId: id, inputAsset: assetA, amountIn, maxSlippageBps: 500 });

            // After swap, k should increase due to fees
            const poolAfter = amm.getPoolState(id);
            const kAfter = poolAfter.reserveA * poolAfter.reserveB;

            expect(kAfter).toBeGreaterThanOrEqual(kBefore);
            expect(kAfter / kBefore).toBeLessThan(1.01); // k grows but not drastically
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: fee paid is always positive and non-zero', () => {
    it('should charge positive fees for all non-zero input amounts', () => {
      fc.assert(
        fc.property(
          poolId(),
          assetCode(),
          assetCode(),
          fc.integer({ min: 100, max: 100000 }),
          fc.integer({ min: 100, max: 100000 }),
          fc.integer({ min: 1, max: 300 }),
          (id, assetA, assetB, reserveA, reserveB, fees) => {
            fc.pre(assetA !== assetB);

            amm.registerPool({ poolId: id, assetA, assetB, reserveA, reserveB, feeBps: fees });
            const quote = amm.quoteSwap(id, assetA, 1000);

            expect(quote.feePaid).toBeGreaterThan(0);
            expect(quote.feePaid).toBeLessThanOrEqual(quote.amountIn);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: liquidity shares increase with capital deposit', () => {
    it('should allocate more shares for larger capital deposits', () => {
      fc.assert(
        fc.property(
          poolId(),
          assetCode(),
          assetCode(),
          fc.integer({ min: 1000, max: 100000 }),
          fc.integer({ min: 1000, max: 100000 }),
          fc.tuple(fc.integer({ min: 100, max: 1000 }), fc.integer({ min: 1001, max: 5000 })),
          (id, assetA, assetB, reserveA, reserveB, [smallCap, largeCap]) => {
            fc.pre(assetA !== assetB);

            amm.resetAMMState();
            const poolId1 = `${id}-1`;
            const poolId2 = `${id}-2`;
            amm.registerPool({ poolId: poolId1, assetA, assetB, reserveA, reserveB });
            amm.registerPool({ poolId: poolId2, assetA, assetB, reserveA, reserveB });

            const pos1 = amm.automateLiquidityProvision({
              providerId: 'p1',
              poolId: poolId1,
              capital: smallCap,
            });
            const pos2 = amm.automateLiquidityProvision({
              providerId: 'p2',
              poolId: poolId2,
              capital: largeCap,
            });

            expect(pos2.shares).toBeGreaterThan(pos1.shares);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
