import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  findPaths,
  findPathsStrictReceive,
  sendPathPayment,
  sendPathPaymentStrictReceive,
  optimizePath,
  getPathPaymentAnalytics,
  recordPathPaymentAnalytic,
  validateSlippageTolerance,
} from '../services/pathPayment.js';
import { validate, rules } from '../middleware/validate.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { SUPPORTED_ASSETS } from '../config/assets.js';

// Intentionally public: path-finding routes only simulate conversions (no
// funds move), and /send requires a `sourceSecret`, the same secret-key
// possession model used by routes/stellar/*. /analytics exposes only
// aggregate, non-user-scoped stats. See #1102.
const router = Router();

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;

const assetField = (field) =>
  body(field)
    .trim()
    .matches(ASSET_CODE)
    .withMessage(`${field}: invalid asset code`)
    .isIn(SUPPORTED_ASSETS)
    .withMessage(`${field}: unsupported asset`);

const amountField = (field) =>
  body(field)
    .trim()
    .isFloat({ gt: 0 })
    .withMessage(`${field}: must be a positive number`)
    .custom((v) => {
      if (parseFloat(v).toFixed(7).split('.')[1].replace(/0+$/, '').length > 7)
        throw new Error(`${field}: max 7 decimal places`);
      return true;
    });

// ISSUE-045: slippageTolerancePercent — required on send endpoints, default 0.5%
const slippageField = body('slippageTolerancePercent')
  .optional()
  .isFloat({ gt: 0, max: 5 })
  .withMessage('slippageTolerancePercent must be a positive number between 0 and 5 (default: 0.5)');

// Find paths (strict-send)
router.post(
  '/paths',
  assetField('sourceAsset'),
  amountField('sourceAmount'),
  assetField('destinationAsset'),
  body('destinationAccount')
    .optional()
    .trim()
    .matches(STELLAR_PUBLIC_KEY)
    .withMessage('Invalid destination account'),
  validate,
  async (req, res) => {
    try {
      const { sourceAsset, sourceAmount, destinationAsset, destinationAccount } = req.body;
      const paths = await findPaths({
        sourceAsset,
        sourceAmount,
        destinationAsset,
        destinationAccount,
      });
      res.json({ paths });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Find paths (strict-receive)
router.post(
  '/paths/receive',
  assetField('sourceAsset'),
  assetField('destinationAsset'),
  amountField('destinationAmount'),
  validate,
  async (req, res) => {
    try {
      const { sourceAsset, destinationAsset, destinationAmount } = req.body;
      const paths = await findPathsStrictReceive({
        sourceAsset,
        destinationAsset,
        destinationAmount,
      });
      res.json({ paths });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Optimize path selection
router.post(
  '/paths/optimize',
  assetField('sendAsset'),
  amountField('sendAmount'),
  assetField('destAsset'),
  validate,
  async (req, res) => {
    try {
      const { sendAsset, sendAmount, destAsset, destAmount } = req.body;
      const result = await optimizePath({ sendAsset, sendAmount, destAsset, destAmount });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * @swagger
 * /api/path-payment/send:
 *   post:
 *     summary: Execute a strict-send path payment
 *     description: Sends a cross-asset payment along a conversion path.
 *     tags: [PathPayment]
 *     parameters:
 *       - $ref: '#/components/parameters/IdempotencyKey'
 *     responses:
 *       200:
 *         description: Path payment result
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
// Execute strict-send path payment
router.post(
  '/send',
  idempotencyMiddleware,
  body('sourceSecret').trim().matches(STELLAR_SECRET_KEY).withMessage('Invalid Stellar secret key'),
  body('destination')
    .trim()
    .matches(STELLAR_PUBLIC_KEY)
    .withMessage('Invalid destination public key'),
  assetField('sendAsset'),
  amountField('sendAmount'),
  assetField('destAsset'),
  slippageField,
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, destination, sendAsset, sendAmount, destAsset, path, slippageBps } =
        req.body;
      const result = await sendPathPayment({
        sourceSecret,
        destination,
        sendAsset,
        sendAmount,
        destAsset,
        path,
        slippageBps,
      });
      recordPathPaymentAnalytic({ sendAsset: sendAsset.code, sendAmount, success: result.success });
      res.json(result);
    } catch (err) {
      recordPathPaymentAnalytic({
        sendAsset: req.body.sendAsset?.code,
        sendAmount: req.body.sendAmount,
        success: false,
      });
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * @swagger
 * /api/path-payment/send/strict-receive:
 *   post:
 *     summary: Execute a strict-receive path payment with sendMax slippage protection
 *     description: >
 *       The destination receives exactly `destAmount`; the sender pays at most
 *       `sendMax = quotedSourceAmount * (1 + slippageTolerancePercent / 100)`.
 *       Requests are rejected when sendMax would exceed the sender's available
 *       balance (ISSUE-045).
 *     tags: [PathPayment]
 *     parameters:
 *       - $ref: '#/components/parameters/IdempotencyKey'
 *     responses:
 *       200:
 *         description: Path payment result including sendMax and quotedSourceAmount
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error or sendMax exceeds balance
 */
// Execute strict-receive path payment (ISSUE-045)
router.post(
  '/send/strict-receive',
  idempotencyMiddleware,
  body('sourceSecret').trim().matches(STELLAR_SECRET_KEY).withMessage('Invalid Stellar secret key'),
  body('destination')
    .trim()
    .matches(STELLAR_PUBLIC_KEY)
    .withMessage('Invalid destination public key'),
  assetField('sendAsset'),
  assetField('destAsset'),
  amountField('destAmount'),
  slippageField,
  validate,
  async (req, res) => {
    try {
      const {
        sourceSecret,
        destination,
        sendAsset,
        destAsset,
        destAmount,
        path,
        slippageTolerancePercent,
      } = req.body;
      const result = await sendPathPaymentStrictReceive({
        sourceSecret,
        destination,
        sendAsset,
        destAsset,
        destAmount,
        path,
        slippageTolerancePercent,
      });
      recordPathPaymentAnalytic({ sendAsset: sendAsset.code, sendAmount: result.sendMax, success: result.success });
      res.json(result);
    } catch (err) {
      recordPathPaymentAnalytic({
        sendAsset: req.body.sendAsset?.code,
        sendAmount: req.body.destAmount,
        success: false,
      });
      res.status(500).json({ error: err.message });
    }
  },
);

// Analytics
router.get('/analytics', (req, res) => {
  res.json(getPathPaymentAnalytics());
});

export default router;
