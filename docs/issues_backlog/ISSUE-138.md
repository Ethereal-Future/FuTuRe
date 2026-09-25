# mobile/redisStore.js: Redis connection drops cause silent mobile session authentication failures rather than graceful degradation

**Domain:** Mobile & Offline Resilience  
**Complexity:** Medium  
**Labels:** `bug`, `mobile`, `redis`, `resilience`  
**Issue ID:** ISSUE-138

---

## Background
In `backend/src/mobile/redisStore.js`, mobile sessions and active tokens are cached in Redis. When Redis experiences a connection hiccup, failover, or network blip, calls to `redis.get()` reject with `Connection is closed` or timeout.

## Problem
- The error is not caught with a database fallback.
- Mobile API routes immediately return HTTP 500 Internal Server Error to the mobile app.
- The mobile app interprets 500 errors or rejected sessions as an expired login and immediately clears local state, logging the user out and forcing them to re-enter credentials!
- A 2-second Redis failover results in mass forced logouts for all active mobile app users.

## Proposed Solution
Implement graceful degradation with PostgreSQL fallback in `mobile/redisStore.js`:
```javascript
export async function getMobileSession(sessionId) {
  try {
    const cached = await redis.get(`mobile:session:${sessionId}`);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis mobile session read failed; falling back to DB');
  }
  // Fallback to PostgreSQL
  return prisma.session.findUnique({ where: { id: sessionId } });
}
```

## Implementation Steps
1. Wrap Redis calls in `mobile/redisStore.js` with try/catch fallbacks to PostgreSQL.
2. Log Redis connection warnings without propagating unhandled errors to the route layer.
3. Add circuit breaker: if Redis fails 5 consecutive times, bypass Redis and query database directly for 30 seconds.
4. Add test verifying mobile session authentication succeeds when Redis is completely offline.

## Acceptance Criteria
- [ ] Temporary Redis downtime does not log out mobile users.
- [ ] Session authentication gracefully falls back to PostgreSQL.
- [ ] Mobile apps continue operating smoothly during Redis maintenance.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1385](https://github.com/Ethereal-Future/FuTuRe/issues/1385)
