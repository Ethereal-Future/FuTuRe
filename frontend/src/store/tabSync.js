// Cross-tab state synchronization via BroadcastChannel (falls back to storage events)
const CHANNEL_NAME = 'app_state_sync';

export function createTabSync(onMessage) {
  // BroadcastChannel is supported in all modern browsers
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => onMessage(e.data);
    return {
      broadcast: (msg) => channel.postMessage(msg),
      destroy: () => channel.close(),
    };
  }

  // Fallback: storage events (cross-tab, same origin)
  const handler = (e) => {
    if (e.key === CHANNEL_NAME) {
      try { onMessage(JSON.parse(e.newValue)); } catch { /* ignore */ }
    }
  };
  window.addEventListener('storage', handler);
  return {
    broadcast: (msg) => {
      try { localStorage.setItem(CHANNEL_NAME, JSON.stringify(msg)); } catch { /* ignore */ }
    },
    destroy: () => window.removeEventListener('storage', handler),
  };
}
