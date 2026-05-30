import express from 'express';
import accountsRouter from './accounts.js';
import paymentsRouter from './payments.js';
import exchangeRouter from './exchange.js';
import ratesRouter from './rates.js';
import convertRouter from './convert.js';
import networkRouter from './network.js';
import trustlinesRouter from './trustlines.js';
import ammRouter from './amm.js';

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

export default router;
