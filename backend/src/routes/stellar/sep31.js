import express from 'express';
import { body, query, param } from 'express-validator';
import { validate } from '../../middleware/validate.js';
import {
  discoverReceivingAnchor,
  getAnchorInfo,
  createCrossBorderTransaction,
  getTransactionStatus,
} from '../../services/sep31.js';

const router = express.Router();

function sendServiceError(res, error, fallbackMessage) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: error?.message || fallbackMessage });
}

// ── GET /info ─────────────────────────────────────────────────────────────
// Discovers a receiving anchor from `domain`'s stellar.toml, then returns
// its SEP-0031 GET /info response (supported assets, required fields).

/**
 * @swagger
 * /api/stellar/sep31/info:
 *   get:
 *     summary: Discover a SEP-0031 receiving anchor and fetch its supported assets/fields
 *     tags: [SEP31]
 *     parameters:
 *       - in: query
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The receiving anchor's home domain (no scheme)
 *     responses:
 *       200:
 *         description: The anchor's DIRECT_PAYMENT_SERVER and /info response
 *       400:
 *         description: domain is required
 *       404:
 *         description: The domain does not advertise SEP-0031 support
 *       502:
 *         description: Failed to reach the anchor
 */
router.get(
  '/info',
  query('domain').isString().trim().notEmpty().withMessage('domain is required'),
  validate,
  async (req, res) => {
    try {
      const { directPaymentServer } = await discoverReceivingAnchor(req.query.domain);
      const info = await getAnchorInfo(directPaymentServer);
      res.json({ directPaymentServer, ...info });
    } catch (error) {
      sendServiceError(res, error, 'Failed to discover SEP-0031 anchor');
    }
  },
);

// ── POST /transactions ───────────────────────────────────────────────────
// Creates a cross-border payment transaction against a receiving anchor.

/**
 * @swagger
 * /api/stellar/sep31/transactions:
 *   post:
 *     summary: Create a SEP-0031 cross-border payment transaction against a receiving anchor
 *     tags: [SEP31]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [anchorUrl, amount, assetCode]
 *             properties:
 *               anchorUrl:
 *                 type: string
 *                 description: The receiving anchor's DIRECT_PAYMENT_SERVER base URL (from GET /info)
 *               amount:
 *                 type: string
 *               assetCode:
 *                 type: string
 *               senderId:
 *                 type: string
 *               receiverId:
 *                 type: string
 *               fields:
 *                 type: object
 *                 description: Anchor-required transaction fields per its /info response
 *     responses:
 *       200:
 *         description: The anchor's created transaction, including the stellar deposit address/memo
 *       400:
 *         description: Validation error
 *       502:
 *         description: The anchor rejected or could not be reached for the request
 */
router.post(
  '/transactions',
  body('anchorUrl').isURL({ require_tld: false }).withMessage('anchorUrl must be a valid URL'),
  body('amount').isString().trim().notEmpty().withMessage('amount is required'),
  body('assetCode').isString().trim().notEmpty().withMessage('assetCode is required'),
  body('senderId').optional().isString().trim(),
  body('receiverId').optional().isString().trim(),
  body('fields').optional().isObject().withMessage('fields must be an object'),
  validate,
  async (req, res) => {
    try {
      const result = await createCrossBorderTransaction(req.body.anchorUrl, {
        amount: req.body.amount,
        asset_code: req.body.assetCode,
        sender_id: req.body.senderId,
        receiver_id: req.body.receiverId,
        fields: req.body.fields,
      });
      res.json(result);
    } catch (error) {
      sendServiceError(res, error, 'Failed to create SEP-0031 transaction');
    }
  },
);

// ── GET /transactions/:id ────────────────────────────────────────────────
// Polls a transaction's status against the receiving anchor.

/**
 * @swagger
 * /api/stellar/sep31/transactions/{id}:
 *   get:
 *     summary: Poll a SEP-0031 transaction's status from its receiving anchor
 *     tags: [SEP31]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: anchorUrl
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The anchor's current transaction status
 *       400:
 *         description: Validation error
 *       502:
 *         description: Failed to reach the anchor
 */
router.get(
  '/transactions/:id',
  param('id').isString().trim().notEmpty().withMessage('id is required'),
  query('anchorUrl').isURL({ require_tld: false }).withMessage('anchorUrl must be a valid URL'),
  validate,
  async (req, res) => {
    try {
      const transaction = await getTransactionStatus(req.query.anchorUrl, req.params.id);
      res.json(transaction);
    } catch (error) {
      sendServiceError(res, error, 'Failed to fetch SEP-0031 transaction status');
    }
  },
);

export default router;
