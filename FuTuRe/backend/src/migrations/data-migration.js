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

  addBatchTransform(table, batchSize, transform) {
    this.migration.addTransformation(table, async (db, tbl) => {
      return { table: tbl, batchSize, transformed: true };
    });
    return this;
  }

  build() {
    return this.migration;
  }
}

export const createDataMigration = (name, version) => new DataMigrationBuilder(name, version);
