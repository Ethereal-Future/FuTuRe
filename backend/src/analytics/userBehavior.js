import prisma from '../db/client.js';

/**
 * Tracks per-user behaviour: frequency, avg amount, active hours, top counterparties.
 */
class UserBehaviorTracker {
  async getProfile(userId) {
    const txs = await prisma.transaction.findMany({
      where: { senderId: userId, successful: true },
      select: { amount: true, assetCode: true, createdAt: true, recipientId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!txs.length) return { userId, txCount: 0 };

    const amounts = txs.map(t => Number(t.amount));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxAmount = Math.max(...amounts);

    // Hour-of-day frequency
    const hourFreq = Array(24).fill(0);
    for (const tx of txs) hourFreq[tx.createdAt.getHours()]++;
    const peakHour = hourFreq.indexOf(Math.max(...hourFreq));

    // Top counterparties
    const counterpartyCount = {};
    for (const tx of txs) {
      counterpartyCount[tx.recipientId] = (counterpartyCount[tx.recipientId] || 0) + 1;
    }
    const topCounterparties = Object.entries(counterpartyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ userId: id, count }));

    // Days since first tx
    const firstTx = txs[txs.length - 1].createdAt;
    const daysSinceFirst = Math.ceil((Date.now() - firstTx.getTime()) / 86400000);
    const txPerDay = daysSinceFirst > 0 ? (txs.length / daysSinceFirst).toFixed(2) : txs.length;

    return {
      userId,
      txCount: txs.length,
      avgAmount: avgAmount.toFixed(7),
      maxAmount: maxAmount.toFixed(7),
      peakHour,
      txPerDay: Number(txPerDay),
      topCounterparties,
      memberSinceDays: daysSinceFirst,
    };
  }
}

export default new UserBehaviorTracker();
