import { useCallback, useEffect, useRef, useState } from 'react';

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
 *
 * @param {object} [options]
 * @param {function} [options.replayFn] - Called with each pending item on reconnect.
 *   Receives the payment intent object. Should throw on failure.
 *
 * @returns {{ queue, dequeue, replayAll, pendingItems, pendingCount, notifications, dismissNotification }}
 */
export function useOfflineQueue({ replayFn } = {}) {
  const [pendingItems, setPendingItems] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Keep a stable ref to replayFn and pendingItems so the online listener
  // doesn't need to be re-registered on every render.
  const replayFnRef = useRef(replayFn);
  const pendingItemsRef = useRef(pendingItems);
  useEffect(() => { replayFnRef.current = replayFn; }, [replayFn]);
  useEffect(() => { pendingItemsRef.current = pendingItems; }, [pendingItems]);

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
    const intent = { destination, amount, assetCode, queuedAt: Date.now() };
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(intent);
    await new Promise((res) => { tx.oncomplete = res; });
    refresh();
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

  const replayAll = useCallback(async (overrideFn) => {
    const fn = overrideFn || replayFnRef.current;
    const items = pendingItemsRef.current;
    if (!fn || items.length === 0) return;

    for (const item of [...items]) {
      try {
        await fn(item);
        await dequeue(item.id);
        setNotifications((prev) => [
          ...prev,
          {
            id: `${item.id}-ok`,
            type: 'success',
            message: `Queued payment of ${item.amount} ${item.assetCode} sent successfully`,
          },
        ]);
      } catch (err) {
        // Keep item in queue; surface the error as a notification
        setNotifications((prev) => [
          ...prev,
          {
            id: `${item.id}-err`,
            type: 'error',
            message: `Queued payment of ${item.amount} ${item.assetCode} failed: ${err.message}`,
          },
        ]);
      }
    }
  }, [dequeue]);

  const dismissNotification = useCallback((notificationId) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
  }, []);

  // Auto-replay all pending items whenever the browser reports back online
  useEffect(() => {
    const handleOnline = () => {
      if (replayFnRef.current && pendingItemsRef.current.length > 0) {
        replayAll();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [replayAll]);

  return {
    queue,
    dequeue,
    replayAll,
    pendingItems,
    pendingCount: pendingItems.length,
    notifications,
    dismissNotification,
  };
}
