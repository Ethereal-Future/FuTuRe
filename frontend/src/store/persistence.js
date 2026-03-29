import { initialState, STATE_VERSION } from './reducer.js';

const STORAGE_KEY = 'app_state_v1';

// Fields persisted to localStorage (never persist secretKey)
const PERSIST_KEYS = ['account'];

function sanitize(state) {
  const out = {};
  for (const key of PERSIST_KEYS) {
    if (state[key] !== undefined) out[key] = state[key];
  }
  // Strip secret key from persisted account
  if (out.account?.secretKey) {
    out.account = { publicKey: out.account.publicKey };
  }
  return out;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const saved = JSON.parse(raw);
    // Migration: if version mismatch, discard persisted state
    if (saved._version !== STATE_VERSION) return initialState;
    return { ...initialState, ...saved };
  } catch {
    return initialState;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ _version: STATE_VERSION, ...sanitize(state) }));
  } catch {
    // ignore quota errors
  }
}

export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
