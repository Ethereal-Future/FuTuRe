import express from 'express';
import { validate, rules } from '../middleware/validate.js';
import * as MultiSigService from '../services/multiSig.js';
import { broadcastToAccount } from '../services/websocket.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../config/logger.js';

const router = express.Router();

router.use(requireAuth);

async function callerPublicKey(req) {
  return MultiSigService.getAuthenticatedPublicKey(req.user?.sub);
}

async function requireAccountSigner(req, res, next) {
  if (req.user?.role === 'ADMIN') return next();
  try {
    const publicKey = await callerPublicKey(req);
    const sourcePublicKey =
      req.params.publicKey ?? req.body.sourcePublicKey ?? req.query.sourcePublicKey;
    if (await MultiSigService.isAuthorizedSigner(sourcePublicKey, publicKey)) return next();
    return res.status(403).json({ error: 'You are not authorized for this multi-sig account' });
  } catch {
    return res.status(500).json({ error: 'Failed to verify multi-sig authorization' });
  }
}

async function requirePendingSigner(req, res, next) {
  if (req.user?.role === 'ADMIN') return next();
  try {
    const publicKey = await callerPublicKey(req);
    const access = await MultiSigService.authorizePendingTransaction(
      req.params.txId ?? req.body.txId,
      publicKey,
    );
    if (!access.pending) return res.status(404).json({ error: 'Transaction not found' });
    if (!access.authorized)
      return res.status(403).json({ error: 'You are not authorized for this transaction' });
    req.multiSigPending = access.pending;
    next();
  } catch {
    return res.status(500).json({ error: 'Failed to verify multi-sig authorization' });
  }
}

async function requireSourceOwner(req, res, next) {
  if (req.user?.role === 'ADMIN') return next();
  try {
    const publicKey = await callerPublicKey(req);
    await MultiSigService.assertSourceSecretOwner(req.body.sourceSecret, publicKey);
    next();
  } catch {
    return res.status(403).json({ error: 'Authenticated user does not own the source account' });
  }
}

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
 * /api/multisig/account/create:
 *   post:
 *     summary: Create a multi-signature account
 *     description: Converts an existing Stellar account to multi-sig by setting signers and thresholds.
 *     tags: [MultiSig]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceSecret, signers, thresholds]
 *             properties:
 *               sourceSecret:
 *                 type: string
 *                 description: Secret key of the account to convert
 *               signers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                     weight:
 *                       type: integer
 *               thresholds:
 *                 type: object
 *                 properties:
 *                   low:
 *                     type: integer
 *                   medium:
 *                     type: integer
 *                   high:
 *                     type: integer
 *               masterWeight:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Multi-sig account created
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post(
  '/account/create',
  rules.createMultiSig,
  validate,
  requireSourceOwner,
  async (req, res) => {
    try {
      const { sourceSecret, signers, thresholds, masterWeight } = req.body;
      const result = await MultiSigService.createMultiSigAccount(
        sourceSecret,
        signers,
        thresholds,
        masterWeight,
      );
      broadcastToAccount(result.publicKey, { type: 'multisig_created', ...result });
      res.json(result);
    } catch (error) {
      logError(req, error);
      res.status(500).json({ error: 'Failed to create multi-sig account' });
    }
  },
);
router.post('/account/create', rules.createMultiSig, validate, async (req, res, next) => {
  try {
    const { sourceSecret, signers, thresholds, masterWeight } = req.body;
    const result = await MultiSigService.createMultiSigAccount(
      sourceSecret,
      signers,
      thresholds,
      masterWeight
    );
    broadcastToAccount(result.publicKey, { type: 'multisig_created', ...result });
    res.json(result);
  } catch (error) {
    if (error.status === 400) {
      return next(new AppError(error.message, 400, ErrorCodes.VALIDATION_ERROR));
    }
    logError(req, error);
    res.status(500).json({ error: 'Failed to create multi-sig account' });
  }
});

/**
 * @swagger
 * /api/multisig/account/{publicKey}:
 *   get:
 *     summary: Get multi-sig account configuration
 *     description: Returns current signers and thresholds for an account.
 *     tags: [MultiSig]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account configuration
 *       500:
 *         description: Server error
 */
router.get(
  '/account/:publicKey',
  rules.publicKeyParam,
  validate,
  requireAccountSigner,
  async (req, res) => {
    try {
      const config = await MultiSigService.getMultiSigConfig(req.params.publicKey);
      res.json(config);
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to retrieve multi-sig configuration' });
    }
  },
);

/**
 * @swagger
 * /api/multisig/account/update:
 *   post:
 *     summary: Update multi-sig account configuration
 *     description: Add/remove signers or update thresholds on a multi-sig account.
 *     tags: [MultiSig]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceSecret]
 *             properties:
 *               sourceSecret:
 *                 type: string
 *               masterWeight:
 *                 type: integer
 *               thresholds:
 *                 type: object
 *               addSigners:
 *                 type: array
 *               removeSigners:
 *                 type: array
 *     responses:
 *       200:
 *         description: Configuration updated
 *       500:
 *         description: Server error
 */
