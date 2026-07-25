import express from 'express';
import { body } from 'express-validator';
import { validate } from '../../middleware/validate.js';
import { rotateKeypair } from '../../services/keypairRotation.js';
import logger from '../../config/logger.js';

const router = express.Router({ mergeParams: true });

/**
 * @swagger
 * /api/v1/clinics/{id}/keypair/rotate:
 *   post:
 *     summary: Rotate the Stellar keypair for a clinic account
 *     description: |
 *       Generates a new Stellar keypair, transfers the full XLM balance from the
 *       old account to the new one via accountMerge, then updates the clinic record.
 *       The DB is only updated after the on-chain transfer succeeds (atomic).
 *       Emits a KEYPAIR_ROTATE audit log and sends an email notification on success.
 *     tags: [Clinics]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Clinic / user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPublicKey, oldSecretKey]
 *             properties:
 *               oldPublicKey:
 *                 type: string
 *                 description: Current Stellar public key (G...)
 *               oldSecretKey:
 *                 type: string
 *                 description: Current Stellar secret key (S...)
 *               adminEmail:
 *                 type: string
 *                 format: email
 *                 description: Email address to notify on success
 *     responses:
 *       200:
 *         description: Rotation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 newPublicKey: { type: string }
 *                 newSecretKey: { type: string }
 *                 mergeHash:   { type: string }
 *       400:
 *         description: Validation error
 *       500:
 *         description: Rotation failed (see error message)
 */
router.post(
  '/rotate',
  [
    body('oldPublicKey')
      .isString().trim()
      .matches(/^G[A-Z2-7]{55}$/).withMessage('oldPublicKey must be a valid Stellar public key'),
    body('oldSecretKey')
      .isString().trim()
      .matches(/^S[A-Z2-7]{55}$/).withMessage('oldSecretKey must be a valid Stellar secret key'),
    body('adminEmail')
      .optional({ nullable: true })
      .isEmail().withMessage('adminEmail must be a valid email address'),
  ],
  validate,
  async (req, res) => {
    const { id: userId } = req.params;
    const { oldPublicKey, oldSecretKey, adminEmail } = req.body;
    const correlationId = req.correlationId;

    try {
      const result = await rotateKeypair({ oldPublicKey, oldSecretKey, userId, adminEmail, correlationId });
      res.json(result);
    } catch (err) {
      logger.error('route.keypair.rotate.failed', {
        userId, oldPublicKey, error: err.message, correlationId,
      });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
