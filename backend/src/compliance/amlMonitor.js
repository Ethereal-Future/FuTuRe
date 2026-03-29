import kycCollector from './kycCollector.js';
import riskScorer from './riskScorer.js';
import complianceAudit from './complianceAudit.js';

// AML transaction monitoring — flags suspicious activity patterns.
const AML_RULES = [
  {
    id: 'LARGE_TX',
    description: 'Single transaction exceeds reporting threshold',
    check: (tx) => parseFloat(tx.amount) >= 10000,
    severity: 'HIGH',
  },
  {
    id: 'RAPID_SUCCESSION',
    description: 'Multiple transactions in short window (structuring)',
    check: (tx, history) => {
      const windowMs = 60 * 60 * 1000; // 1 hour
      const recent = history.filter(h =>
        h.senderId === tx.senderId &&
        new Date(tx.createdAt) - new Date(h.createdAt) < windowMs
      );
      return recent.length >= 5;
    },
    severity: 'HIGH',
  },
  {
    id: 'STRUCTURING',
    description: 'Transactions just below reporting threshold',
    check: (tx) => {
      const amount = parseFloat(tx.amount);
      return amount >= 9000 && amount < 10000;
    },
    severity: 'MEDIUM',
  },
  {
    id: 'UNVERIFIED_USER',
    description: 'Transaction from unverified user',
    check: async (tx) => !(await kycCollector.isVerified(tx.senderId)),
    severity: 'MEDIUM',
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
