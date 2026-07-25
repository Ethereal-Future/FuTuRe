import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import complianceAudit from './complianceAudit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '../../data/compliance-reports');

class ComplianceReportingSystem {
  async initialize() {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
  }

  async generateReport(type = 'AML_SUMMARY', options = {}) {
    await this.initialize();

    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    const auditTrail = await complianceAudit.getTrail({ from, to });
    const amlAlerts = auditTrail.filter((e) => e.eventType === 'AML_ALERT');
    const kycEvents = auditTrail.filter((e) => e.eventType.startsWith('KYC_'));

    const report = {
      id: `RPT-${type}-${Date.now()}`,
      type,
      generatedAt: new Date().toISOString(),
      period: { from, to },
      summary: {
        totalAuditEvents: auditTrail.length,
        amlAlerts: amlAlerts.length,
        kycEvents: kycEvents.length,
        highRiskAlerts: amlAlerts.filter((a) =>
          a.details?.alerts?.some((al) => al.severity === 'HIGH')
        ).length,
      },
      amlAlerts,
      kycEvents,
    };

    const file = path.join(REPORTS_DIR, `${report.id}.json`);
    await fs.writeFile(file, JSON.stringify(report, null, 2));

    await complianceAudit.log('REPORT_GENERATED', 'system', { reportId: report.id, type });
    return report;
  }

  async listReports() {
    await this.initialize();
    try {
      const files = await fs.readdir(REPORTS_DIR);
      const reports = [];
      for (const file of files) {
        const content = await fs.readFile(path.join(REPORTS_DIR, file), 'utf-8');
        const { id, type, generatedAt, summary } = JSON.parse(content);
        reports.push({ id, type, generatedAt, summary });
      }
      return reports.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    } catch {
      return [];
    }
  }

  // FinCEN SAR — Suspicious Activity Report (HIGH/CRITICAL AML alerts)
  async generateSAR(options = {}) {
    await this.initialize();

    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    const auditTrail = await complianceAudit.getTrail({ from, to });
    const sarEvents = auditTrail.filter(
      (e) =>
        e.eventType === 'AML_ALERT' &&
        e.details?.alerts?.some((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL')
    );

    const report = {
      id: `SAR-${Date.now()}`,
      reportType: 'SAR',
      filingDate: new Date().toISOString(),
      period: { from, to },
      reportingEntity: { institutionName: 'FuTuRe Remittance Platform' },
      suspiciousActivities: sarEvents.map((e) => ({
        activityDate: e.timestamp,
        activityType: e.details?.alerts?.[0]?.ruleId ?? 'UNKNOWN',
        description: (e.details?.alerts ?? []).map((a) => a.description).join('; '),
        userId: e.userId,
      })),
      totalActivities: sarEvents.length,
    };

    await fs.writeFile(
      path.join(REPORTS_DIR, `${report.id}.json`),
      JSON.stringify(report, null, 2)
    );
    await complianceAudit.log('REPORT_GENERATED', 'system', { reportId: report.id, type: 'SAR' });
    return report;
  }

  // FinCEN CTR — Currency Transaction Report (transactions >= $10,000)
  async generateCTR(options = {}) {
    await this.initialize();

    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    // Accept explicit transactions array for testability; fall back to AML audit trail
    const transactions =
      options.transactions ??
      (await complianceAudit.getTrail({ from, to }))
        .filter(
          (e) =>
            e.eventType === 'AML_ALERT' && e.details?.alerts?.some((a) => a.ruleId === 'LARGE_TX')
        )
        .map((e) => ({
          transactionId: e.details?.transactionId ?? 'UNKNOWN',
          amount: e.details?.amount ?? 0,
          date: e.timestamp,
          userId: e.userId,
        }));

    const qualifying = transactions.filter((tx) => parseFloat(tx.amount) >= 10000);

    const report = {
      id: `CTR-${Date.now()}`,
      reportType: 'CTR',
      filingDate: new Date().toISOString(),
      period: { from, to },
      reportingEntity: { institutionName: 'FuTuRe Remittance Platform' },
      transactions: qualifying,
      totalTransactions: qualifying.length,
      totalAmount: qualifying.reduce((sum, tx) => sum + parseFloat(tx.amount), 0),
    };

    await fs.writeFile(
      path.join(REPORTS_DIR, `${report.id}.json`),
      JSON.stringify(report, null, 2)
    );
    await complianceAudit.log('REPORT_GENERATED', 'system', { reportId: report.id, type: 'CTR' });
    return report;
  }

  // Convert a list of objects to CSV given an ordered field list
  toCsv(fields, rows) {
    const escape = (v) => JSON.stringify(v ?? '');
    const header = fields.join(',');
    const lines = rows.map((row) => fields.map((f) => escape(row[f])).join(','));
    return [header, ...lines].join('\n');
  }
}

export default new ComplianceReportingSystem();
