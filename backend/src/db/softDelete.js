/**
 * Soft Delete extension for Prisma (Prisma 5+ query extension API).
 *
 * Automatically filters out soft-deleted records from:
 *   - findUnique / findUniqueOrThrow
 *   - findFirst / findFirstOrThrow
 *   - findMany
 *   - update / updateMany
 *   - count / aggregate / groupBy          ← ISSUE-061: previously missing
 *   - nested relation includes / selects   ← ISSUE-061: previously missing
 *
 * Hard-delete operations (delete / deleteMany) are intercepted and converted
 * into soft-deletes by setting deletedAt = now().
 *
 * Pass { where: { includeDeleted: true } } to bypass the filter in admin
 * queries that need to see all records.
 *
 * Raw SQL ($queryRaw / $executeRaw) bypasses Prisma extensions entirely.
 * Callers MUST include `WHERE deleted_at IS NULL` manually in raw queries,
 * or target a PostgreSQL view that already excludes soft-deleted rows.
 */

const SOFT_DELETE_MODELS = new Set(['User', 'Transaction']);

const FILTER_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const UPDATE_ACTIONS = new Set(['update', 'updateMany']);

/**
 * Recursively walk an `include` or `select` object and inject
 * `where: { deletedAt: null }` on every relation whose target model is in
 * SOFT_DELETE_MODELS.
 *
 * Prisma relation include entries can be:
 *   - `true`  → convert to `{ where: { deletedAt: null } }`
 *   - `{ where, select, include, … }` → merge deletedAt: null into where
 *
 * @param {Record<string, unknown>} clause  - The include or select object
 * @param {Record<string, string>}  relMap  - Map of relation field → model name
 */
function injectSoftDeleteIntoRelations(clause, relMap) {
  if (!clause || typeof clause !== 'object') return clause;

  const result = { ...clause };

  for (const [field, value] of Object.entries(result)) {
    const targetModel = relMap[field];

    if (!targetModel || !SOFT_DELETE_MODELS.has(targetModel)) {
      // Recurse into nested include/select regardless of model membership
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = {};
        if (value.include) nested.include = injectSoftDeleteIntoRelations(value.include, relMap);
        if (value.select) nested.select = injectSoftDeleteIntoRelations(value.select, relMap);
        if (Object.keys(nested).length) result[field] = { ...value, ...nested };
      }
      continue;
    }

    if (value === true) {
      // Expand shorthand `true` into an object with the filter applied
      result[field] = { where: { deletedAt: null } };
    } else if (value && typeof value === 'object') {
      // Merge into existing where clause
      result[field] = {
        ...value,
        where: { ...value.where, deletedAt: null },
      };
      // Recurse into nested include / select on the same relation
      if (value.include)
        result[field].include = injectSoftDeleteIntoRelations(value.include, relMap);
      if (value.select)
        result[field].select = injectSoftDeleteIntoRelations(value.select, relMap);
    }
  }

  return result;
}

/**
 * Return the Prisma extension object.  The relationsMap is intentionally
 * kept simple and explicit; update it whenever a new relation between
 * soft-deletable models is added to the schema.
 *
 * Format: { '<relationFieldName>': '<PrismaModelName>' }
 * Only relations whose target model is in SOFT_DELETE_MODELS need entries.
 */
const RELATION_MODEL_MAP = {
  // User → Transaction relations
  sentTransactions: 'Transaction',
  receivedTransactions: 'Transaction',
  transactions: 'Transaction',
  // Transaction → User relations
  sender: 'User',
  recipient: 'User',
};

export function createSoftDeleteExtension() {
  return {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }

          const includeDeleted = args?.where?.includeDeleted === true;

          // Strip the custom flag before passing to Prisma
          if (args?.where?.includeDeleted !== undefined) {
            const { includeDeleted: _stripped, ...rest } = args.where;
            args = { ...args, where: rest };
          }

          if (!includeDeleted) {
            // ── Top-level where filter ─────────────────────────────────────
            if (FILTER_ACTIONS.has(operation) || UPDATE_ACTIONS.has(operation)) {
              args = { ...args, where: { ...args.where, deletedAt: null } };
            }

            // ── Intercept hard deletes → soft deletes ──────────────────────
            if (operation === 'delete') {
              return query({ ...args, data: { deletedAt: new Date() } });
            }
            if (operation === 'deleteMany') {
              return query({ ...args, data: { deletedAt: new Date() } });
            }

            // ── Inject filter into nested relation includes/selects ─────────
            if (args.include) {
              args = {
                ...args,
                include: injectSoftDeleteIntoRelations(args.include, RELATION_MODEL_MAP),
              };
            }
            if (args.select) {
              args = {
                ...args,
                select: injectSoftDeleteIntoRelations(args.select, RELATION_MODEL_MAP),
              };
            }
          }

          return query(args);
        },
      },
    },
  };
}

/**
 * Permanently delete a soft-deleted record (admin/cleanup use only).
 */
export async function hardDelete(prisma, model, where) {
  const keys = Object.keys(where);
  return prisma.$executeRawUnsafe(
    `DELETE FROM "${model}" WHERE ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ')}`,
    ...Object.values(where)
  );
}

/**
 * Restore a soft-deleted record.
 */
export async function restoreDeleted(prisma, model, where) {
  return prisma[model.charAt(0).toLowerCase() + model.slice(1)].update({
    where,
    data: { deletedAt: null },
  });
}
