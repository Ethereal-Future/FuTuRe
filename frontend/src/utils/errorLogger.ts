import * as Sentry from '@sentry/react';

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

const logs: ErrorEntry[] = [];
let sentryInitialized = false;

export function initSentry() {
  if (sentryInitialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn('[ErrorLogger] VITE_SENTRY_DSN not configured, Sentry disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubbySensitiveData(event);
    },
    denyUrls: [/extensions\//i, /^chrome:\/\//i],
  });

  sentryInitialized = true;
}

function scrubbySensitiveData(event: any) {
  // Remove private keys and sensitive Stellar data
  const sensitivePatterns = [
    /SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/gi,
    /private[_-]?key/gi,
    /secret[_-]?key/gi,
    /wallet[_-]?address/gi,
    /[a-zA-Z0-9]{56}/gi, // Stellar secret keys are 56 chars
  ];

  const scrubValue = (value: any): any => {
    if (typeof value === 'string') {
      return sensitivePatterns.reduce(
        (str, pattern) => str.replace(pattern, '[REDACTED]'),
        value
      );
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(scrubValue);
      }
      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = scrubValue(val);
      }
      return result;
    }
    return value;
  };

  return scrubValue(event);
}

export function logError(error: unknown, info: Record<string, unknown> = {}): void {
  const entry: ErrorEntry = {
    message: (error as Error)?.message || String(error),
    stack: (error as Error)?.stack,
    timestamp: new Date().toISOString(),
    ...info,
  };
  logs.push(entry);
  console.error('[ErrorLogger]', entry);

  // Send to Sentry if initialized
  if (sentryInitialized) {
    Sentry.captureException(error, {
      tags: {
        source: info.source || 'unknown',
        context: info.context || 'unknown',
      },
      extra: info,
    });
  }

  // Hook for custom external service
  if (typeof window.__reportError === 'function') {
    window.__reportError(entry);
  }
}

export function getLogs(): ErrorEntry[] {
  return [...logs];
}

// Set up global error handlers
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, { source: 'unhandledRejection' });
  });

  window.addEventListener('error', (event) => {
    logError(event.error || event.message, { source: 'globalError' });
  });
}
