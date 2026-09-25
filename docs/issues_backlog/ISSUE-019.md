# services/stellar.js: incrementFeeBumpStats single-row JSON array accumulates unbounded public keys, causing severe PostgreSQL row lock contention

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `database`, `performance`  
**Issue ID:** ISSUE-019

---

## Background
In `backend/src/services/stellar.js`, `incrementFeeBumpStats` tracks fee-bump metrics using a singleton database row (lines 29-58):
```javascript
async function incrementFeeBumpStats(sourcePublicKey, feeStroops) {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.feeBumpStat.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          total: 1,
          totalFeeStroops: feeStroops,
          accounts: [sourcePublicKey],
        },
        update: {
          total: { increment: 1 },
          totalFeeStroops: { increment: feeStroops },
        },
      });
      const accounts = Array.isArray(existing.accounts) ? existing.accounts : [];
      if (!accounts.includes(sourcePublicKey)) {
        await tx.feeBumpStat.update({
          where: { id: 'singleton' },
          data: { accounts: [...accounts, sourcePublicKey] },
        });
      }
    });
  } catch (err) {
    logger.warn('stellar.feeBumpStats.persist.failed', { error: err.message });
  }
}
```

## Problem
- Every fee-bumped payment acquires an exclusive row-level lock on the `singleton` row in `feeBumpStat`. Under high transaction throughput, all concurrent payments serialize on this single row lock, causing query timeouts and transaction deadlocks.
- The `accounts` column is a JSON array that appends every unique public key. As user volume grows to 50,000+ accounts, this single column grows to multiple megabytes.
- Every payment reads the entire multi-megabyte JSON array into Node memory, executes an `O(n)` `.includes()` check, and rewrites the entire multi-megabyte array back to PostgreSQL!
- This causes massive write amplification, WAL bloat, and connection pool exhaustion.

## Proposed Solution
Decompose `feeBumpStat` into a normalized relation: a `FeeBumpDailySummary` table with date-partitioned aggregates and a separate `FeeBumpAccount` join table (`id, publicKey, firstUsedAt`) with a unique index on `publicKey`. Use an `INSERT ... ON CONFLICT DO NOTHING` for new accounts, eliminating the serialized lock on a singleton JSON array.

## Implementation Steps
1. Create a Prisma schema migration adding `FeeBumpAccount` (`publicKey` PK) and `FeeBumpSummary` (`date` PK).
2. Replace the singleton row transaction in `incrementFeeBumpStats` with an atomic insert into `FeeBumpAccount` using `upsert` or raw `INSERT ... ON CONFLICT DO NOTHING`.
3. Increment daily counters using atomic SQL `UPDATE fee_bump_summary SET total = total + 1, total_fee_stroops = total_fee_stroops + $1 WHERE date = CURRENT_DATE`.
4. Refactor `getFeeBumpStats()` to query count of unique accounts and total fees from the relational tables.
5. Benchmark concurrent fee-bump writes to verify zero row lock contention.

## Acceptance Criteria
- [ ] Singleton row lock bottleneck is completely eliminated.
- [ ] Unique accounts tracked without multi-megabyte JSON serialization.
- [ ] Concurrent fee-bump payments execute in parallel without database timeouts.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1266](https://github.com/Ethereal-Future/FuTuRe/issues/1266)
