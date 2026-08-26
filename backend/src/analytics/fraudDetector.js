import prisma from '../db/client.js';
import { createStreamAnalyzer } from '../compliance/rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default analysis window when `from`/`to` are omitted. */
export const ANALYZE_DEFAULT_RANGE_MS = 30 * DAY_MS;

/** Hard cap on the requested window (env-overridable). */
export const ANALYZE_MAX_RANGE_DAYS = parseInt(process.env.FRAUD_ANALYZE_MAX_RANGE_DAYS ?? '90', 10);

export const ANALYZE_MAX_RANGE_MS = ANALYZE_MAX_RANGE_DAYS * DAY_MS;

/** Cursor page size for the underlying transaction query. */
export const ANALYZE_PAGE_SIZE = parseInt(process.env.FRAUD_ANALYZE_PAGE_SIZE ?? '500', 10);

export class DateRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DateRangeError';
    this.statusCode = 400;
  }
}

/**
 * Resolve from/to into a bounded [fromDate, toDate] window.
 * Defaults to the last 30 days; rejects ranges longer than ANALYZE_MAX_RANGE_MS.
 */
export function resolveAnalyzeRange({ from, to } = {}, now = Date.now()) {
  const toDate = to ? new Date(to) : new Date(now);
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - ANALYZE_DEFAULT_RANGE_MS);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new DateRangeError('Invalid from/to date');
  }
  if (fromDate > toDate) {
    throw new DateRangeError('from must be less than or equal to to');
  }
  if (toDate.getTime() - fromDate.getTime() > ANALYZE_MAX_RANGE_MS) {
    throw new DateRangeError(
      `Date range exceeds the maximum of ${ANALYZE_MAX_RANGE_DAYS} days`
    );
  }

  return { fromDate, toDate };
}

/**
 * Detects fraud / AML patterns in transaction data using the shared
 * compliance rule set (`../compliance/rules.js`).
 */
export class FraudDetector {
  /**
   * @param {{ from?: string|Date, to?: string|Date, pageSize?: number }} [opts]
   * @returns {Promise<object[]>} flagged incidents
   */
  async analyze({ from, to, pageSize = ANALYZE_PAGE_SIZE } = {}) {
    const { fromDate, toDate } = resolveAnalyzeRange({ from, to });
    const analyzer = createStreamAnalyzer();

    let cursor = undefined;
    for (;;) {
      const page = await prisma.transaction.findMany({
        where: {
          successful: true,
          createdAt: { gte: fromDate, lte: toDate },
        },
        select: { id: true, amount: true, senderId: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;
      analyzer.processPage(page);
      cursor = page[page.length - 1].id;
      if (page.length < pageSize) break;
    }

    return analyzer.getFlags();
  }
}

export default new FraudDetector();
