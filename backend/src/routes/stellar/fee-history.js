import express from 'express';
import * as FeeHistoryService from '../../services/feeHistory.js';
import logger from '../../config/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const data = await FeeHistoryService.getFeeHistory(parseInt(hours, 10));
    res.json(data);
  } catch (error) {
    logger.error('feeHistory.route.error', {
      error: error.message,
      path: '/fee-history',
    });
    res.status(500).json({
      error: 'Failed to retrieve fee history',
      message: error.message,
    });
  }
});

router.get('/cache-stats', async (req, res) => {
  try {
    const stats = FeeHistoryService.getCacheStats();
    res.json(stats);
  } catch (error) {
    logger.error('feeHistory.cacheStats.error', {
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

router.post('/clear-cache', async (req, res) => {
  try {
    await FeeHistoryService.clearFeeCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    logger.error('feeHistory.clearCache.error', {
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

export default router;
