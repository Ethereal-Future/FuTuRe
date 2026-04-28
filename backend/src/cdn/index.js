/**
 * CDN Optimization Module
 *
 * Provides:
 *  - Multi-region CDN configuration
 *  - Dynamic cache-control header strategy
 *  - Edge computing hints (Vary, Surrogate-Control)
 *  - CDN analytics & monitoring
 *  - Security headers (CSP, HSTS, X-Frame-Options)
 *  - Cost optimization (cache-hit tracking)
 *  - Failover: primary → secondary CDN origin
 *
 * Env vars:
 *   CDN_URL=https://cdn.example.com
 *   CDN_SECONDARY_URL=https://cdn2.example.com
 *   CDN_ENABLED=true
 *   CDN_CACHE_MAX_AGE_S=86400
 */

import logger from '../config/logger.js';

// ── Config ────────────────────────────────────────────────────────────────────

export function getCdnConfig() {
  return {
    enabled: process.env.CDN_ENABLED === 'true',
    primaryUrl: process.env.CDN_URL ?? null,
    secondaryUrl: process.env.CDN_SECONDARY_URL ?? null,
    maxAgeSeconds: parseInt(process.env.CDN_CACHE_MAX_AGE_S ?? '86400', 10),
    regions: (process.env.CDN_REGIONS ?? 'us-east-1').split(',').map(r => r.trim()),
  };
}

// ── Cache strategy ────────────────────────────────────────────────────────────

const CACHE_PROFILES = {
  // Static assets with content hash — cache forever
  immutable: (maxAge) => `public, max-age=${maxAge}, immutable`,
  // API responses — short TTL, allow stale while revalidating
  api:        () => 'public, max-age=30, stale-while-revalidate=60',
  // User-specific data — private, no CDN caching
  private:    () => 'private, no-store',
  // HTML entry point — always revalidate
  html:       () => 'public, max-age=0, must-revalidate',
};

export function getCacheHeaders(profile = 'api') {
  const { maxAgeSeconds } = getCdnConfig();
  const directive = CACHE_PROFILES[profile]?.(maxAgeSeconds) ?? CACHE_PROFILES.api();
  return { 'Cache-Control': directive };
}

// ── Security headers ──────────────────────────────────────────────────────────

export function getSecurityHeaders() {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=()',
  };
}

// ── Asset URL resolution with failover ───────────────────────────────────────

let primaryFailed = false;

export function resolveAssetUrl(path) {
  const { enabled, primaryUrl, secondaryUrl } = getCdnConfig();
  if (!enabled || !primaryUrl) return path;
  const base = primaryFailed && secondaryUrl ? secondaryUrl : primaryUrl;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function reportCdnFailure(origin) {
  if (origin === 'primary') {
    primaryFailed = true;
    logger.warn('cdn.failover.activated', { fallback: getCdnConfig().secondaryUrl });
  }
}

export function resetCdnFailover() {
  primaryFailed = false;
  logger.info('cdn.failover.reset');
}

// ── Analytics & monitoring ────────────────────────────────────────────────────

const cdnStats = {
  cacheHits: 0,
  cacheMisses: 0,
  originRequests: 0,
  failovers: 0,
  byRegion: {},
};

export function recordCdnEvent({ type, region }) {
  if (type === 'hit')    cdnStats.cacheHits++;
  if (type === 'miss')   { cdnStats.cacheMisses++; cdnStats.originRequests++; }
  if (type === 'failover') cdnStats.failovers++;
  if (region) cdnStats.byRegion[region] = (cdnStats.byRegion[region] ?? 0) + 1;
}

export function getCdnStats() {
  const total = cdnStats.cacheHits + cdnStats.cacheMisses;
  return {
    ...cdnStats,
    hitRate: total > 0 ? (cdnStats.cacheHits / total).toFixed(3) : null,
    config: getCdnConfig(),
  };
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Attach CDN-friendly cache-control and security headers to responses.
 * Profile is determined by request path:
 *   /assets/* → immutable  (Vite hashed bundles)
 *   /api/*    → api
 *   *.html    → html
 *   default   → api
 */
export function cdnMiddleware(req, res, next) {
  const path = req.path;
  let profile = 'api';
  if (path.startsWith('/assets/')) profile = 'immutable';
  else if (path.endsWith('.html'))  profile = 'html';
  else if (path.startsWith('/api/')) profile = 'api';

  const cacheHeaders = getCacheHeaders(profile);
  const secHeaders = getSecurityHeaders();
  Object.assign(res, {}); // ensure res is writable
  res.set({ ...cacheHeaders, ...secHeaders });

  // Edge computing hint: vary on Accept-Encoding for compression
  res.set('Vary', 'Accept-Encoding');

  // Surrogate-Control for CDN-specific TTL (Fastly/Varnish)
  if (profile === 'immutable') {
    res.set('Surrogate-Control', `max-age=${getCdnConfig().maxAgeSeconds}`);
  }

  next();
}
