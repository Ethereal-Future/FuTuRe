import express from 'express';
import { getAssetIntegrityManifest, getAssetIntegrity } from '../utils/sriManifest.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * @swagger
 * /api/assets/integrity:
 *   get:
 *     summary: Get the SRI integrity manifest for built frontend assets
 *     description: >
 *       Returns pre-computed sha384 Subresource Integrity hashes for every
 *       built .js/.css asset, keyed by asset path. Use these values to
 *       populate the `integrity` attribute on <script>/<link> tags — SRI is
 *       only enforced by the browser when the hash is present in the HTML
 *       tag itself, not via a response header (#1121).
 *     tags: [Assets]
 *     responses:
 *       200:
 *         description: Integrity manifest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 algorithm:
 *                   type: string
 *                 generatedAt:
 *                   type: string
 *                 hashes:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 */
router.get('/integrity', (req, res) => {
  try {
    const manifest = getAssetIntegrityManifest();
    res.json(manifest);
  } catch (error) {
    logger.error('assetIntegrity.manifest.failed', { error: error.message });
    res.status(500).json({ error: 'Failed to build asset integrity manifest' });
  }
});

/**
 * @swagger
 * /api/assets/integrity/{assetPath}:
 *   get:
 *     summary: Get the SRI integrity hash for a single built asset
 *     tags: [Assets]
 *     parameters:
 *       - in: path
 *         name: assetPath
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Integrity hash for the asset
 *       404:
 *         description: Asset not found in the manifest
 */
router.get('/integrity/*', (req, res) => {
  try {
    const assetPath = req.params[0];
    const integrity = getAssetIntegrity(assetPath);
    if (!integrity) {
      return res.status(404).json({ error: 'Asset not found in integrity manifest' });
    }
    res.json({ path: `/${assetPath}`, integrity });
  } catch (error) {
    logger.error('assetIntegrity.lookup.failed', { error: error.message });
    res.status(500).json({ error: 'Failed to look up asset integrity' });
  }
});

export default router;
