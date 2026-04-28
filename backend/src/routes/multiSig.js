import express from 'express';
import { validate, rules } from '../middleware/validate.js';
import * as MultiSigService from '../services/multiSig.js';
import { broadcastToAccount } from '../services/websocket.js';
import logger from '../config/logger.js';

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
router.post('/account/create', rules.createMultiSig, validate, async (req, res) => {
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
router.get('/account/:publicKey', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const config = await MultiSigService.getMultiSigConfig(req.params.publicKey);
    res.json(config);
  } catch (error) {
    logError(req, error, { publicKey: req.params.publicKey });
    res.status(500).json({ error: 'Failed to retrieve multi-sig configuration' });
  }
});

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
router.post('/account/update', rules.updateMultiSig, validate, async (req, res) => {
  try {
    const { sourceSecret, ...updates } = req.body;
    const result = await MultiSigService.updateMultiSigConfig(sourceSecret, updates);
    res.json(result);
  } catch (error) {
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
router.post('/transaction/build', rules.buildMultiSigTx, validate, async (req, res) => {
  try {
    const { sourcePublicKey, destination, amount, assetCode } = req.body;
    const result = await MultiSigService.buildMultiSigTransaction(
      sourcePublicKey,
      destination,
      amount,
      assetCode
    );
    broadcastToAccount(sourcePublicKey, { type: 'multisig_tx_pending', ...result });
    res.json(result);
  } catch (error) {
    logError(req, error, { destination: req.body.destination, amount: req.body.amount });
    res.status(500).json({ error: 'Failed to build multi-sig transaction' });
  }
});

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
 *             required: [txId, signerSecret]
 *             properties:
 *               txId:
 *                 type: string
 *               signerSecret:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signature added
 *       500:
 *         description: Server error
 */
router.post('/transaction/sign', rules.signMultiSigTx, validate, async (req, res) => {
  try {
    const { txId, signerSecret } = req.body;
    const result = await MultiSigService.addSignature(txId, signerSecret);
    res.json(result);
  } catch (error) {
    logError(req, error, { txId: req.body.txId });
    res.status(500).json({ error: 'Failed to add signature' });
  }
});

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
    logError(req, error, { txId: req.body.txId });
    res.status(500).json({ error: 'Failed to submit multi-sig transaction' });
  }
});

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
router.get('/transaction/pending/:publicKey', rules.publicKeyParam, validate, async (req, res) => {
  try {
    const transactions = MultiSigService.getPendingTransactions(req.params.publicKey);
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
router.get('/transaction/:txId', async (req, res) => {
  try {
    const tx = MultiSigService.getPendingTransaction(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (error) {
    logError(req, error, { txId: req.params.txId });
    res.status(500).json({ error: 'Failed to retrieve transaction' });
  }
});

export default router;
