# db/adminAuditLog.js: Admin audit log writes are executed outside the business logic transaction, losing audit trail on database rollbacks

**Domain:** Database & Persistence  
**Complexity:** Medium  
**Labels:** `bug`, `database`, `compliance`, `audit`  
**Issue ID:** ISSUE-062

---

## Background
In `backend/src/db/adminAuditLog.js` and admin routes (`routes/admin.js`, `routes/compliance.js`), admin actions (e.g. approving KYC, updating user roles, adjusting fees) execute the business update, followed by:
```javascript
await logAdminAction(adminId, action, targetUserId, details);
```
`logAdminAction` creates a row in `prisma.adminAuditLog` independently outside any database transaction.

## Problem
- If an admin operation is wrapped in a transaction that fails or rolls back, or if the server crashes after the business logic commits but before `logAdminAction` is awaited, the audit record is lost.
- Conversely, if `logAdminAction` runs before the operation, but the operation throws, the audit log records an action that never actually occurred.
- Compliance standards (SOC 2, ISO 27001, FinCEN) require admin audit trails to be atomically bound to privileged operations.

## Proposed Solution
Refactor admin actions to require atomic transactions:
```javascript
await prisma.$transaction(async (tx) => {
  await executeAdminAction(tx, ...);
  await tx.adminAuditLog.create({ data: { ... } });
});
```
Provide an overload `logAdminAction(..., tx)` that accepts the active Prisma transaction client so audit records and business state commit or roll back together atomically.

## Implementation Steps
1. Update `logAdminAction` signature to accept optional `tx` client (`tx || prisma`).
2. In all routes in `backend/src/routes/admin.js`, wrap the update and audit log in `prisma.$transaction`.
3. Ensure that failures in either step result in complete transaction rollback.
4. Add tests verifying atomicity: if audit log insert fails, user mutation is rolled back.

## Acceptance Criteria
- [ ] Admin actions and their audit log entries commit atomically.
- [ ] No audit records exist for aborted or rolled-back admin actions.
- [ ] Privileged state changes cannot occur without an accompanying audit log entry.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1309](https://github.com/Ethereal-Future/FuTuRe/issues/1309)
