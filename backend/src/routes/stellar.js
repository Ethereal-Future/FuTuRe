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
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { optionalMFA } from '../middleware/mfa.js';
import { requireKYC } from '../middleware/kyc.js';
import sanctionsChecker from '../compliance/sanctionsChecker.js';
import amlMonitor from '../compliance/amlMonitor.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';

const isValidStellarAddress = (address) => {
  try {
    return StellarSDK.StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
};

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
 *             example:
 *               publicKey: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *               secret: SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// Stricter rate limit for account creation (5 req/hour per IP) to prevent Friendbot abuse
const accountCreateRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many account creation requests, please try again later.',
});

router.post('/account/create', accountCreateRateLimiter, async (req, res) => {
  try {
    const account = await StellarService.createAccount(req.correlationId);
    res.json(account);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/account/fund', rules.publicKeyBody, validate, async (req, res) => {
  if (!StellarService.isTestnet())
    return res.status(403).json({ error: 'Only available on testnet' });
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
    const balance = await StellarService.getBalance(publicKey, req.correlationId);
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
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
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
 *             example:
 *               - asset_type: native
 *                 balance: '100.0000000'
 *               - asset_type: credit_alphanum4
 *                 asset_code: USDC
 *                 asset_issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *                 balance: '50.0000000'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/account/:publicKey',
  rules.publicKeyParam,
  validate,
  cacheMiddleware(TTL.BALANCE, (req) => cacheKeys.balance(req.params.publicKey)),
  async (req, res) => {
    try {
      const balance = await StellarService.getBalance(req.params.publicKey);
      res.json(balance);
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to retrieve balance' });
    }
  },
);

/**
 * @swagger
 * /api/stellar/payment/send:
 *   post:
 *     summary: Send a payment
 *     description: Sends a payment from one Stellar account to another. Requires KYC approval for amounts above the configured threshold.
 *     tags: [Stellar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentRequest'
 *           example:
 *             sourceSecret: SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2
 *             destination: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *             amount: '10.5000000'
 *             assetCode: XLM
 *             memo: Invoice #42
 *     responses:
 *       200:
 *         description: Payment sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentResult'
 *             example:
 *               hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *               ledger: 48392011
 *               successful: true
 *               fee_charged: '100'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden — KYC required or sanctions hit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               kyc_required:
 *                 summary: KYC not approved
 *                 value:
 *                   error: KYC_REQUIRED
 *                   kycStatus: PENDING
 *               sanctions_hit:
 *                 summary: Sanctions screening failed
 *                 value:
 *                   error: SANCTIONS_HIT
 *                   reason: Match found on OFAC SDN list
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
// Stricter rate limit for payment endpoint (10 req/min)
const paymentRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
  message: 'Too many payment requests, please try again later.',
});

router.post(
  '/payment/send',
  paymentRateLimiter,
  idempotencyMiddleware,
  requireKYC,
  rules.sendPayment,
  validate,
  optionalMFA,
  async (req, res) => {
    try {
      const { sourceSecret, destination, amount, assetCode, memo, memoType } = req.body;

      // Sanctions screening — check sender and recipient before submitting to Stellar
      const senderKey = StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();
      const senderKyc = await prisma.kYCRecord.findFirst({
        where: { user: { publicKey: senderKey } },
      });
      const senderName = senderKyc?.fullName ?? senderKey;

      const [senderScreen, recipientScreen] = await Promise.all([
        sanctionsChecker.check(senderName),
        sanctionsChecker.check(destination),
      ]);

      if (senderScreen.hit || recipientScreen.hit) {
        const reason = senderScreen.hit ? senderScreen.reason : recipientScreen.reason;
        logger.warn('route.payment.sanctions_hit', { senderKey, destination, reason });
        return res
          .status(403)
          .json({
            error: { code: 'SANCTIONS_MATCH', message: 'Sanctions screening failed', reason },
          });
      }

      const result = await StellarService.sendPayment(
        sourceSecret,
        destination,
        amount,
        assetCode,
        memo,
        memoType,
        req.correlationId,
      );

      // AML monitoring — run asynchronously after payment succeeds
      const txRecord = await prisma.transaction.findUnique({ where: { hash: result.hash } });
      if (txRecord) {
        const history = await prisma.transaction.findMany({
          where: {
            senderId: txRecord.senderId,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          orderBy: { createdAt: 'desc' },
        });
        amlMonitor.screenTransaction(txRecord, history).catch((err) =>
          logger.error('route.payment.aml_screen_failed', {
            hash: result.hash,
            error: err.message,
          }),
        );
      }

      const notification = {
        type: 'transaction',
        hash: result.hash,
        amount,
        assetCode: assetCode || 'XLM',
        timestamp: Date.now(),
      };

      // Notify sender's updated balance + tx notification
      const senderBalance = await StellarService.getBalance(senderKey, req.correlationId);
      broadcastToAccount(senderKey, {
        ...notification,
        direction: 'sent',
        balance: senderBalance.balances,
      });
      dispatchEvent(senderKey, 'payment_sent', {
        hash: result.hash,
        amount,
        assetCode: assetCode || 'XLM',
        destination,
      });

      // Invalidate cached balances for sender and recipient
      await invalidateBalance(senderKey);
      await invalidateBalance(destination);

      // Notify recipient of incoming tx + updated balance
      try {
        const recipientBalance = await StellarService.getBalance(destination, req.correlationId);
        broadcastToAccount(destination, {
          ...notification,
          direction: 'received',
          balance: recipientBalance.balances,
        });
        dispatchEvent(destination, 'payment_received', {
          hash: result.hash,
          amount,
          assetCode: assetCode || 'XLM',
          source: senderKey,
        });
        const pushSub = getSubscriptionByPublicKey(destination);
        if (pushSub) {
          const asset = assetCode || 'XLM';
          const truncatedSender = `${senderKey.slice(0, 4)}…${senderKey.slice(-4)}`;
          sendWebPush(pushSub, {
            title: 'Payment received',
            body: `You received ${amount} ${asset} from ${truncatedSender}`,
            data: {
              url: `/app#tx=${result.hash}`,
              hash: result.hash,
              amount,
              assetCode: asset,
              sender: truncatedSender,
            },
          }).catch(() => {});
        }
      } catch {
        /* swallow — recipient balance/push errors must not fail the payment response */
      }

      res.json(result);
    } catch (error) {
      logError(req, error, {
        destination: req.body.destination,
        amount: req.body.amount,
        assetCode: req.body.assetCode,
      });
      res.status(500).json({ error: 'Failed to send payment' });
    }
  },
);

