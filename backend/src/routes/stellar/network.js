import express from 'express';
import * as StellarService from '../../services/stellar.js';
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

// GET /network/status
router.get('/status', async (req, res) => {
  try {
    const status = await StellarService.getNetworkStatus();
    res.json(status);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve network status' });
  }
});

export default router;
