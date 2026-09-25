/**
 * Tests for userBehavior.js — verifies that peakHour computation is
 * timezone-independent (issue #1146).
 *
 * The test stubs prisma so it can be run in any environment without a DB.
 * It also verifies that switching TZ has no effect on the computed peakHour
 * by temporarily mutating process.env.TZ (Node honours TZ at runtime for
 * getHours() but not for getUTCHours(), so this is the canonical canary).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Prisma stub ──────────────────────────────────────────────────────────────
vi.mock('../src/db/client.js', () => ({
  default: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../src/db/client.js';
import userBehavior from '../src/analytics/userBehavior.js';

// Build a fake transaction whose createdAt is a specific UTC hour.
function makeTx(utcHour, amount = '10') {
  const date = new Date('2025-01-15T00:00:00.000Z');
  date.setUTCHours(utcHour, 0, 0, 0);
  return { amount, assetCode: 'XLM', createdAt: date, recipientId: 'user-b' };
}

describe('UserBehaviorTracker.getProfile — peakHour (issue #1146)', () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    // Restore TZ after each test
    if (originalTZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTZ;
    }
    vi.clearAllMocks();
  });

  it('returns the correct UTC peak hour (14:00 UTC)', async () => {
    // 5 txs at UTC 14, 1 at UTC 02
    const txs = [
      makeTx(14), makeTx(14), makeTx(14), makeTx(14), makeTx(14),
      makeTx(2),
    ];
    prisma.transaction.findMany.mockResolvedValue(txs);

    process.env.TZ = 'UTC';
    const profile = await userBehavior.getProfile('user-a');
    expect(profile.peakHour).toBe(14);
  });

  it('peakHour is identical whether TZ=UTC or TZ=America/New_York', async () => {
    // 5 txs at UTC 14, 1 at UTC 02
    const txs = [
      makeTx(14), makeTx(14), makeTx(14), makeTx(14), makeTx(14),
      makeTx(2),
    ];
    prisma.transaction.findMany.mockResolvedValue(txs);

    process.env.TZ = 'UTC';
    const profileUtc = await userBehavior.getProfile('user-a');

    prisma.transaction.findMany.mockResolvedValue(txs);
    process.env.TZ = 'America/New_York';
    const profileNy = await userBehavior.getProfile('user-a');

    expect(profileUtc.peakHour).toBe(profileNy.peakHour);
  });

  it('peakHour is identical whether TZ=UTC or TZ=Asia/Manila', async () => {
    // 4 txs at UTC 03, 2 at UTC 22
    const txs = [
      makeTx(3), makeTx(3), makeTx(3), makeTx(3),
      makeTx(22), makeTx(22),
    ];

    prisma.transaction.findMany.mockResolvedValue(txs);
    process.env.TZ = 'UTC';
    const profileUtc = await userBehavior.getProfile('user-a');

    prisma.transaction.findMany.mockResolvedValue(txs);
    process.env.TZ = 'Asia/Manila';
    const profileManila = await userBehavior.getProfile('user-a');

    expect(profileUtc.peakHour).toBe(profileManila.peakHour);
    expect(profileUtc.peakHour).toBe(3);
  });

  it('returns txCount 0 when no transactions', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    const profile = await userBehavior.getProfile('user-a');
    expect(profile.txCount).toBe(0);
    expect(profile.peakHour).toBeUndefined();
  });
});
