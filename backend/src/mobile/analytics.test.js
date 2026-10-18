/**
 * Telemetry log sanitization and PII redaction (#1386).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: logger } = await import('../config/logger.js');
const { default: mobileAnalytics, sanitizeLogData, anonymizeIp } = await import('./analytics.js');

const BEARER = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1MSJ9.c2lnbmF0dXJl';

function telemetryRequest(overrides = {}) {
  return {
    ip: '192.168.1.42',
    headers: {
      authorization: BEARER,
      cookie: 'sid=abc123; refresh=def456',
      'x-refresh-token': 'rt-secret',
      'x-api-key': 'key-secret',
      'x-device-id': 'device-1',
      'x-forwarded-for': '203.0.113.9',
      'user-agent': 'FuTuRe/2.4.0 (iPhone; iOS 18.1)',
      'accept-language': 'en-US',
      'x-app-version': '2.4.0',
    },
    mobile: { userId: 'user-1', deviceId: 'device-1' },
    ...overrides,
  };
}

const hardwarePayload = {
  type: 'screen_view',
  event: 'home_opened',
  metadata: {
    screen: 'home',
    IMEI: '490154203237518',
    macAddress: '00:1B:44:11:3A:B7',
    IDFA: '6D92078A-8246-4BA4-AE5B-76104861E7DC',
    nested: { imei_number: '356938035643809', wifi_mac: 'aa:bb:cc:dd:ee:ff', ok: 1 },
  },
};

describe('mobile telemetry sanitization (#1386)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mobileAnalytics.events = [];
  });

  it('logs sanitized objects with redacted bearer tokens, stripped device ids and masked IPs', () => {
    mobileAnalytics.recordTelemetry(telemetryRequest(), hardwarePayload);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message, logged] = logger.info.mock.calls[0];
    expect(message).toBe('mobile.telemetry');

    expect(logged.headers).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-refresh-token': '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'user-agent': 'FuTuRe/2.4.0 (iPhone; iOS 18.1)',
      'accept-language': 'en-US',
      'x-app-version': '2.4.0',
    });
    expect(logged.ip).toBe('192.168.1.xxx');
    expect(logged.metadata).toEqual({ screen: 'home', nested: { ok: 1 } });

    const serialized = JSON.stringify(logger.info.mock.calls);
    for (const secret of [
      'eyJhbGciOiJIUzI1NiJ9',
      'sid=abc123',
      'rt-secret',
      '192.168.1.42',
      '203.0.113.9',
      '490154203237518',
      '356938035643809',
      '00:1B:44:11:3A:B7',
      '6D92078A-8246-4BA4-AE5B-76104861E7DC',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('drops headers that are not on the allowlist', () => {
    const { headers } = sanitizeLogData(telemetryRequest(), {});
    expect(headers).not.toHaveProperty('x-device-id');
    expect(headers).not.toHaveProperty('x-forwarded-for');
  });

  it('handles mixed-case header names', () => {
    const req = { headers: { Authorization: BEARER, Cookie: 'a=b', 'User-Agent': 'ua' } };
    expect(sanitizeLogData(req, {}).headers).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'user-agent': 'ua',
    });
  });

  it('redacts bearer tokens embedded in metadata values', () => {
    const { metadata } = sanitizeLogData(telemetryRequest(), {
      metadata: { lastError: `401 for request with ${BEARER}` },
    });
    expect(metadata.lastError).toBe('401 for request with Bearer [REDACTED]');
  });

  it('keeps hardware identifiers only for opted-in crash diagnostics', () => {
    const crash = {
      type: 'crash',
      crashDiagnostics: { optIn: true },
      metadata: { IMEI: '490154203237518', stack: 'at main()' },
    };
    expect(sanitizeLogData(telemetryRequest(), crash).metadata).toEqual(crash.metadata);

    const notOptedIn = { ...crash, crashDiagnostics: { optIn: false } };
    expect(sanitizeLogData(telemetryRequest(), notOptedIn).metadata).toEqual({
      stack: 'at main()',
    });

    const optInWithoutCrash = { ...crash, type: 'screen_view' };
    expect(sanitizeLogData(telemetryRequest(), optInWithoutCrash).metadata).not.toHaveProperty(
      'IMEI',
    );
  });

  it('still redacts credentials and masks IPs for opted-in crash diagnostics', () => {
    mobileAnalytics.recordTelemetry(telemetryRequest(), {
      type: 'crash',
      crashDiagnostics: { optIn: true },
      metadata: { IMEI: '490154203237518' },
    });
    const [, logged] = logger.info.mock.calls[0];
    expect(logged.headers.authorization).toBe('[REDACTED]');
    expect(logged.ip).toBe('192.168.1.xxx');
  });

  it('anonymizes IP addresses found inside metadata', () => {
    const { metadata } = sanitizeLogData({}, { metadata: { clientIp: '10.0.0.7' } });
    expect(metadata.clientIp).toBe('10.0.0.xxx');
  });

  it('stores only the sanitized telemetry on the tracked event', () => {
    const event = mobileAnalytics.recordTelemetry(telemetryRequest(), hardwarePayload);
    expect(event).toMatchObject({ userId: 'user-1', event: 'home_opened' });
    expect(JSON.stringify(event)).not.toContain('490154203237518');
    expect(JSON.stringify(event)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});

describe('anonymizeIp (#1386)', () => {
  it.each([
    ['192.168.1.42', '192.168.1.xxx'],
    ['::ffff:203.0.113.9', '203.0.113.xxx'],
    // Last 80 bits zeroed: only the first 48 bits (3 hextets) survive.
    ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', '2001:db8:85a3::'],
    ['2001:db8:85a3::8a2e:370:7334', '2001:db8:85a3::'],
    ['2001:db8::1', '2001:db8:0::'],
    ['fe80::1%eth0', 'fe80:0:0::'],
    ['::1', '0:0:0::'],
  ])('%s -> %s', (input, expected) => {
    expect(anonymizeIp(input)).toBe(expected);
  });

  it('returns null for missing or unparseable values instead of logging them verbatim', () => {
    expect(anonymizeIp(undefined)).toBeNull();
    expect(anonymizeIp('')).toBeNull();
    expect(anonymizeIp('not-an-ip')).toBeNull();
  });
});
