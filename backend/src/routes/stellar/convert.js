import express from 'express';
import { convert } from '../../services/exchangeRate.js';
import { validate, rules } from '../../middleware/validate.js';
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

// GET /convert/:from/:to/:amount
router.get('/:from/:to/:amount', rules.assetCodeParams, validate, async (req, res) => {
  try {
    const amount = parseFloat(req.params.amount);
    if (!isFinite(amount) || amount <= 0) return res.status(422).json({ error: 'Invalid amount' });
    const result = await convert(amount, req.params.from, req.params.to);
    res.json({ from: req.params.from, to: req.params.to, amount, converted: result });
  } catch (error) {
    logError(req, error, { from: req.params.from, to: req.params.to, amount: req.params.amount });
    res.status(500).json({ error: 'Failed to convert amount' });
  }
});

export default router;
