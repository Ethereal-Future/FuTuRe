import express from 'express';
import * as StellarService from '../../services/stellar.js';
import { validate, rules } from '../../middleware/validate.js';
import { SUPPORTED_ASSETS, getIssuer } from '../../config/assets.js';
import logger from '../../config/logger.js';

const router = express.Router();

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

router.get('/assets', (req, res) => {
  const assets = SUPPORTED_ASSETS.map(code => ({
    code,
    issuer: code === 'XLM' ? null : getIssuer(code),
    native: code === 'XLM',
  }));
  res.json({ assets });
});

router.post('/create', rules.createTrustline, validate, async (req, res) => {
  try {
    const { sourceSecret, assetCode } = req.body;
    const result = await StellarService.createTrustline(sourceSecret, assetCode);
    res.json(result);
  } catch (error) {
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(500).json({ error: 'Failed to create trustline' });
  }
});

router.delete('/remove', rules.removeTrustline, validate, async (req, res) => {
  try {
    const { sourceSecret, assetCode } = req.body;
    const result = await StellarService.removeTrustline(sourceSecret, assetCode);
    res.json(result);
  } catch (error) {
    if (error.message.startsWith('Cannot remove trustline') || error.message.startsWith('No trustline found')) {
      return res.status(400).json({ error: error.message });
    }
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(500).json({ error: 'Failed to remove trustline' });
  }
});

export default router;
