interface ErrorEntry {
  message: string;
  stack?: string;
  timestamp: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __reportError?: (entry: ErrorEntry) => void;
  }
}

// Lightweight error logger — logs locally and can be wired to an external service
const logs: ErrorEntry[] = [];

export function logError(error: unknown, info: Record<string, unknown> = {}): void {
  const entry: ErrorEntry = {
    message: (error as Error)?.message || String(error),
    stack: (error as Error)?.stack,
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

export function getLogs(): ErrorEntry[] {
  return [...logs];
}
