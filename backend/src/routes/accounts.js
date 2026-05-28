import express from 'express';
import { getHorizonServer } from '../services/stellar.js';
import { validate, rules } from '../middleware/validate.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * @swagger
 * /api/accounts/{address}/offers:
 *   get:
 *     summary: Get open DEX offers for an account
 *     tags: [Accounts]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar account address
 *     responses:
 *       200:
 *         description: List of open offers
 *       404:
 *         description: Account not found
 *       500:
 *         description: Horizon connectivity error
 */
router.get('/:address/offers', rules.addressParam, validate, async (req, res) => {
  const { address } = req.params;
  const correlationId = req.correlationId;

  try {
    const server = getHorizonServer();
    const response = await server.offers().forAccount(address).call();

    const offers = response.records.map(o => ({
      id: o.id,
      selling_asset: o.selling.asset_type === 'native'
        ? { type: 'native', code: 'XLM' }
        : { type: o.selling.asset_type, code: o.selling.asset_code, issuer: o.selling.asset_issuer },
      buying_asset: o.buying.asset_type === 'native'
        ? { type: 'native', code: 'XLM' }
        : { type: o.buying.asset_type, code: o.buying.asset_code, issuer: o.buying.asset_issuer },
      amount: o.amount,
      price: o.price,
      last_modified_ledger: o.last_modified_ledger,
    }));

    logger.info('accounts.offers.fetched', { correlationId, address, count: offers.length });
    res.json({ offers });
  } catch (error) {
    if (error?.response?.status === 404) {
      logger.warn('accounts.offers.not_found', { correlationId, address });
      return res.status(404).json({ error: 'Account not found' });
    }
    logger.error('accounts.offers.failed', { correlationId, address, error: error.message });
    res.status(500).json({ error: 'Failed to fetch offers from Horizon' });
  }
});

export default router;
