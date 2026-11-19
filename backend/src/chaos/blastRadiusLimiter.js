import { createRedisBackend } from '../cache/redis.js';

const LIMITS_KEY = 'chaos:blast:limits';
const IMPACTS_KEY = 'chaos:blast:impacts';
const GLOBAL_KEY = 'chaos:blast:global';
const LOCK_PREFIX = 'chaos:blast:lock:';
const ABORTED_KEY = 'chaos:blast:aborted';

class BlastRadiusLimiter {
  constructor(redisBackend) {
    this.redis = redisBackend || createRedisBackend();
    // Local fallback state used when Redis is unavailable (fail-open).
    this.limits = new Map();
    this.impacts = new Map();
    this._localGlobal = { affectedServices: 0, errorRate: 0 };
  }

  async _withRedis(fn, fallback) {
    try {
      if (!this.redis || typeof this.redis.isAvailable === 'function' && !this.redis.isAvailable()) {
        return fallback();
      }
      return await fn();
    } catch (err) {
      return fallback();
    }
  }

  async _getLimits() {
    return this._withRedis(async () => {
      const raw = await this.redis.hgetall(LIMITS_KEY);
      const limits = new Map();
      if (raw) {
        for (const [limitId, value] of Object.entries(raw)) {
          try {
            limits.set(limitId, JSON.parse(value));
          } catch (e) {
            // skip malformed entry
          }
        }
      }
      return limits;
    }, () => new Map(this.limits));
  }

  async setLimit(limitId, maxAffectedServices, maxErrorRate = 10, maxDowntime = 60000) {
    const limit = {
      limitId,
      maxAffectedServices,
      maxErrorRate,
      maxDowntime,
      enabled: true
    };

    this.limits.set(limitId, limit);
    await this._withRedis(async () => {
      await this.redis.hset(LIMITS_KEY, limitId, JSON.stringify(limit));
    }, () => {});

    return limit;
  }

  async canInjectFailure(failureId, affectedServices, estimatedErrorRate) {
    const limits = await this._getLimits();

    for (const [limitId, limit] of limits) {
      if (!limit.enabled) continue;

      if (affectedServices.length > limit.maxAffectedServices) {
        return {
          allowed: false,
          reason: `Affected services (${affectedServices.length}) exceeds limit (${limit.maxAffectedServices})`,
          limitId
        };
      }

      if (estimatedErrorRate > limit.maxErrorRate) {
        return {
          allowed: false,
          reason: `Error rate (${estimatedErrorRate}%) exceeds limit (${limit.maxErrorRate}%)`,
          limitId
        };
      }
    }

    // Distributed safety check: read global counters from Redis.
    const global = await this._withRedis(async () => {
      const raw = await this.redis.hgetall(GLOBAL_KEY);
      return {
        affectedServices: raw && raw.affectedServices ? Number(raw.affectedServices) : 0,
        errorRate: raw && raw.errorRate ? Number(raw.errorRate) : 0
      };
    }, () => ({ ...this._localGlobal }));

    for (const [limitId, limit] of limits) {
      if (!limit.enabled) continue;

      const projectedServices = global.affectedServices + affectedServices.length;
      if (projectedServices > limit.maxAffectedServices) {
        return {
          allowed: false,
          reason: `Global affected services (${projectedServices}) exceeds limit (${limit.maxAffectedServices})`,
          limitId
        };
      }

      const projectedErrorRate = Math.max(global.errorRate, estimatedErrorRate);
      if (projectedErrorRate > limit.maxErrorRate) {
        return {
          allowed: false,
          reason: `Global error rate (${projectedErrorRate}%) exceeds limit (${limit.maxErrorRate}%)`,
          limitId
        };
      }
    }

    // Acquire a distributed lock to serialize concurrent injections across nodes.
    const lockKey = `${LOCK_PREFIX}${failureId}`;
    const lockAcquired = await this._withRedis(async () => {
      if (typeof this.redis.setNX === 'function') {
        return await this.redis.setNX(lockKey, '1', 30);
      }
      return true;
    }, () => true);

    if (!lockAcquired) {
      return {
        allowed: false,
        reason: `Concurrent chaos injection in progress for ${failureId}`,
        limitId: null
      };
    }

    return { allowed: true };
  }

