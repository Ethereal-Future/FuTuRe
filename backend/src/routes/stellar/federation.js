import express from 'express';
import { body, query } from 'express-validator';
import { validate, rules } from '../../middleware/validate.js';
import {
  claimFederationAddress,
  getFederationDomain,
  resolveFederationAddress,
} from '../../services/federation.js';

const router = express.Router();

router.get(
  '/',
  query('address').isString().trim().notEmpty().withMessage('address is required'),
  validate,
  async (req, res) => {
    try {
      const result = await resolveFederationAddress(req.query.address);
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to resolve federation address' });
    }
  },
);

router.put(
  '/claim/:publicKey',
  rules.publicKeyParam,
  body('localPart').isString().trim().notEmpty(),
  validate,
  async (req, res) => {
    try {
      const result = await claimFederationAddress({
        publicKey: req.params.publicKey,
        localPart: req.body.localPart,
      });
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to claim federation address' });
    }
  },
);

router.get('/stellar.toml', (_req, res) => {
  const baseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3001';
  res.type('text/plain').send([
    `FEDERATION_SERVER="${baseUrl}/api/v1/stellar/federation"`,
    `SIGNING_KEY="${process.env.STELLAR_SIGNING_KEY || ''}"`,
    `NETWORK_PASSPHRASE="${process.env.STELLAR_NETWORK === 'mainnet' ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015'}"`,
    `TRANSFER_SERVER="${baseUrl}/api/v1/stellar"`,
    `ACCOUNTS=[]`,
    `VERSION="2.0.0"`,
    `# Federation domain: ${getFederationDomain()}`,
  ].join('\n'));
});

export default router;