router.post(
  '/account/update',
  rules.updateMultiSig,
  validate,
  requireSourceOwner,
  async (req, res) => {
    try {
      const { sourceSecret, ...updates } = req.body;
      const result = await MultiSigService.updateMultiSigConfig(sourceSecret, updates);
      res.json(result);
    } catch (error) {
      logError(req, error);
      res.status(500).json({ error: 'Failed to update multi-sig configuration' });
    }
  },
);
router.post('/account/update', rules.updateMultiSig, validate, async (req, res, next) => {
  try {
    const { sourceSecret, ...updates } = req.body;
    const result = await MultiSigService.updateMultiSigConfig(sourceSecret, updates);
    res.json(result);
  } catch (error) {
    if (error.status === 400) {
      return next(new AppError(error.message, 400, ErrorCodes.VALIDATION_ERROR));
    }
    logError(req, error);
    res.status(500).json({ error: 'Failed to update multi-sig configuration' });
  }
});

/**
 * @swagger
 * /api/multisig/transaction/build:
 *   post:
 *     summary: Build a multi-sig transaction
 *     description: Creates an unsigned transaction XDR for signers to collect signatures on.
 *     tags: [MultiSig]
 *     parameters:
 *       - $ref: '#/components/parameters/IdempotencyKey'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourcePublicKey, destination, amount]
 *             properties:
 *               sourcePublicKey:
 *                 type: string
 *               destination:
 *                 type: string
 *               amount:
 *                 type: string
 *               assetCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction XDR built
 *       500:
 *         description: Server error
 */
router.post('/transaction/build', idempotencyMiddleware, rules.buildMultiSigTx, validate, async (req, res) => {
  try {
    const { sourcePublicKey, destination, amount, assetCode, ttlSeconds, channelAccount } = req.body;
    const result = await MultiSigService.buildMultiSigTransaction(
      sourcePublicKey,
      destination,
      amount,
      assetCode,
      { ttlSeconds, channelAccount }
    );
    broadcastToAccount(sourcePublicKey, { type: 'multisig_tx_pending', ...result });
    res.json(result);
  } catch (error) {
    logError(req, error, { destination: req.body.destination, amount: req.body.amount });
    res.status(500).json({ error: 'Failed to build multi-sig transaction' });
  }
});
router.post(
  '/transaction/build',
  idempotencyMiddleware,
  rules.buildMultiSigTx,
  validate,
  requireAccountSigner,
  async (req, res) => {
    try {
      const { sourcePublicKey, destination, amount, assetCode } = req.body;
      const result = await MultiSigService.buildMultiSigTransaction(
        sourcePublicKey,
        destination,
        amount,
        assetCode,
      );
      broadcastToAccount(sourcePublicKey, { type: 'multisig_tx_pending', ...result });
      res.json(result);
    } catch (error) {
      logError(req, error, { destination: req.body.destination, amount: req.body.amount });
      res.status(500).json({ error: 'Failed to build multi-sig transaction' });
    }
  },
);

/**
 * @swagger
 * /api/multisig/transaction/sign:
 *   post:
 *     summary: Add a signature to a pending multi-sig transaction
 *     tags: [MultiSig]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txId]
 *             properties:
 *               txId:
 *                 type: string
 *               signerSecret:
 *                 type: string
 *                 description: Signer secret (server signs). Required unless signedXdr is provided.
 *               signedXdr:
 *                 type: string
 *                 description: Client-signed transaction envelope. Every signature is verified against the transaction hash for the configured network.
 *               signerPublicKey:
 *                 type: string
 *                 description: Optional public key the client-signed envelope must contain a valid signature from.
 *     responses:
 *       200:
 *         description: Signature added
 *       400:
 *         description: InvalidSignature — a signature failed cryptographic verification
 *       410:
 *         description: Transaction expired
 *       500:
 *         description: Server error
 */
