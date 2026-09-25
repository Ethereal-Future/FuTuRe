import dns from 'node:dns';
import net from 'node:net';

function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice('::ffff:'.length);
      if (net.isIP(v4) === 4) return isPrivateOrReservedIp(v4);
    }
    return false;
  }
  return true;
}

async function resolvePublicAddresses(hostname, lookup = dns.promises.lookup) {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      const err = new Error('hostname resolves to a private, loopback, or link-local address');
      err.status = 400;
      throw err;
    }
    return [hostname];
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true }).catch(() => null);
  if (!resolved || resolved.length === 0) {
    const err = new Error('hostname could not be resolved');
    err.status = 400;
    throw err;
  }
  const addresses = resolved.map((entry) => entry.address);
  if (addresses.some(isPrivateOrReservedIp)) {
    const err = new Error('hostname resolves to a private, loopback, or link-local address');
    err.status = 400;
    throw err;
  }
  return addresses.sort();
}

export async function validatePublicHttpsUrl(
  value,
  { allowPath = true, allowQuery = true, lookup = dns.promises.lookup } = {},
) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    const err = new Error('url must be a valid absolute URL');
    err.status = 400;
    throw err;
  }

  if (parsed.protocol !== 'https:') {
    const err = new Error('url must use https://');
    err.status = 400;
    throw err;
  }

  if (!allowPath && parsed.pathname && parsed.pathname !== '/') {
    const err = new Error('url must not include a path');
    err.status = 400;
    throw err;
  }
  if (!allowQuery && parsed.search) {
    const err = new Error('url must not include query parameters');
    err.status = 400;
    throw err;
  }

  const hostname = parsed.hostname.toLowerCase();
  const addresses = await resolvePublicAddresses(hostname, lookup);
  return {
    parsed,
    normalizedUrl: parsed.toString(),
    dnsPin: { hostname, addresses },
  };
}

export async function validatePublicDomain(domain, { lookup = dns.promises.lookup } = {}) {
  const cleanDomain = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  if (!cleanDomain) {
    const err = new Error('domain is required');
    err.status = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(`https://${cleanDomain}`);
  } catch {
    const err = new Error('domain must be a valid hostname');
    err.status = 400;
    throw err;
  }

  if (parsed.username || parsed.password) {
    const err = new Error('domain must not include credentials');
    err.status = 400;
    throw err;
  }
  if (net.isIP(parsed.hostname)) {
    const err = new Error('domain must not be an IP address');
    err.status = 400;
    throw err;
  }

  const hostname = parsed.hostname.toLowerCase();
  const addresses = await resolvePublicAddresses(hostname, lookup);
  return { hostname, dnsPin: { hostname, addresses } };
}

export async function assertDnsPin(dnsPin, { lookup = dns.promises.lookup } = {}) {
  if (!dnsPin?.hostname || !Array.isArray(dnsPin.addresses)) return;
  const latest = await resolvePublicAddresses(dnsPin.hostname, lookup);
  if (
    latest.length !== dnsPin.addresses.length ||
    latest.some((address, index) => address !== dnsPin.addresses[index])
  ) {
    const err = new Error('hostname DNS changed during request validation');
    err.status = 400;
    throw err;
  }
}
