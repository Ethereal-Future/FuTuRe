const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../../middleware/auth');
const { dispatchDelivery } = require('../dispatcher');

const router = express.Router();
const prisma = new PrismaClient();

// List webhooks for the authenticated account
router.get('/', authenticate, async (req, res) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { accountId: req.account.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ webhooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a webhook
router.post('/', authenticate, async (req, res) => {
  try {
    const { url, events } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }
    const webhook = await prisma.webhook.create({
      data: {
        url,
        events: events || [],
        accountId: req.account.id,
        status: 'ACTIVE',
        consecutiveFailures: 0,
      },
    });
    res.status(201).json({ webhook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List deliveries for a webhook
router.get('/:id/deliveries', authenticate, async (req, res) => {
  try {
    const webhook = await prisma.webhook.findFirst({
      where: { id: req.params.id, accountId: req.account.id },
    });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redeliver a failed delivery after the endpoint has been repaired
router.post('/deliveries/:id/redeliver', authenticate, async (req, res) => {
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: req.params.id },
      include: { webhook: true },
    });
    if (!delivery || !delivery.webhook) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    if (delivery.webhook.accountId !== req.account.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (delivery.status !== 'FAILED') {
      return res.status(400).json({ error: 'Only failed deliveries can be redelivered' });
    }

    const reset = await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'PENDING', attempt: 0, lastError: null },
    });

    // Re-enable the endpoint so the redriven delivery can be attempted.
    if (delivery.webhook.status === 'DISABLED') {
      await prisma.webhook.update({
        where: { id: delivery.webhook.id },
        data: { status: 'ACTIVE', consecutiveFailures: 0 },
      });
    }

    dispatchDelivery(reset.id).catch((err) => {
      console.error(`Redelivery of ${reset.id} failed:`, err.message);
    });

    res.json({ delivery: reset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
