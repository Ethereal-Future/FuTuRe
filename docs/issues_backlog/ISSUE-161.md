# chaos/blastRadiusLimiter.js: In-memory limit tracking allows concurrent chaos experiments to breach blast radius boundaries

**Domain:** Chaos Engineering & Safety  
**Complexity:** Hard  
**Labels:** `bug`, `resilience`, `concurrency`  
**Issue ID:** ISSUE-161

---

## Background
In `backend/src/chaos/blastRadiusLimiter.js` (lines 2-4):
```javascript
class BlastRadiusLimiter {
  constructor() {
    this.limits = new Map();
    this.impacts = new Map();
  }
```
The blast radius limiter tracks safety constraints (max affected services, max error rate, max downtime) purely in process-local JavaScript Maps.

## Problem
- In a multi-task or microservices deployment, multiple automated chaos experiments (e.g. running in CI/CD pipelines or automated canary tests) can execute simultaneously on different nodes.
- Each instance evaluates `canInjectFailure` against its own empty local Map.
- Combined across instances, total affected services and cumulative error rates vastly exceed the safety threshold.
- Production services can suffer widespread outages because the blast radius is not coordinated across nodes!

## Proposed Solution
1. Store active chaos experiments and system impact metrics centrally in Redis or PostgreSQL.
2. Use Redis distributed locks or atomic counters (`HINCRBY`) to record active disruptions and total affected services globally.
3. If the global count of affected services or cumulative error rate exceeds configured maximums, reject new chaos injections across all nodes.

## Implementation Steps
1. Refactor `BlastRadiusLimiter` in `backend/src/chaos/blastRadiusLimiter.js` to use Redis for shared state.
2. Implement distributed safety checks for concurrent chaos experiments.
3. Add tests simulating concurrent chaos requests to verify cross-instance limit enforcement.

## Acceptance Criteria
- [ ] Concurrent failure injections across separate nodes respect global blast radius limits.
- [ ] Redis tracks total active disrupted services atomically.
- [ ] Experiments are automatically aborted if global error rate thresholds are breached.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Vital safety guardrail for production chaos testing.

**GitHub Issue:** [1408](https://github.com/Ethereal-Future/FuTuRe/issues/1408)
