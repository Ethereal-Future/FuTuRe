# security/ipWhitelist.js: In-memory cache lacks distributed invalidation across multi-task ECS cluster

**Domain:** Security & Architecture  
**Complexity:** Medium  
**Labels:** `bug`, `cache`, `infra`, `redis`  
**Issue ID:** ISSUE-153

---

## Background
In `backend/src/security/ipWhitelist.js`:
```javascript
const whitelistedIPsCache = new Map();
let cacheInitialized = false;
```
The IP whitelist is loaded from Postgres into process memory once at startup.
When an IP is added or removed:
```javascript
export async function addIPToWhitelist(ipAddress, reason, addedBy) {
  ...
  whitelistedIPsCache.set(ipAddress, entry);
```
The cache mutation only modifies the local Node.js process memory.

## Problem
- FuTuRe runs in AWS ECS with multiple containers behind an Application Load Balancer.
- When an admin revokes a compromised IP address via `/api/security/ip-whitelist` on Task A:
  1. Task A removes the IP from Postgres and its local memory.
  2. Task B and Task C never receive any eviction event and keep the IP cached in memory indefinitely until next container restart!
- The attacker continues to bypass rate limits and access admin endpoints via Task B and Task C.

## Proposed Solution
1. Utilize Redis Pub/Sub for distributed cache invalidation:
   - When an IP is added, updated, or deleted, publish a message to `channel:ip_whitelist_updates`.
   - All ECS tasks subscribe to `channel:ip_whitelist_updates` and reload or mutate their local cache.
2. Alternatively, store active whitelist sets in Redis directly with a short TTL local cache (e.g. 30 seconds).

## Implementation Steps
1. Implement Redis Pub/Sub listener in `backend/src/security/ipWhitelist.js`.
2. Publish eviction messages on `addIPToWhitelist` and `removeIPFromWhitelist`.
3. Add integration test verifying cross-instance cache sync.

## Acceptance Criteria
- [ ] Adding or removing an IP on one instance updates all running cluster instances immediately.
- [ ] Cache falls back safely if Redis is briefly unavailable.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Critical for security policy enforcement across cluster nodes.

**GitHub Issue:** [1400](https://github.com/Ethereal-Future/FuTuRe/issues/1400)
