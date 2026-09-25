# infra/elasticache.tf: Single-node Redis cluster lacks high availability and multi-AZ failover

**Domain:** Infra & High Availability  
**Complexity:** Medium  
**Labels:** `enhancement`, `infra`, `high-availability`  
**Issue ID:** ISSUE-190

---

## Background
In `infra/elasticache.tf`:
The Redis cache is configured as a standalone single-node instance (`aws_elasticache_cluster`) rather than a replication group.

## Problem
- AWS performs regular maintenance and hardware replacements on ElastiCache nodes.
- During any AWS maintenance event or single-AZ degradation:
  1. The single Redis node is unavailable for 5-15 minutes.
  2. Because session management, rate limiting, and distributed locking depend on Redis, all user requests fail or hit fallback bottlenecks.
  3. Single-node architecture lacks automated failover, violating production SLA targets (99.99%).

## Proposed Solution
1. Migrate `aws_elasticache_cluster` to `aws_elasticache_replication_group`.
2. Enable `automatic_failover_enabled = true` and `multi_az_enabled = true` for staging/production environments.
3. Configure 2 or 3 replicas spread across distinct Availability Zones.

## Implementation Steps
1. Replace `aws_elasticache_cluster` with `aws_elasticache_replication_group` in `infra/elasticache.tf`.
2. Configure conditional multi-AZ and automatic failover based on `var.environment`.
3. Validate failover behavior via AWS Fault Injection Simulator (FIS).

## Acceptance Criteria
- [ ] Production Redis uses multi-AZ replication group with automatic failover.
- [ ] Zero downtime during single-node maintenance.
- [ ] Failover time is under 30 seconds.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Essential high-availability requirement for production SLA.

**GitHub Issue:** [1437](https://github.com/Ethereal-Future/FuTuRe/issues/1437)
