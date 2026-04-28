// Lightweight error logger — logs locally and can be wired to an external service
const logs = [];

export function logError(error, info = {}) {
  const entry = {
    message: error?.message || String(error),
    stack: error?.stack,
    timestamp: new Date().toISOString(),
    ...info,
  };
  logs.push(entry);
  console.error('[ErrorLogger]', entry);

  // Hook for external service (e.g. Sentry): window.__reportError?.(entry)
  if (typeof window.__reportError === 'function') {
    window.__reportError(entry);
  }
}

export function getLogs() {
  return [...logs];
}
