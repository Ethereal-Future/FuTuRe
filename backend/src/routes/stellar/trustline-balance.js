import express from 'express';
import { getHorizonServer, withHorizonRetry, updateTrustlineLimit } from '../../services/stellar.js';
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
    if (!accountId) throw new Error('Account ID is required');

    const account = await withHorizonRetry(() => getHorizonServer().loadAccount(accountId));

    const balances = account.balances.map((balance) => {
      const isNative = balance.asset_type === 'native';
      if (isNative) {
        return {
          assetCode: 'XLM',
          issuer: null,
          balance: parseFloat(balance.balance),
          limit: null,
          buyingLiabilities: parseFloat(balance.buying_liabilities || '0'),
          sellingLiabilities: parseFloat(balance.selling_liabilities || '0'),
        };
      }
      return {
        assetCode: balance.asset_code,
        issuer: balance.asset_issuer,
        balance: parseFloat(balance.balance),
        limit: balance.limit ? parseFloat(balance.limit) : null,
        buyingLiabilities: parseFloat(balance.buying_liabilities || '0'),
        sellingLiabilities: parseFloat(balance.selling_liabilities || '0'),
      };
    });

    balances.sort((a, b) => {
      if (a.assetCode === 'XLM') return -1;
      if (b.assetCode === 'XLM') return 1;
      return a.assetCode.localeCompare(b.assetCode);
    });

    res.json({ balances });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/modify-limit', async (req, res) => {
  try {
    const { sourceSecret, assetCode, issuer, newLimit } = req.body;
    const result = await updateTrustlineLimit(sourceSecret, assetCode, issuer, newLimit);
    res.json(result);
  } catch (error) {
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(400).json({ error: error.message });
  }
});

export default router;
