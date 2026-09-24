# security/accountLockout.js: Read-modify-write race condition in Redis failed login tracking allows brute-force bypass

**Domain:** Security & Authentication  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `concurrency`, `auth`  
**Issue ID:** ISSUE-150

---

## Background
In `backend/src/security/accountLockout.js` (lines 43-52):
```javascript
  // Get current failed attempts
  const attempts = (await redis.get(key)) || [];
  const now = Date.now();
  
  // Filter out old attempts outside the window
  const recentAttempts = attempts.filter(t => now - t < FAILED_ATTEMPT_WINDOW_MS);
  recentAttempts.push(now);

  // Store updated attempts
  await redis.set(key, recentAttempts, Math.ceil(FAILED_ATTEMPT_WINDOW_MS / 1000));
```
Failed login attempts are recorded by fetching a JSON array from Redis, pushing the new timestamp in Node.js memory, and writing it back to Redis.

## Problem
- This is a non-atomic read-modify-write pattern.
- If an attacker initiates 20 concurrent login attempts across multiple threads or IP addresses targeting a single account:
  1. All 20 requests read the same initial empty or 1-element array from Redis simultaneously.
  2. Each request appends its own timestamp to the local array.
  3. All requests write back an array containing only 1 or 2 attempts.
- The `attempts.length >= LOCKOUT_THRESHOLD (5)` condition is never triggered, allowing automated attackers to attempt hundreds of passwords simultaneously without ever locking the account!

## Proposed Solution
1. Replace the serialized JSON array in Redis with a Redis Sorted Set (ZSET).
2. Execute an atomic Lua script or Redis multi/exec transaction:
   - `ZREMRANGEBYSCORE key 0 (now - FAILED_ATTEMPT_WINDOW_MS)`
   - `ZADD key now now`
   - `EXPIRE key Math.ceil(FAILED_ATTEMPT_WINDOW_MS / 1000)`
   - `ZCARD key`
3. If `ZCARD` exceeds `LOCKOUT_THRESHOLD`, atomically set the `account_locked:<username>` key.

## Implementation Steps
1. Refactor `recordFailedLogin` in `backend/src/security/accountLockout.js` to use Redis Sorted Sets or an atomic Lua script.
2. Ensure the window sliding and counter increment happen atomically on Redis.
3. Add integration test with 25 concurrent failed logins to assert account is locked after exactly 5 attempts.

## Acceptance Criteria
- [ ] Concurrent login attempts cannot bypass the lockout threshold.
- [ ] Redis operations are atomic without race windows.
- [ ] Unit and integration tests demonstrate deterministic lockout at 5 failed attempts under load.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Critical vulnerability for credential stuffing protection.

**GitHub Issue:** [1397](https://github.com/Ethereal-Future/FuTuRe/issues/1397)
