import prisma from '../db/client.js';

/**
 * Load a payment stream and attach it to req.stream.
 * Enforces ownership: caller must be the sender, recipient, or an admin.
 * Mutation routes should additionally use requireStreamSender.
 */
export async function requireStreamAccess(req, res, next) {
  try {
    const streamId = req.params.id;
    const stream = await prisma.paymentStream.findUnique({
      where: { id: streamId },
      include: { sender: true, recipient: true },
    });

    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    const userId = req.user?.id || req.user?.sub;
    const isAdmin = req.user?.isAdmin === true || req.user?.role === 'ADMIN';

    if (
      !isAdmin &&
      stream.senderId !== userId &&
      stream.recipientId !== userId
    ) {
      return res.status(403).json({
        error: 'Forbidden: You do not have access to this payment stream',
      });
    }

    req.stream = stream;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify stream access' });
  }
}

/**
 * Restrict stream mutations (pause/resume/cancel/update) to the sender or admin.
 * Must run after requireStreamAccess (or load the stream itself).
 */
export async function requireStreamOwner(req, res, next) {
  try {
    let stream = req.stream;
    if (!stream) {
      stream = await prisma.paymentStream.findUnique({
        where: { id: req.params.id },
        include: { sender: true },
      });
      if (!stream) {
        return res.status(404).json({ error: 'Stream not found' });
      }
      req.stream = stream;
    }

    const userId = req.user?.id || req.user?.sub;
    const isAdmin = req.user?.isAdmin === true || req.user?.role === 'ADMIN';

    if (!isAdmin && stream.senderId !== userId) {
      return res.status(403).json({
        error: 'Forbidden: You do not own this payment stream',
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify stream ownership' });
  }
}