router.post(
  '/transaction/sign',
  rules.signMultiSigTx,
  validate,
  requirePendingSigner,
  async (req, res, next) => {
    try {
      const { txId, signerSecret } = req.body;
      if (req.user?.role !== 'ADMIN') {
        const publicKey = await callerPublicKey(req);
        await MultiSigService.assertSignerSecretOwner(signerSecret, publicKey);
      }
      const result = await MultiSigService.addSignature(txId, signerSecret);
      res.json(result);
    } catch (error) {
      if (error.message?.includes('expired')) {
        return next(new AppError(error.message, 410, ErrorCodes.CONFLICT));
      }
      if (error.message?.includes('not found')) {
        return next(new AppError(error.message, 404, ErrorCodes.NOT_FOUND));
      }
      logError(req, error, { txId: req.body.txId });
      next(error);
router.post('/transaction/sign', rules.signMultiSigTx, validate, async (req, res, next) => {
  try {
    const { txId, signerSecret, signedXdr, signerPublicKey } = req.body;
    const result = await MultiSigService.addSignature(
      txId,
      signedXdr ? { signedXdr, signerPublicKey } : { signerSecret }
    );
    res.json(result);
  } catch (error) {
    if (error.name === 'InvalidSignatureError' || error.status === 400) {
      logger.warn('multisig.signature.rejected', { txId: req.body.txId, error: error.message, details: error.details });
      return next(new AppError(error.message, 400, ErrorCodes.VALIDATION_ERROR, error.details));
    }
    if (error.message?.includes('expired')) {
      return next(new AppError(error.message, 410, ErrorCodes.CONFLICT));
    }
    if (error.message?.includes('not found')) {
      return next(new AppError(error.message, 404, ErrorCodes.NOT_FOUND));
    }
  },
);

/**
 * @swagger
 * /api/multisig/transaction/submit:
 *   post:
 *     summary: Submit a fully-signed multi-sig transaction
 *     tags: [MultiSig]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txId]
 *             properties:
 *               txId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction submitted
 *       500:
 *         description: Server error
 */
router.post('/transaction/submit', rules.submitMultiSigTx, validate, async (req, res) => {
  try {
    const { txId } = req.body;
    const result = await MultiSigService.submitMultiSigTransaction(txId);
    broadcastToAccount(result.hash, { type: 'multisig_tx_submitted', ...result });
    res.json(result);
  } catch (error) {
    if (error.status === 409 || error.code === 'MULTISIG_SEQUENCE_DRIFT' || error.code === 'MULTISIG_CONFLICT') {
      return res.status(409).json({ error: error.message, code: error.code, details: error.details });
    }
    if (error.code === 'INSUFFICIENT_MULTISIG_WEIGHT' || error.status === 400) {
      return res.status(400).json({ error: error.message, code: error.code, details: error.details });
    }
    logError(req, error, { txId: req.body.txId });
    res.status(500).json({ error: 'Failed to submit multi-sig transaction' });
  }
});
router.post(
  '/transaction/submit',
  rules.submitMultiSigTx,
  validate,
  requirePendingSigner,
  async (req, res) => {
    try {
      const { txId } = req.body;
      const result = await MultiSigService.submitMultiSigTransaction(txId);
      broadcastToAccount(result.hash, { type: 'multisig_tx_submitted', ...result });
      res.json(result);
    } catch (error) {
      logError(req, error, { txId: req.body.txId });
      res.status(500).json({ error: 'Failed to submit multi-sig transaction' });
    }
  },
);

/**
 * @swagger
 * /api/multisig/transaction/verify:
 *   post:
 *     summary: Verify signatures on a transaction XDR
 *     tags: [MultiSig]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txXdr, expectedSigners]
 *             properties:
 *               txXdr:
 *                 type: string
 *               expectedSigners:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Verification result
 *       500:
 *         description: Server error
 */
router.post('/transaction/verify', rules.verifyMultiSigTx, validate, async (req, res) => {
  try {
    const { txXdr, expectedSigners } = req.body;
    const result = MultiSigService.verifySignatures(txXdr, expectedSigners);
    res.json(result);
  } catch (error) {
    logError(req, error);
    res.status(500).json({ error: 'Failed to verify signatures' });
  }
});

/**
 * @swagger
 * /api/multisig/transaction/pending/{publicKey}:
 *   get:
 *     summary: Get pending multi-sig transactions for an account
 *     tags: [MultiSig]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of pending transactions
 *       500:
 *         description: Server error
 */
router.get(
  '/transaction/pending/:publicKey',
  rules.publicKeyParam,
  validate,
  requireAccountSigner,
  async (req, res) => {
    try {
      const transactions = await MultiSigService.getPendingTransactions(req.params.publicKey);
      res.json({ transactions });
    } catch (error) {
      logError(req, error, { publicKey: req.params.publicKey });
      res.status(500).json({ error: 'Failed to retrieve pending transactions' });
    }
  },
);
router.get('/transaction/pending/:publicKey', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const transactions = await MultiSigService.getPendingTransactions(req.params.publicKey);
    res.json({ transactions });
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve pending transactions' });
  }
});

/**
 * @swagger
 * /api/multisig/transaction/{txId}:
 *   get:
 *     summary: Get a specific pending transaction by ID
 *     tags: [MultiSig]
 *     parameters:
 *       - in: path
 *         name: txId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.get('/transaction/:txId', requirePendingSigner, async (req, res) => {
  try {
    const tx = await MultiSigService.getPendingTransaction(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (error) {
    logError(req, error, { txId: req.params.txId });
    res.status(500).json({ error: 'Failed to retrieve transaction' });
  }
});

/**
 * @swagger
 * /api/multisig/expired:
 *   get:
 *     summary: List all expired multi-sig transactions
 *     tags: [MultiSig]
 *     parameters:
 *       - in: query
 *         name: sourcePublicKey
 *         schema:
 *           type: string
 *         description: Optional filter by source account
 *     responses:
 *       200:
 *         description: List of expired transactions
 *       500:
 *         description: Server error
 */
router.get('/expired', requireAccountSigner, async (req, res, next) => {
  try {
    const transactions = await MultiSigService.getExpiredTransactions(req.query.sourcePublicKey);
    res.json({ transactions });
  } catch (error) {
    logError(req, error);
    next(error);
  }
});

export default router;
