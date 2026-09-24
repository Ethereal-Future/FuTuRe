import prisma from './client.js';
import logger from '../config/logger.js';

/**
 * Write an immutable audit log entry for an admin action.
 *
 * When called without a transaction client (tx) the entry is written via the
 * shared Prisma singleton — matching the previous behaviour.
 *
 * When called with a Prisma transaction client (tx) the insert is part of the
 * caller's transaction and will be rolled back automatically if that
 * transaction rolls back.  This is the preferred call-site for all routes in
 * admin.js / compliance.js so that audit records and business state are
 * atomically bound (SOC 2 / ISO 27001 / FinCEN requirement).
 *
 * @param {string}  adminId      - Authenticated admin user id (req.user.sub)
 * @param {string}  actionType   - Enum-style label, e.g. 'KYC_APPROVE'
 * @param {string}  targetType   - Entity type, e.g. 'USER'
 * @param {string}  targetId     - Primary key of the affected entity
 * @param {object}  [metadata]   - Free-form JSON bag (default: {})
 * @param {object}  [request]    - Express request (used for ip / user-agent)
 * @param {object}  [tx]         - Active Prisma transaction client (optional)
 */
export async function logAdminAction(
  adminId,
  actionType,
  targetType,
  targetId,
  metadata = {},
  request = {},
  tx = null
) {
  const db = tx ?? prisma;

  // When running inside a transaction we must NOT swallow errors: a failure
  // here should roll back the whole transaction so the business action never
  // commits without its audit record.
  if (tx) {
    await db.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        actionType,
        targetEntityType: targetType,
        targetEntityId: targetId,
        actionMetadata: metadata,
        ipAddress: request.ip ?? null,
        userAgent: request.get ? request.get('user-agent') ?? null : null,
      },
    });
    return;
  }

  // Outside a transaction: preserve the existing fire-and-forget behaviour —
  // a logging failure must not propagate and break the HTTP response.
  try {
    await db.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        actionType,
        targetEntityType: targetType,
        targetEntityId: targetId,
        actionMetadata: metadata,
        ipAddress: request.ip ?? null,
        userAgent: request.get ? request.get('user-agent') ?? null : null,
      },
    });
  } catch (err) {
    logger.error(
      { err, adminId, actionType, targetType, targetId },
      'Failed to write admin audit log'
    );
  }
}
