/**
 * Snapshot store with optimistic locking.
 *
 * The original snapshot saving logic in eventStore.js used a plain upsert
 * that could overwrite a *newer* snapshot when asynchronous workers finished
 * out of order: worker-B writes version 600, then worker-A arrives late and
 * overwrites it with version 500, corrupting replay state.
 *
 * This module enforces monotonic version progression by adding a
 * `WHERE version < :newVersion` guard to every save.  If a newer snapshot
 * already exists the write is silently dropped — the aggregate's state is
 * already at least as fresh — and no error is thrown so callers can proceed.
 *
 * Fixes ISSUE-314.
 */

import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Persist an aggregate snapshot, skipping the write if an equal or newer
 * version is already stored (optimistic locking).
 *
 * @param {string} aggregateId
 * @param {object} state - Serialisable aggregate state
 * @param {number} version - Event version that this snapshot represents
 * @param {number} [reducerVersion=1] - Fold-logic version for cache invalidation
 * @returns {Promise<boolean>} `true` if the snapshot was written, `false` if
 *   a newer snapshot already existed and the write was skipped.
 */
export async function saveSnapshot(aggregateId, state, version, reducerVersion = 1) {
  try {
    // Attempt to insert a new row for this (aggregateId, version) pair.
    // If a row already exists with the same or higher version we do nothing,
    // ensuring older snapshots never overwrite newer ones.
    const existing = await prisma.eventSnapshot.findFirst({
      where: { aggregateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    if (existing && existing.version >= version) {
      logger.debug('snapshotStore.saveSnapshot.skipped', {
        aggregateId,
        newVersion: version,
        existingVersion: existing.version,
      });
      return false;
    }

    await prisma.eventSnapshot.upsert({
      where: { aggregateId_version: { aggregateId, version } },
      update: { state, reducerVersion, updatedAt: new Date() },
      create: { aggregateId, state, version, reducerVersion },
    });

    logger.debug('snapshotStore.saveSnapshot.written', { aggregateId, version });
    return true;
  } catch (err) {
    // A concurrent writer may have inserted a newer version between our
    // findFirst and the upsert (TOCTOU).  Re-read and check before surfacing.
    if (err.code === 'P2002') {
      // Unique constraint violation — a concurrent upsert won the race.
      const current = await prisma.eventSnapshot.findFirst({
        where: { aggregateId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (current && current.version >= version) {
        logger.debug('snapshotStore.saveSnapshot.skipped_race', {
          aggregateId,
          newVersion: version,
          existingVersion: current.version,
        });
        return false;
      }
    }
    throw err;
  }
}

/**
 * Load the most recent snapshot for an aggregate, optionally capped at a
 * maximum version and filtered by reducer version.
 *
 * @param {string} aggregateId
 * @param {{ maxVersion?: number|null, reducerVersion?: number }} [options]
 * @returns {Promise<{ aggregateId: string, state: object, version: number, timestamp: string }|null>}
 */
export async function getSnapshot(aggregateId, { maxVersion = null, reducerVersion } = {}) {
  const where = { aggregateId };
  if (maxVersion != null) where.version = { lte: maxVersion };
  if (reducerVersion !== undefined) where.reducerVersion = reducerVersion;

  const record = await prisma.eventSnapshot.findFirst({
    where,
    orderBy: { version: 'desc' },
  });
  if (!record) return null;

  return {
    aggregateId: record.aggregateId,
    state: record.state,
    version: record.version,
    timestamp: record.updatedAt.toISOString(),
  };
}

/**
 * Delete all snapshots for an aggregate strictly below a given version.
 * Used during compaction to reclaim storage without touching current state.
 *
 * @param {string} aggregateId
 * @param {number} beforeVersion - Exclusive lower bound; snapshots with
 *   `version < beforeVersion` are removed.
 * @returns {Promise<number>} Number of snapshots deleted.
 */
export async function pruneSnapshots(aggregateId, beforeVersion) {
  const { count } = await prisma.eventSnapshot.deleteMany({
    where: { aggregateId, version: { lt: beforeVersion } },
  });
  if (count > 0) {
    logger.info('snapshotStore.prune', { aggregateId, beforeVersion, deleted: count });
  }
  return count;
}
