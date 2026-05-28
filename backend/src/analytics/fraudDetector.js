import prisma from '../db/client.js';

// Thresholds
const LARGE_TX_THRESHOLD = 10000;
const RAPID_TX_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RAPID_TX_COUNT = 5;
const STRUCTURING_LOW = 9000;
const STRUCTURING_HIGH = 10000;

/**
 * Detects fraud patterns in transaction data.
 * Returns an array of flagged incidents.
 */
class FraudDetector {
  async analyze({ from, to } = {}) {
    const where = { successful: true };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const txs = await prisma.transaction.findMany({
      where,
      select: { id: true, amount: true, senderId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const flags = [];

    // Group by sender for window-based checks
    const bySender = {};
    for (const tx of txs) {
      (bySender[tx.senderId] = bySender[tx.senderId] || []).push(tx);
    }

    for (const [senderId, senderTxs] of Object.entries(bySender)) {
      for (let i = 0; i < senderTxs.length; i++) {
        const tx = senderTxs[i];
        const amount = Number(tx.amount);

        // Large transaction
        if (amount >= LARGE_TX_THRESHOLD) {
          flags.push({ type: 'LARGE_TRANSACTION', severity: 'HIGH', senderId, txId: tx.id, amount });
        }

        // Structuring (just below reporting threshold)
        if (amount >= STRUCTURING_LOW && amount < STRUCTURING_HIGH) {
          flags.push({ type: 'STRUCTURING', severity: 'HIGH', senderId, txId: tx.id, amount });
        }

        // Rapid succession (5+ txs within 1 hour)
        const windowEnd = tx.createdAt.getTime() + RAPID_TX_WINDOW_MS;
        const inWindow = senderTxs.filter(t => t.createdAt.getTime() >= tx.createdAt.getTime() && t.createdAt.getTime() <= windowEnd);
        if (inWindow.length >= RAPID_TX_COUNT) {
          flags.push({ type: 'RAPID_SUCCESSION', severity: 'MEDIUM', senderId, count: inWindow.length, windowStart: tx.createdAt });
          break; // one flag per sender per window
        }
      }
    }

    return flags;
  }
}

export default new FraudDetector();