  async recordImpact(failureId, affectedServices, errorRate, downtime) {
    const limits = await this._getLimits();

    const impact = {
      failureId,
      affectedServices,
      errorRate,
      downtime,
      timestamp: new Date().toISOString(),
      withinLimits: true
    };

    for (const limit of limits.values()) {
      if (affectedServices.length > limit.maxAffectedServices ||
          errorRate > limit.maxErrorRate ||
          downtime > limit.maxDowntime) {
        impact.withinLimits = false;
        break;
      }
    }

    this.impacts.set(failureId, impact);

    await this._withRedis(async () => {
      // Atomically increment global counters.
      await this.redis.hincrby(GLOBAL_KEY, 'affectedServices', affectedServices.length);
      await this.redis.hincrby(GLOBAL_KEY, 'errorRate', Math.round(errorRate * 100));
      await this.redis.hset(IMPACTS_KEY, failureId, JSON.stringify(impact));

      // Check whether the global error rate threshold has been breached and
      // automatically abort running experiments if so.
      const raw = await this.redis.hgetall(GLOBAL_KEY);
      const globalErrorRate = raw && raw.errorRate ? Number(raw.errorRate) / 100 : 0;
      const globalAffected = raw && raw.affectedServices ? Number(raw.affectedServices) : 0;

      for (const [limitId, limit] of limits) {
        if (!limit.enabled) continue;
        if (globalErrorRate > limit.maxErrorRate || globalAffected > limit.maxAffectedServices) {
          await this.redis.hset(ABORTED_KEY, failureId, JSON.stringify({
            failureId,
            limitId,
            reason: globalErrorRate > limit.maxErrorRate
              ? `Global error rate (${globalErrorRate}%) exceeds limit (${limit.maxErrorRate}%)`
              : `Global affected services (${globalAffected}) exceeds limit (${limit.maxAffectedServices})`,
            timestamp: new Date().toISOString()
          }));
          impact.aborted = true;
          impact.abortReason = globalErrorRate > limit.maxErrorRate
            ? `Global error rate (${globalErrorRate}%) exceeds limit (${limit.maxErrorRate}%)`
            : `Global affected services (${globalAffected}) exceeds limit (${limit.maxAffectedServices})`;
          await this.redis.hset(IMPACTS_KEY, failureId, JSON.stringify(impact));
          break;
        }
      }
    }, () => {
      this._localGlobal.affectedServices += affectedServices.length;
      this._localGlobal.errorRate = Math.max(this._localGlobal.errorRate, errorRate);
    });

    return impact;
  }

  async getImpactReport(failureId) {
    return this._withRedis(async () => {
      const raw = await this.redis.hget(IMPACTS_KEY, failureId);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (e) {
          return this.impacts.get(failureId);
        }
      }
      return this.impacts.get(failureId);
    }, () => this.impacts.get(failureId));
  }

  async getAllImpacts() {
    return this._withRedis(async () => {
      const raw = await this.redis.hgetall(IMPACTS_KEY);
      if (!raw) return Array.from(this.impacts.values());
      return Object.values(raw).map(v => {
        try {
          return JSON.parse(v);
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    }, () => Array.from(this.impacts.values()));
  }

  async getOutOfBoundsImpacts() {
    const impacts = await this.getAllImpacts();
    return impacts.filter(i => !i.withinLimits);
  }

  async disableLimit(limitId) {
    const limit = this.limits.get(limitId);
    if (limit) {
      limit.enabled = false;
    }
    await this._withRedis(async () => {
      const raw = await this.redis.hget(LIMITS_KEY, limitId);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.enabled = false;
          await this.redis.hset(LIMITS_KEY, limitId, JSON.stringify(parsed));
        } catch (e) {
          // ignore malformed entry
        }
      }
    }, () => {});
  }

  async enableLimit(limitId) {
    const limit = this.limits.get(limitId);
    if (limit) {
      limit.enabled = true;
    }
    await this._withRedis(async () => {
      const raw = await this.redis.hget(LIMITS_KEY, limitId);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.enabled = true;
          await this.redis.hset(LIMITS_KEY, limitId, JSON.stringify(parsed));
        } catch (e) {
          // ignore malformed entry
        }
      }
    }, () => {});
  }
}

export { BlastRadiusLimiter };
export default new BlastRadiusLimiter();
