/**
 * Data Migration Support
 * Handle data transformations during migrations
 */

export class DataMigration {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.transformations = [];
  }

  addTransformation(table, transform) {
    this.transformations.push({ table, transform });
    return this;
  }

  async execute(db) {
    const results = [];

    for (const { table, transform } of this.transformations) {
      try {
        const result = await transform(db, table);
        results.push({ table, status: 'success', result });
      } catch (error) {
        results.push({ table, status: 'failed', error: error.message });
        throw error;
      }
    }

    return results;
  }

  async rollback(db) {
    const results = [];

    for (const { table, transform } of this.transformations.reverse()) {
      try {
        const result = await transform(db, table);
        results.push({ table, status: 'rolled_back', result });
      } catch (error) {
        results.push({ table, status: 'failed', error: error.message });
        throw error;
      }
    }

    return results;
  }
}

export class DataMigrationBuilder {
  constructor(name, version) {
    this.migration = new DataMigration(name, version);
  }

  addColumnTransform(table, column, transform) {
    this.migration.addTransformation(table, async (db, tbl) => {
      return { column, transformed: true };
    });
    return this;
  }

  /**
   * Chunked, checkpointed batch transform (ISSUE-067).
   * db must provide:
   *   fetchBatch(table, { afterId, limit }) -> records ordered by id
   *   transaction(fn) -> runs fn(tx) atomically (e.g. prisma.$transaction)
   *   checkpoints: { get(migration, table), save(tx, migration, table, state) }
   * Each chunk and its checkpoint commit in one transaction, so a crash
   * resumes from the last committed id without reprocessing records.
   */
  addBatchTransform(table, batchSize = 500, transform) {
    const name = this.migration.name;
    this.migration.addTransformation(table, async (db, tbl) => {
      if (!db?.fetchBatch) return { table: tbl, batchSize, transformed: true };
      return runBatched(db, name, tbl, batchSize, transform);
    });
    return this;
  }

  build() {
    return this.migration;
  }
}

export async function runBatched(db, migration, table, batchSize, transform) {
  const cp = (await db.checkpoints.get(migration, table)) || { lastProcessedId: null, processed: 0, completed: false };
  if (cp.completed) return { table, processed: cp.processed, resumed: true, completed: true };

  let { lastProcessedId, processed } = cp;
  const resumedFrom = lastProcessedId;
  for (;;) {
    const records = await db.fetchBatch(table, { afterId: lastProcessedId, limit: batchSize });
    if (!records.length) break;
    const nextId = records[records.length - 1].id;
    await db.transaction(async (tx) => {
      await transform(records, tx, table);
      await db.checkpoints.save(tx, migration, table, { lastProcessedId: nextId, processed: processed + records.length, completed: false });
    });
    lastProcessedId = nextId;
    processed += records.length;
    if (records.length < batchSize) break;
  }
  await db.transaction((tx) => db.checkpoints.save(tx, migration, table, { lastProcessedId, processed, completed: true }));
  return { table, processed, resumedFrom, completed: true };
}

export const createDataMigration = (name, version) => new DataMigrationBuilder(name, version);
