import express from 'express';
import * as AMMService from '../../services/amm.js';

const router = express.Router();

router.get('/pools', (req, res) => {
  res.json({ pools: AMMService.getAllPools() });
});

router.post('/pools/register', (req, res) => {
  try {
    res.json(AMMService.registerPool(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/pools/:poolId', (req, res) => {
  try {
    res.json(AMMService.getPoolState(req.params.poolId));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.post('/swap', (req, res) => {
  try {
    res.json(AMMService.executeSwap(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/arbitrage/:assetA/:assetB', (req, res) => {
  const opportunities = AMMService.detectArbitrageOpportunities([req.params.assetA, req.params.assetB]);
  res.json({ opportunities });
});

router.post('/strategies/run', (req, res) => {
  try {
    res.json(AMMService.runAutomatedStrategy(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/liquidity/automate', (req, res) => {
  try {
    res.json(AMMService.automateLiquidityProvision(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/yield/estimate', (req, res) => {
  try {
    res.json(AMMService.estimateYieldFarming(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

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
