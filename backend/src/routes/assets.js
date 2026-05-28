import express from 'express';
import AssetRegistryService from '../services/assetRegistry.js';
import TrustlineManagerService from '../services/trustlineManager.js';
import AssetPortfolioService from '../services/assetPortfolio.js';
import AssetConverterService from '../services/assetConverter.js';

const router = express.Router();

const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const assetRegistry = new AssetRegistryService(horizonUrl);
const trustlineManager = new TrustlineManagerService(horizonUrl, networkPassphrase);
const portfolioService = new AssetPortfolioService(assetRegistry, trustlineManager);
const converterService = new AssetConverterService(horizonUrl, networkPassphrase);

/**
 * @route POST /api/assets/register
 * @desc Register a new asset
 */
router.post('/register', async (req, res) => {
  try {
    const asset = await assetRegistry.registerAsset(req.body);
    res.json(asset);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/discover
 * @desc Discover assets from Stellar network
 */
router.get('/discover', async (req, res) => {
  try {
    const assets = await assetRegistry.discoverAssets(req.query);
    res.json(assets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets
 * @desc Get all registered assets
 */
router.get('/', (req, res) => {
  try {
    const assets = assetRegistry.getAllAssets();
    res.json(assets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/:code/:issuer
 * @desc Get specific asset
 */
router.get('/:code/:issuer', (req, res) => {
  try {
    const { code, issuer } = req.params;
    const asset = assetRegistry.getAsset(code, issuer);
    
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    
    res.json(asset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route POST /api/assets/trustline
 * @desc Create trustline
 */
router.post('/trustline', async (req, res) => {
  try {
    const { sourceSecret, assetCode, assetIssuer, limit } = req.body;
    const result = await trustlineManager.createTrustline(
      sourceSecret,
      assetCode,
      assetIssuer,
      limit
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/trustlines/:publicKey
 * @desc Get trustlines for account
 */
router.get('/trustlines/:publicKey', async (req, res) => {
  try {
    const { publicKey } = req.params;
    const trustlines = await trustlineManager.getTrustlines(publicKey);
    res.json(trustlines);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/portfolio/:publicKey
 * @desc Get portfolio for account
 */
router.get('/portfolio/:publicKey', async (req, res) => {
  try {
    const { publicKey } = req.params;
    const portfolio = await portfolioService.getPortfolio(publicKey);
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/portfolio/:publicKey/summary
 * @desc Get portfolio summary
 */
router.get('/portfolio/:publicKey/summary', async (req, res) => {
  try {
    const { publicKey } = req.params;
    const summary = await portfolioService.getPortfolioSummary(publicKey);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route POST /api/assets/convert
 * @desc Convert between assets
 */
router.post('/convert', async (req, res) => {
  try {
    const { sourceSecret, sourceAsset, destAsset, amount, destMin } = req.body;
    const result = await converterService.convertAsset(
      sourceSecret,
      sourceAsset,
      destAsset,
      amount,
      destMin
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/price/:code/:issuer
 * @desc Get asset price
 */
router.get('/price/:code/:issuer', async (req, res) => {
  try {
    const { code, issuer } = req.params;
    const { base = 'XLM' } = req.query;
    const price = await assetRegistry.trackAssetPrice(code, issuer, base);
    res.json({ code, issuer, price, base });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
