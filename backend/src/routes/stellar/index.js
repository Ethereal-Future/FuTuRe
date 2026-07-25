import express from 'express';
import accountsRouter from './accounts.js';
import paymentsRouter from './payments.js';
import exchangeRouter from './exchange.js';
import ratesRouter from './rates.js';
import convertRouter from './convert.js';
import networkRouter from './network.js';
import trustlinesRouter from './trustlines.js';
import ammRouter from './amm.js';
import federationRouter from './federation.js';
import contractRouter from './contract.js';
import { getStellarNetwork } from '../../services/stellarNetwork.js';
import logger from '../../config/logger.js';

const router = express.Router();

// Mount sub-routers to maintain backward compatibility with original routes
router.use('/account', accountsRouter);
router.use('/payment', paymentsRouter);
router.use('/exchange-rate', exchangeRouter);
router.use('/fee-stats', exchangeRouter);
router.use('/rates', ratesRouter);
router.use('/convert', convertRouter);
router.use('/network', networkRouter);
router.use('/trustline', trustlinesRouter);
router.use('/assets', trustlinesRouter);
router.use('/amm', ammRouter);
router.use('/federation', federationRouter);
router.use('/contract', contractRouter);

// GET /api/stellar/network-status — fee surge indicator
router.get('/network-status', async (req, res) => {
  try {
    const status = await getStellarNetwork().getNetworkStatusWithFeeSurge();
    res.json(status);
  } catch (error) {
    logger.error('route.error', { path: '/network-status', error: error.message });
    res.status(500).json({ error: 'Failed to retrieve network status' });
  }
});

export default router;
