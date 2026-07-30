import express from 'express';
import { body, param } from 'express-validator';
import * as OfferService from '../../services/offer.js';
import { validate } from '../../middleware/validate.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../../utils/stellarErrors.js';
import logger from '../../config/logger.js';

const router = express.Router();

// ── Regex ─────────────────────────────────────────────────────────────────────

const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function logError(req, error, context = {}) {
  logger.error('offer.error', {
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
 * Map a caught error to the right HTTP status + body, using stellarErrors.js
 * for Horizon-originating failures and falling back to the raw message otherwise.
 */
function handleOfferError(req, res, error, context = {}) {
  logError(req, error, context);
  const code = extractStellarErrorCode(error);
  const info = getStellarErrorInfo(code);
  // Use 400 for permanent Stellar errors, 503/504 for transient infra, 500 otherwise
  if (code === 'connection_error') {
    return res.status(503).json({ error: info.userMessage, code });
  }
  if (code === 'timeout') {
    return res.status(504).json({ error: info.userMessage, code });
  }
  if (!info.retryable && code !== 'tx_failed') {
    return res.status(400).json({ error: info.userMessage, code });
  }
  return res.status(500).json({ error: info.userMessage, code });
}

// ── Shared validators ─────────────────────────────────────────────────────────

const secretKeyValidator = body('sourceSecret')
  .trim()
  .matches(STELLAR_SECRET_KEY)
  .withMessage('sourceSecret must be a valid Stellar secret key (S…, 56 chars)');

const assetValidator = (field) =>
  body(field)
    .isString()
    .trim()
    .notEmpty()
    .withMessage(`${field} must be a non-empty string`);

const positiveAmountValidator = (field) =>
  body(field)
    .isFloat({ gt: 0 })
    .withMessage(`${field} must be a positive number`);

// ── Routes ────────────────────────────────────────────────────────────────────

router.get(
  '/:accountId',
  param('accountId')
    .trim()
    .matches(/^G[A-Z2-7]{55}$/)
    .withMessage('accountId must be a valid Stellar public key'),
  validate,
  async (req, res) => {
    try {
      const offers = await OfferService.getAccountOffers(req.params.accountId);
      res.json({ offers });
    } catch (error) {
      handleOfferError(req, res, error, { accountId: req.params.accountId });
    }
  },
);

router.post(
  '/create',
  secretKeyValidator,
  assetValidator('sellingAsset'),
  assetValidator('buyingAsset'),
  positiveAmountValidator('sellingAmount'),
  positiveAmountValidator('price'),
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, sellingAsset, buyingAsset, sellingAmount, price } = req.body;
      const result = await OfferService.createOffer(
        sourceSecret,
        sellingAsset,
        buyingAsset,
        sellingAmount,
        price,
      );
      res.json(result);
    } catch (error) {
      handleOfferError(req, res, error, {
        sellingAsset: req.body.sellingAsset,
        buyingAsset: req.body.buyingAsset,
      });
    }
  },
);

router.post(
  '/modify',
  secretKeyValidator,
  body('offerId').isString().trim().notEmpty().withMessage('offerId must be a non-empty string'),
  assetValidator('sellingAsset'),
  assetValidator('buyingAsset'),
  positiveAmountValidator('sellingAmount'),
  positiveAmountValidator('price'),
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, offerId, sellingAsset, buyingAsset, sellingAmount, price } = req.body;
      const result = await OfferService.modifyOffer(
        sourceSecret,
        offerId,
        sellingAsset,
        buyingAsset,
        sellingAmount,
        price,
      );
      res.json(result);
    } catch (error) {
      handleOfferError(req, res, error, { offerId: req.body.offerId });
    }
  },
);

router.post(
  '/cancel',
  secretKeyValidator,
  body('offerId').isString().trim().notEmpty().withMessage('offerId must be a non-empty string'),
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, offerId } = req.body;
      const result = await OfferService.cancelOffer(sourceSecret, offerId);
      res.json(result);
    } catch (error) {
      handleOfferError(req, res, error, { offerId: req.body.offerId });
    }
  },
);

export default router;
