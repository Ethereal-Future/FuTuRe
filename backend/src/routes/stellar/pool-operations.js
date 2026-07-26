import express from 'express';
import * as PoolService from '../../services/pool.js';
import logger from '../../config/logger.js';

const router = express.Router();

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

router.post('/deposit/estimate', async (req, res) => {
  try {
    const { poolId, amountA, amountB, slippageTolerance } = req.body;
    const estimate = await PoolService.estimateDepositFees(poolId, amountA, amountB, slippageTolerance);
    res.json(estimate);
  } catch (error) {
    logError(req, error, { poolId: req.body.poolId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/withdraw/estimate', async (req, res) => {
  try {
    const { poolId, shares, slippageTolerance } = req.body;
    const estimate = await PoolService.estimateWithdrawFees(poolId, shares, slippageTolerance);
    res.json(estimate);
  } catch (error) {
    logError(req, error, { poolId: req.body.poolId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/deposit', async (req, res) => {
  try {
    const { sourceSecret, poolId, amountA, amountB, slippageTolerance } = req.body;
    const result = await PoolService.executeDeposit(
      sourceSecret,
      poolId,
      amountA,
      amountB,
      slippageTolerance
    );
    res.json(result);
  } catch (error) {
    logError(req, error, { poolId: req.body.poolId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const { sourceSecret, poolId, shares, slippageTolerance } = req.body;
    const result = await PoolService.executeWithdraw(sourceSecret, poolId, shares, slippageTolerance);
    res.json(result);
  } catch (error) {
    logError(req, error, { poolId: req.body.poolId });
    res.status(400).json({ error: error.message });
  }
});

export default router;
