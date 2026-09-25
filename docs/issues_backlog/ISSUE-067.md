# migrations/data-migration.js: Large-scale data migrations perform unbounded chunk updates without batch transaction boundaries

**Domain:** Database & Persistence  
**Complexity:** Medium  
**Labels:** `bug`, `database`, `resilience`  
**Issue ID:** ISSUE-067

---

## Background
In `backend/src/migrations/data-migration.js`, data migration tasks transform historical records (e.g. converting balances, migrating transaction metadata, or updating schema versions).

## Problem
- The migration loops through records in memory and executes individual updates without grouping them into explicit batch transactions (`tx.batch` or `UPDATE ... WHERE id IN (...)`).
- If the migration process fails or times out halfway through a 100,000-record migration, state is left in a partially migrated state.
- Because there is no checkpointing (saving the last processed ID) or atomic batch boundaries, restarting the migration either re-processes already migrated records or fails on duplicate constraints.

## Proposed Solution
1. Implement chunked batch migrations with cursor-based checkpoints (`lastProcessedId`).
2. Process records in explicit transaction batches (e.g. 500 records per transaction).
3. Commit each batch atomically and record the checkpoint in a `MigrationCheckpoint` table.
4. On restart, resume execution strictly from the last committed checkpoint.

## Implementation Steps
1. Add checkpoint tracking model `DataMigrationCheckpoint` in Prisma.
2. Refactor `data-migration.js` to process records in chunks of 500.
3. Wrap each chunk in `prisma.$transaction`.
4. Implement resume-from-checkpoint logic on startup.
5. Add test simulating mid-migration crash and verifying resume without data loss or duplication.

## Acceptance Criteria
- [ ] Data migrations execute in atomic, bounded chunks.
- [ ] Crashes can be resumed from the last checkpoint without manual intervention.
- [ ] Database lock holding times remain minimal.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1314](https://github.com/Ethereal-Future/FuTuRe/issues/1314)
