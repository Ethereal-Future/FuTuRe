import prisma from '../db/client.js';

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = v => `"${String(v).replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

/**
 * Exports transaction data in JSON or CSV format.
 */
class DataExporter {
  async export({ userId, from, to, format = 'json' } = {}) {
    const where = {};
    if (userId) where.senderId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const txs = await prisma.transaction.findMany({
      where,
      select: {
        id: true, hash: true, assetCode: true, amount: true,
        successful: true, createdAt: true,
        sender: { select: { publicKey: true } },
        recipient: { select: { publicKey: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = txs.map(tx => ({
      id: tx.id,
      hash: tx.hash,
      asset: tx.assetCode,
      amount: tx.amount.toString(),
      successful: tx.successful,
      createdAt: tx.createdAt.toISOString(),
      sender: tx.sender.publicKey,
      recipient: tx.recipient.publicKey,
    }));

    if (format === 'csv') {
      return {
        contentType: 'text/csv',
        data: toCSV(rows),
      };
    }

    return { contentType: 'application/json', data: JSON.stringify(rows, null, 2) };
  }
}

export default new DataExporter();
