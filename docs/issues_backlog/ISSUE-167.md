# loadTesting/performanceAlerting.js: In-memory alert deduplication causes alert storms across clustered load workers

**Domain:** Load Testing & Alerting  
**Complexity:** Medium  
**Labels:** `bug`, `monitoring`, `alerting`  
**Issue ID:** ISSUE-167

---

## Background
In `backend/src/loadTesting/performanceAlerting.js`:
The alert manager tracks fired alerts in a local `Map` to prevent duplicate alerts within a cooldown period:
```javascript
this.lastAlertTime = new Map(); // metric -> timestamp
```
When error rates or response times exceed thresholds, it checks `Date.now() - lastAlertTime < COOLDOWN`.

## Problem
- When running distributed load tests with multiple worker containers, each worker maintains its own local alert map.
- When an SLA is breached, all 10 load testing containers trigger alerts simultaneously to Slack/PagerDuty.
- The on-call engineers receive an alert storm of identical notifications, obscuring root cause analysis.

## Proposed Solution
1. Store alert deduplication keys in Redis with `SET key timestamp NX EX cooldownSeconds`.
2. If Redis key already exists, skip alert dispatch across all workers.
3. Consolidate multi-worker alert metrics into a single aggregated incident alert.

## Implementation Steps
1. Update `backend/src/loadTesting/performanceAlerting.js` to use Redis for distributed alert throttling.
2. Add fallback to in-memory map if Redis is not configured.
3. Verify single alert dispatch across 5 simulated concurrent workers.

## Acceptance Criteria
- [ ] Only one alert is dispatched across the entire worker cluster during cooldown periods.
- [ ] Alert storms are eliminated during sustained performance degradation.
- [ ] Alerting handles Redis disconnection gracefully.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Ensures clean on-call notifications during load testing.

**GitHub Issue:** [1414](https://github.com/Ethereal-Future/FuTuRe/issues/1414)
