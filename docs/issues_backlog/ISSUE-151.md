# security/accountLockout.js: Unbounded `suspicious_patterns` array in Redis causes OOM and excessive latency

**Domain:** Security & Incident Response  
**Complexity:** Medium  
**Labels:** `bug`, `performance`, `redis`  
**Issue ID:** ISSUE-151

---

## Background
In `backend/src/security/accountLockout.js` (lines 92-108):
```javascript
export async function blockIP(ipAddress, reason = 'Excessive failed login attempts') {
  const redis = await initRedis();
  const key = `blocked_ip:${ipAddress}`;
  const patternKey = `suspicious_patterns`;
  ...
  const patterns = (await redis.get(patternKey)) || [];
  patterns.push(pattern);
  if (patterns.length > 1000) {
    patterns.shift();
  }
  await redis.set(patternKey, patterns, 24 * 60 * 60);
```
Every blocked IP serializes and deserializes a monolithic JSON array up to 1,000 items in Redis.

## Problem
- Under high brute-force volume from hundreds of botnet IPs, `patterns` array grows up to 1,000 JSON objects.
- Each IP block triggers `redis.get(patternKey)` transmitting several hundred kilobytes of JSON across the network, parsing it in Node.js, shifting elements, and serializing it back with `redis.set`.
- This causes massive Redis bandwidth saturation, high event-loop lag in Node.js, and lost records due to concurrent overwrites.

## Proposed Solution
1. Replace the JSON array with a Redis List (`RPUSH` / `LPUSH` + `LTRIM patternKey -1000 -1`).
2. `RPUSH` followed by `LTRIM` runs in O(1) time and transfers only the single new pattern object over the network.
3. Eliminate read-modify-write cycles and race conditions.

## Implementation Steps
1. Update `blockIP` in `backend/src/security/accountLockout.js` to use `redis.rpush` and `redis.ltrim`.
2. Update any consumer reading `suspicious_patterns` to use `redis.lrange`.
3. Verify memory and latency profiles under simulated 1,000 IP blocks.

## Acceptance Criteria
- [ ] `suspicious_patterns` uses Redis native list primitives (`RPUSH`/`LTRIM`).
- [ ] Network payload per blocked IP is reduced to the size of a single pattern (<1KB).
- [ ] No race condition occurs when multiple IPs are blocked simultaneously.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Ensures Redis stability during automated botnet attacks.

**GitHub Issue:** [1398](https://github.com/Ethereal-Future/FuTuRe/issues/1398)
