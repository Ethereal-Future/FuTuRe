import express from 'express';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { createPerUserRateLimiter } from '../middleware/rateLimiter.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * Maximum number of contacts a single user is allowed to store.
 * Prevents slow-and-steady unbounded row growth that rate limiting alone
 * cannot stop.
 */
export const MAX_CONTACTS_PER_USER = 500;

/**
 * Per-user rate limiter for contact creation.
 * 20 requests per minute, keyed on the authenticated user id.
 * Independent of the global IP-based limiter applied in server.js.
 */
const contactCreateLimiter = createPerUserRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: 'Too many contact creation requests, please slow down.',
});

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

router.use(requireAuth);

// GET /api/accounts/contacts
router.get('/', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { publicKey: req.user.publicKey } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const contacts = await prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, address: true, createdAt: true },
    });
    res.json({ contacts });
  } catch (err) {
    logger.error('contacts.list.failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/accounts/contacts
/**
 * @swagger
 * /api/v1/accounts/contacts:
 *   post:
 *     summary: Create a new contact for the authenticated user
 *     tags: [Contacts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, address]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 64
 *               address:
 *                 type: string
 *                 description: Stellar public key (G...)
 *     responses:
 *       201:
 *         description: Contact created
 *       400:
 *         description: Contact limit reached (max 500 per user)
 *       409:
 *         description: Contact with this address already exists
 *       422:
 *         description: Validation error
 *       429:
 *         description: Per-user rate limit exceeded (20 req/min)
 *       500:
 *         description: Internal server error
 */
router.post(
  '/',
  contactCreateLimiter,
  [
    body('name').trim().notEmpty().withMessage('name is required').isLength({ max: 64 }).withMessage('name too long'),
    body('address').trim().matches(STELLAR_PUBLIC_KEY).withMessage('Invalid Stellar address'),
  ],
  validate,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { publicKey: req.user.publicKey } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Enforce per-user total-contacts cap before attempting the insert.
      const contactCount = await prisma.contact.count({ where: { userId: user.id } });
      if (contactCount >= MAX_CONTACTS_PER_USER) {
        return res.status(400).json({
          error: `Contact limit reached. A user may not exceed ${MAX_CONTACTS_PER_USER} contacts.`,
        });
      }

      const contact = await prisma.contact.create({
        data: { userId: user.id, name: req.body.name, address: req.body.address },
        select: { id: true, name: true, address: true, createdAt: true },
      });
      res.status(201).json({ contact });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: 'Contact with this address already exists' });
      logger.error('contacts.create.failed', { error: err.message });
      res.status(500).json({ error: 'Failed to create contact' });
    }
  }
);

// DELETE /api/accounts/contacts/:id
router.delete(
  '/:id',
  param('id').trim().notEmpty().withMessage('id is required'),
  validate,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { publicKey: req.user.publicKey } });
      if (!user) return res.status(404).json({ error: 'User not found' });
      const deleted = await prisma.contact.deleteMany({
        where: { id: req.params.id, userId: user.id },
      });
      if (deleted.count === 0) return res.status(404).json({ error: 'Contact not found' });
      res.status(204).send();
    } catch (err) {
      logger.error('contacts.delete.failed', { error: err.message });
      res.status(500).json({ error: 'Failed to delete contact' });
    }
  }
);

export default router;
