import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { registerWebhook, listWebhooks, deleteWebhook, rotateWebhookSecret, verifyWebhookSignature } from '../webhooks/store.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * @swagger
 * /api/webhooks:
 *   post:
 *     summary: Register a new webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, events]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Webhook registered
 *       401:
 *         description: Unauthorized
 */
router.post('/', requireAuth, (req, res) => {
  const { url, events } = req.body;
  
  if (!url) return res.status(400).json({ error: 'url is required' });
  
  try {
    const webhook = registerWebhook({
      url,
      accountId: req.user.sub,
      events: events || ['*'],
    });
    
    logger.info({ webhookId: webhook.id, accountId: req.user.sub }, 'Webhook registered');
    res.status(201).json(webhook);
  } catch (err) {
    logger.error({ err }, 'Failed to register webhook');
    res.status(500).json({ error: 'Failed to register webhook' });
  }
});

/**
 * @swagger
 * /api/webhooks:
 *   get:
 *     summary: List webhooks for authenticated user
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of webhooks
 *       401:
 *         description: Unauthorized
 */
router.get('/', requireAuth, (req, res) => {
  try {
    const webhooks = listWebhooks(req.user.sub);
    res.json(webhooks);
  } catch (err) {
    logger.error({ err }, 'Failed to list webhooks');
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

/**
 * @swagger
 * /api/webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Webhook not found
 */
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const deleted = deleteWebhook(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' });
    
    logger.info({ webhookId: req.params.id, accountId: req.user.sub }, 'Webhook deleted');
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete webhook');
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

/**
 * @swagger
 * /api/webhooks/{id}/rotate-secret:
 *   post:
 *     summary: Rotate webhook secret
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Secret rotated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Webhook not found
 */
router.post('/:id/rotate-secret', requireAuth, (req, res) => {
  try {
    const result = rotateWebhookSecret(req.params.id);
    logger.info({ webhookId: req.params.id, accountId: req.user.sub }, 'Webhook secret rotated');
    res.json(result);
  } catch (err) {
    if (err.message === 'Webhook not found') {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    logger.error({ err }, 'Failed to rotate webhook secret');
    res.status(500).json({ error: 'Failed to rotate webhook secret' });
  }
});

/**
 * @swagger
 * /api/webhooks/verify:
 *   post:
 *     summary: Verify webhook signature (for testing)
 *     tags: [Webhooks]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [webhookId, signature, payload]
 *             properties:
 *               webhookId:
 *                 type: string
 *               signature:
 *                 type: string
 *               payload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Verification result
 */
router.post('/verify', (req, res) => {
  const { webhookId, signature, payload } = req.body;
  
  if (!webhookId || !signature || !payload) {
    return res.status(400).json({ error: 'webhookId, signature, and payload are required' });
  }
  
  const valid = verifyWebhookSignature(webhookId, signature, payload);
  res.json({ valid });
});

export default router;
