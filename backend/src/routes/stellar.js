import express from 'express';
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from '../services/stellar.js';
import { broadcastToAccount } from '../services/websocket.js';

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
router.get('/account/:publicKey', async (req, res) => {
  try {
    const balance = await StellarService.getBalance(req.params.publicKey);
    res.json(balance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
router.post('/payment/send', async (req, res) => {
  try {
    const { sourceSecret, destination, amount, assetCode } = req.body;
    const result = await StellarService.sendPayment(sourceSecret, destination, amount, assetCode);

    const notification = { type: 'transaction', hash: result.hash, amount, assetCode: assetCode || 'XLM', timestamp: Date.now() };

    // Notify sender's updated balance + tx notification
    const senderKey = StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();
    const senderBalance = await StellarService.getBalance(senderKey);
    broadcastToAccount(senderKey, { ...notification, direction: 'sent', balance: senderBalance.balances });

    // Notify recipient of incoming tx + updated balance
    try {
      const recipientBalance = await StellarService.getBalance(destination);
      broadcastToAccount(destination, { ...notification, direction: 'received', balance: recipientBalance.balances });
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
router.get('/exchange-rate/:from/:to', async (req, res) => {
  try {
    const rate = await StellarService.getExchangeRate(req.params.from, req.params.to);
    res.json({ rate });
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

export default router;

