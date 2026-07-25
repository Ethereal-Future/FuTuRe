import { initialState, STATE_VERSION } from './reducer.js';

// Bump this key whenever the persisted shape changes to evict stale data.
const STORAGE_KEY = 'app_state_v2';

/**
 * Build the subset of state that is safe to persist.
 * Only publicKey is kept from the account object — secretKey must never
 * be written to browser storage.
 */
function sanitize(state) {
  return {
    // Allowlist: only publicKey — never secretKey
    account: state.account?.publicKey
      ? { publicKey: state.account.publicKey }
      : null,
    accountLabel: state.accountLabel || '',
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const saved = JSON.parse(raw);
    if (saved._version !== STATE_VERSION) return initialState;
    // Merge only the safe persisted fields back into initial state
    return {
      ...initialState,
      account: saved.account ?? null,
      accountLabel: saved.accountLabel ?? '',
    };
  } catch {
    return initialState;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ _version: STATE_VERSION, ...sanitize(state) })
    );
  } catch {
    // ignore quota errors
  }
}

export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
