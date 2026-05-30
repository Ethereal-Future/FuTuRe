/**
 * Soft Delete Middleware for Prisma
 * Automatically filters out soft-deleted records from queries
 * Allows admin queries to access soft-deleted records via includeDeleted flag
 */

export function setupSoftDeleteMiddleware(prisma) {
  prisma.$use(async (params, next) => {
    // Skip middleware for migrations and internal operations
    if (params.model === null) {
      return next(params);
    }

    // Models that support soft delete
    const softDeleteModels = ['User', 'Transaction'];

    // Check if this is a soft-delete-enabled model
    if (!softDeleteModels.includes(params.model)) {
      return next(params);
    }

    // Check if includeDeleted flag is set (for admin queries)
    const includeDeleted = params.args?.includeDeleted === true;

    // Remove the includeDeleted flag from args before passing to Prisma
    if (params.args?.includeDeleted !== undefined) {
      delete params.args.includeDeleted;
    }

    // For read operations, automatically filter out soft-deleted records
    if (['findUnique', 'findUniqueOrThrow', 'findFirst', 'findMany'].includes(params.action)) {
      if (!includeDeleted) {
        // Add filter to exclude soft-deleted records
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }

    // For update operations, prevent updating soft-deleted records
    if (['update', 'updateMany'].includes(params.action)) {
      if (!includeDeleted) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }

    // For delete operations, perform soft delete instead of hard delete
    if (params.action === 'delete') {
      params.action = 'update';
      params.args.data = { deletedAt: new Date() };
    }

    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      params.args.data = { deletedAt: new Date() };
    }

    return next(params);
  });
}

/**
 * Helper function to permanently delete a soft-deleted record
 * Should only be used by admin operations or data cleanup jobs
 */
export async function hardDelete(prisma, model, where) {
  return prisma[model.toLowerCase()].$executeRawUnsafe(
    `DELETE FROM "${model}" WHERE ${Object.keys(where)
      .map((key) => `"${key}" = $1`)
      .join(' AND ')}`,
    ...Object.values(where)
  );
}

/**
 * Helper function to restore a soft-deleted record
 */
export async function restoreDeleted(prisma, model, where) {
  return prisma[model.toLowerCase()].update({
    where,
    data: { deletedAt: null },
  });
}
