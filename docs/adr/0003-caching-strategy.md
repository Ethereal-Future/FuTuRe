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

* L1 cache can serve stale data if a write happens on a different instance before L2 propagates
* Two cache layers add complexity to debugging cache misses
* In-memory L1 is bounded by process heap — large cache payloads risk OOM

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
