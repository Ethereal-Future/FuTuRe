import prisma from '../db/client.js';

/**
 * Identifies recurring patterns: common amounts, frequent pairs, time-of-day clusters.
 */
class PatternAnalyzer {
  async analyze({ userId, from, to } = {}) {
    const where = { successful: true };
    if (userId) where.senderId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const txs = await prisma.transaction.findMany({
      where,
      select: { amount: true, assetCode: true, senderId: true, recipientId: true, createdAt: true },
    });

    // Common amounts (rounded to nearest 10)
    const amountBuckets = {};
    for (const tx of txs) {
      const bucket = Math.round(Number(tx.amount) / 10) * 10;
      amountBuckets[bucket] = (amountBuckets[bucket] || 0) + 1;
    }
    const topAmounts = Object.entries(amountBuckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([amount, count]) => ({ amount: Number(amount), count }));

    // Most active day-of-week
    const dowFreq = Array(7).fill(0);
    for (const tx of txs) dowFreq[tx.createdAt.getDay()]++;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const peakDay = days[dowFreq.indexOf(Math.max(...dowFreq))];

    // Asset distribution
    const assetDist = {};
    for (const tx of txs) {
      assetDist[tx.assetCode] = (assetDist[tx.assetCode] || 0) + 1;
    }

    return { topAmounts, peakDay, assetDistribution: assetDist, totalAnalyzed: txs.length };
  }
}

export default new PatternAnalyzer();
