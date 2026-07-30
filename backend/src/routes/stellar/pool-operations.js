import express from 'express';
import { body } from 'express-validator';
import * as PoolService from '../../services/pool.js';
import { validate } from '../../middleware/validate.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../../utils/stellarErrors.js';
import logger from '../../config/logger.js';

const router = express.Router();

// ── Regex ─────────────────────────────────────────────────────────────────────

const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function logError(req, error, context = {}) {
  logger.error('pool.operation.error', {
    requestId: req.id,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    ...context,
    error: error.message,
    stack: error.stack,
  });
}

function handlePoolError(req, res, error, context = {}) {
  logError(req, error, context);
  const code = extractStellarErrorCode(error);
  const info = getStellarErrorInfo(code);
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

const poolIdValidator = body('poolId')
  .isString()
  .trim()
  .notEmpty()
  .withMessage('poolId must be a non-empty string');

const positiveAmount = (field) =>
  body(field)
    .isFloat({ gt: 0 })
    .withMessage(`${field} must be a positive number`);

const slippageValidator = body('slippageTolerance')
  .isFloat({ min: 0, max: 1 })
  .withMessage('slippageTolerance must be a number between 0 and 1');

// ── Routes ────────────────────────────────────────────────────────────────────

router.post(
  '/deposit/estimate',
  poolIdValidator,
  positiveAmount('amountA'),
  positiveAmount('amountB'),
  slippageValidator,
  validate,
  async (req, res) => {
    try {
      const { poolId, amountA, amountB, slippageTolerance } = req.body;
      const estimate = await PoolService.estimateDepositFees(
        poolId,
        amountA,
        amountB,
        slippageTolerance,
      );
      res.json(estimate);
    } catch (error) {
      handlePoolError(req, res, error, { poolId: req.body.poolId });
    }
  },
);

router.post(
  '/withdraw/estimate',
  poolIdValidator,
  positiveAmount('shares'),
  slippageValidator,
  validate,
  async (req, res) => {
    try {
      const { poolId, shares, slippageTolerance } = req.body;
      const estimate = await PoolService.estimateWithdrawFees(poolId, shares, slippageTolerance);
      res.json(estimate);
    } catch (error) {
      handlePoolError(req, res, error, { poolId: req.body.poolId });
    }
  },
);

router.post(
  '/deposit',
  secretKeyValidator,
  poolIdValidator,
  positiveAmount('amountA'),
  positiveAmount('amountB'),
  slippageValidator,
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, poolId, amountA, amountB, slippageTolerance } = req.body;
      const result = await PoolService.executeDeposit(
        sourceSecret,
        poolId,
        amountA,
        amountB,
        slippageTolerance,
      );
      res.json(result);
    } catch (error) {
      handlePoolError(req, res, error, { poolId: req.body.poolId });
    }
  },
);

router.post(
  '/withdraw',
  secretKeyValidator,
  poolIdValidator,
  positiveAmount('shares'),
  slippageValidator,
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, poolId, shares, slippageTolerance } = req.body;
      const result = await PoolService.executeWithdraw(
        sourceSecret,
        poolId,
        shares,
        slippageTolerance,
      );
      res.json(result);
    } catch (error) {
      handlePoolError(req, res, error, { poolId: req.body.poolId });
    }
  },
);

export default router;
