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
// Legacy single-blob key. Still read once for migration, then removed.
const LEGACY_STORAGE_KEY = 'app_state_v2';

// Each persisted slice lives under its own key so that corruption of one
// slice cannot wipe the others (#1699).
const KEY_PREFIX = 'app_state_v3';
const VERSION_KEY = `${KEY_PREFIX}:_version`;

/**
 * Persisted slices. `sanitize` re-applies the allowlist on read (defends
 * against corruption / injection); `fallback` is used only for that slice
 * when its stored value is missing or malformed.
 */
const SLICES = {
  account: {
    serialize: (state) =>
      state.account?.publicKey ? { publicKey: state.account.publicKey } : null,
    // Allowlist: only publicKey — never secretKey
    sanitize: (value) =>
      value && typeof value === 'object' && typeof value.publicKey === 'string' && value.publicKey
        ? { publicKey: value.publicKey }
        : null,
    fallback: () => initialState.account ?? null,
  },
  accountLabel: {
    serialize: (state) => state.accountLabel || '',
    sanitize: (value) => (typeof value === 'string' ? value : ''),
    fallback: () => initialState.accountLabel ?? '',
  },
};

export const sliceKey = (name) => `${KEY_PREFIX}:${name}`;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore quota errors */ }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Read a single slice. A parse failure only resets this slice's key and
 * returns its fallback; other slices are untouched.
 */
function loadSlice(name) {
  const { sanitize, fallback } = SLICES[name];
  const raw = safeGet(sliceKey(name));
  if (raw === null) return { found: false, value: fallback() };
  try {
    return { found: true, value: sanitize(JSON.parse(raw)) };
  } catch {
    safeRemove(sliceKey(name));
    return { found: false, value: fallback() };
  }
}

/**
 * Migrate the legacy single-key blob into per-slice keys. A corrupted or
 * stale legacy blob is simply discarded — it cannot affect v3 slices.
 */
function migrateLegacy() {
  const raw = safeGet(LEGACY_STORAGE_KEY);
  if (raw === null) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && saved._version === STATE_VERSION) {
      for (const name of Object.keys(SLICES)) {
        if (safeGet(sliceKey(name)) === null && name in saved) {
          safeSet(sliceKey(name), JSON.stringify(SLICES[name].sanitize(saved[name])));
        }
      }
      if (safeGet(VERSION_KEY) === null) safeSet(VERSION_KEY, JSON.stringify(STATE_VERSION));
    }
  } catch {
    /* corrupted legacy blob — drop it */
  }
  safeRemove(LEGACY_STORAGE_KEY);
}

function readVersion() {
  const raw = safeGet(VERSION_KEY);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export function loadState() {
  migrateLegacy();

  const version = readVersion();
  if (version !== null && version !== STATE_VERSION) {
    // Persisted shape is from another version: evict only our slice keys.
    clearState();
    return initialState;
  }

  const next = { ...initialState };
  let any = false;
  for (const name of Object.keys(SLICES)) {
    const { found, value } = loadSlice(name);
    next[name] = value;
    any = any || found;
  }
  return any ? next : initialState;
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
export function saveState(state) {
  safeSet(VERSION_KEY, JSON.stringify(STATE_VERSION));
  for (const [name, { serialize }] of Object.entries(SLICES)) {
    try {
      safeSet(sliceKey(name), JSON.stringify(serialize(state)));
    } catch {
      /* ignore serialization errors for this slice */
    }
  }
}

export function clearState() {
  safeRemove(LEGACY_STORAGE_KEY);
  safeRemove(VERSION_KEY);
  for (const name of Object.keys(SLICES)) safeRemove(sliceKey(name));
}
