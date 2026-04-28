import kycCollector from './kycCollector.js';
import sanctionsChecker from './sanctionsChecker.js';

// Risk scoring: produces a 0–100 score (higher = riskier).
const RISK_WEIGHTS = {
  LARGE_TX: 30,
  RAPID_SUCCESSION: 35,
  STRUCTURING: 40,
  UNVERIFIED_USER: 25,
};

const RISK_LEVELS = [
  { label: 'LOW', max: 30 },
  { label: 'MEDIUM', max: 60 },
  { label: 'HIGH', max: 80 },
  { label: 'CRITICAL', max: 100 },
];

class RiskScorer {
  async scoreTransaction(tx, amlAlerts = []) {
    let score = 0;

    // AML rule contributions
    for (const alert of amlAlerts) {
      score += RISK_WEIGHTS[alert.ruleId] || 10;
    }

    // KYC status contribution
    const verified = await kycCollector.isVerified(tx.senderId);
    if (!verified) score += 20;

    // Sanctions contribution
    const record = await kycCollector.getKYCRecord(tx.senderId);
    if (record) {
      const sanctioned = await sanctionsChecker.check(record.fullName, record.nationality);
      if (sanctioned.hit) score += 50;
    }

    score = Math.min(score, 100);
    const level = RISK_LEVELS.find(l => score <= l.max)?.label || 'CRITICAL';

    return { score, level };
  }

  async scoreUser(userId) {
    const record = await kycCollector.getKYCRecord(userId);
    if (!record) return { score: 50, level: 'MEDIUM', reason: 'No KYC on file' };

    let score = 0;

    if (record.status !== 'APPROVED') score += 30;

    const sanctioned = await sanctionsChecker.check(record.fullName, record.nationality);
    if (sanctioned.hit) score += 50;
    const level = RISK_LEVELS.find(l => score <= l.max)?.label || 'CRITICAL';

    return { score, level };
  }
}

export default new RiskScorer();
