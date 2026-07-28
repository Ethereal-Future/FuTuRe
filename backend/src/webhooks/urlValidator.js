import dns from 'node:dns';
import net from 'node:net';
import { getConfig } from '../config/env.js';

const MAX_URL_LENGTH = 2048;

// Escape hatch for local development / CI so tests can register plain
// http://localhost webhook receivers without tripping SSRF protections,
// mirroring the allowlist pattern used by src/security/ipWhitelist.js.
const HOST_ALLOWLIST = new Set(
  (process.env.WEBHOOK_HOST_ALLOWLIST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);

  if (type === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 0) return true; // "this" network
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice('::ffff:'.length);
      if (net.isIP(v4) === 4) return isPrivateOrReservedIp(v4);
    }
    return false;
  }

  // Unparseable address — treat as unsafe.
  return true;
}

/**
 * Validate a webhook registration/delivery URL to prevent SSRF.
 * Rejects malformed URLs, disallowed schemes, and hosts that resolve to
 * private/loopback/link-local addresses. HTTPS is required outside of
 * development/test so local receivers can still use http://localhost.
 */
export async function validateWebhookUrl(url, { appEnv, lookup = dns.promises.lookup } = {}) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, error: 'url is required' };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, error: `url must not exceed ${MAX_URL_LENGTH} characters` };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'url must be a valid absolute URL' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { valid: false, error: 'url must include a hostname' };
  }

  if (HOST_ALLOWLIST.has(hostname)) {
    return { valid: true };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'url scheme must be http or https' };
  }

  const resolvedAppEnv = appEnv ?? getConfig().meta.appEnv;
  const requireHttps = resolvedAppEnv === 'production' || resolvedAppEnv === 'staging';
  if (requireHttps && parsed.protocol !== 'https:') {
    return { valid: false, error: 'url must use https://' };
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const results = await lookup(hostname, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      return { valid: false, error: 'url hostname could not be resolved' };
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    return { valid: false, error: 'url resolves to a private, loopback, or link-local address' };
  }

  return { valid: true };
}
