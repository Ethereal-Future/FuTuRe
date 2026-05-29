import express from 'express';
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from '../../services/stellar.js';
import { broadcastToAccount } from '../../services/websocket.js';
import { validate, rules } from '../../middleware/validate.js';
import { dispatchEvent } from '../../webhooks/dispatcher.js';
import { keys as cacheKeys, invalidateBalance } from '../../cache/appCache.js';
import { getSubscriptionByPublicKey, sendWebPush } from '../../notifications/webPush.js';
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

// Stricter rate limit for payment endpoint (10 req/min)
const paymentRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
  message: 'Too many payment requests, please try again later.',
});

router.post('/send', paymentRateLimiter, rules.sendPayment, validate, async (req, res) => {
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

export default router;
