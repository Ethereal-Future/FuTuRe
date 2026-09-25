/**
 * #1117 / #1118 — bounded fraud analysis, O(n) rapid-succession, shared AML rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  default: {
    transaction: { findMany: vi.fn() },
    aMLAlert: { create: vi.fn().mockResolvedValue({}) },
    user: { update: vi.fn() },
  },
}));

vi.mock('../src/compliance/riskScorer.js', () => ({
  default: {
    scoreTransaction: vi.fn().mockResolvedValue({ score: 50, level: 'MEDIUM' }),
  },
}));

vi.mock('../src/compliance/complianceAudit.js', () => ({
  default: { log: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../src/compliance/kycCollector.js', () => ({
  default: { isVerified: vi.fn().mockResolvedValue(true) },
}));

vi.mock('../src/config/logger.js', () => ({
  default: {
    child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
  },
}));

import prisma from '../src/db/client.js';
import fraudDetector, {
  resolveAnalyzeRange,
  DateRangeError,
  ANALYZE_DEFAULT_RANGE_MS,
  ANALYZE_MAX_RANGE_MS,
} from '../src/analytics/fraudDetector.js';
import {
  findRapidSuccessionWindow,
  findRapidSuccessionWindowNaive,
  detectBatchFlags,
  THRESHOLDS,
} from '../src/compliance/rules.js';
import amlMonitor from '../src/compliance/amlMonitor.js';

function makeTx({ id, senderId = 'sender-1', amount = '100', createdAt }) {
  return { id, senderId, amount, createdAt };
}

function cluster(senderId, n, start, intervalMs, amount = '100') {
  return Array.from({ length: n }, (_, i) =>
    makeTx({
      id: `${senderId}-${i}`,
      senderId,
      amount,
      createdAt: new Date(start + i * intervalMs),
    })
  );
}

describe('resolveAnalyzeRange', () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);

  it('defaults to the last 30 days when from/to are omitted', () => {
    const { fromDate, toDate } = resolveAnalyzeRange({}, now);
    expect(toDate.getTime()).toBe(now);
    expect(fromDate.getTime()).toBe(now - ANALYZE_DEFAULT_RANGE_MS);
  });

  it('rejects ranges longer than the server-side maximum', () => {
    const to = new Date(now);
    const from = new Date(now - ANALYZE_MAX_RANGE_MS - 24 * 60 * 60 * 1000);
    expect(() => resolveAnalyzeRange({ from, to }, now)).toThrow(DateRangeError);
  });

  it('rejects from > to', () => {
    expect(() =>
      resolveAnalyzeRange({ from: new Date(now), to: new Date(now - 1000) }, now)
    ).toThrow(/from must be/i);
  });
});

describe('rapid-succession sliding window', () => {
  it('matches the naive O(n²) scan on a large per-sender set', () => {
    const start = Date.UTC(2026, 0, 1);
    const txs = [
      ...cluster('s1', 80, start, 60 * 1000),
      ...cluster('s1', 200, start + 3 * 60 * 60 * 1000, 30 * 1000),
      ...cluster('s1', 50, start + 8 * 60 * 60 * 1000, 10 * 60 * 1000),
    ];

    const naive = findRapidSuccessionWindowNaive(txs);
    const sliding = findRapidSuccessionWindow(txs);

    expect(sliding).not.toBeNull();
    expect(naive).not.toBeNull();
    expect(sliding.count).toBe(naive.count);
    expect(new Date(sliding.windowStart).getTime()).toBe(new Date(naive.windowStart).getTime());
    expect(sliding.txId).toBe(naive.txId);
  });

  it('does not flag when fewer than RAPID_TX_COUNT txs fall in the window', () => {
    const start = Date.UTC(2026, 0, 1);
    const txs = cluster('s1', THRESHOLDS.RAPID_TX_COUNT - 1, start, 1000);
    expect(findRapidSuccessionWindow(txs)).toBeNull();
    expect(findRapidSuccessionWindowNaive(txs)).toBeNull();
  });
});

describe('fraudDetector.analyze query bounds and pagination', () => {
  beforeEach(() => {
    vi.mocked(prisma.transaction.findMany).mockReset();
  });

  it('queries a bounded createdAt window and pages with take/cursor', async () => {
    const page1 = cluster('s1', 2, Date.now() - 10000, 1000);
    const page2 = cluster('s1', 1, Date.now() - 1000, 1000);
    page2[0].id = 's1-2';

    vi.mocked(prisma.transaction.findMany)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    await fraudDetector.analyze({ pageSize: 2 });

    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(2);

    const first = prisma.transaction.findMany.mock.calls[0][0];
    expect(first.take).toBe(2);
    expect(first.where.createdAt.gte).toBeInstanceOf(Date);
    expect(first.where.createdAt.lte).toBeInstanceOf(Date);
    expect(first.where.createdAt.lte - first.where.createdAt.gte).toBeLessThanOrEqual(
      ANALYZE_DEFAULT_RANGE_MS
    );
    expect(first.cursor).toBeUndefined();

    const second = prisma.transaction.findMany.mock.calls[1][0];
    expect(second.cursor).toEqual({ id: page1[1].id });
    expect(second.skip).toBe(1);
    expect(second.take).toBe(2);
  });
});

describe('shared AML / fraud flags', () => {
  it('amlMonitor.screenTransaction and fraudDetector produce consistent flags', async () => {
    const now = new Date('2026-08-01T12:00:00Z');
    const senderId = 'shared-sender';
    const history = [
      makeTx({ id: 'h-vel-1', senderId, amount: '6000', createdAt: new Date(now.getTime() - 20 * 60 * 60 * 1000) }),
      makeTx({ id: 'h-vel-2', senderId, amount: '4000', createdAt: new Date(now.getTime() - 19 * 60 * 60 * 1000) }),
      makeTx({ id: 'h0', senderId, amount: '800', createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000) }),
      makeTx({ id: 'h1', senderId, amount: '900', createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }),
      makeTx({ id: 'h2', senderId, amount: '950', createdAt: new Date(now.getTime() - 60 * 60 * 1000) }),
      makeTx({ id: 'h3', senderId, amount: '100', createdAt: new Date(now.getTime() - 4 * 60 * 1000) }),
      makeTx({ id: 'h4', senderId, amount: '100', createdAt: new Date(now.getTime() - 3 * 60 * 1000) }),
      makeTx({ id: 'h5', senderId, amount: '100', createdAt: new Date(now.getTime() - 2 * 60 * 1000) }),
      makeTx({ id: 'h6', senderId, amount: '100', createdAt: new Date(now.getTime() - 1 * 60 * 1000) }),
    ];
    const current = makeTx({ id: 'tx-now', senderId, amount: '500', createdAt: now });
    const large = makeTx({
      id: 'tx-large',
      senderId,
      amount: '15000',
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    });
    const all = [...history, large, current].sort((a, b) => a.createdAt - b.createdAt);

    const { alerts } = await amlMonitor.screenTransaction(current, history);
    const amlIds = new Set(alerts.map((a) => a.ruleId));
    expect(amlIds.has('STRUCTURING')).toBe(true);
    expect(amlIds.has('RAPID_SUCCESSION')).toBe(true);
    expect(amlIds.has('VELOCITY')).toBe(true);

    const { alerts: largeAlerts } = await amlMonitor.screenTransaction(large, []);
    expect(largeAlerts.some((a) => a.ruleId === 'LARGE_TX')).toBe(true);

    const batchTypes = new Set(detectBatchFlags(all).map((f) => f.type));
    for (const id of [...amlIds, 'LARGE_TX']) {
      if (id === 'UNVERIFIED_USER') continue;
      expect(batchTypes.has(id)).toBe(true);
    }
  });
});
