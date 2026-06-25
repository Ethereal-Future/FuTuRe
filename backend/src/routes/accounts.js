import express from 'express';
import { getHorizonServer } from '../services/stellar.js';
import { validate, rules } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../db/client.js';
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

/**
 * @swagger
 * /api/accounts/label:
 *   put:
 *     summary: Update account label
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - label
 *             properties:
 *               label:
 *                 type: string
 *                 maxLength: 255
 *                 example: My Trading Account
 *     responses:
 *       200:
 *         description: Label updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 label:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.put('/label', requireAuth, async (req, res) => {
  const correlationId = req.correlationId;
  const userId = req.user?.id;

  if (!userId) {
    logger.warn('accounts.label.unauthorized', { correlationId });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { label } = req.body;

    if (typeof label !== 'string' || label.length > 255) {
      return res.status(400).json({ error: 'Label must be a string with max 255 characters' });
    }

    const setting = await prisma.setting.upsert({
      where: { userId },
      update: { accountLabel: label || null },
      create: { userId, accountLabel: label || null },
    });

    logger.info('accounts.label.updated', { correlationId, userId });
    res.json({ label: setting.accountLabel });
  } catch (error) {
    logger.error('accounts.label.failed', { correlationId, error: error.message });
    res.status(500).json({ error: 'Failed to update label' });
  }
});

/**
 * @swagger
 * /api/accounts/label:
 *   get:
 *     summary: Get account label
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account label retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 label:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/label', requireAuth, async (req, res) => {
  const correlationId = req.correlationId;
  const userId = req.user?.id;

  if (!userId) {
    logger.warn('accounts.label.unauthorized', { correlationId });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const setting = await prisma.setting.findUnique({
      where: { userId },
    });

    logger.info('accounts.label.fetched', { correlationId, userId });
    res.json({ label: setting?.accountLabel || null });
  } catch (error) {
    logger.error('accounts.label.fetch_failed', { correlationId, error: error.message });
    res.status(500).json({ error: 'Failed to retrieve label' });
  }
});

export default router;