/**
 * @swagger
 * /api/stellar/account/{publicKey}/transactions:
 *   get:
 *     summary: List transactions for an account
 *     description: >
 *       Returns a cursor-paginated list of transactions for the given account.
 *       Pass the `nextCursor` value from a previous response as `cursor` to
 *       fetch the next page. `hasMore: true` means another page is available.
 *       `hasMore: false` (and `nextCursor: null`) means you have reached the end.
 *     tags: [Stellar]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: Stellar public key of the account.
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Paging token from a previous response's `nextCursor` field.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of records to return (max 50).
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by operation type (e.g. `payment`).
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Include only transactions on or after this ISO-8601 timestamp.
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Include only transactions on or before this ISO-8601 timestamp.
 *       - in: query
 *         name: hash
 *         schema:
 *           type: string
 *         description: Filter by transaction hash prefix.
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionListResponse'
 *             example:
 *               records:
 *                 - hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *                   type: payment
 *                   direction: sent
 *                   amount: '10.5000000'
 *                   asset: XLM
 *                   date: '2026-03-15T14:22:00Z'
 *                   successful: true
 *                   ledger: 48392011
 *               nextCursor: '48392011'
 *               hasMore: true
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
/**
 * @swagger
 * /api/stellar/account/{publicKey}/trustlines:
 *   get:
 *     summary: Get trustlines for an account
 *     description: Returns all non-native trustlines (asset code, issuer, balance, limit, authorized flag).
 *     tags: [Stellar]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *     responses:
 *       200:
 *         description: Trustlines retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 trustlines:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Trustline'
 *             example:
 *               trustlines:
 *                 - asset_code: USDC
 *                   asset_issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *                   balance: '50.0000000'
 *                   limit: '1000.0000000'
 *                   is_authorized: true
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/account/:publicKey/trustlines', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const trustlines = await StellarService.getTrustlines(req.params.publicKey);
    res.json({ trustlines });
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve trustlines' });
  }
});

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
      result.records = result.records.filter((tx) => tx.hash?.toLowerCase().startsWith(prefix));
    }
    res.json(result);
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
});

router.get(
  '/fee-stats',
  cacheMiddleware(TTL.FEE_STATS, () => cacheKeys.feeStats()),
  async (req, res) => {
    try {
      res.json(await StellarService.getFeeStats());
    } catch (error) {
      logError(req, error);
      res.status(500).json({ error: 'Failed to retrieve fee stats' });
    }
  },
);

/**
 * @swagger
 * /api/stellar/fee-estimate:
 *   get:
 *     summary: Get current fee estimate
 *     description: Returns the current base fee in both stroops and XLM for transaction estimation
 *     tags: [Stellar]
 *     responses:
 *       200:
 *         description: Fee estimate retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 baseFeeBump:
 *                   type: integer
 *                   description: Base fee in stroops (1 stroop = 0.0000001 XLM)
 *                 baseFeeXLM:
 *                   type: string
 *                   description: Base fee in XLM
 *                 recommendedFeeMultiplier:
 *                   type: number
 *                   description: Multiplier for base fee based on network congestion
 *             example:
 *               baseFeeBump: 100
 *               baseFeeXLM: "0.0000100"
 *               recommendedFeeMultiplier: 1
 *       500:
 *         description: Failed to retrieve fee estimate
 */
