import prisma from './client.js';
import logger from '../config/logger.js';

/**
 * Write an immutable audit log entry for an admin action.
 * Failures are logged but never propagate — the action itself should not fail due to logging.
 */
export async function logAdminAction(adminId, actionType, targetType, targetId, metadata = {}, request = {}) {
  try {
    await prisma.adminAuditLog.create({
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
    logger.error({ err, adminId, actionType, targetType, targetId }, 'Failed to write admin audit log');
  }
}
