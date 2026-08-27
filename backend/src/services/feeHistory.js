import { horizonServer } from '../config/stellar.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';

/**
 * Take a single fee-stats snapshot from Horizon and persist it to the
 * FeeSnapshot table.  Called by the scheduler every 5 minutes.
 * @returns {Promise<void>}
 */
export async function recordFeeSnapshot() {
  try {
    const feeStats = await horizonServer.feeStats().call();

    const baseFee = parseInt(feeStats.last_ledger_base_fee, 10) || 100;
    const p10      = parseInt(feeStats.fee_charged?.p10  ?? baseFee, 10);
    const p50      = parseInt(feeStats.fee_charged?.p50  ?? baseFee, 10);
    const p75      = parseInt(feeStats.fee_charged?.p75  ?? baseFee, 10);
    const p90      = parseInt(feeStats.fee_charged?.p90  ?? baseFee, 10);
    const p99      = parseInt(feeStats.fee_charged?.p99  ?? baseFee, 10);
    const peakFee  = parseInt(feeStats.peak_fee?.p99     ?? p99,     10);

    await prisma.feeSnapshot.create({
      data: { baseFee, p10, p50, p75, p90, p99, peakFee },
    });

    logger.info('feeHistory.snapshot.recorded', { baseFee, p50 });
  } catch (error) {
    logger.error('feeHistory.snapshot.error', { error: error.message });
    // Non-fatal: the scheduler will retry on the next interval.
  }
}

/**
 * Return real persisted fee snapshots for the requested window.
 * Only genuine data is returned — no synthetic / randomised points.
 * When fewer snapshots exist than the window covers the frontend should
 * display however many real points are available (see FeeHistoryChart.jsx).
 *
 * @param {number} [hours=24] - How far back (in hours) to look
 * @returns {Promise<{
 *   history: Array<{timestamp: string, baseFee: number}>,
 *   currentFee: number,
 *   recommendedFee: number,
 *   snapshotCount: number,
 *   insufficientHistory: boolean
 * }>}
 */
export async function getFeeHistory(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const snapshots = await prisma.feeSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: 'asc' },
    select: { capturedAt: true, baseFee: true, p50: true, p75: true },
  });

  const history = snapshots.map((s) => ({
    timestamp: s.capturedAt.toISOString(),
    baseFee: s.baseFee,
  }));

  // How many data points would a fully-populated window contain?
  // With a 5-minute interval: hours * 12 points.
  const expectedPoints = hours * 12;
  const insufficientHistory = history.length < expectedPoints;

  const latest = snapshots[snapshots.length - 1];
  const currentFee    = latest?.baseFee ?? 100;
  // Recommended fee: p75 of the most recent snapshot, +20% headroom.
  const recommendedFee = latest
    ? Math.ceil(latest.p75 * 1.2)
    : Math.ceil(currentFee * 1.2);

  return {
    history,
    currentFee,
    recommendedFee,
    snapshotCount: history.length,
    insufficientHistory,
  };
}

/**
 * Purge snapshots older than `days` days.  Intended for a periodic cleanup job.
 * @param {number} [days=30]
 */
export async function purgeStaleFeeSnapshots(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.feeSnapshot.deleteMany({
    where: { capturedAt: { lt: cutoff } },
  });
  if (count > 0) logger.info('feeHistory.purge', { count, days });
}