import express from 'express';
import * as TrustlineService from '../../services/trustline.js';
import logger from '../../config/logger.js';

const router = express.Router();

function logError(req, error, context = {}) {
  logger.error('trustline.error', {
    requestId: req.id,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    ...context,
    error: error.message,
    stack: error.stack,
  });
}

router.get('/balances/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const balances = await TrustlineService.getBalancesWithLimits(accountId);
    res.json({ balances });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/modify-limit', async (req, res) => {
  try {
    const { sourceSecret, assetCode, issuer, newLimit } = req.body;
    const result = await TrustlineService.modifyTrustlineLimit(
      sourceSecret,
      assetCode,
      issuer,
      newLimit
    );
    res.json(result);
  } catch (error) {
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(400).json({ error: error.message });
  }
});

export default router;
