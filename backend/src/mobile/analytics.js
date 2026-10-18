/**
 * Mobile analytics tracking.
 * Collects app events (screen views, actions, errors) per user/device.
 *
 * Client telemetry is sanitized before it is logged (issue #1386): request
 * headers are reduced to an explicit allowlist, hardware identifiers are
 * stripped unless the user opted in to crash diagnostics, and client IP
 * addresses are anonymized.
 */
import net from 'net';
import logger from '../config/logger.js';
import { sanitizeLogData as redactSecrets } from '../utils/sanitizeLogData.js';

export const ALLOWED_TELEMETRY_HEADERS = ['user-agent', 'accept-language', 'x-app-version'];

// Always replaced with a marker (never dropped silently) so it is visible
// in logs that a credential was present and deliberately withheld.
const REDACTED_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);
const SENSITIVE_HEADER_RE = /token|auth|session|secret|api[-_]?key|signature/i;

// Hardware / advertising identifiers, matched on keys normalised to
// lowercase alphanumerics (so `IMEI`, `imei_number`, `mac-address` all match).
const HARDWARE_ID_KEYS = new Set([
  'imei',
  'imeinumber',
  'meid',
  'mac',
  'macaddress',
  'wifimac',
  'bluetoothmac',
  'idfa',
  'idfv',
  'advertisingid',
  'adid',
  'gaid',
  'aaid',
  'serial',
  'serialnumber',
  'androidid',
]);

const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const MAX_DEPTH = 10;

const normaliseKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const redactBearer = (text) => text.replace(BEARER_RE, 'Bearer [REDACTED]');

/**
 * Anonymize an IP address before logging: the last IPv4 octet is masked
 * (`192.168.1.xxx`) and the last 80 bits of an IPv6 address are zeroed,
 * keeping only the /48 routing prefix.
 */
export function anonymizeIp(ip) {
  if (typeof ip !== 'string' || ip.trim() === '') return null;
  let address = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) address = mapped[1];

  const version = net.isIP(address);
  if (version === 4) {
    return `${address.split('.').slice(0, 3).join('.')}.xxx`;
  }
  if (version === 6) {
    return `${expandIpv6(address).slice(0, 3).join(':')}::`;
  }
  return null; // Not an IP — never log unparseable values verbatim.
}

/** Expand an IPv6 address into its 8 hextets (lowercase, no leading zeros). */
function expandIpv6(address) {
  let text = address.toLowerCase();
  // Embedded IPv4 tail (e.g. ::1.2.3.4) -> two hextets.
  const v4Tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4Tail) {
    const [a, b, c, d] = v4Tail[1].split('.').map(Number);
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    text = `${text.slice(0, -v4Tail[1].length)}${hi}:${lo}`;
  }
  const [head, tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - headParts.length - tailParts.length : 0;
  return [...headParts, ...Array(fill).fill('0'), ...tailParts].map((h) =>
    (parseInt(h, 16) || 0).toString(16),
  );
}

/** Reduce request headers to the allowlist; credentials are explicitly redacted. */
export function sanitizeHeaders(headers = {}) {
  const sanitized = {};
  for (const [rawName, value] of Object.entries(headers ?? {})) {
    const name = rawName.toLowerCase();
    if (REDACTED_HEADERS.has(name) || SENSITIVE_HEADER_RE.test(name)) {
      sanitized[name] = '[REDACTED]';
    } else if (ALLOWED_TELEMETRY_HEADERS.includes(name)) {
      sanitized[name] = typeof value === 'string' ? redactBearer(value) : value;
    }
    // Everything else (x-forwarded-for, device ids, custom headers…) is dropped.
  }
  return sanitized;
}

function stripMetadata(value, { keepHardwareIds }, depth = 0) {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
  if (typeof value === 'string') return redactBearer(value);
  if (Array.isArray(value)) {
    return value.map((v) => stripMetadata(v, { keepHardwareIds }, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const normalised = normaliseKey(key);
    if (!keepHardwareIds && HARDWARE_ID_KEYS.has(normalised)) continue;
    if (['ip', 'ipaddress', 'clientip', 'remoteaddress'].includes(normalised)) {
      out[key] = anonymizeIp(v);
      continue;
    }
    out[key] = stripMetadata(v, { keepHardwareIds }, depth + 1);
  }
  return out;
}

/**
 * Hardware identifiers are kept only for crash reports the user explicitly
 * opted in to sending as diagnostics.
 */
function hasCrashDiagnosticsOptIn(payload) {
  return payload?.type === 'crash' && payload?.crashDiagnostics?.optIn === true;
}

/**
 * Sanitize an incoming telemetry request + payload into an object that is
 * safe to log.
 *
 * @param {{ headers?: object, ip?: string }} req
 * @param {{ type?: string, event?: string, metadata?: object,
 *           crashDiagnostics?: { optIn?: boolean } }} payload
 */
export function sanitizeLogData(req = {}, payload = {}) {
  const keepHardwareIds = hasCrashDiagnosticsOptIn(payload);
  const { metadata, ...rest } = payload ?? {};
  return {
    headers: sanitizeHeaders(req?.headers),
    ip: anonymizeIp(req?.ip),
    ...redactSecrets(stripMetadata(rest, { keepHardwareIds })),
    metadata: redactSecrets(stripMetadata(metadata ?? {}, { keepHardwareIds })),
  };
}

class MobileAnalytics {
  constructor() {
    this.events = [];
  }

  track(userId, deviceId, eventName, properties = {}) {
    const event = {
      userId,
      deviceId,
      event: eventName,
      properties,
      timestamp: new Date(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * Record a client telemetry payload. Only the sanitized form is logged or
   * retained — raw headers, IPs and hardware ids never reach the logs.
   */
  recordTelemetry(req, payload = {}) {
    const sanitized = sanitizeLogData(req, payload);
    logger.info('mobile.telemetry', sanitized);
    return this.track(
      req?.mobile?.userId ?? null,
      req?.mobile?.deviceId ?? null,
      payload?.event ?? payload?.type ?? 'telemetry',
      sanitized,
    );
  }

  getStats(userId) {
    const userEvents = this.events.filter(e => e.userId === userId);
    const counts = userEvents.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {});
    return { total: userEvents.length, counts };
  }

  getSummary() {
    const counts = this.events.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {});
    return { total: this.events.length, counts };
  }
}

export default new MobileAnalytics();
