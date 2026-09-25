import express from 'express';
import { param, body } from 'express-validator';
import * as StellarSDK from '@stellar/stellar-sdk';
import { getRate } from '../../services/exchangeRate.js';
import { createQuote, getValidQuote, consumeQuote } from '../../services/conversionQuote.js';
import { sendPathPayment } from '../../services/pathPayment.js';
import { validate, rules } from '../../middleware/validate.js';
import logger from '../../config/logger.js';

const router = express.Router({ mergeParams: true });

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

const FIAT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'PHP', 'INR', 'MXN', 'BRL', 'AUD', 'CAD', 'CHF', 'SGD', 'HKD', 'KRW', 'NGN']);

// GET /convert/:from/:to/:amount
// Returns a quote valid for QUOTE_TTL_S (default 60s). Execute it with
// POST /convert/execute { quoteId, sourceSecret } before `validUntil`.
router.get(
  '/:from/:to/:amount',
  ...rules.assetCodeParams,
  param('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
  validate,
  async (req, res) => {
    try {
      const { from, to } = req.params;
      const amount = parseFloat(req.params.amount);
      const rate = await getRate(from, to);
      if (rate == null) {
        return res.status(503).json({ error: `Exchange rate unavailable for ${from}/${to}` });
      }

      const quote = await createQuote({ from, to, amount, rate });
      res.json({
        quoteId: quote.quoteId,
        from,
        to,
        amount,
        rate,
        guaranteedRate: quote.guaranteedRate,
        converted: quote.converted,
        quote: quote.converted,
        createdAt: quote.createdAt,
        validUntil: quote.validUntil,
        expiresAt: quote.validUntil,
      });
    } catch (error) {
      logError(req, error, { from: req.params.from, to: req.params.to, amount: req.params.amount });
      res.status(500).json({ error: 'Failed to convert amount' });
    }
  },
);

// POST /convert/execute
// Executes a previously issued quote as a strict-send path payment. The
// recipient is guaranteed at least the quoted `converted` amount; quotes past
// `validUntil` are rejected before anything is submitted.
router.post(
  '/execute',
  body('quoteId').isUUID().withMessage('quoteId must be a valid quote identifier'),
  body('sourceSecret').trim().matches(/^S[A-Z2-7]{55}$/).withMessage('Invalid Stellar secret key'),
  body('destination')
    .optional()
    .trim()
    .matches(/^G[A-Z2-7]{55}$/)
    .withMessage('Invalid destination public key'),
  validate,
  async (req, res) => {
    const { quoteId, sourceSecret, destination } = req.body;
    try {
      const lookup = await getValidQuote(quoteId);
      if (lookup.status === 'expired') {
        return res.status(410).json({ error: 'QuoteExpired', message: 'Quote expired. Please refresh for a current rate.' });
      }
      if (lookup.status === 'not_found') {
        return res.status(404).json({ error: 'QuoteNotFound', message: 'Quote not found or expired. Please refresh for a current rate.' });
      }

      const { quote } = lookup;
      if (FIAT_CURRENCIES.has(quote.from) || FIAT_CURRENCIES.has(quote.to)) {
        return res.status(422).json({ error: 'QuoteNotExecutable', message: 'Fiat conversion quotes are indicative only and cannot be executed on-chain.' });
      }

      if (!(await consumeQuote(quote))) {
        return res.status(409).json({ error: 'QuoteAlreadyUsed', message: 'This quote has already been executed. Please refresh for a current rate.' });
      }

      const recipient = destination || StellarSDK.Keypair.fromSecret(sourceSecret).publicKey();
      const result = await sendPathPayment({
        sourceSecret,
        destination: recipient,
        sendAsset: { code: quote.from },
        sendAmount: quote.amount,
        destAsset: { code: quote.to },
        minDestAmount: quote.converted,
      });

      res.json({
        quoteId,
        guaranteedRate: quote.guaranteedRate,
        guaranteedAmount: quote.converted,
        ...result,
      });
    } catch (error) {
      logError(req, error, { quoteId });
      res.status(500).json({ error: error.message || 'Failed to execute conversion', code: error.code });
    }
  },
);

export default router;
