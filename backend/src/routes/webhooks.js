import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { registerWebhook, listWebhooks, getWebhook, deleteWebhook } from '../webhooks/store.js';

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

// POST /api/webhooks — register a webhook
router.post('/',
  body('url').isURL().withMessage('Valid URL required'),
  body('accountId').trim().notEmpty().withMessage('accountId required'),
  body('events').optional().isArray().withMessage('events must be an array'),
  validate,
  (req, res) => {
    const { url, accountId, events, secret } = req.body;
    const webhook = registerWebhook({ url, accountId, events, secret });
    res.status(201).json(webhook);
  }
);

// GET /api/webhooks?accountId=...
router.get('/', (req, res) => {
  res.json(listWebhooks(req.query.accountId));
});

// GET /api/webhooks/:id
router.get('/:id', param('id').trim().notEmpty(), validate, (req, res) => {
  const webhook = getWebhook(req.params.id);
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
  const { signingSecret: _, ...safe } = webhook;
  res.json(safe);
});

// DELETE /api/webhooks/:id
router.delete('/:id', param('id').trim().notEmpty(), validate, (req, res) => {
  if (!deleteWebhook(req.params.id)) return res.status(404).json({ error: 'Webhook not found' });
  res.json({ message: 'Webhook deleted' });
});

export default router;
