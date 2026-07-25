import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Aggregates transaction data from the DB into volume/frequency summaries.
 */
class TransactionAggregator {
  /**
   * Returns daily volume and count for a given period.
   * @param {Object} opts - { from, to, userId }
   */
  async dailySummary({ from, to, userId } = {}) {
    const where = this._buildWhere({ from, to, userId });

    const txs = await prisma.transaction.findMany({
      where,
      select: { amount: true, assetCode: true, createdAt: true, successful: true },
    });

    const byDay = {};
    for (const tx of txs) {
      if (!tx.successful) continue;
      const day = tx.createdAt.toISOString().split('T')[0];
      if (!byDay[day]) byDay[day] = { date: day, count: 0, volume: {} };
      byDay[day].count++;
      byDay[day].volume[tx.assetCode] = (byDay[day].volume[tx.assetCode] || 0) + Number(tx.amount);
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Returns total volume per asset and overall tx count.
   */
  async totals({ from, to, userId } = {}) {
    const where = this._buildWhere({ from, to, userId });

    const txs = await prisma.transaction.findMany({
      where,
      select: { amount: true, assetCode: true, successful: true },
    });

    const volume = {};
    let totalCount = 0;
    let successCount = 0;

    for (const tx of txs) {
      totalCount++;
      if (!tx.successful) continue;
      successCount++;
      volume[tx.assetCode] = (volume[tx.assetCode] || 0) + Number(tx.amount);
    }

    return { totalCount, successCount, failedCount: totalCount - successCount, volume };
  }

  _buildWhere({ from, to, userId } = {}) {
    const where = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (userId) where.senderId = userId;
    return where;
  }
}

export default new TransactionAggregator();
