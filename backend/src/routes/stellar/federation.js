import express from 'express';
import { body, query } from 'express-validator';
import { validate, rules } from '../../middleware/validate.js';
import {
  buildStellarToml,
  claimFederationAddress,
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
  res.type('text/plain').send(buildStellarToml());
});

export default router;
