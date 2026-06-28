import express from 'express';
import { param, body } from 'express-validator';
import { validate, rules } from '../middleware/validate.js';
import { SUPPORTED_ASSETS } from '../config/assets.js';
import AssetRegistryService from '../services/assetRegistry.js';
import TrustlineManagerService from '../services/trustlineManager.js';
import AssetPortfolioService from '../services/assetPortfolio.js';
import AssetConverterService from '../services/assetConverter.js';

const ASSET_CODE_REGEX = /^[A-Z0-9]{1,12}$/;
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;

const router = express.Router();

const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const networkPassphrase =
  process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const assetRegistry = new AssetRegistryService(horizonUrl);
const trustlineManager = new TrustlineManagerService(horizonUrl, networkPassphrase);
const portfolioService = new AssetPortfolioService(assetRegistry, trustlineManager);
const converterService = new AssetConverterService(horizonUrl, networkPassphrase);

const assetCodeParam = (field) =>
  param(field)
    .trim()
    .matches(ASSET_CODE_REGEX)
    .withMessage(`${field} must be a valid asset code (1-12 alphanumeric characters)`);

const publicKeyParam = (field) =>
  param(field)
    .trim()
    .matches(STELLAR_PUBLIC_KEY_REGEX)
    .withMessage(`${field} must be a valid Stellar public key`);

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
 * @route GET /api/assets/trustlines/:publicKey
 * @desc Get trustlines for account
 */
router.get('/trustlines/:publicKey', publicKeyParam('publicKey'), validate, async (req, res) => {
  try {
    const { publicKey } = req.params;
    const trustlines = await trustlineManager.getTrustlines(publicKey);
    res.json(trustlines);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/portfolio/:publicKey/summary
 * @desc Get portfolio summary
 */
router.get(
  '/portfolio/:publicKey/summary',
  publicKeyParam('publicKey'),
  validate,
  async (req, res) => {
    try {
      const { publicKey } = req.params;
      const summary = await portfolioService.getPortfolioSummary(publicKey);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

/**
 * @route GET /api/assets/portfolio/:publicKey
 * @desc Get portfolio for account
 */
router.get('/portfolio/:publicKey', publicKeyParam('publicKey'), validate, async (req, res) => {
  try {
    const { publicKey } = req.params;
    const portfolio = await portfolioService.getPortfolio(publicKey);
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/assets/:code/:issuer
 * @desc Get specific asset
 */
router.get(
  '/:code/:issuer',
  assetCodeParam('code'),
  param('issuer')
    .trim()
    .matches(STELLAR_PUBLIC_KEY_REGEX)
    .withMessage('issuer must be a valid Stellar public key'),
  validate,
  (req, res) => {
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
  },
);

/**
 * @route POST /api/assets/trustline
 * @desc Create trustline
 */
router.post(
  '/trustline',
  body('sourceSecret')
    .trim()
    .matches(STELLAR_SECRET_KEY_REGEX)
    .withMessage('Invalid Stellar secret key'),
  body('assetCode')
    .trim()
    .matches(ASSET_CODE_REGEX)
    .withMessage('Invalid asset code')
    .isIn(SUPPORTED_ASSETS.filter((a) => a !== 'XLM'))
    .withMessage(
      `Unsupported asset. Supported non-native: ${SUPPORTED_ASSETS.filter((a) => a !== 'XLM').join(', ')}`,
    ),
  body('assetIssuer')
    .trim()
    .matches(STELLAR_PUBLIC_KEY_REGEX)
    .withMessage('Invalid asset issuer public key'),
  body('limit').optional().isFloat({ gt: 0 }).withMessage('limit must be a positive number'),
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, assetCode, assetIssuer, limit } = req.body;
      const result = await trustlineManager.createTrustline(
        sourceSecret,
        assetCode,
        assetIssuer,
        limit,
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * @route POST /api/assets/convert
 * @desc Convert between assets
 */
router.post(
  '/convert',
  body('sourceSecret')
    .trim()
    .matches(STELLAR_SECRET_KEY_REGEX)
    .withMessage('Invalid Stellar secret key'),
  body('sourceAsset').trim().matches(ASSET_CODE_REGEX).withMessage('Invalid source asset code'),
  body('destAsset').trim().matches(ASSET_CODE_REGEX).withMessage('Invalid destination asset code'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
  body('destMin').optional().isFloat({ gt: 0 }).withMessage('destMin must be a positive number'),
  validate,
  async (req, res) => {
    try {
      const { sourceSecret, sourceAsset, destAsset, amount, destMin } = req.body;
      const result = await converterService.convertAsset(
        sourceSecret,
        sourceAsset,
        destAsset,
        amount,
        destMin,
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * @route GET /api/assets/price/:code/:issuer
 * @desc Get asset price
 */
router.get(
  '/price/:code/:issuer',
  assetCodeParam('code'),
  param('issuer')
    .trim()
    .matches(STELLAR_PUBLIC_KEY_REGEX)
    .withMessage('issuer must be a valid Stellar public key'),
  validate,
  async (req, res) => {
    try {
      const { code, issuer } = req.params;
      const { base = 'XLM' } = req.query;
      const price = await assetRegistry.trackAssetPrice(code, issuer, base);
      res.json({ code, issuer, price, base });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
