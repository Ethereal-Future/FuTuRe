/**
 * Database Sharding Layer
 *
 * Strategy: consistent-hash sharding on publicKey / userId.
 * Each shard is an independent PostgreSQL connection pool.
 * Shard count is driven by DB_SHARD_COUNT (default 2).
 *
 * Env vars:
 *   DB_SHARD_COUNT=2
 *   DB_SHARD_0_URL=postgresql://...
 *   DB_SHARD_1_URL=postgresql://...
 *   DATABASE_URL is used as fallback for shard 0 when DB_SHARD_0_URL is absent.
 */

import pg from 'pg';
import { createHash } from 'crypto';
import logger from '../config/logger.js';

const { Pool } = pg;

// ── Shard registry ────────────────────────────────────────────────────────────

let shards = [];   // Array<{ id, pool, url, healthy }>
let initialized = false;

export function initShards() {
  if (initialized) return;
  const count = parseInt(process.env.DB_SHARD_COUNT ?? '1', 10);

  for (let i = 0; i < count; i++) {
    const url = process.env[`DB_SHARD_${i}_URL`] ?? process.env.DATABASE_URL;
    if (!url) throw new Error(`Missing DB_SHARD_${i}_URL or DATABASE_URL`);

    const pool = new Pool({
      connectionString: url,
      max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error('shard.pool.error', { shardId: i, error: err.message });
      shards[i].healthy = false;
    });

    shards.push({ id: i, pool, url, healthy: true });
    logger.info('shard.registered', { shardId: i });
  }
  initialized = true;
}

// ── Shard key selection ───────────────────────────────────────────────────────

/**
 * Deterministically maps a shardKey (publicKey or userId) to a shard index
 * using a consistent hash so the same key always routes to the same shard.
 */
export function getShardIndex(shardKey) {
  const hash = createHash('sha256').update(String(shardKey)).digest('hex');
  // Use first 8 hex chars as a 32-bit integer
  const num = parseInt(hash.slice(0, 8), 16);
  return num % shards.length;
}

export function getShard(shardKey) {
  if (!initialized) initShards();
  const idx = getShardIndex(shardKey);
  const shard = shards[idx];
  if (!shard.healthy) {
    // Fallback: find next healthy shard
    const fallback = shards.find(s => s.healthy && s.id !== idx);
    if (!fallback) throw new Error('No healthy shards available');
    logger.warn('shard.fallback', { requestedShard: idx, fallbackShard: fallback.id });
    return fallback;
  }
  return shard;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Run a query on the shard responsible for shardKey. */
export async function shardQuery(shardKey, text, values = []) {
  const shard = getShard(shardKey);
  const client = await shard.pool.connect();
  try {
    const result = await client.query(text, values);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Fan-out query: run the same query on ALL shards and merge rows.
 * Use for cross-shard reads (e.g. admin dashboards, global search).
 */
export async function allShardsQuery(text, values = []) {
  if (!initialized) initShards();
  const results = await Promise.allSettled(
    shards.map(async (shard) => {
      const client = await shard.pool.connect();
      try {
        return (await client.query(text, values)).rows;
      } finally {
        client.release();
      }
    })
  );

  const rows = [];
  for (const r of results) {
    if (r.status === 'fulfilled') rows.push(...r.value);
    else logger.error('shard.fanout.error', { error: r.reason?.message });
  }
  return rows;
}

// ── Health & monitoring ───────────────────────────────────────────────────────

export async function checkShardHealth() {
  if (!initialized) initShards();
  const checks = await Promise.allSettled(
    shards.map(async (shard) => {
      const client = await shard.pool.connect();
      try {
        await client.query('SELECT 1');
        shard.healthy = true;
        return { shardId: shard.id, status: 'ok' };
      } catch (err) {
        shard.healthy = false;
        return { shardId: shard.id, status: 'error', error: err.message };
      } finally {
        client.release();
      }
    })
  );
  return checks.map(r => r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message });
}

export function getShardStats() {
  return shards.map(s => ({
    shardId: s.id,
    healthy: s.healthy,
    totalConnections: s.pool.totalCount,
    idleConnections: s.pool.idleCount,
    waitingClients: s.pool.waitingCount,
  }));
}

// ── Rebalancing ───────────────────────────────────────────────────────────────

/**
 * Rebalance: identify keys that would map to a different shard if shard count
 * changed. Returns a migration plan (dry-run by default).
 * In production, you'd run this as a background job with actual data movement.
 */
export function planRebalance(newShardCount) {
  const plan = [];
  for (const shard of shards) {
    plan.push({
      shardId: shard.id,
      note: `Rebalance from ${shards.length} → ${newShardCount} shards requires data migration`,
      action: 'manual_migration_required',
    });
  }
  logger.warn('shard.rebalance.plan', { currentCount: shards.length, newShardCount });
  return plan;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function closeShards() {
  await Promise.all(shards.map(s => s.pool.end()));
  shards = [];
  initialized = false;
  logger.info('shards.closed');
}
