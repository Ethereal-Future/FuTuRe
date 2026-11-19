// Self-healing cache purge used by ErrorBoundary to break crash loops caused
// by corrupted persisted state (malformed JSON, outdated cache schemas, ...).

// Credentials and session tokens survive the purge so the user is not locked
// out of their wallet or logged out.
export const PRESERVED_STORAGE_KEYS = ['secretKey', 'accessToken', 'refreshToken', 'authToken'];

const CACHE_DATABASES = ['stellar-balance-cache'];

function purgeStorage(storage) {
  if (!storage) return;
  const keys = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  keys
    .filter((key) => key !== null && !PRESERVED_STORAGE_KEYS.includes(key))
    .forEach((key) => storage.removeItem(key));
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAppCache() {
  try { purgeStorage(window.localStorage); } catch { /* storage unavailable */ }
  try { purgeStorage(window.sessionStorage); } catch { /* storage unavailable */ }
  if (typeof indexedDB !== 'undefined') {
    await Promise.all(CACHE_DATABASES.map(deleteDatabase));
  }
}
