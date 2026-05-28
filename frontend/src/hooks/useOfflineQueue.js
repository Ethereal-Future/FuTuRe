import { useCallback, useEffect, useState } from 'react';

const DB_NAME = 'stellar-offline';
const STORE = 'pending-transactions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Queue a payment intent for later replay when back online.
 * Only stores { destination, amount, assetCode } — never the secret key.
 * Returns { queue, dequeue, pendingItems, pendingCount }
 */
export function useOfflineQueue() {
  const [pendingItems, setPendingItems] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => setPendingItems(req.result ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const queue = useCallback(async ({ destination, amount, assetCode }) => {
    // Explicitly store only the payment intent — no sourceSecret
    const intent = { destination, amount, assetCode, queuedAt: Date.now() };
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(intent);
    await new Promise((res) => { tx.oncomplete = res; });
    refresh();
    // Register background sync so the SW can notify the client when online
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-transactions').catch(() => {});
    }
  }, [refresh]);

  const dequeue = useCallback(async (id) => {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await new Promise((res) => { tx.oncomplete = res; });
    refresh();
  }, [refresh]);

  return { queue, dequeue, pendingItems, pendingCount: pendingItems.length };
}
