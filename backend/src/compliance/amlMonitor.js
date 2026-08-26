import prisma from '../db/client.js';
import riskScorer from './riskScorer.js';
import complianceAudit from './complianceAudit.js';
import kycCollector from './kycCollector.js';
import logger from '../config/logger.js';

const amlLogger = logger.child({ component: 'aml' });

// Configurable thresholds
const LARGE_TX_THRESHOLD      = parseFloat(process.env.AML_LARGE_TX_THRESHOLD      ?? '10000');
const STRUCTURING_THRESHOLD   = parseFloat(process.env.AML_STRUCTURING_THRESHOLD   ?? '1000');
const STRUCTURING_COUNT       = parseInt(  process.env.AML_STRUCTURING_COUNT        ?? '3',   10);
const VELOCITY_LIMIT          = parseFloat(process.env.AML_VELOCITY_LIMIT           ?? '10000');
const WINDOW_MS               = 24 * 60 * 60 * 1000; // 24 hours

// Pre-submission rules that block transactions
const PRE_SUBMISSION_RULES = [
  {
    id: 'LARGE_TX',
    description: 'Single transaction exceeds reporting threshold',
    severity: 'HIGH',
    check: (tx) => parseFloat(tx.amount) >= LARGE_TX_THRESHOLD,
  },
  {
    id: 'STRUCTURING',
    description: `More than ${STRUCTURING_COUNT} transactions below $${STRUCTURING_THRESHOLD} in 24h (structuring)`,
    severity: 'HIGH',
    check: (tx, history) => {
      const windowStart = new Date(new Date(tx.createdAt) - WINDOW_MS);
      const recent = history.filter(h =>
        h.senderId === tx.senderId &&
        new Date(h.createdAt) >= windowStart &&
        parseFloat(h.amount) < STRUCTURING_THRESHOLD
      );
      return recent.length >= STRUCTURING_COUNT && parseFloat(tx.amount) < STRUCTURING_THRESHOLD;
    },
  },
  {
    id: 'VELOCITY',
    description: `Total sent in 24h exceeds $${VELOCITY_LIMIT}`,
    severity: 'HIGH',
    check: (tx, history) => {
      const windowStart = new Date(new Date(tx.createdAt) - WINDOW_MS);
      const total = history
        .filter(h => h.senderId === tx.senderId && new Date(h.createdAt) >= windowStart)
        .reduce((sum, h) => sum + parseFloat(h.amount), 0);
      return total + parseFloat(tx.amount) > VELOCITY_LIMIT;
    },
  },
];

// Post-submission rules for monitoring
const ALL_RULES = [
  ...PRE_SUBMISSION_RULES,
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
