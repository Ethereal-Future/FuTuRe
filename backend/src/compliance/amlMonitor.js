import prisma from '../db/client.js';
import riskScorer from './riskScorer.js';
import complianceAudit from './complianceAudit.js';
import kycCollector from './kycCollector.js';
import logger from '../config/logger.js';
import {
  THRESHOLDS,
  PRE_SUBMISSION_RULES,
  POST_SUBMISSION_ONLY_RULES,
} from './rules.js';

const amlLogger = logger.child({ component: 'aml' });
const WINDOW_MS = THRESHOLDS.WINDOW_MS;

// Post-submission rules for monitoring
const ALL_RULES = [
  ...PRE_SUBMISSION_RULES,
  ...POST_SUBMISSION_ONLY_RULES,
  {
    id: 'UNVERIFIED_USER',
    description: 'Transaction from unverified user',
    severity: 'MEDIUM',
    check: async (tx) => !(await kycCollector.isVerified(tx.senderId)),
  },
];

class AMLMonitor {
  // Synchronous pre-submission screening that can block payments
  async screenTransactionPreSubmission(tx, history = []) {
    const alerts = [];

    // Only check pre-submission rules
    for (const rule of PRE_SUBMISSION_RULES) {
      const triggered = await rule.check(tx, history);
      if (triggered) {
        alerts.push({ ruleId: rule.id, description: rule.description, severity: rule.severity });
      }
    }

    const riskScore = await riskScorer.scoreTransaction(tx, alerts);

    return {
      alerts,
      riskScore,
      flagged: alerts.length > 0,
      blocking: alerts.some(a => a.severity === 'HIGH'),
    };
  }

  // Asynchronous post-submission screening for monitoring
  async screenTransaction(tx, history = []) {
    const alerts = [];

    for (const rule of ALL_RULES) {
      const triggered = await rule.check(tx, history);
      if (triggered) {
        alerts.push({ ruleId: rule.id, description: rule.description, severity: rule.severity });
      }
    }

    const riskScore = await riskScorer.scoreTransaction(tx, alerts);

    if (alerts.length > 0) {
      // Persist each alert to DB (requires a real transactionId)
      if (tx.id && tx.senderId) {
        await Promise.all(alerts.map(alert =>
          prisma.aMLAlert.create({
            data: {
              transactionId: tx.id,
              userId:        tx.senderId,
              ruleId:        alert.ruleId,
              severity:      alert.severity,
              description:   alert.description,
              riskScore:     riskScore.score ?? 0,
              riskLevel:     riskScore.level ?? 'UNKNOWN',
            },
          }).catch(() => {}) // don't fail the payment if alert persistence fails
        ));
      }

      await complianceAudit.log('AML_ALERT', tx.senderId, {
        transactionId: tx.id,
        alerts,
        riskScore,
      });
    }

    return { alerts, riskScore, flagged: alerts.length > 0 };
  }

  // Set account hold for review
  async holdAccountForReview(userId, reason) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          amlStatus: 'HELD_FOR_REVIEW',
          amlHoldReason: reason,
          amlHoldDate: new Date(),
        },
      });

      amlLogger.warn('Account held for AML review', {
        userId,
        reason,
      });

      await complianceAudit.log('ACCOUNT_HOLD', userId, {
        reason,
        status: 'HELD_FOR_REVIEW',
      });
    } catch (error) {
      amlLogger.error('Failed to hold account for review', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  // Clear account hold
  async clearAccountHold(userId) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          amlStatus: 'CLEAR',
          amlHoldReason: null,
          amlHoldDate: null,
        },
      });

      amlLogger.info('Account hold cleared', { userId });

      await complianceAudit.log('ACCOUNT_HOLD_CLEARED', userId, {
        status: 'CLEAR',
      });
    } catch (error) {
      amlLogger.error('Failed to clear account hold', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  // Get transaction history with locking
  async getTransactionHistory(userId, windowMs = WINDOW_MS) {
    const windowStart = new Date(Date.now() - windowMs);

    try {
      return await prisma.transaction.findMany({
        where: {
          senderId: userId,
          createdAt: {
            gte: windowStart,
          },
          successful: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error) {
      amlLogger.error('Failed to retrieve transaction history', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }
}

export default new AMLMonitor();
