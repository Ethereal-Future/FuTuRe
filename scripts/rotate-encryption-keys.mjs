#!/usr/bin/env node
/**
 * db:rotate-encryption-keys
 *
 * Re-encrypt database rows from an old key version to the current key.
 *
 * Usage:
 *   node scripts/rotate-encryption-keys.mjs --model=User --fields=recoverySecret
 *   node scripts/rotate-encryption-keys.mjs --model=WebhookSubscription --fields=secret
 *
 * Required environment variables:
 *   DATABASE_ENCRYPTION_KEY        New (current) key, hex-encoded 32 bytes.
 *   DATABASE_ENCRYPTION_KEY_ID     Numeric id for the new key (e.g. "2").
 *   DATABASE_ENCRYPTION_KEY_RING   JSON map that includes the OLD key(s),
 *                                  e.g. '{"1":"<old-hex-key>","2":"<new-hex-key>"}'.
 *   DATABASE_URL                   PostgreSQL connection string.
 *
 * The script:
 *   1. Pages through every row of the target model.
 *   2. For each row where the target field starts with the OLD key version
 *      prefix (or has the bare legacy format), decrypts and re-encrypts to
 *      the current key.
 *   3. Writes the updated value back with a targeted UPDATE so only changed
 *      rows are touched.
 *   4. Prints a progress summary and exits non-zero on any error.
 *
 * The script is idempotent: rows already encrypted with the current key are
 * skipped.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { getKeyRing, reencryptValue } from '../src/db/encryption.js';

// ── CLI arg parsing ────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    model:     { type: 'string' },
    fields:    { type: 'string' },
    batchSize: { type: 'string', default: '100' },
    dryRun:    { type: 'boolean', default: false },
  },
});

if (!args.model || !args.fields) {
  console.error('Usage: node scripts/rotate-encryption-keys.mjs --model=<Model> --fields=<field1,field2>');
  process.exit(1);
}

const MODEL      = args.model;
const FIELDS     = args.fields.split(',').map((f) => f.trim());
const BATCH_SIZE = parseInt(args.batchSize, 10);
const DRY_RUN    = args.dryRun;

// ── Main ───────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

async function main() {
  const keyRing = getKeyRing();
  const { currentKeyId } = keyRing;
  const currentPrefix = `v${currentKeyId}:`;

  console.log(`\nKey rotation — model: ${MODEL}, fields: ${FIELDS.join(', ')}`);
  console.log(`Current key id: ${currentKeyId}  |  dry-run: ${DRY_RUN}\n`);

  const modelClient = prisma[MODEL.charAt(0).toLowerCase() + MODEL.slice(1)];
  if (!modelClient) {
    throw new Error(`Prisma model "${MODEL}" not found. Check --model spelling.`);
  }

  let cursor = undefined;
  let processed = 0;
  let skipped = 0;
  let rotated = 0;
  let errors = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await modelClient.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, ...Object.fromEntries(FIELDS.map((f) => [f, true])) },
      orderBy: { id: 'asc' },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      processed++;
      const updates = {};

      for (const field of FIELDS) {
        const value = row[field];
        if (!value || typeof value !== 'string') continue;
        if (value.startsWith(currentPrefix)) {
          skipped++;
          continue; // already on the current key
        }

        try {
          updates[field] = reencryptValue(value, keyRing);
          rotated++;
        } catch (err) {
          console.error(`  ERROR row ${row.id} field ${field}: ${err.message}`);
          errors++;
        }
      }

      if (Object.keys(updates).length > 0 && !DRY_RUN) {
        await modelClient.update({ where: { id: row.id }, data: updates });
      }
    }

    process.stdout.write(
      `\r  processed=${processed}  rotated=${rotated}  skipped=${skipped}  errors=${errors}`
    );
  }

  console.log('\n\nDone.');
  if (DRY_RUN) console.log('(dry-run — no rows were written)');
  if (errors > 0) {
    console.error(`\n${errors} error(s) encountered. Review output above.`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('\nFatal:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
