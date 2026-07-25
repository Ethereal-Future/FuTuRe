/**
 * Vitest privacy guardrails
 * - Redacts sensitive values from console output
 * - Optionally fails tests when sensitive data is logged
 *
 * Enable strict mode:
 *   TEST_PRIVACY_STRICT=1 npm test
 */

import { afterAll, beforeAll } from 'vitest';
import { detectSensitiveText, redactSensitiveData, redactSensitiveText } from './privacy.js';

const STRICT_TYPES = new Set(['stellar_secret', 'jwt', 'email']);

const ORIGINAL_CONSOLE = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

function findSensitiveInValue(value, depth = 0) {
  if (depth > 6) return [];
  if (typeof value === 'string') return detectSensitiveText(value);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v) => findSensitiveInValue(v, depth + 1));

  const out = [];
  for (const v of Object.values(value)) out.push(...findSensitiveInValue(v, depth + 1));
  return out;
}

function createConsoleWrapper(methodName) {
  const original = ORIGINAL_CONSOLE[methodName] ?? console[methodName];

  return (...args) => {
    const findings = args.flatMap((a) => findSensitiveInValue(a));
    const hasStrictFinding = findings.some((f) => STRICT_TYPES.has(f.type));

    if (hasStrictFinding && process.env.TEST_PRIVACY_STRICT === '1') {
      const first = findings.find((f) => STRICT_TYPES.has(f.type));
      throw new Error(
        `Sensitive data detected in console.${methodName} output (${first?.type}). ` +
          'Avoid logging secrets/PII or use redaction utilities.'
      );
    }

    const redactedArgs = args.map((a) =>
      typeof a === 'string' ? redactSensitiveText(a) : redactSensitiveData(a)
    );

    return original(...redactedArgs);
  };
}

beforeAll(() => {
  console.log = createConsoleWrapper('log');
  console.info = createConsoleWrapper('info');
  console.warn = createConsoleWrapper('warn');
  console.error = createConsoleWrapper('error');
  console.debug = createConsoleWrapper('debug');
});

afterAll(() => {
  console.log = ORIGINAL_CONSOLE.log;
  console.info = ORIGINAL_CONSOLE.info;
  console.warn = ORIGINAL_CONSOLE.warn;
  console.error = ORIGINAL_CONSOLE.error;
  console.debug = ORIGINAL_CONSOLE.debug;
});

