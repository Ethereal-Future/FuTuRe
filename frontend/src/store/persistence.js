import { initialState, STATE_VERSION } from './reducer.js';

// Legacy single-blob key. Kept only so existing data can be migrated.
const LEGACY_STORAGE_KEY = 'app_state_v2';

// Each persisted slice lives under its own key so that corruption in one
// slice can never take down unrelated slices (#1699).
const KEY_PREFIX = 'app_state_v3:';
const VERSION_KEY = `${KEY_PREFIX}_version`;

/**
 * Re-apply the account allowlist to ensure only publicKey is present.
 * Used on both read and write to defend against localStorage corruption or
 * injection — secretKey must never be written to browser storage.
 */
function sanitizeAccount(account) {
  return account?.publicKey && typeof account.publicKey === 'string'
    ? { publicKey: account.publicKey }
    : null;
}

function sanitizeLabel(label) {
  return typeof label === 'string' ? label : '';
}

/**
 * Persisted slices. `serialize` builds the safe-to-store value from app
 * state; `deserialize` validates a parsed value and returns the slice value
 * (falling back to the slice's initial state for malformed input).
 */
const SLICES = {
  account: {
    serialize: (state) => sanitizeAccount(state.account),
    deserialize: (value) => sanitizeAccount(value),
  },
  accountLabel: {
    serialize: (state) => sanitizeLabel(state.accountLabel),
    deserialize: (value) => sanitizeLabel(value),
  },
};

export const sliceKey = (name) => `${KEY_PREFIX}${name}`;

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / access errors
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Read and parse one slice. A corrupted value only resets *that* slice:
 * its key is removed and the slice falls back to its initial value, while
 * every other slice is left untouched.
 */
function loadSlice(name) {
  const key = sliceKey(name);
  const raw = safeGet(key);
  if (raw === null) return { found: false, value: initialState[name] };
  try {
    return { found: true, value: SLICES[name].deserialize(JSON.parse(raw)) };
  } catch {
    safeRemove(key);
    return { found: false, value: initialState[name] };
  }
}

/**
 * Migrate data from the legacy single-blob key. Each slice is extracted
 * independently so a malformed field does not discard the others.
 */
function migrateLegacy() {
  const raw = safeGet(LEGACY_STORAGE_KEY);
  if (raw === null) return null;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    // The legacy blob is unreadable; drop only that key.
    safeRemove(LEGACY_STORAGE_KEY);
    return null;
  }
  if (!saved || typeof saved !== 'object' || saved._version !== STATE_VERSION) {
    safeRemove(LEGACY_STORAGE_KEY);
    return null;
  }

  const migrated = {};
  for (const [name, slice] of Object.entries(SLICES)) {
    try {
      migrated[name] = slice.deserialize(saved[name]);
    } catch {
      migrated[name] = initialState[name];
    }
  }
  saveState({ ...initialState, ...migrated });
  safeRemove(LEGACY_STORAGE_KEY);
  return migrated;
}

export function loadState() {
  const version = safeGet(VERSION_KEY);

  if (version === null) {
    const migrated = migrateLegacy();
    return migrated ? { ...initialState, ...migrated } : initialState;
  }

  if (version !== String(STATE_VERSION)) {
    // Shape changed between versions — evict stale slices.
    clearState();
    return initialState;
  }

  const result = { ...initialState };
  for (const name of Object.keys(SLICES)) {
    result[name] = loadSlice(name).value;
  }
  return result;
}

export function saveState(state) {
  safeSet(VERSION_KEY, String(STATE_VERSION));
  for (const [name, slice] of Object.entries(SLICES)) {
    let value;
    try {
      value = JSON.stringify(slice.serialize(state));
    } catch {
      continue; // skip only the slice that failed to serialize
    }
    safeSet(sliceKey(name), value);
  }
}

export function clearState() {
  safeRemove(LEGACY_STORAGE_KEY);
  safeRemove(VERSION_KEY);
  for (const name of Object.keys(SLICES)) safeRemove(sliceKey(name));
}
