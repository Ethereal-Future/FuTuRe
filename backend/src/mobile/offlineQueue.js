import crypto from 'crypto';

/**
 * Offline transaction queue.
 * Clients enqueue transactions while offline; the server processes them
 * in order when the client reconnects and calls /mobile/queue/flush.
 */
class OfflineQueue {
  constructor() {
    // userId -> ordered array of queued transactions
    this.queues = new Map();
  }

  enqueue(userId, transaction) {
    if (!this.queues.has(userId)) this.queues.set(userId, []);
    const item = {
      id: crypto.randomUUID(),
      userId,
      transaction,
      enqueuedAt: new Date(),
      status: 'pending',
    };
    this.queues.get(userId).push(item);
    return item;
  }

  getQueue(userId) {
    return this.queues.get(userId) || [];
  }

  /** Mark an item as processed (success or failed) */
  updateStatus(userId, itemId, status, result = null) {
    const queue = this.queues.get(userId) || [];
    const item = queue.find(i => i.id === itemId);
    if (!item) throw new Error('Queue item not found');
    item.status = status;
    item.result = result;
    item.processedAt = new Date();
    return item;
  }

  /** Remove completed/failed items */
  clearProcessed(userId) {
    const queue = this.queues.get(userId) || [];
    const pending = queue.filter(i => i.status === 'pending');
    this.queues.set(userId, pending);
    return { removed: queue.length - pending.length };
  }
}

export default new OfflineQueue();
