import express from 'express';
import { body } from 'express-validator';
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from '../../services/stellar.js';
import { validate, rules } from '../../middleware/validate.js';
import prisma from '../../db/client.js';
import logger from '../../config/logger.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';

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

// Stricter rate limit for account creation (5 req/hour per IP) to prevent Friendbot abuse
const accountCreateRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many account creation requests, please try again later.',
});

router.post('/create', accountCreateRateLimiter, async (req, res) => {
  try {
    const account = await StellarService.createAccount();
    res.json(account);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/fund', rules.publicKeyBody, validate, async (req, res) => {
  if (!StellarService.isTestnet()) return res.status(403).json({ error: 'Only available on testnet' });
  try {
    const result = await StellarService.fundAccount(req.body.publicKey);
    res.json(result);
  } catch (error) {
    logError(req, error, { publicKey: req.body.publicKey });
    res.status(500).json({ error: 'Failed to fund account' });
  }
});

router.post('/import', rules.importAccount, validate, async (req, res) => {
  try {
    const { secretKey } = req.body;
    const keypair = StellarSDK.Keypair.fromSecret(secretKey);
    const publicKey = keypair.publicKey();
    const balance = await StellarService.getBalance(publicKey);
    res.json({ publicKey, balances: balance.balances });
  } catch (error) {
    res.status(400).json({ error: 'Invalid secret key or account not found on network' });
  }
});

router.get('/:publicKey', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const balance = await StellarService.getBalance(req.params.publicKey);
    res.json(balance);
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve balance' });
  }
});

router.get('/:publicKey/trustlines', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const trustlines = await StellarService.getTrustlines(req.params.publicKey);
    res.json({ trustlines });
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve trustlines' });
  }
});

router.get('/:publicKey/transactions', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const { cursor, limit, type, dateFrom, dateTo, hash } = req.query;
    const result = await StellarService.getTransactions(req.params.publicKey, {
      cursor,
      limit: limit ? Math.min(parseInt(limit), 50) : 10,
      type,
      dateFrom,
      dateTo,
    });
    if (hash) {
      const prefix = hash.toLowerCase();
      result.records = result.records.filter(tx => tx.hash?.toLowerCase().startsWith(prefix));
    }
    res.json(result);
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
});

router.get('/:publicKey/label', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicKey: req.params.publicKey },
      include: { settings: true },
    });
    res.json({ accountLabel: user?.settings?.accountLabel ?? null });
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve account label' });
  }
});

router.put('/:publicKey/label', rules.publicKeyParam, validate,
  body('accountLabel').trim().isLength({ max: 50 }).withMessage('Label must be 50 characters or fewer'),
  validate,
  async (req, res) => {
    try {
      const { accountLabel } = req.body;
      const user = await prisma.user.upsert({
        where: { publicKey: req.params.publicKey },
        update: {},
        create: { publicKey: req.params.publicKey },
      });
      await prisma.setting.upsert({
        where: { userId: user.id },
        update: { accountLabel: accountLabel || null },
        create: { userId: user.id, accountLabel: accountLabel || null },
      });
      res.json({ accountLabel: accountLabel || null });
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to update account label' });
    }
  }
);

router.get('/:publicKey/settings', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicKey: req.params.publicKey },
      include: { settings: true, kycRecord: { select: { status: true, submittedAt: true } } },
    });
    const settings = user?.settings ?? {};
    res.json({
      defaultAsset: settings.defaultAsset ?? 'XLM',
      notificationsOn: settings.notificationsOn ?? true,
      kycStatus: user?.kycRecord?.status ?? null,
      kycSubmittedAt: user?.kycRecord?.submittedAt ?? null,
    });
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve account settings' });
  }
});

router.put('/:publicKey/settings',
  rules.publicKeyParam, validate,
  body('defaultAsset').optional().isString().trim().isLength({ min: 1, max: 12 }),
  body('notificationsOn').optional().isBoolean(),
  validate,
  async (req, res) => {
    try {
      const { defaultAsset, notificationsOn } = req.body;
      const user = await prisma.user.upsert({
        where: { publicKey: req.params.publicKey },
        update: {},
        create: { publicKey: req.params.publicKey },
      });
      const update = {};
      if (defaultAsset !== undefined) update.defaultAsset = defaultAsset;
      if (notificationsOn !== undefined) update.notificationsOn = notificationsOn;
      const settings = await prisma.setting.upsert({
        where: { userId: user.id },
        update,
        create: { userId: user.id, ...update },
      });
      res.json({ defaultAsset: settings.defaultAsset, notificationsOn: settings.notificationsOn });
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to update account settings' });
    }
  }
);

router.post('/merge', rules.mergeAccount, validate, async (req, res) => {
  try {
    const { sourceSecret, destination } = req.body;
    const result = await StellarService.mergeAccount(sourceSecret, destination);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
