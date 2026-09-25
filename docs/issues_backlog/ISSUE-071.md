# auth/sessionStore.js: getActiveSession executes an unthrottled UPDATE on every HTTP request, causing severe database write amplification

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `performance`, `backend`  
**Issue ID:** ISSUE-071

---

## Background
In `backend/src/auth/sessionStore.js`, `getActiveSession` is called on every authenticated request by the session/auth middleware (lines 27-43):
```javascript
export async function getActiveSession(sessionId) {
  if (!sessionId) return null;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (session) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
  }
  return session;
}
```

## Problem
- For EVERY single authenticated API request, `getActiveSession` runs TWO sequential database queries:
  1. `SELECT ... FROM session WHERE id = ...`
  2. `UPDATE session SET lastActiveAt = ... WHERE id = ...`
- At 300 requests/second, this executes 300 `UPDATE` queries per second on the `session` table!
- PostgreSQL creates a new row version (tuple) on every `UPDATE` (MVCC). This generates massive table bloat, high autovacuum load, and connection pool starvation.
- Writing to the database on every read request creates severe write amplification for an activity timestamp that only needs approximate accuracy.

## Proposed Solution
1. Cache active sessions in Redis: store session JSON in Redis key `session:${sessionId}` with TTL matching session expiry.
2. Throttle `lastActiveAt` database writes: update `lastActiveAt` in PostgreSQL at most once every 5 or 15 minutes:
```javascript
const FIFTEEN_MINS_MS = 15 * 60 * 1000;
if (!session.lastActiveAt || (Date.now() - new Date(session.lastActiveAt).getTime() > FIFTEEN_MINS_MS)) {
  prisma.session.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } }).catch(...);
}
```
3. Read the session from Redis cache; only query PostgreSQL on a cache miss.

## Implementation Steps
1. Add Redis caching for session lookups in `backend/src/auth/sessionStore.js`.
2. Implement throttling for `lastActiveAt` updates (only write if >15 minutes elapsed since last update).
3. Fire the `UPDATE` asynchronously without blocking the request pipeline.
4. Invalidate Redis session cache on `revokeSession` and `revokeAllSessions`.
5. Benchmark database queries per second under load before and after throttling.

## Acceptance Criteria
- [ ] Session lookups are served from Redis in <1ms without hitting PostgreSQL.
- [ ] `lastActiveAt` updates occur at most once per 15-minute window per user.
- [ ] Database write QPS drops by >95% on authenticated endpoints.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1318](https://github.com/Ethereal-Future/FuTuRe/issues/1318)
