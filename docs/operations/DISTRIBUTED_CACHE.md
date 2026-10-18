# Distributed Cache Operations Guide

## Overview

The FuTuRe backend uses a **two-tier distributed caching architecture** to maintain cache coherence across multiple ECS tasks in production while remaining functional without Redis in local development.

## Architecture

### Two-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│  ECS Task 1                    ECS Task 2                   │
│  ┌──────────────┐              ┌──────────────┐             │
│  │ L1 In-Memory │              │ L1 In-Memory │             │
│  │    Cache     │              │    Cache     │             │
│  │   (Map)      │              │   (Map)      │             │
│  └──────┬───────┘              └──────┬───────┘             │
│         │                              │                     │
│         │         Redis Pub/Sub        │                     │
│         │    ┌──────────────────┐     │                     │
│         └────┤ ip_whitelist:    ├─────┘                     │
│              │   updates        │                           │
│              │ amm:pool-updates │                           │
│              └────────┬─────────┘                           │
│                       │                                     │
│         ┌─────────────▼─────────────┐                       │
│         │   Redis L2 Cache          │                       │
│         │  (ElastiCache/Redis)      │                       │
│         └─────────────┬─────────────┘                       │
│                       │                                     │
│         ┌─────────────▼─────────────┐                       │
│         │   PostgreSQL RDS          │                       │
│         │  (Source of Truth)        │                       │
│         └───────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Cache Flow

**Read Path:**
1. Check L1 (in-memory) cache — ~1μs
2. On L1 miss, check L2 (Redis) cache — ~1-5ms
3. On L2 miss, query database — ~10-50ms
4. Populate both L1 and L2 on successful database read

**Write Path:**
1. Write to database (source of truth)
2. Update local L1 cache immediately
3. Write to L2 (Redis) cache
4. Publish invalidation message via Redis Pub/Sub
5. Other instances receive pub/sub message and update their L1 caches

## Subsystems Using Distributed Cache

### 1. IP Whitelist

**Purpose:** Rate limit exemptions for trusted IPs across all instances

**Cache Keys:** `ip_whitelist:<ip_address>`  
**Pub/Sub Channel:** `ip_whitelist:updates`  
**TTL:** 3600 seconds (1 hour)

**Message Types:**
```json
// Add IP
{"action": "add", "entry": {"ipAddress": "192.168.1.1", "reason": "Office"}}

// Remove IP
{"action": "remove", "ip": "192.168.1.1"}

// Clear all
{"action": "clear"}

// Force reload from DB
{"action": "reload"}
```

**Operations:**
```javascript
// Add IP (triggers pub/sub)
await addToWhitelist('192.168.1.1', 'Office network', 'admin-user-id');

// Remove IP (triggers pub/sub)
await removeFromWhitelist('192.168.1.1', 'admin-user-id');

// Force reload across all instances
await reloadWhitelist();

// Check if whitelisted (reads L1 → L2 → DB)
const whitelisted = await isWhitelisted('192.168.1.1');
```

### 2. AMM Pool Reserves

**Purpose:** Share pool reserve state across instances to prevent race conditions

**Cache Keys:** `amm:pool:<pool_id>`  
**Pub/Sub Channel:** `amm:pool-updates`  
**TTL:** 300 seconds (5 minutes)

**Concurrency Control:**
- Uses optimistic locking with version field in database
- Pub/sub updates L1/L2 caches after successful DB write
- Stale cache reads fail at DB write due to version mismatch

## Configuration

### Required Environment Variables

```bash
# Option 1: Connection URL (local dev, single Redis)
REDIS_URL=redis://localhost:6379

# Option 2: Host + Port + Auth (production ECS)
REDIS_HOST=my-elasticache.cache.amazonaws.com
REDIS_PORT=6379
REDIS_AUTH_TOKEN=<from-secrets-manager>
REDIS_TLS=true
```

### Local Development (No Redis)

When neither `REDIS_URL` nor `REDIS_HOST` is set:
- L1 cache remains functional (in-memory only)
- L2 operations are no-ops (graceful degradation)
- Pub/sub messages are not sent
- Single-instance deployments work correctly

### Production (Multi-Task ECS)

**Requirements:**
- ElastiCache Redis Replication Group with Multi-AZ
- All ECS tasks in the same VPC with access to ElastiCache
- `REDIS_HOST`, `REDIS_AUTH_TOKEN`, and `REDIS_TLS=true` configured
- Redis 7+ (ioredis client compatibility)

## Monitoring

### Key Metrics to Watch

**Redis Metrics (CloudWatch):**
- `CurrConnections` — Should be ~2 per ECS task (publisher + subscriber)
- `NetworkBytesIn/Out` — Pub/sub message traffic
- `CacheHits` / `CacheMisses` — L2 hit rate
- `EngineCPUUtilization` — Should remain low (<30%)

**Application Logs:**
```
ip_whitelist:updates published — successful invalidation
amm.redis.unavailable — Redis connection failure (falls back to L1)
IP whitelist cache updated via pub/sub — received update from another instance
```

### Alerts to Configure

1. **Redis Unavailable:** `redis.status !== 'ready'` for >5 minutes
2. **High L2 Miss Rate:** Cache miss rate >50% sustained for >10 minutes
3. **Pub/Sub Message Lag:** If custom metrics show messages taking >100ms to propagate

## Troubleshooting

### Symptom: IP whitelist not working across instances

**Diagnosis:**
```bash
# Check Redis connectivity from ECS task
aws ecs execute-command --cluster future-production --task <task-id> \
  --container backend --interactive --command "/bin/sh"

# Inside container
node -e "const Redis = require('ioredis'); const r = new Redis(process.env.REDIS_HOST, {port: process.env.REDIS_PORT, password: process.env.REDIS_AUTH_TOKEN, tls: {}}); r.ping().then(console.log).catch(console.error)"
```

