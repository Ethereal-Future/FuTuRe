import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import complianceAudit from './complianceAudit.js';
import riskScorer from './riskScorer.js';

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
    const amlAlerts = auditTrail.filter(e => e.eventType === 'AML_ALERT');
    const kycEvents = auditTrail.filter(e => e.eventType.startsWith('KYC_'));

    const report = {
      id: `RPT-${type}-${Date.now()}`,
      type,
      generatedAt: new Date().toISOString(),
      period: { from, to },
      summary: {
        totalAuditEvents: auditTrail.length,
        amlAlerts: amlAlerts.length,
        kycEvents: kycEvents.length,
        highRiskAlerts: amlAlerts.filter(a => a.details?.alerts?.some(al => al.severity === 'HIGH')).length,
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
}

export default new ComplianceReportingSystem();
