import express from 'express';
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

const router = express.Router();

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
    res.status(500).json({ error: error.message });
  }
});

router.post('/account/import', rules.importAccount, validate, async (req, res) => {
  try {
    const { secretKey } = req.body;
    const keypair = StellarSDK.Keypair.fromSecret(secretKey);
    const publicKey = keypair.publicKey();
    const balance = await StellarService.getBalance(publicKey);
    res.json({ publicKey, secretKey, balances: balance.balances });
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
      res.status(500).json({ error: error.message });
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
router.post('/payment/send', rules.sendPayment, validate, async (req, res) => {
  try {
    const { sourceSecret, destination, amount, assetCode } = req.body;
    const result = await StellarService.sendPayment(sourceSecret, destination, amount, assetCode);

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
    } catch (_) {}

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const { cursor, limit, type, dateFrom, dateTo } = req.query;
    const result = await StellarService.getTransactions(req.params.publicKey, {
      cursor,
      limit: limit ? Math.min(parseInt(limit), 50) : 10,
      type,
      dateFrom,
      dateTo,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fee-stats', cacheMiddleware(TTL.FEE_STATS, () => cacheKeys.feeStats()), async (req, res) => {
  try {
    res.json(await StellarService.getFeeStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
    }
  }
);

// All supported pair rates in one call
router.get('/rates', async (req, res) => {
  try {
    const rates = await getAllRates();
    res.json({ rates });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/network/status', async (req, res) => {
  try {
    const status = await StellarService.getNetworkStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    res.status(500).json({ error: error.message });
  }
});

export default router;

