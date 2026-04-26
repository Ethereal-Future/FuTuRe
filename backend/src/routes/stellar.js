import express from 'express';
import { body } from 'express-validator';
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from '../services/stellar.js';
import * as AMMService from '../services/amm.js';
import { getRate, getAllRates, convert } from '../services/exchangeRate.js';
import { broadcastToAccount } from '../services/websocket.js';
import { validate, rules } from '../middleware/validate.js';
import { SUPPORTED_ASSETS, getIssuer } from '../config/assets.js';
import { dispatchEvent } from '../webhooks/dispatcher.js';
import { cacheMiddleware } from '../middleware/cache.js';
import { keys as cacheKeys, TTL, invalidateBalance } from '../cache/appCache.js';
import prisma from '../db/client.js';
import { getSubscriptionByPublicKey, sendWebPush } from '../notifications/webPush.js';
import logger from '../config/logger.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

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

/**
 * @swagger
 * /api/stellar/account/create:
 *   post:
 *     summary: Create a new Stellar account
 *     description: Generates a new random keypair for a Stellar account.
 *     tags: [Stellar]
 *     responses:
 *       200:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/account/create', async (req, res) => {
  try {
    const account = await StellarService.createAccount();
    res.json(account);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/account/fund', rules.publicKeyBody, validate, async (req, res) => {
  if (!StellarService.isTestnet()) return res.status(403).json({ error: 'Only available on testnet' });
  try {
    const result = await StellarService.fundAccount(req.body.publicKey);
    res.json(result);
  } catch (error) {
    logError(req, error, { publicKey: req.body.publicKey });
    res.status(500).json({ error: 'Failed to fund account' });
  }
});

router.post('/account/import', rules.importAccount, validate, async (req, res) => {
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

/**
 * @swagger
 * /api/stellar/account/{publicKey}:
 *   get:
 *     summary: Get account balance
 *     description: Retrieves the balance for a given Stellar public key.
 *     tags: [Stellar]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: The public key of the account to check.
 *     responses:
 *       200:
 *         description: Balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Balance'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/account/:publicKey', rules.publicKeyParam, validate,
  cacheMiddleware(TTL.BALANCE, (req) => cacheKeys.balance(req.params.publicKey)),
  async (req, res) => {
    try {
      const balance = await StellarService.getBalance(req.params.publicKey);
      res.json(balance);
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to retrieve balance' });
    }
  }
);

/**
 * @swagger
 * /api/stellar/payment/send:
 *   post:
 *     summary: Send a payment
 *     description: Sends a payment from one Stellar account to another.
 *     tags: [Stellar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentRequest'
 *     responses:
 *       200:
 *         description: Payment sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentResult'
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Stricter rate limit for payment endpoint (10 req/min)
const paymentRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
  message: 'Too many payment requests, please try again later.',
});

router.post('/payment/send', paymentRateLimiter, rules.sendPayment, validate, async (req, res) => {
  try {
    const { sourceSecret, destination, amount, assetCode, memo, memoType } = req.body;
    const result = await StellarService.sendPayment(sourceSecret, destination, amount, assetCode, memo, memoType);

    const notification = { type: 'transaction', hash: result.hash, amount, assetCode: assetCode || 'XLM', timestamp: Date.now() };

    // Notify sender's updated balance + tx notification
    const senderKey = StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();
    const senderBalance = await StellarService.getBalance(senderKey);
    broadcastToAccount(senderKey, { ...notification, direction: 'sent', balance: senderBalance.balances });
    dispatchEvent(senderKey, 'payment_sent', { hash: result.hash, amount, assetCode: assetCode || 'XLM', destination });

    // Invalidate cached balances for sender and recipient
    await invalidateBalance(senderKey);
    await invalidateBalance(destination);

    // Notify recipient of incoming tx + updated balance
    try {
      const recipientBalance = await StellarService.getBalance(destination);
      broadcastToAccount(destination, { ...notification, direction: 'received', balance: recipientBalance.balances });
      dispatchEvent(destination, 'payment_received', { hash: result.hash, amount, assetCode: assetCode || 'XLM', source: senderKey });
      const pushSub = getSubscriptionByPublicKey(destination);
      if (pushSub) {
        sendWebPush(pushSub, { title: 'Payment received', body: `You received ${amount} ${assetCode || 'XLM'}` }).catch(() => {});
      }
    } catch (_) {}

    res.json(result);
  } catch (error) {
    logError(req, error, { destination: req.body.destination, amount: req.body.amount, assetCode: req.body.assetCode });
    res.status(500).json({ error: 'Failed to send payment' });
  }
});

/**
 * @swagger
 * /api/stellar/exchange-rate/{from}/{to}:
 *   get:
 *     summary: Get exchange rate
 *     description: Retrieves the exchange rate between two assets on the Stellar network.
 *     tags: [Stellar]
 *     parameters:
 *       - in: path
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *         description: The source asset code.
 *       - in: path
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: The target asset code.
 *     responses:
 *       200:
 *         description: Exchange rate retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExchangeRate'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/account/:publicKey/transactions', rules.publicKeyParam, validate, async (req, res) => {
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

router.get('/fee-stats', cacheMiddleware(TTL.FEE_STATS, () => cacheKeys.feeStats()), async (req, res) => {
  try {
    res.json(await StellarService.getFeeStats());
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve fee stats' });
  }
});

router.get('/exchange-rate/:from/:to', rules.assetCodeParams, validate,
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

// All supported pair rates in one call
router.get('/rates', async (req, res) => {
  try {
    const rates = await getAllRates();
    res.json({ rates });
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve rates' });
  }
});

// Convert an amount between assets
router.get('/convert/:from/:to/:amount', rules.assetCodeParams, validate, async (req, res) => {
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

router.get('/network/status', async (req, res) => {
  try {
    const status = await StellarService.getNetworkStatus();
    res.json(status);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to retrieve network status' });
  }
});

router.get('/amm/pools', (req, res) => {
  res.json({ pools: AMMService.getAllPools() });
});

router.post('/amm/pools/register', (req, res) => {
  try {
    res.json(AMMService.registerPool(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/amm/pools/:poolId', (req, res) => {
  try {
    res.json(AMMService.getPoolState(req.params.poolId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.post('/amm/swap', (req, res) => {
  try {
    res.json(AMMService.executeSwap(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/amm/arbitrage/:assetA/:assetB', (req, res) => {
  const opportunities = AMMService.detectArbitrageOpportunities([req.params.assetA, req.params.assetB]);
  res.json({ opportunities });
});

router.post('/amm/strategies/run', (req, res) => {
  try {
    res.json(AMMService.runAutomatedStrategy(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/amm/liquidity/automate', (req, res) => {
  try {
    res.json(AMMService.automateLiquidityProvision(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/amm/yield/estimate', (req, res) => {
  try {
    res.json(AMMService.estimateYieldFarming(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/amm/analytics', (req, res) => {
  res.json(AMMService.getAMMAnalytics());
});

router.get('/amm/risk', (req, res) => {
  res.json(AMMService.runRiskChecks());
});

router.get('/amm/optimize', (req, res) => {
  res.json(AMMService.optimizeAMMPerformance());
});

// Returns supported assets and their issuers
router.get('/assets', (req, res) => {
  const assets = SUPPORTED_ASSETS.map(code => ({
    code,
    issuer: code === 'XLM' ? null : getIssuer(code),
    native: code === 'XLM',
  }));
  res.json({ assets });
});

// Create a trustline for a non-native asset (e.g. USDC)
router.post('/trustline', rules.createTrustline, validate, async (req, res) => {
  try {
    const { sourceSecret, assetCode } = req.body;
    const result = await StellarService.createTrustline(sourceSecret, assetCode);
    res.json(result);
  } catch (error) {
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(500).json({ error: 'Failed to create trustline' });
  }
});

router.get('/account/:publicKey/label', rules.publicKeyParam, validate, async (req, res) => {
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

router.put('/account/:publicKey/label', rules.publicKeyParam, validate,
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

// GET /api/stellar/account/:publicKey/settings
router.get('/account/:publicKey/settings', rules.publicKeyParam, validate, async (req, res) => {
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

// PUT /api/stellar/account/:publicKey/settings
router.put('/account/:publicKey/settings',
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

export default router;

// POST /api/stellar/account/merge - Merge account (irreversible)
router.post('/account/merge', rules.mergeAccount, validate, async (req, res) => {
  try {
    const { sourceSecret, destination } = req.body;
    const result = await StellarService.mergeAccount(sourceSecret, destination);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