router.get(
  '/fee-estimate',
  cacheMiddleware(TTL.FEE_STATS, () => cacheKeys.feeStats()),
  async (req, res) => {
    const correlationId = req.correlationId;
    try {
      const server = StellarService.getHorizonServer();
      const ledger = await server.ledgers().order('desc').limit(1).call();
      const baseFeeBump = ledger.records[0].base_fee_in_stroops || 100;
      
      res.json({
        baseFeeBump,
        baseFeeXLM: (baseFeeBump / 10000000).toFixed(7),
        recommendedFeeMultiplier: 1,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logError(req, error, { correlationId });
      res.status(500).json({ error: 'Failed to retrieve fee estimate' });
    }
  }
);

/**
 * @swagger
 * /api/stellar/exchange-rate/{from}/{to}:
 *   get:
 *     summary: Get exchange rate
 *     description: Retrieves the best ask price between two assets on the Stellar SDEX order book.
 *     tags: [Stellar]
 *     parameters:
 *       - in: path
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *         example: XLM
 *         description: The source asset code.
 *       - in: path
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         example: USDC
 *         description: The target asset code.
 *     responses:
 *       200:
 *         description: Exchange rate retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExchangeRate'
 *             example:
 *               from: XLM
 *               to: USDC
 *               rate: '0.1234567'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/exchange-rate/:from/:to',
  rules.assetCodeParams,
  validate,
  cacheMiddleware(TTL.RATE, (req) => cacheKeys.rate(req.params.from, req.params.to)),
  async (req, res) => {
    try {
      const { from, to } = req.params;
      const rate = await getRate(from, to);
      if (rate === null) {
        return res.status(503).json({
          error: `Exchange rate unavailable for ${from}/${to}: no liquidity in orderbook`,
        });
      }
      res.json({ from, to, rate });
    } catch (error) {
      logError(req, error, { from: req.params.from, to: req.params.to });
      res.status(500).json({ error: 'Failed to retrieve exchange rate' });
    }
  },
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
  const opportunities = AMMService.detectArbitrageOpportunities([
    req.params.assetA,
    req.params.assetB,
  ]);
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
  const assets = SUPPORTED_ASSETS.map((code) => ({
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

// DELETE /api/stellar/trustline - Remove a trustline (balance must be zero)
router.delete('/trustline', rules.removeTrustline, validate, async (req, res) => {
  try {
    const { sourceSecret, assetCode } = req.body;
    const result = await StellarService.removeTrustline(sourceSecret, assetCode);
    res.json(result);
  } catch (error) {
    if (
      error.message.startsWith('Cannot remove trustline') ||
      error.message.startsWith('No trustline found')
    ) {
      return res.status(400).json({ error: error.message });
    }
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(500).json({ error: 'Failed to remove trustline' });
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

router.put(
  '/account/:publicKey/label',
  rules.publicKeyParam,
  validate,
  body('accountLabel')
    .trim()
    .isLength({ max: 50 })
    .withMessage('Label must be 50 characters or fewer'),
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
  },
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
router.put(
  '/account/:publicKey/settings',
  rules.publicKeyParam,
  validate,
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
  },
);

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

// POST /api/stellar/trustline/create - Create trustline for non-native asset
router.post('/trustline/create', [
  body('sourceSecret').notEmpty(),
  body('assetCode').notEmpty().isString().isLength({ min: 1, max: 12 }),
], validate, async (req, res) => {
  try {
    const { sourceSecret, assetCode } = req.body;
    
    if (assetCode === 'XLM') {
      return res.status(400).json({ error: 'XLM is native and does not require a trustline' });
    }

    const issuer = getIssuer(assetCode);
    if (!issuer) {
      return res.status(400).json({ error: `No issuer found for asset code: ${assetCode}` });
    }

    const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();
    
    // Load account and create trustline transaction
    const sourceAccount = await StellarService.getHorizonServer().loadAccount(sourcePublicKey);
    const asset = new StellarSDK.Asset(assetCode, issuer);

    const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
      fee: StellarSDK.BASE_FEE,
      networkPassphrase: StellarService.isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
    }).addOperation(
      StellarSDK.Operation.changeTrust({
        asset,
      })
    ).setTimeout(30);

    const transaction = txBuilder.build();
    transaction.sign(sourceKeypair);

    const result = await StellarService.getHorizonServer().submitTransaction(transaction);
    
    res.json({
      success: true,
      hash: result.hash,
      assetCode,
      issuer,
      ledger: result.ledger,
    });
  } catch (error) {
    logError(req, error, { assetCode: req.body.assetCode });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stellar/account/:publicKey/balances - Get all asset balances (cached)
router.get('/account/:publicKey/balances', cacheMiddleware(cacheKeys.balance, TTL.balance), async (req, res) => {
  try {
    const { publicKey } = req.params;
    const balances = await StellarService.getBalance(publicKey);
    res.json(balances);
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: error.message });
  }
});

// POST /api/stellar/batch-payment - Send payment to multiple recipients
router.post(
  '/batch-payment',
  paymentRateLimiter,
  idempotencyMiddleware,
  requireKYC,
  [
    body('sourceSecret').notEmpty(),
    body('payments').isArray({ min: 1, max: 10 }),
    body('payments.*.destination').notEmpty().isString(),
    body('payments.*.amount').notEmpty().isString(),
    body('payments.*.assetCode').optional().isString().isLength({ min: 1, max: 12 }),
    body('memo').optional().isString().isLength({ max: 28 }),
    body('memoType').optional().isIn(['text', 'id', 'hash', 'return']),
  ],
  validate,
  optionalMFA,
  async (req, res) => {
    try {
      const { sourceSecret, payments, memo, memoType } = req.body;
      const senderKey = StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();

      // Validate payments
      if (payments.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 recipients per batch' });
      }

      let totalAmount = 0;
      for (const payment of payments) {
        totalAmount += parseFloat(payment.amount);
        if (!isValidStellarAddress(payment.destination)) {
          return res.status(400).json({ error: `Invalid recipient address: ${payment.destination}` });
        }
      }

      // Sanctions screening for sender and recipients
      const senderKyc = await prisma.kYCRecord.findFirst({
        where: { user: { publicKey: senderKey } },
      });
      const senderName = senderKyc?.fullName ?? senderKey;

      const [senderScreen, ...recipientScreens] = await Promise.all([
        sanctionsChecker.check(senderName),
        ...payments.map((p) => sanctionsChecker.check(p.destination)),
      ]);

      if (senderScreen.hit) {
        return res.status(403).json({ error: { code: 'SANCTIONS_MATCH', message: 'Sanctions screening failed', reason: senderScreen.reason } });
      }

      for (const screen of recipientScreens) {
        if (screen.hit) {
          return res.status(403).json({ error: { code: 'SANCTIONS_MATCH', message: 'Recipient sanctions screening failed', reason: screen.reason } });
        }
      }

      // Build batch transaction
      const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await StellarService.getHorizonServer().loadAccount(senderKey);

      const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
        fee: StellarSDK.BASE_FEE * Math.ceil(payments.length / 100),
        networkPassphrase: StellarService.isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
      });

      // Add payment operations
      for (const payment of payments) {
        const assetCode = payment.assetCode ?? 'XLM';
        const asset = assetCode === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(assetCode, getIssuer(assetCode));

        txBuilder.addOperation(
          StellarSDK.Operation.payment({
            destination: payment.destination,
            asset,
            amount: payment.amount.toString(),
          })
        );
      }

      // Add memo if provided
      if (memo) {
        let stellarMemo;
        switch (memoType) {
          case 'id':
            stellarMemo = StellarSDK.Memo.id(memo);
            break;
          case 'hash':
            stellarMemo = StellarSDK.Memo.hash(memo);
            break;
          case 'return':
            stellarMemo = StellarSDK.Memo.return(memo);
            break;
          case 'text':
          default:
            stellarMemo = StellarSDK.Memo.text(memo);
            break;
        }
        txBuilder.addMemo(stellarMemo);
      }

      const transaction = txBuilder.setTimeout(30).build();
      transaction.sign(sourceKeypair);

      // Submit transaction
      const result = await StellarService.getHorizonServer().submitTransaction(transaction);

      res.json({
        hash: result.hash,
        ledger: result.ledger,
        payments: payments.length,
        totalAmount,
        successful: true,
      });
    } catch (error) {
      logError(req, error, { context: 'batch-payment' });
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
