import express from 'express';
import * as OfferService from '../../services/offer.js';
import logger from '../../config/logger.js';

const router = express.Router();

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

router.get('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const offers = await OfferService.getAccountOffers(accountId);
    res.json({ offers });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/create', async (req, res) => {
  try {
    const { sourceSecret, sellingAsset, buyingAsset, sellingAmount, price } = req.body;
    const result = await OfferService.createOffer(
      sourceSecret,
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price
    );
    res.json(result);
  } catch (error) {
    logError(req, error, {
      sellingAsset: req.body.sellingAsset,
      buyingAsset: req.body.buyingAsset,
    });
    res.status(400).json({ error: error.message });
  }
});

router.post('/modify', async (req, res) => {
  try {
    const { sourceSecret, offerId, sellingAsset, buyingAsset, sellingAmount, price } = req.body;
    const result = await OfferService.modifyOffer(
      sourceSecret,
      offerId,
      sellingAsset,
      buyingAsset,
      sellingAmount,
      price
    );
    res.json(result);
  } catch (error) {
    logError(req, error, { offerId: req.body.offerId });
    res.status(400).json({ error: error.message });
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const { sourceSecret, offerId } = req.body;
    const result = await OfferService.cancelOffer(sourceSecret, offerId);
    res.json(result);
  } catch (error) {
    logError(req, error, { offerId: req.body.offerId });
    res.status(400).json({ error: error.message });
  }
});

export default router;
