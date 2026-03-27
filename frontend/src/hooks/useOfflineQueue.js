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
 * Queue a transaction for background sync when offline.
 * Returns { queue, pendingCount }
 */
export function useOfflineQueue() {
  const [pendingCount, setPendingCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => setPendingCount(req.result);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  const queue = useCallback(async (payload) => {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ payload, queuedAt: Date.now() });
    await new Promise((res) => { tx.oncomplete = res; });
    refreshCount();
    // Request background sync if supported
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-transactions').catch(() => {});
    }
  }, [refreshCount]);

  return { queue, pendingCount };
}
