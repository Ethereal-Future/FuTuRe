'use strict';

const { isChannelEnabled, CRITICAL_NOTIFICATION_TYPES } = require('../preferences');

/**
 * Build a Date whose UTC instant corresponds to the given wall-clock hour in
 * the supplied IANA timezone. We compute the offset for that timezone at the
 * target instant using Intl so the tests are deterministic regardless of the
 * machine's own timezone.
 */
function dateAtLocalHour(timeZone, hour) {
  // Start from a fixed reference day (UTC) and search for the instant whose
  // local hour in `timeZone` equals `hour`.
  const base = Date.UTC(2024, 0, 15, 0, 0, 0);
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(base + offsetMinutes * 60 * 1000);
    const localHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hour: 'numeric',
      }).format(candidate)
    );
    if (localHour === hour) {
      return candidate;
    }
  }
  throw new Error(`Could not build a date at local hour ${hour} for ${timeZone}`);
}

function makePref(overrides = {}) {
  return {
    email: true,
    push: true,
    sms: false,
    quietHoursStart: 22,
    quietHoursEnd: 7,
    timezone: 'UTC',
    ...overrides,
  };
}

describe('isChannelEnabled quiet hours', () => {
  test('enforces quiet hours in the user\'s local timezone (New York)', () => {
    const pref = makePref({ timezone: 'America/New_York' });

    // 23:00 local New York -> inside quiet hours (22:00-07:00).
    const quiet = dateAtLocalHour('America/New_York', 23);
    expect(isChannelEnabled(pref, 'push', quiet)).toBe(false);

    // 12:00 local New York -> outside quiet hours, should be delivered.
    const daytime = dateAtLocalHour('America/New_York', 12);
    expect(isChannelEnabled(pref, 'push', daytime)).toBe(true);
  });

  test('evaluates quiet hours correctly across multiple timezones', () => {
    const cases = [
      { timezone: 'Asia/Tokyo', quietHour: 23, activeHour: 12 },
      { timezone: 'Europe/London', quietHour: 23, activeHour: 12 },
      { timezone: 'America/Los_Angeles', quietHour: 23, activeHour: 12 },
    ];

    for (const { timezone, quietHour, activeHour } of cases) {
      const pref = makePref({ timezone });
      expect(isChannelEnabled(pref, 'push', dateAtLocalHour(timezone, quietHour))).toBe(false);
      expect(isChannelEnabled(pref, 'push', dateAtLocalHour(timezone, activeHour))).toBe(true);
    }
  });

  test('does not suppress notifications when quiet hours are not configured', () => {
    const pref = makePref({ quietHoursStart: null, quietHoursEnd: null });
    expect(isChannelEnabled(pref, 'push', dateAtLocalHour('UTC', 3))).toBe(true);
  });

  test('falls back to UTC when no timezone is configured', () => {
    const pref = makePref({ timezone: undefined });
    expect(isChannelEnabled(pref, 'push', dateAtLocalHour('UTC', 23))).toBe(false);
    expect(isChannelEnabled(pref, 'push', dateAtLocalHour('UTC', 12))).toBe(true);
  });
});

describe('isChannelEnabled critical notification bypass', () => {
  test('exposes the critical notification whitelist', () => {
    expect(CRITICAL_NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining(['login_new_device', 'password_reset', 'aml_freeze'])
    );
  });

  test('critical security alerts bypass quiet hours', () => {
    const pref = makePref({ timezone: 'America/New_York' });
    const quiet = dateAtLocalHour('America/New_York', 23);

    for (const type of ['login_new_device', 'password_reset', 'aml_freeze']) {
      expect(isChannelEnabled(pref, 'push', quiet, type)).toBe(true);
    }
  });

  test('non-critical notifications are still suppressed during quiet hours', () => {
    const pref = makePref({ timezone: 'America/New_York' });
    const quiet = dateAtLocalHour('America/New_York', 23);
    expect(isChannelEnabled(pref, 'push', quiet, 'weekly_digest')).toBe(false);
  });

  test('critical alerts still respect disabled channels', () => {
    const pref = makePref({ push: false, timezone: 'America/New_York' });
    const quiet = dateAtLocalHour('America/New_York', 23);
    expect(isChannelEnabled(pref, 'push', quiet, 'login_new_device')).toBe(false);
  });
});
