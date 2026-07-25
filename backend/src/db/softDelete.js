/**
 * Soft Delete extension for Prisma (Prisma 5+ query extension API).
 * Automatically filters out soft-deleted records from queries.
 * Pass { where: { includeDeleted: true } } to bypass the filter in admin queries.
 */

const SOFT_DELETE_MODELS = new Set(['User', 'Transaction']);

const FILTER_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
]);
const UPDATE_ACTIONS = new Set(['update', 'updateMany']);

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
            if (FILTER_ACTIONS.has(operation) || UPDATE_ACTIONS.has(operation)) {
              args = { ...args, where: { ...args.where, deletedAt: null } };
            }

            if (operation === 'delete') {
              // Intercept hard delete → soft delete
              return query({ ...args, data: { deletedAt: new Date() } });
            }

            if (operation === 'deleteMany') {
              return query({ ...args, data: { deletedAt: new Date() } });
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
