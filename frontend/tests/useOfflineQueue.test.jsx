import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOfflineQueue } from '../src/hooks/useOfflineQueue';

// ── In-memory IndexedDB mock ──────────────────────────────────────────────────

let mockStore;
let autoId;

function makeStore(data) {
  return {
    getAll() {
      const req = {};
      Promise.resolve().then(() => req.onsuccess?.({ target: { result: [...data.values()] } }));
      return req;
    },
    add(item) {
      const id = ++autoId;
      data.set(id, { ...item, id });
      const req = {};
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
    delete(id) {
      data.delete(id);
      const req = {};
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
  };
}

function makeDB(data) {
  return {
    transaction(_name, _mode) {
      const tx = {
        objectStore() { return makeStore(data); },
      };
      // Fire oncomplete on next microtask
      Promise.resolve().then(() => tx.oncomplete?.());
      return tx;
    },
  };
}

function setupIDBMock() {
  mockStore = new Map();
  autoId = 0;

  const openReq = {
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    result: makeDB(mockStore),
  };

  Object.defineProperty(global, 'indexedDB', {
    value: {
      open: vi.fn(() => {
        Promise.resolve().then(() => {
          openReq.onupgradeneeded?.({ target: openReq });
          openReq.onsuccess?.({ target: openReq });
        });
        return openReq;
      }),
    },
    configurable: true,
    writable: true,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockPayment = { destination: 'GDEST123', amount: '10', assetCode: 'XLM' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useOfflineQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupIDBMock();
    // Silence navigator.serviceWorker missing in jsdom
    if (!('serviceWorker' in navigator)) {
      Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    }
  });

  it('starts with empty pending items', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });

  it('persists a queued payment to IndexedDB and updates pendingItems', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));

    await act(async () => {
      await result.current.queue(mockPayment);
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(result.current.pendingItems[0]).toMatchObject(mockPayment);
  });

  it('dequeues a payment and removes it from pendingItems', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    const itemId = result.current.pendingItems[0].id;
    await act(async () => { await result.current.dequeue(itemId); });
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });

  it('replayAll calls replayFn for each pending item and dequeues on success', async () => {
    const replayFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineQueue({ replayFn }));

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => { await result.current.replayAll(); });

    expect(replayFn).toHaveBeenCalledWith(expect.objectContaining(mockPayment));
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });

  it('shows a success notification after a queued payment is replayed', async () => {
    const replayFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineQueue({ replayFn }));

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => { await result.current.replayAll(); });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.notifications[0].type).toBe('success');
    expect(result.current.notifications[0].message).toMatch(/10 XLM/i);
  });

  it('keeps a failed item in queue and shows an error notification', async () => {
    const replayFn = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useOfflineQueue({ replayFn }));

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => { await result.current.replayAll(); });

    // Item remains in queue
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    // Error notification is shown
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.notifications[0].type).toBe('error');
    expect(result.current.notifications[0].message).toContain('network error');
  });

  it('auto-replays pending items when browser fires the online event', async () => {
    const replayFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineQueue({ replayFn }));

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    // Simulate reconnect
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      // Give async replay time to run
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(replayFn).toHaveBeenCalled();
  });

  it('dismissNotification removes the notification by id', async () => {
    const replayFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineQueue({ replayFn }));

    await act(async () => { await result.current.queue(mockPayment); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    await act(async () => { await result.current.replayAll(); });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    const notifId = result.current.notifications[0].id;
    act(() => { result.current.dismissNotification(notifId); });
    expect(result.current.notifications).toHaveLength(0);
  });
});
