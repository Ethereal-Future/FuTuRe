import express from 'express';
import { body, param } from 'express-validator';
import * as AMMService from '../../services/amm.js';
import { validate } from '../../middleware/validate.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const swapRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: 'Too many swap requests, please try again later.',
});

const liquidityAutomateRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: 'Too many liquidity automation requests, please try again later.',
});

// ── Validators ────────────────────────────────────────────────────────────────

const poolIdBody = body('poolId')
  .isString()
  .trim()
  .notEmpty()
  .withMessage('poolId must be a non-empty string');

const assetNameBody = (field) =>
  body(field)
    .isString()
    .trim()
    .notEmpty()
    .withMessage(`${field} must be a non-empty string`);

const positiveFloat = (field) =>
  body(field)
    .isFloat({ gt: 0 })
    .withMessage(`${field} must be a positive number`);

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/pools', (req, res) => {
  res.json({ pools: AMMService.getAllPools() });
});

router.post(
  '/pools/register',
  assetNameBody('poolId'),
  assetNameBody('assetA'),
  assetNameBody('assetB'),
  positiveFloat('reserveA'),
  positiveFloat('reserveB'),
  body('feeBps').optional().isInt({ min: 0 }).withMessage('feeBps must be a non-negative integer'),
  validate,
  (req, res) => {
    try {
      res.json(AMMService.registerPool(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

router.get('/pools/:poolId', (req, res) => {
  try {
    res.json(AMMService.getPoolState(req.params.poolId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.post(
  '/swap',
  swapRateLimiter,
  poolIdBody,
  assetNameBody('inputAsset'),
  positiveFloat('amountIn'),
  body('traderId').optional().isString().trim().notEmpty().withMessage('traderId must be a non-empty string'),
  validate,
  (req, res) => {
    try {
      res.json(AMMService.executeSwap(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

router.get(
  '/arbitrage/:assetA/:assetB',
  param('assetA').isString().trim().notEmpty().withMessage('assetA must be a non-empty string'),
  param('assetB').isString().trim().notEmpty().withMessage('assetB must be a non-empty string'),
  validate,
  (req, res) => {
    const opportunities = AMMService.detectArbitrageOpportunities([
      req.params.assetA,
      req.params.assetB,
    ]);
    res.json({ opportunities });
  },
);

router.post(
  '/strategies/run',
  poolIdBody,
  body('strategy')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('strategy must be a non-empty string'),
  body('marketPrices')
    .optional()
    .isArray()
    .withMessage('marketPrices must be an array'),
  validate,
  (req, res) => {
    try {
      res.json(AMMService.runAutomatedStrategy(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

router.post(
  '/liquidity/automate',
  liquidityAutomateRateLimiter,
  poolIdBody,
  body('providerId').isString().trim().notEmpty().withMessage('providerId must be a non-empty string'),
  positiveFloat('capital'),
  body('targetWeightA')
    .isFloat({ min: 0, max: 1 })
    .withMessage('targetWeightA must be a number between 0 and 1'),
  validate,
  (req, res) => {
    try {
      res.json(AMMService.automateLiquidityProvision(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

router.post(
  '/yield/estimate',
  poolIdBody,
  body('providerId').isString().trim().notEmpty().withMessage('providerId must be a non-empty string'),
  validate,
  (req, res) => {
    try {
      res.json(AMMService.estimateYieldFarming(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

router.get('/analytics', (req, res) => {
  res.json(AMMService.getAMMAnalytics());
});

router.get('/risk', (req, res) => {
  res.json(AMMService.runRiskChecks());
});

router.get('/optimize', (req, res) => {
  res.json(AMMService.optimizeAMMPerformance());
});

export default router;
