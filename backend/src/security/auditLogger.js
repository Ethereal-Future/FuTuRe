import logger from '../config/logger.js';
import { getClient } from '../db/client.js';

const auditLogger = logger.child({ component: 'audit' });

class SecurityAuditLogger {
  async initialize() {}

  async logEvent(
    actionType,
    userId,
    details,
    severity = 'INFO',
    ipAddress = null,
    userAgent = null,
  ) {
    try {
      const client = getClient();
      return await client.auditLog.create({
        data: {
          userId: userId || null,
          actionType,
          resourceType: details.resourceType || null,
          resourceId: details.resourceId || null,
          details: JSON.stringify(details),
          ipAddress: ipAddress || details.ipAddress || null,
          userAgent: userAgent || details.userAgent || null,
          outcome: details.outcome || 'SUCCESS',
          severity,
        },
      });
    } catch (error) {
      auditLogger.error('Failed to create audit entry', { error: error.message });
    }
  }

  async logAuthAttempt(userId, success, ipAddress, userAgent) {
    return this.logEvent(
      success ? 'LOGIN' : 'FAILED_LOGIN',
      userId,
      { ipAddress, userAgent },
      success ? 'INFO' : 'WARNING',
      ipAddress,
      userAgent,
    );
  }

  async logMFAEvent(userId, action, ipAddress) {
    return this.logEvent('MFA_EVENT', userId, { action, ipAddress }, 'INFO', ipAddress);
  }

  async logSecurityEvent(eventType, userId, details) {
    return this.logEvent(eventType, userId, details, 'CRITICAL');
  }

  async logDataAccess(userId, resource, action, ipAddress) {
    return this.logEvent('DATA_ACCESS', userId, { resource, action, ipAddress }, 'INFO', ipAddress);
  }

  async logPayment(userId, resourceId, ipAddress) {
    return this.logEvent(
      'PAYMENT',
      userId,
      { resourceType: 'transaction', resourceId, ipAddress },
      'INFO',
      ipAddress,
    );
  }

  async logKYCSubmission(userId, ipAddress) {
    return this.logEvent(
      'KYC_SUBMISSION',
      userId,
      { resourceType: 'kyc', resourceId: userId, ipAddress },
      'INFO',
      ipAddress,
    );
  }

  async logPasswordChange(userId, ipAddress) {
    return this.logEvent('PASSWORD_CHANGE', userId, { ipAddress }, 'INFO', ipAddress);
  }

  async logAccountDeletion(userId, ipAddress = null, retention = {}) {
    return this.logEvent(
      'ACCOUNT_DELETION',
      userId,
      {
        resourceType: 'user',
        resourceId: userId,
        ...retention,
      },
      'WARNING',
      ipAddress,
    );
  }

  async logAdminAction(adminId, action, resourceType, resourceId, ipAddress) {
    return this.logEvent(
      `ADMIN_${action}`,
      adminId,
      { resourceType, resourceId, ipAddress },
      'WARNING',
      ipAddress,
    );
  }

  async getAuditLog(filters = {}) {
    try {
      const client = getClient();
      const { userId, actionType, severity, limit = 100, offset = 0 } = filters;

      const where = {};
      if (userId) where.userId = userId;
      if (actionType) where.actionType = actionType;
      if (severity) where.severity = severity;

      return await client.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      });
    } catch (error) {
      auditLogger.error('Failed to retrieve audit log', { error: error.message });
      return [];
    }
  }

  async getSecurityEvents(severity = 'CRITICAL', limit = 100) {
    try {
      const client = getClient();
      return await client.auditLog.findMany({
        where: { severity },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (error) {
      auditLogger.error('Failed to get security events', { error: error.message });
      return [];
    }
  }
}

export default new SecurityAuditLogger();
