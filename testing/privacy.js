/**
 * Test Data Privacy Utilities
 * - Generate synthetic (non-production) test identifiers
 * - Detect and redact sensitive data in logs, snapshots, and reports
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
export const STELLAR_SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;

const STELLAR_PUBLIC_KEY_GLOBAL_REGEX = /\bG[A-Z2-7]{55}\b/g;
const STELLAR_SECRET_KEY_GLOBAL_REGEX = /\bS[A-Z2-7]{55}\b/g;

// Intentionally conservative; used for redaction (not validation).
const JWT_GLOBAL_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const EMAIL_GLOBAL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const DEFAULT_SENSITIVE_KEY_REGEX =
  /(secret|secretKey|privateKey|seed|token|accessToken|refreshToken|password|authorization|apiKey)/i;

function randomBase32(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE32_ALPHABET[Math.floor(Math.random() * BASE32_ALPHABET.length)];
  }
  return out;
}

export function fakeStellarPublicKey() {
  // Format-compatible with StrKey (not guaranteed checksum-valid).
  return `G${randomBase32(55)}`;
}

export function fakeStellarSecretKey() {
  // Format-compatible with StrKey (not guaranteed checksum-valid).
  return `S${randomBase32(55)}`;
}

export function fakeStellarKeypair(overrides = {}) {
  return {
    publicKey: fakeStellarPublicKey(),
    secretKey: fakeStellarSecretKey(),
    ...overrides,
  };
}

export function redactStellarSecretKey(secretKey) {
  if (typeof secretKey !== 'string') return secretKey;
  if (!STELLAR_SECRET_KEY_REGEX.test(secretKey)) return secretKey;
  return `${secretKey.slice(0, 4)}…${secretKey.slice(-4)}`;
}

export function detectSensitiveText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const matches = [];
  const detectors = [
    { type: 'stellar_secret', regex: STELLAR_SECRET_KEY_GLOBAL_REGEX },
    { type: 'stellar_public', regex: STELLAR_PUBLIC_KEY_GLOBAL_REGEX },
    { type: 'jwt', regex: JWT_GLOBAL_REGEX },
    { type: 'email', regex: EMAIL_GLOBAL_REGEX },
  ];

  for (const { type, regex } of detectors) {
    const found = text.match(regex);
    if (found?.length) {
      matches.push(...found.map((value) => ({ type, value })));
    }
  }

  return matches;
}

export function redactSensitiveText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;

  return text
    .replace(STELLAR_SECRET_KEY_GLOBAL_REGEX, '[REDACTED:STELLAR_SECRET]')
    .replace(JWT_GLOBAL_REGEX, '[REDACTED:JWT]')
    .replace(EMAIL_GLOBAL_REGEX, '[REDACTED:EMAIL]');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSensitiveData(value, options = {}) {
  const {
    sensitiveKeyRegex = DEFAULT_SENSITIVE_KEY_REGEX,
    redact = (key) => (key?.toLowerCase().includes('secret') ? '[REDACTED:SECRET]' : '[REDACTED]'),
  } = options;

  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((v) => redactSensitiveData(v, options));
  if (value instanceof Date) return value.toISOString();

  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (sensitiveKeyRegex.test(key)) {
      if (typeof v === 'string') {
        const redactedText = redactSensitiveText(v);
        out[key] = redactedText === v ? redact(key) : redactedText;
      } else {
        out[key] = redact(key);
      }
      continue;
    }
    out[key] = redactSensitiveData(v, options);
  }
  return out;
}
