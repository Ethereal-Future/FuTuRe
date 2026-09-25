# db/softDelete.js: Unique constraints on tables with soft delete (deletedAt) block re-registration of identical identifiers (usernames/emails)

**Domain:** Database & Persistence  
**Complexity:** Medium  
**Labels:** `bug`, `database`  
**Issue ID:** ISSUE-065

---

## Background
In `prisma/schema.prisma`, tables like `User` have unique constraints:
```prisma
model User {
  id        String   @id @default(uuid())
  email     String?  @unique
  username  String?  @unique
  deletedAt DateTime?
}
```

## Problem
- When a user deletes their account, `deletedAt` is set to `new Date()`.
- If the user (or another user) subsequently attempts to register with the same email or username, PostgreSQL rejects the insert because the unique constraint on `email` is violated by the soft-deleted row!
- Users cannot re-create deleted accounts or re-use usernames, violating standard GDPR/CCPA account deletion expectations.

## Proposed Solution
Replace simple unique constraints with partial unique indexes in PostgreSQL:
`CREATE UNIQUE INDEX user_email_active_unique ON "User" (email) WHERE deleted_at IS NULL;`
`CREATE UNIQUE INDEX user_username_active_unique ON "User" (username) WHERE deleted_at IS NULL;`
In Prisma, execute a raw SQL migration to replace the table-level `@unique` constraint with partial indexes.

## Implementation Steps
1. Create a Prisma custom migration dropping the unconditional `@unique` constraint on `email` and `username`.
2. Add partial unique indexes: `CREATE UNIQUE INDEX ... WHERE "deletedAt" IS NULL`.
3. Update `userStore.js` registration logic to verify uniqueness only against active users.
4. Add test verifying a user can register with an email previously used by a soft-deleted account.

## Acceptance Criteria
- [ ] Soft-deleted emails and usernames do not prevent new account creation.
- [ ] Active accounts maintain strict uniqueness.
- [ ] Database migration applies partial indexes cleanly.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1312](https://github.com/Ethereal-Future/FuTuRe/issues/1312)
