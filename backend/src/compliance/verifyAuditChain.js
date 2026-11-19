import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Compute the chained hash for a compliance audit log entry.
 *
 * currentHash = sha256(prevHash + eventType + userId + JSON.stringify(metadata) + createdAt)
 *
 * This mirrors the hashing performed when entries are appended in
 * complianceAudit.js so that the chain can be independently verified.
 */
export function computeAuditHash({ prevHash, eventType, userId, metadata, createdAt }) {
  const payload =
    (prevHash || '') +
    eventType +
    userId +
    JSON.stringify(metadata ?? null) +
    new Date(createdAt).toISOString();

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Traverse the compliance audit log chain from genesis to latest and verify
 * that every entry's stored currentHash matches the recomputed hash and that
 * prevHash correctly links to the previous entry.
 *
 * Detects:
 *  - mutated rows (recomputed hash != stored currentHash)
 *  - deleted rows (broken prevHash linkage)
 *  - reordered rows (broken linkage / timestamp ordering)
 *
 * @returns {{ valid: boolean, checked: number, errors: Array<object> }}
 */
export async function verifyAuditChain() {
  const entries = await prisma.complianceAuditLog.findMany({
    orderBy: { createdAt: 'asc' },
  });

  const errors = [];
  let expectedPrevHash = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Verify linkage to the previous entry (genesis has no prevHash).
    if (i === 0) {
      if (entry.prevHash) {
        errors.push({
          id: entry.id,
          index: i,
          reason: 'genesis entry has a non-null prevHash',
        });
      }
    } else if (entry.prevHash !== expectedPrevHash) {
      errors.push({
        id: entry.id,
        index: i,
        reason: 'prevHash does not match previous entry currentHash (possible deletion or reorder)',
        expected: expectedPrevHash,
        actual: entry.prevHash,
      });
    }

    // Recompute the hash and compare against the stored value.
    const recomputed = computeAuditHash({
      prevHash: entry.prevHash,
      eventType: entry.eventType,
      userId: entry.userId,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    });

    if (recomputed !== entry.currentHash) {
      errors.push({
        id: entry.id,
        index: i,
        reason: 'currentHash mismatch (entry has been mutated)',
        expected: recomputed,
        actual: entry.currentHash,
      });
    }

    expectedPrevHash = entry.currentHash;
  }

  return {
    valid: errors.length === 0,
    checked: entries.length,
    errors,
  };
}

async function main() {
  try {
    const result = await verifyAuditChain();

    if (result.valid) {
      console.log(
        `Compliance audit chain verified: ${result.checked} entr${result.checked === 1 ? 'y' : 'ies'} intact.`
      );
      process.exitCode = 0;
    } else {
      console.error(
        `Compliance audit chain verification FAILED: ${result.errors.length} issue(s) across ${result.checked} entries.`
      );
      for (const err of result.errors) {
        console.error(`  - [${err.index}] ${err.id}: ${err.reason}`);
      }
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Failed to verify compliance audit chain:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
