import { randomUUID } from 'node:crypto';
import * as StellarSDK from '@stellar/stellar-sdk';
import { createRedisBackend } from '../cache/redis.js';

const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 20_000;
const LOCK_RETRY_MS = 50;
const SEQ_TTL_SEC = 300;
const lockKey = (pk) => `seq:lock:${pk}`;
const seqKey = (pk) => `seq:last:${pk}`;

// Release only if we still own the lock.
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
// Atomically store the max of current and new sequence.
const SET_MAX_LUA =
  "local c = redis.call('get', KEYS[1]); " +
  "if (not c) or (string.len(ARGV[1]) > string.len(c)) or (string.len(ARGV[1]) == string.len(c) and ARGV[1] > c) then " +
  "redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) end return 1";

/**
 * Per-account sequence coordinator.
 *
 * Serializes sequence allocation per source account in-process and, when Redis
 * is configured, across instances via a Redis lock plus a shared last-allocated
 * sequence (ISSUE-234), so horizontally scaled tasks never reuse a sequence.
 */
class SequenceManager {
  constructor() {
    this.queueByAccount = new Map();
    this.stateByAccount = new Map();
    this.redisPromise = null;
  }

  async getRedis() {
    if (!this.redisPromise) {
      this.redisPromise = (async () => {
        const backend = createRedisBackend();
        if (!backend.client) return null;
        await backend.connect();
        return backend.client;
      })().catch(() => null);
    }
    const client = await this.redisPromise;
    return client && client.status === 'ready' ? client : null;
  }

  async acquireDistributedLock(redis, sourcePublicKey) {
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const ok = await redis.set(lockKey(sourcePublicKey), token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') return token;
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
    throw new Error(`Timed out acquiring sequence lock for ${sourcePublicKey}`);
  }

  async withLock(sourcePublicKey, task) {
    return this.withLocalLock(sourcePublicKey, async () => {
      const redis = await this.getRedis();
      if (!redis) return task();
      const token = await this.acquireDistributedLock(redis, sourcePublicKey);
      try {
        return await task();
      } finally {
        await redis.eval(RELEASE_LUA, 1, lockKey(sourcePublicKey), token).catch(() => {});
      }
    });
  }

  async withLocalLock(sourcePublicKey, task) {
    const prior = this.queueByAccount.get(sourcePublicKey) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    this.queueByAccount.set(sourcePublicKey, tail);

    await prior;
    try {
      return await task();
    } finally {
      release();
      if (this.queueByAccount.get(sourcePublicKey) === tail) {
        this.queueByAccount.delete(sourcePublicKey);
      }
    }
  }

  clear(sourcePublicKey) {
    this.stateByAccount.delete(sourcePublicKey);
    this.getRedis()
      .then((redis) => redis?.del(seqKey(sourcePublicKey)))
      .catch(() => {});
  }

  async getAccountForBuild(sourcePublicKey, loadAccountFn) {
    const state = this.stateByAccount.get(sourcePublicKey);
    const redis = await this.getRedis();
    if (redis) {
      const shared = await redis.get(seqKey(sourcePublicKey)).catch(() => null);
      if (shared) {
        const sharedSeq = BigInt(shared);
        if (!state?.lastAllocatedSequence || sharedSeq > state.lastAllocatedSequence) {
          this.stateByAccount.set(sourcePublicKey, {
            lastAllocatedSequence: sharedSeq,
            balances: state?.balances ?? [],
          });
        }
        return this.getCachedAccount(sourcePublicKey, loadAccountFn);
      }
      // No shared sequence: reload from Horizon to avoid a stale local cache.
      this.stateByAccount.delete(sourcePublicKey);
    }
    return this.getCachedAccount(sourcePublicKey, loadAccountFn);
  }

  async getCachedAccount(sourcePublicKey, loadAccountFn) {
    const state = this.stateByAccount.get(sourcePublicKey);
    if (state?.lastAllocatedSequence) {
      const account = new StellarSDK.Account(
        sourcePublicKey,
        state.lastAllocatedSequence.toString(),
      );
      return {
        account,
        balances: Array.isArray(state.balances) ? state.balances : [],
        fromCache: true,
      };
    }

    const loaded = await loadAccountFn();
    const currentSequence = BigInt(loaded.sequenceNumber());
    this.stateByAccount.set(sourcePublicKey, {
      lastAllocatedSequence: currentSequence,
      balances: loaded.balances ?? [],
    });
    return { account: loaded, balances: loaded.balances ?? [], fromCache: false };
  }

  async markBuilt(sourcePublicKey, account, balances = []) {
    const seq = BigInt(account.sequenceNumber());
    this.stateByAccount.set(sourcePublicKey, {
      lastAllocatedSequence: seq,
      balances: Array.isArray(balances) ? balances : [],
    });
    const redis = await this.getRedis();
    if (redis) {
      await redis
        .eval(SET_MAX_LUA, 1, seqKey(sourcePublicKey), seq.toString(), SEQ_TTL_SEC)
        .catch(() => {});
    }
  }
}

export const sequenceManager = new SequenceManager();
