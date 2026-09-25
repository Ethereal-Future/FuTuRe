# db/softDelete.js: Prisma soft delete middleware leaks deleted records during relation includes, raw queries, and aggregate operations

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `security`  
**Issue ID:** ISSUE-061

---

## Background
In `backend/src/db/softDelete.js`, a Prisma Client extension filters deleted records:
```javascript
export function createSoftDeleteExtension() {
  return Prisma.defineExtension({
    query: {
      $allModels: {
        async findMany({ args, query }) {
          args.where = { ...args.where, deletedAt: null };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, deletedAt: null };
          return query(args);
        },
```

## Problem
- The extension only intercepts `findMany`, `findFirst`, and `findUnique` at top level.
- It DOES NOT intercept:
  1. Nested relation queries: `prisma.user.findMany({ include: { transactions: true } })` returns all transactions, including soft-deleted ones!
  2. Aggregate queries: `prisma.transaction.count()`, `prisma.transaction.aggregate()` count deleted records!
  3. Raw SQL queries: `prisma.$queryRaw` bypasses extensions entirely.
  4. `findUniqueOrThrow`.
- Consequently, deleted payment streams, deleted transactions, and deleted contacts leak into frontend dashboards and aggregate financial reporting!

## Proposed Solution
1. Expand the soft-delete extension to intercept `count`, `aggregate`, `groupBy`, and `findUniqueOrThrow`.
2. For relation includes, recursively inject `where: { deletedAt: null }` into `args.include` and `args.select` blocks.
3. For raw queries, document that raw SQL must explicitly filter `WHERE deleted_at IS NULL` or create PostgreSQL views that automatically exclude soft-deleted rows.

## Implementation Steps
1. Update `backend/src/db/softDelete.js` to cover `count`, `aggregate`, `groupBy`, `findUniqueOrThrow`.
2. Implement recursive walker function to inject `deletedAt: null` on all relation filters within `include` and `select`.
3. Write comprehensive tests verifying soft-deleted items are excluded from relation includes and aggregate counts.

## Acceptance Criteria
- [ ] Soft-deleted records are filtered out in nested relation includes.
- [ ] `count` and `aggregate` exclude soft-deleted records by default.
- [ ] Leaked soft-deleted data in user dashboards is eliminated.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1308](https://github.com/Ethereal-Future/FuTuRe/issues/1308)