**Common Causes:**
- Security group not allowing ECS tasks to reach ElastiCache
- Wrong `REDIS_HOST` (check ElastiCache primary endpoint)
- Missing or incorrect `REDIS_AUTH_TOKEN`

**Resolution:**
1. Verify security group rules allow port 6379 from ECS security group
2. Check ECS task definition has correct `REDIS_*` environment variables
3. Test connection from ECS Exec as shown above

### Symptom: Cache updates delayed across instances

**Diagnosis:**
```bash
# Monitor pub/sub messages
redis-cli -h <redis-host> --tls -a <auth-token> SUBSCRIBE ip_whitelist:updates
```

**Common Causes:**
- Redis connection pool exhausted
- Network latency between ECS and ElastiCache
- Redis CPU utilization high

**Resolution:**
1. Scale ElastiCache node type if CPU >70%
2. Check CloudWatch `NetworkBytesIn/Out` for saturation
3. Review ECS task count vs Redis connection limits

### Symptom: Memory pressure on ECS tasks

**Diagnosis:**
```javascript
// Check L1 cache size
const { getWhitelist } = require('./src/security/ipWhitelist.js');
console.log('Whitelist size:', getWhitelist().length);
```

**Common Causes:**
- Large IP whitelist (>10,000 entries)
- L1 cache never clearing (TTL not working)

**Resolution:**
1. Review whitelist for unnecessary entries (use CIDR ranges)
2. Consider L1 cache size limits if whitelist >5000 entries
3. Force reload: `reloadWhitelist()` clears stale L1 entries

### Symptom: Redis connection leak

**Diagnosis:**
```bash
# Check active connections
redis-cli -h <redis-host> --tls -a <auth-token> CLIENT LIST
```

**Expected:** 2 connections per ECS task (publisher + subscriber)

**Resolution:**
- Check for crashed ECS tasks leaving stale connections
- Ensure `closeIPWhitelistRedis()` is called on shutdown
- Verify `SIGTERM` handlers are working (graceful shutdown)

## Operational Procedures

### Adding an IP to Whitelist (Production)

```bash
# Option 1: Via API (recommended)
curl -X POST https://api.example.com/api/admin/whitelist \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"ip": "203.0.113.0/24", "reason": "Corporate VPN"}'

# Option 2: Direct database + manual reload
psql $DATABASE_URL -c "INSERT INTO \"IPWhitelist\" (\"ipAddress\", reason) VALUES ('203.0.113.0/24', 'Corporate VPN');"

# Force all instances to reload from DB
curl -X POST https://api.example.com/api/admin/whitelist/reload \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Emergency Cache Flush

If cache corruption is suspected:

```bash
# Option 1: Clear via API (triggers pub/sub)
curl -X DELETE https://api.example.com/api/admin/whitelist \
  -H "Authorization: Bearer $ADMIN_JWT"

# Option 2: Direct Redis flush (nukes all caches)
redis-cli -h <redis-host> --tls -a <auth-token> FLUSHDB

# Option 3: Rolling ECS task restart (clears L1 only)
aws ecs update-service --cluster future-production \
  --service backend --force-new-deployment
```

### Redis Maintenance Window

When performing Redis maintenance (version upgrades, failover testing):

1. **Pre-maintenance:** Cache is warm, pub/sub active
2. **During maintenance:** Redis unavailable
   - L1 caches remain functional
   - No cross-instance invalidation (staleness possible)
   - New writes go to database only
3. **Post-maintenance:** Redis reconnects automatically
   - Force reload to sync L1 caches: `reloadWhitelist()`
   - Monitor logs for "Redis pub/sub initialized"

**Recommended:** Schedule during low-traffic window; staleness window is <5 minutes

## Security Considerations

### Pub/Sub Message Authentication

Currently, pub/sub messages are **not signed or encrypted**. Redis Pub/Sub assumes:
- Network-level security (VPC isolation)
- AUTH token protects Redis access
- Only trusted backend instances can publish

**Risk:** Compromised ECS task could publish malicious invalidation messages

**Mitigation:**
- ElastiCache within private subnets only
- ECS task IAM roles with least privilege
- Regular security group audits

### Cache Poisoning

If an attacker compromises the database:
1. Writes malicious IP whitelist entries
2. Triggers pub/sub to propagate to all instances

**Mitigation:**
- Database-level access controls (Prisma query authorization)
- Admin audit logging on all whitelist changes
- Regular review of `IPWhitelist` table and audit logs

## Performance Characteristics

### Latency

| Operation | L1 Hit | L2 Hit | DB Hit |
|---|---|---|---|
| `isWhitelisted()` | ~1μs | ~2ms | ~15ms |
| `addToWhitelist()` | ~15ms (DB write) + ~3ms (pub/sub) | — | — |
| Pub/sub propagation | ~5-20ms (async) | — | — |

### Throughput

- **L1 reads:** >100,000 ops/sec per task
- **L2 reads:** ~5,000 ops/sec (Redis limits)
- **Pub/sub messages:** ~1,000 msg/sec (ElastiCache limits)

### Scalability

- Tested with up to 10 ECS tasks × 2 Redis connections = 20 connections
- ElastiCache `cache.t4g.medium` supports up to 65,000 connections
- No observed degradation with 5,000-entry whitelists

## References

- [ADR-0003: Caching Strategy](../adr/0003-caching-strategy.md)
- [Backend Configuration](../../backend/CONFIGURATION.md)
- [Infrastructure: ElastiCache](../../infra/README.md#redis-multi-az-cutover-runbook)
- [ioredis Documentation](https://github.com/redis/ioredis)
