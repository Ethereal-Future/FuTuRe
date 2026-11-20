// Cross-tab state synchronization via BroadcastChannel (falls back to storage events)
const CHANNEL_NAME = 'app_state_sync';

// Fields that must never leave the current tab.
const SENSITIVE_KEYS = ['secretKey', 'secret', 'privateKey', 'seed', 'mnemonic'];

function stripSensitive(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.includes(key)) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Remove private key material from a message before it crosses browser
 * contexts. Account payloads keep only public identifiers.
 */
export function sanitizeSyncMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const safe = stripSensitive(msg);
  if (safe.payload && typeof safe.payload === 'object') {
    safe.payload = stripSensitive(safe.payload);
    if (safe.payload.account && typeof safe.payload.account === 'object') {
      safe.payload.account = stripSensitive(safe.payload.account);
    }
  }
  return safe;
}

export function createTabSync(onMessage) {
  // Incoming messages are sanitized too, so a key can't be injected into
  // this tab's state by an older tab still broadcasting full payloads.
  const receive = (data) => onMessage(sanitizeSyncMessage(data));

  // BroadcastChannel is supported in all modern browsers
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => receive(e.data);
    return {
      broadcast: (msg) => channel.postMessage(sanitizeSyncMessage(msg)),
      destroy: () => channel.close(),
    };
  }

  // Fallback: storage events (cross-tab, same origin).
  // Never write secretKey to localStorage.
  const handler = (e) => {
    if (e.key === CHANNEL_NAME) {
      try { receive(JSON.parse(e.newValue)); } catch { /* ignore */ }
    }
  };
  window.addEventListener('storage', handler);
  return {
    broadcast: (msg) => {
      try {
        localStorage.setItem(CHANNEL_NAME, JSON.stringify(sanitizeSyncMessage(msg)));
      } catch { /* ignore */ }
    },
    destroy: () => window.removeEventListener('storage', handler),
  };
}
