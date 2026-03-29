import { Router } from 'express';
import {
  findPaths,
  findPathsStrictReceive,
  sendPathPayment,
  optimizePath,
  getPathPaymentAnalytics,
  recordPathPaymentAnalytic,
} from '../services/pathPayment.js';

const router = Router();

// Find paths (strict-send)
router.post('/paths', async (req, res) => {
  try {
    const { sourceAsset, sourceAmount, destinationAsset, destinationAccount } = req.body;
    if (!sourceAsset || !sourceAmount || !destinationAsset) {
      return res.status(400).json({ error: 'sourceAsset, sourceAmount, destinationAsset are required' });
    }
    const paths = await findPaths({ sourceAsset, sourceAmount, destinationAsset, destinationAccount });
    res.json({ paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find paths (strict-receive)
router.post('/paths/receive', async (req, res) => {
  try {
    const { sourceAsset, destinationAsset, destinationAmount } = req.body;
    if (!sourceAsset || !destinationAsset || !destinationAmount) {
      return res.status(400).json({ error: 'sourceAsset, destinationAsset, destinationAmount are required' });
    }
    const paths = await findPathsStrictReceive({ sourceAsset, destinationAsset, destinationAmount });
    res.json({ paths });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Optimize path selection
router.post('/paths/optimize', async (req, res) => {
  try {
    const { sendAsset, sendAmount, destAsset, destAmount } = req.body;
    if (!sendAsset || !sendAmount || !destAsset) {
      return res.status(400).json({ error: 'sendAsset, sendAmount, destAsset are required' });
    }
    const result = await optimizePath({ sendAsset, sendAmount, destAsset, destAmount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute path payment
router.post('/send', async (req, res) => {
  try {
    const { sourceSecret, destination, sendAsset, sendAmount, destAsset, path, slippageBps } = req.body;
    if (!sourceSecret || !destination || !sendAsset || !sendAmount || !destAsset) {
      return res.status(400).json({ error: 'sourceSecret, destination, sendAsset, sendAmount, destAsset are required' });
    }
    const result = await sendPathPayment({ sourceSecret, destination, sendAsset, sendAmount, destAsset, path, slippageBps });
    recordPathPaymentAnalytic({ sendAsset: sendAsset.code, sendAmount, success: result.success });
    res.json(result);
  } catch (err) {
    recordPathPaymentAnalytic({ sendAsset: req.body.sendAsset?.code, sendAmount: req.body.sendAmount, success: false });
    res.status(500).json({ error: err.message });
  }
});

// Analytics
router.get('/analytics', (req, res) => {
  res.json(getPathPaymentAnalytics());
});

export default router;
