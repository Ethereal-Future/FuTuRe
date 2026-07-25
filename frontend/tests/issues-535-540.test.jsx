import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Issue #540: WebSocket reconnection with exponential backoff ────────────

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    MockWebSocket.instances.push(this);
  }
  send = vi.fn();
  close() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateError() {
    this.onerror?.();
  }
}
MockWebSocket.instances = [];
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

describe('Issue #540: useWebSocket reconnection with exponential backoff', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    global.WebSocket = MockWebSocket;
    global.window = { location: { hostname: 'localhost' } };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function importHook() {
    vi.resetModules();
    const { useWebSocket } = await import('../src/hooks/useWebSocket.js');
    return useWebSocket;
  }

  it('starts as disconnected', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    expect(result.current).toBe('disconnected');
  });

  it('transitions to connected on open', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    act(() => {
      const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      sock?.simulateOpen();
    });
    expect(result.current).toBe('connected');
  });

  it('transitions to reconnecting after close with attempts remaining', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    act(() => {
      const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      sock?.simulateOpen();
      sock?.close();
    });
    expect(result.current).toBe('reconnecting');
  });

  it('uses exponential backoff: first retry after 1s', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    const initialCount = MockWebSocket.instances.length;
    act(() => {
      MockWebSocket.instances[initialCount - 1]?.simulateOpen();
      MockWebSocket.instances[initialCount - 1]?.close();
    });
    expect(result.current).toBe('reconnecting');
    expect(MockWebSocket.instances.length).toBe(initialCount); // no new socket yet
    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances.length).toBeGreaterThan(initialCount);
  });

  it('uses exponential backoff: second retry after 2s', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    act(() => {
      const s1 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      s1?.simulateOpen();
      s1?.close(); // attempt 1, delay = 1s
    });
    act(() => { vi.advanceTimersByTime(1000); }); // fires retry #1
    act(() => {
      const s2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      s2?.close(); // attempt 2, delay = 2s
    });
    const countBefore = MockWebSocket.instances.length;
    act(() => { vi.advanceTimersByTime(1999); }); // not yet
    expect(MockWebSocket.instances.length).toBe(countBefore);
    act(() => { vi.advanceTimersByTime(1); }); // now fires
    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it('transitions to failed after MAX_RECONNECT (10) attempts', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));

    // Exhaust all 10 reconnect attempts
    for (let i = 0; i < 11; i++) {
      act(() => {
        const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        if (sock) {
          if (sock.readyState !== MockWebSocket.OPEN) sock.simulateOpen();
          sock.close();
        }
      });
      if (i < 10) {
        act(() => { vi.advanceTimersByTime(60000); }); // advance past max backoff
      }
    }

    await waitFor(() => {
      expect(result.current).toBe('failed');
    });
  });

  it('sends subscribe with since timestamp on reconnect after receiving messages', async () => {
    const useWebSocket = await importHook();
    const { result } = renderHook(() => useWebSocket('GTEST', vi.fn()));
    const s1 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      s1?.simulateOpen();
      s1?.simulateMessage({ type: 'transaction', amount: '1' });
      s1?.close();
    });
    act(() => { vi.advanceTimersByTime(1000); });
    const s2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => { s2?.simulateOpen(); });
    const subscribeCalls = s2.send.mock.calls.map((c) => JSON.parse(c[0]));
    const subWithSince = subscribeCalls.find((m) => m.since !== undefined);
    expect(subWithSince).toBeDefined();
  });
});

// ── Issue #535: Responsive layout CSS ─────────────────────────────────────

describe('Issue #535: Responsive layout CSS', () => {
  it('index.css defines --ws-failed variable', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'),
      'utf8',
    );
    expect(css).toContain('--ws-failed');
  });

  it('index.css has a 375px media query', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'),
      'utf8',
    );
    expect(css).toMatch(/max-width:\s*375px/);
  });

  it('index.css defines .header-actions with flex-wrap', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'),
      'utf8',
    );
    expect(css).toContain('.header-actions');
    expect(css).toContain('flex-wrap');
  });

  it('App.jsx uses header-actions class', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'),
      'utf8',
    );
    expect(src).toContain('header-actions');
    expect(src).toContain('app-header-row');
  });

  it('buttons have min-height: 44px (WCAG 2.5.5)', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'),
      'utf8',
    );
    expect(css).toMatch(/min-height:\s*44px/);
  });
});
