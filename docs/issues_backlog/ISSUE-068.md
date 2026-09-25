# db/client.js: Missing PostgreSQL read-replica connection routing for high-volume analytics and history queries

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `enhancement`, `database`, `architecture`, `performance`  
**Issue ID:** ISSUE-068

---

## Background
In `backend/src/db/client.js`, a single connection pool is configured to point to `DATABASE_URL` (the primary PostgreSQL write instance).
All database queries—including heavy analytical aggregations in `analytics/aggregator.js`, transaction history queries, and compliance audit scans—execute on the primary read/write database node.

## Problem
- Heavy analytics reporting (e.g. 24-hour volume aggregations, fraud pattern scans, and CSV exports) consume CPU and memory on the primary database node.
- Under high report generation or audit traffic, primary database CPU spikes to 100%, degrading latency for critical payment processing and user authentication queries.
- AWS RDS Aurora / Multi-AZ read replicas configured in `infra/rds.tf` cannot be utilized because the application lacks read-replica routing.

## Proposed Solution
Implement read/write connection splitting in Prisma using `@prisma/extension-read-replicas` or dual Prisma client instances (`prismaRead` and `prismaWrite`):
1. Configure `DATABASE_READ_URL` in `config/env.js` pointing to the RDS reader endpoint.
2. Route read-only queries (`findMany`, `findFirst`, `count`, `aggregate`) to the read replica.
3. Route write operations (`create`, `update`, `delete`, and interactive `$transaction`) to the primary write node.

## Implementation Steps
1. Add `DATABASE_READ_URL` environment variable support in `config/env.js`.
2. Configure Prisma read-replica extension in `backend/src/db/client.js`.
3. Ensure read-your-own-writes consistency by routing transactions and immediately subsequent reads to the primary node.
4. Add metrics tracking read-replica query latency vs primary query latency.
5. Verify heavy analytics queries run exclusively against the reader endpoint.

## Acceptance Criteria
- [ ] Heavy read and analytics queries are offloaded to RDS read replicas.
- [ ] Primary database CPU utilization is preserved for write transactions.
- [ ] Read-your-own-writes consistency is maintained for state-changing user flows.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1315](https://github.com/Ethereal-Future/FuTuRe/issues/1315)
