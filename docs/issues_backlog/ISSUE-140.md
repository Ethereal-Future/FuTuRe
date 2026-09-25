# recovery/recoveryWorkflow.js: Account recovery state is stored in in-memory Maps, breaking recovery workflows across server restarts and ECS tasks

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `resilience`, `critical-bug`  
**Issue ID:** ISSUE-140

---

## Background
In `backend/src/recovery/recoveryWorkflow.js` (lines 3-5):
```javascript
// In-memory store (replace with DB in production)
const recoveryRequests = new Map(); // requestId -> request
const userRequests = new Map();     // userId -> [requestId]
```
The entire lifecycle of account recovery (initiation, recording recovery attempts, gathering social guardian approvals, and time-lock execution) relies exclusively on these in-memory JavaScript Maps.

## Problem
- Account recovery requires a mandatory 24-hour time-lock (`DELAY_HOURS = 24`) and allows a 72-hour window (`EXPIRY_HOURS = 72`).
- In production on AWS ECS:
  1. Any redeployment, auto-scaling event, or task reboot clears all active recovery requests from memory.
  2. If a user initiates recovery on Task A, but a guardian attempts to approve on Task B, Task B throws `Error: Recovery request not found`!
  3. Because an account recovery takes 24 hours to mature, it is virtually guaranteed that the container will be recycled or scaled before 24 hours elapse, permanently stranding users out of their accounts!

## Proposed Solution
Migrate the account recovery workflow to PostgreSQL backed by Prisma:
1. Define a `RecoveryRequest` model (`id, userId, method, status, attempts, executeAfter, expiresAt, approvals, ipAddress, createdAt, completedAt`).
2. Persist state changes atomically in PostgreSQL.
3. Coordinate social approvals and time-locks through database records so any cluster node can evaluate recovery status.

## Implementation Steps
1. Create `RecoveryRequest` model in `prisma/schema.prisma`.
2. Run Prisma migration to generate table and client methods.
3. Refactor all functions in `backend/src/recovery/recoveryWorkflow.js` (`initiateRecovery`, `recordAttempt`, `addApproval`, `completeRecovery`, `cancelRecovery`) to use Prisma.
4. Add tests verifying persistence across simulated restarts.

## Acceptance Criteria
- [ ] Recovery requests are durably persisted in PostgreSQL.
- [ ] Guardian approvals can be registered on any backend container task.
- [ ] 24-hour time-locks mature reliably without data loss from deployments.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1387](https://github.com/Ethereal-Future/FuTuRe/issues/1387)
