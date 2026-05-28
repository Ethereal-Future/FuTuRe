import logger from '../config/logger.js';

// ── XSS / HTML sanitization ───────────────────────────────────────────────────

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;' };

/**
 * Escapes HTML special characters to prevent XSS in user-generated text.
 */
export function escapeHtml(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[&<>"'/]/g, c => HTML_ENTITIES[c]);
}

// ── SQL injection prevention ──────────────────────────────────────────────────
// Primary defence is Prisma's parameterised queries. This strips the most
// common injection patterns from any string that will be used in a raw query.

const SQL_INJECTION_RE = /('|--|;|\/\*|\*\/|xp_|UNION\s+SELECT|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET)/gi;

/**
 * Strips SQL injection patterns from a string.
 * Use only as a secondary defence — always prefer parameterised queries.
 */
export function stripSqlInjection(value) {
  if (typeof value !== 'string') return value;
  return value.replace(SQL_INJECTION_RE, '');
}

// ── Length enforcement ────────────────────────────────────────────────────────

export const MAX_LENGTHS = {
  username: 32,
  text: 500,
  memo: 28,       // Stellar memo text limit
  memoId: 18,     // uint64 max is 18446744073709551615 (20 digits), but safe integer is 18 digits
  address: 256,
  default: 1000,
};

/** Allowed Stellar memo types supported by this application. */
export const MEMO_TYPES = ['none', 'text', 'id', 'hash', 'return'];

/**
 * Truncates a string to the given max length.
 */
export function enforceLength(value, max = MAX_LENGTHS.default) {
  if (typeof value !== 'string') return value;
  return value.slice(0, max);
}

// ── Composite sanitizer ───────────────────────────────────────────────────────

/**
 * Sanitizes a free-text user input: trim → enforce length → escape HTML → strip SQL.
 */
export function sanitizeText(value, maxLength = MAX_LENGTHS.text) {
  if (typeof value !== 'string') return value;
  return stripSqlInjection(escapeHtml(enforceLength(value.trim(), maxLength)));
}

// ── File upload validation ────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateFileUpload(file) {
  const errors = [];
  if (!file) return { valid: false, errors: ['No file provided'] };
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    errors.push(`File type ${file.mimetype} not allowed. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    errors.push(`File size ${file.size} exceeds limit of ${MAX_FILE_SIZE_BYTES} bytes`);
  }
  // Reject path traversal in filename
  if (/[/\\]/.test(file.originalname)) {
    errors.push('Invalid filename');
  }
  return { valid: errors.length === 0, errors };
}

// ── Recursive object sanitizer ────────────────────────────────────────────────

/**
 * Recursively sanitizes all string values in a plain object.
 * Safe to run on req.body before processing.
 */
export function sanitizeObject(obj, maxLength = MAX_LENGTHS.text) {
  if (typeof obj === 'string') return sanitizeText(obj, maxLength);
  if (Array.isArray(obj)) return obj.map(v => sanitizeObject(v, maxLength));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitizeObject(v, maxLength)])
    );
  }
  return obj;
}

// ── Logging ───────────────────────────────────────────────────────────────────

export function logSanitizationEvent(field, original, sanitized, req) {
  if (original !== sanitized) {
    logger.warn('sanitization.modified', {
      field,
      ip: req?.ip,
      path: req?.path,
      originalLength: String(original).length,
      sanitizedLength: String(sanitized).length,
    });
  }
}
