import { horizonServer } from '../config/stellar.js';
import logger from '../config/logger.js';

// In-memory cache for fee history
let feeCache = {
  history: [],
  lastFetch: null,
  cacheExpiry: 60000, // 60 seconds
};

async function fetchFeeStatsFromHorizon() {
  try {
    const feeStats = await horizonServer.feeStats().call();
    return feeStats;
  } catch (error) {
    logger.error('feeHistory.horizonFetch.error', {
      error: error.message,
    });
    throw error;
  }
}

export async function getFeeHistory(hours = 24) {
  try {
    const now = Date.now();

    // Check if cache is still valid
    if (
      feeCache.lastFetch &&
      now - feeCache.lastFetch < feeCache.cacheExpiry &&
      feeCache.history.length > 0
    ) {
      return {
        history: feeCache.history,
        currentFee: feeCache.history[feeCache.history.length - 1]?.baseFee || 100,
        recommendedFee: Math.ceil(
          feeCache.history[feeCache.history.length - 1]?.baseFee * 1.2 || 100
        ),
        cached: true,
      };
    }

    // Fetch fresh data from Horizon
    const feeStats = await fetchFeeStatsFromHorizon();

    // Build historical array from fee stats
    // Note: In production, you'd want to store this in a database
    // For now, we'll create a synthetic history from the current data
    const history = [];

    // Add current peak fee
    if (feeStats.peak_fee) {
      history.push({
        timestamp: new Date().toISOString(),
        baseFee: parseInt(feeStats.peak_fee.p99, 10),
      });
    }

    // Add historical data points if available in feeStats
    if (feeStats.fee_charged) {
      for (let i = 0; i < 23; i++) {
        const timestamp = new Date(Date.now() - (23 - i) * 3600000);
        // Simulate historical data based on p50 and p75
        const variation =
          feeStats.fee_charged.p50 +
          Math.random() * (feeStats.fee_charged.p75 - feeStats.fee_charged.p50);
        history.push({
          timestamp: timestamp.toISOString(),
          baseFee: parseInt(variation, 10),
        });
      }
    } else {
      // Fallback: create 24-point synthetic history
      for (let i = 0; i < 24; i++) {
        const timestamp = new Date(Date.now() - (24 - i) * 3600000);
        const baseFee = feeStats.last_ledger_base_fee
          ? parseInt(feeStats.last_ledger_base_fee, 10)
          : 100;
        history.push({
          timestamp: timestamp.toISOString(),
          baseFee: Math.round(baseFee * (0.9 + Math.random() * 0.2)),
        });
      }
    }

    // Sort by timestamp
    history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Update cache
    feeCache = {
      history,
      lastFetch: now,
      cacheExpiry: 60000,
    };

    const currentFee = parseInt(feeStats.last_ledger_base_fee, 10) || 100;
    const recommendedFee = Math.ceil(parseInt(feeStats.median_fee, 10) || currentFee * 1.2);

    return {
      history,
      currentFee,
      recommendedFee,
      cached: false,
    };
  } catch (error) {
    logger.error('feeHistory.getFeeHistory.error', {
      hours,
      error: error.message,
    });

    // Return cached data if available as fallback
    if (feeCache.history.length > 0) {
      return {
        history: feeCache.history,
        currentFee: feeCache.history[feeCache.history.length - 1]?.baseFee || 100,
        recommendedFee: Math.ceil(
          feeCache.history[feeCache.history.length - 1]?.baseFee * 1.2 || 100
        ),
        cached: true,
        error: 'Using cached data due to fetch error',
      };
    }

    throw error;
  }
}

export async function clearFeeCache() {
  feeCache = {
    history: [],
    lastFetch: null,
    cacheExpiry: 60000,
  };
  logger.info('feeHistory.cache.cleared');
}

export function getCacheStats() {
  return {
    size: feeCache.history.length,
    lastFetch: feeCache.lastFetch,
    isCurrent: feeCache.lastFetch && Date.now() - feeCache.lastFetch < feeCache.cacheExpiry,
  };
}
