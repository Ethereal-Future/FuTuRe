/**
 * Sanitizes log data by redacting sensitive fields
 * Prevents private keys, secrets, passwords, and tokens from appearing in logs
 */

const SENSITIVE_KEYS_REGEX = /secret|private|password|token|key/i;
const MAX_DEPTH = 10;

export function sanitizeLogData(data, depth = 0) {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeLogData(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
