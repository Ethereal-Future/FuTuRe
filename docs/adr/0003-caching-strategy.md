# ADR-0003: Multi-level Caching — In-memory L1 + Optional Redis L2

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-01-20

## Context and Problem Statement

Several API endpoints (account balance, exchange rates, fee stats) hit the Stellar Horizon API on every request. Horizon enforces its own rate limits, and repeated round-trips add latency. We need a caching layer to reduce Horizon calls, improve response times, and provide resilience when Horizon is temporarily unavailable.

## Decision Drivers

* Must reduce Horizon API calls to stay within rate limits
* Cache must be invalidated when a balance-changing operation (payment, trustline) occurs
* Should degrade gracefully when the cache backend is unavailable
* Deployment must work without external infrastructure for local development
* Must support shared cache state across multiple Node.js instances in production

## Considered Options

* **Redis only** — single shared cache, requires a Redis instance for every environment
* **In-memory only** — zero infrastructure, but cache is not shared across instances and is lost on restart
* **Multi-level: in-memory L1 + optional Redis L2** — fast local cache with a shared fallback
* **No caching** — simplest, but untenable under load due to Horizon rate limits

## Decision Outcome

Chosen option: **Multi-level: in-memory L1 + optional Redis L2**, implemented in `backend/src/cache/multi-level.js`.

When `REDIS_URL` is set, the cache uses Redis as a backing store so all Node.js replicas share the same cache state. When `REDIS_URL` is absent, the cache operates in L1-only mode — suitable for local development and single-instance deployments without requiring a Redis process. The architecture is transparent to consumers: they call `.get()` and `.set()` on `MultiLevelCache` regardless of which backend is active.

Cache invalidation is triggered explicitly after balance-changing operations (payments, trustline changes) rather than relying solely on TTL expiry, keeping data fresh without excessive Horizon calls.

### Positive Consequences

* Zero-infrastructure local development (no Redis required)
* Shared cache state in production when Redis is configured
* Explicit invalidation keeps balance data accurate after writes
* L1 hit path avoids network round-trips entirely
* Single abstraction layer — callers are unaware of L1 vs L2

### Negative Consequences

* L1 cache can serve stale data if a write happens on a different instance before pub/sub propagates (typically <20ms window)
* Two cache layers add complexity to debugging cache misses
* In-memory L1 is bounded by process heap — large cache payloads risk OOM
* Requires Redis Pub/Sub for cross-instance coherence in production deployments

## Implementation Patterns

### Pattern 1: Read-Through Cache (General-purpose)

Used for: Balance queries, exchange rates, fee stats

```javascript
// backend/src/cache/multi-level.js
async get(key) {
  // L1 hit
  const l1Value = this.l1.get(key);
  if (l1Value) return l1Value;
  
  // L2 hit
  if (this.l2) {
    const l2Value = await this.l2.get(key);
    if (l2Value) {
      this.l1.set(key, l2Value); // warm L1
      return l2Value;
    }
  }
  
  return null; // cache miss
}
```

### Pattern 2: Pub/Sub Invalidation (Distributed State)

Used for: IP whitelist, AMM pool reserves

```javascript
// backend/src/security/ipWhitelist.js
// Publisher side (writer instance)
async addToWhitelist(ip, reason, adminId) {
  const entry = await prisma.iPWhitelist.create({...}); // DB write
  whitelistedIPsCache.set(ip, entry); // L1 update
  await writeCachedEntry(entry); // L2 update
  await publishCacheUpdate({ action: 'add', entry }); // Pub/sub
}

// Subscriber side (all instances)
subscriber.on('message', (channel, message) => {
  const update = JSON.parse(message);
  if (update.action === 'add') {
    whitelistedIPsCache.set(update.entry.ipAddress, update.entry); // L1 sync
  }
});
```

**Key properties:**
- Database is source of truth
- L1 update is immediate (local write)
- L2 and pub/sub are async (fire-and-forget)
- Failures in L2/pub/sub are logged but don't fail the operation
- Sub-20ms propagation time for cross-instance updates

### Pattern 3: Optimistic Locking (Concurrency Control)

Used for: AMM pool reserves with version field

```javascript
// backend/src/services/amm.js
const pool = await prisma.ammPool.findUnique({ where: { poolId } });

// Attempt update with version check
const updated = await prisma.ammPool.update({
  where: { poolId, version: pool.version }, // optimistic lock
  data: { reserveA: newReserveA, version: { increment: 1 } }
});

await publishPool(updated); // Notify other instances
```

**Stale cache resolution:**
- Stale L1/L2 read → DB write fails due to version mismatch
- Retry reads fresh data from DB → cache miss recovery
- Pub/sub ensures next read hits updated L1 cache

## Pros and Cons of the Options

### Redis Only

* Good, because single source of truth — no staleness across instances
* Good, because cache survives Node.js restarts
* Bad, because requires Redis in every environment, including local dev
* Bad, because adds network latency on every cache hit (vs in-memory)

### In-memory Only

* Good, because zero external dependencies
* Good, because sub-microsecond access
* Bad, because cache is not shared across process instances — load-balanced deployments get cache fragmentation
* Bad, because cache is lost on every deploy or restart

### No Caching

* Good, because simplest possible implementation
* Bad, because unacceptable latency and Horizon rate-limit exposure under any meaningful load

## Related Issues

* [#1400](https://github.com/Ethereal-Future/FuTuRe/issues/1400) — IP whitelist distributed cache invalidation (resolved via Redis pub/sub pattern)
* [#1290](https://github.com/Ethereal-Future/FuTuRe/issues/1290) — AMM pool reserve synchronization across ECS tasks (resolved via pub/sub + optimistic locking)

## References

* [Distributed Cache Operations Guide](../operations/DISTRIBUTED_CACHE.md)
* [Backend Configuration: Redis Settings](../../backend/CONFIGURATION.md#caching--redis)
* [ioredis Pub/Sub Documentation](https://github.com/redis/ioredis#pubsub)
