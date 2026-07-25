import express from 'express';
import * as StellarService from '../../services/stellar.js';
import { getRate, getAllRates, convert } from '../../services/exchangeRate.js';
import { validate, rules } from '../../middleware/validate.js';
import { cacheMiddleware } from '../../middleware/cache.js';
import { keys as cacheKeys, TTL } from '../../cache/appCache.js';
import logger from '../../config/logger.js';

const router = express.Router({ mergeParams: true });

function logError(req, error, context = {}) {
  logger.error('route.error', {
    requestId: req.id,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    ...context,
    error: error.message,
    stack: error.stack,
  });
}

// GET /fee-stats
router.get('/', cacheMiddleware(TTL.FEE_STATS, () => cacheKeys.feeStats()), async (req, res) => {
  try {
    res.json(await StellarService.getFeeStats());
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve fee stats' });
  }
});

// GET /exchange-rate/:from/:to
router.get('/:from/:to', rules.assetCodeParams, validate,
  cacheMiddleware(TTL.RATE, (req) => cacheKeys.rate(req.params.from, req.params.to)),
  async (req, res) => {
    try {
      const { from, to } = req.params;
      const rate = await getRate(from, to);
      if (rate === null) {
        return res.status(503).json({ error: `Exchange rate unavailable for ${from}/${to}: no liquidity in orderbook` });
      }
      res.json({ from, to, rate });
    } catch (error) {
      logError(req, error, { from: req.params.from, to: req.params.to });
      res.status(500).json({ error: 'Failed to retrieve exchange rate' });
    }
  }
);

export default router;
