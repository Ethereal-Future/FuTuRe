import prisma from '../db/client.js';
import riskScorer from './riskScorer.js';
import complianceAudit from './complianceAudit.js';
import kycCollector from './kycCollector.js';

// Configurable thresholds
const LARGE_TX_THRESHOLD      = parseFloat(process.env.AML_LARGE_TX_THRESHOLD      ?? '10000');
const STRUCTURING_THRESHOLD   = parseFloat(process.env.AML_STRUCTURING_THRESHOLD   ?? '1000');
const STRUCTURING_COUNT       = parseInt(  process.env.AML_STRUCTURING_COUNT        ?? '3',   10);
const VELOCITY_LIMIT          = parseFloat(process.env.AML_VELOCITY_LIMIT           ?? '10000');
const WINDOW_MS               = 24 * 60 * 60 * 1000; // 24 hours

const AML_RULES = [
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
  {
    id: 'UNVERIFIED_USER',
    description: 'Transaction from unverified user',
    severity: 'MEDIUM',
    check: async (tx) => !(await kycCollector.isVerified(tx.senderId)),
  },
];

class AMLMonitor {
  async screenTransaction(tx, history = []) {
    const alerts = [];

    for (const rule of AML_RULES) {
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
}

export default new AMLMonitor();
