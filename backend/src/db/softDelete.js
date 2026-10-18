/**
 * Soft-delete helpers (ISSUE-065)
 * Uniqueness is enforced only among active rows via partial unique indexes
 * (see prisma/migrations/*_db_persistence_hardening/migration.sql).
 */
export const activeWhere = (where = {}) => ({ ...where, deletedAt: null });

export async function softDelete(model, id) {
  return model.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Throws if an active record already uses any of the given unique fields. */
export async function assertUniqueActive(model, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    const existing = await model.findFirst({ where: activeWhere({ [key]: value }) });
    if (existing) {
      const err = new Error(`${key} already in use`);
      err.status = 409;
      throw err;
    }
  }
}