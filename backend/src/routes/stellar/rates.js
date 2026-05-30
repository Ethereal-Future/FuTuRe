import express from 'express';
import { getAllRates, convert } from '../../services/exchangeRate.js';
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

// GET /rates
router.get('/', async (req, res) => {
  try {
    const rates = await getAllRates();
    res.json({ rates });
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve rates' });
  }
});

export default router;
