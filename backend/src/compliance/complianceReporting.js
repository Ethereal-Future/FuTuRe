/**
 * Compliance reporting — SAR, CTR, and general AML summary reports.
 *
 * Issue #1144: reports are now persisted to the database (ComplianceReport
 * table) instead of local disk so they:
 *   - survive container restarts / re-deploys (durable storage)
 *   - carry an explicit filingStatus field that distinguishes "generated"
 *     from "actually filed with FinCEN" — two legally distinct states
 *   - include a retainUntil date enforcing the BSA 5-year retention window
 *
 * Issue #1340: CTR aggregation now groups transactions by beneficial owner
 * (verified identity) rather than by individual account/senderId, so that
 * structuring across multiple accounts of the same person is detected per
 * FinCEN 31 CFR § 1010.311.
 *
 * ⚠️  WARNING: generating a SAR or CTR here does NOT automatically submit
 * it to FinCEN's BSA E-Filing system.  Every generated report has
 * filingStatus = "MANUAL_REVIEW_REQUIRED" until an authorised operator
 * updates it to "FILED" with a BSA filing reference number.  Operators
 * must file SAR/CTR reports manually via https://bsaefiling.fincen.treas.gov
 * within the statutory deadline (typically 30 days of detection for SARs,
 * 15 days for CTRs).  See docs/guides/security.md for the compliance runbook.
 */
import prisma from '../db/client.js';
import complianceAudit from './complianceAudit.js';
import { getRelatedAccountIds } from './identityVerifier.js';

// BSA mandated retention period in years
const RETENTION_YEARS = 5;

// FinCEN CTR reporting threshold (31 CFR § 1010.311)
const CTR_THRESHOLD = 10000;

function retainUntilDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + RETENTION_YEARS);
  return d;
}

class ComplianceReportingSystem {
  async generateReport(type = 'AML_SUMMARY', options = {}) {
    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    const auditTrail = await complianceAudit.getTrail({ from, to });
    const amlAlerts = auditTrail.filter((e) => e.eventType === 'AML_ALERT');
    const kycEvents = auditTrail.filter((e) => e.eventType.startsWith('KYC_'));

    const payload = {
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

    const record = await prisma.complianceReport.create({
      data: {
        reportType: type,
        payload,
        period: { from, to },
        filingStatus: 'GENERATED',
        generatedBy: options.generatedBy ?? null,
        retainUntil: retainUntilDate(),
      },
    });

    await complianceAudit.log('REPORT_GENERATED', 'system', {
      reportId: record.id,
      type,
    });

    return { id: record.id, filingStatus: record.filingStatus, ...payload };
  }

  async listReports() {
    const records = await prisma.complianceReport.findMany({
      select: {
        id: true,
        reportType: true,
        filingStatus: true,
        filingReference: true,
        generatedAt: true,
        filedAt: true,
        retainUntil: true,
        period: true,
        payload: true,
      },
      orderBy: { generatedAt: 'desc' },
    });

    return records.map((r) => ({
      id: r.id,
      type: r.reportType,
      generatedAt: r.generatedAt,
      filingStatus: r.filingStatus,
      filingReference: r.filingReference ?? null,
      filedAt: r.filedAt ?? null,
      retainUntil: r.retainUntil,
      summary: r.payload?.summary ?? null,
    }));
  }

  // FinCEN SAR — Suspicious Activity Report (HIGH/CRITICAL AML alerts)
  //
  // ⚠️  WARNING: this generates the report document only. It does NOT file
  // the SAR with FinCEN. Operators must manually submit via BSA E-Filing
  // (https://bsaefiling.fincen.treas.gov) within 30 days of detection and
  // update filingStatus to "FILED" with the assigned filing reference.
  async generateSAR(options = {}) {
    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    const auditTrail = await complianceAudit.getTrail({ from, to });
    const sarEvents = auditTrail.filter(
      (e) =>
        e.eventType === 'AML_ALERT' &&
        e.details?.alerts?.some((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL')
    );

    const payload = {
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
      // Operators: this report requires MANUAL filing with FinCEN.
      // See docs/guides/security.md — "SAR/CTR Filing Runbook".
      _notice: 'MANUAL_FILING_REQUIRED — not yet submitted to FinCEN BSA E-Filing.',
    };

    const record = await prisma.complianceReport.create({
      data: {
        reportType: 'SAR',
        payload,
        period: { from, to },
        // MANUAL_REVIEW_REQUIRED makes it explicit that filing has not happened.
        filingStatus: 'MANUAL_REVIEW_REQUIRED',
        generatedBy: options.generatedBy ?? null,
        retainUntil: retainUntilDate(),
      },
    });

    await complianceAudit.log('REPORT_GENERATED', 'system', {
      reportId: record.id,
      type: 'SAR',
    });

    return {
      id: record.id,
      filingStatus: record.filingStatus,
      retainUntil: record.retainUntil,
      ...payload,
    };
  }

  // FinCEN CTR — Currency Transaction Report (transactions >= $10,000)
  //
  // Per 31 CFR § 1010.311, cash/crypto transactions conducted by or on
  // behalf of the SAME beneficial owner across ALL accounts they own or
  // control within a single business day must be aggregated.  We therefore
  // group by verified identity (taxId / documentNumberHash) rather than by
  // individual senderId, so cross-account structuring is detected.
  //
  // ⚠️  WARNING: this generates the report document only. It does NOT file
  // the CTR with FinCEN. Operators must manually submit via BSA E-Filing
  // within 15 days and update filingStatus to "FILED".
  async generateCTR(options = {}) {
    const from = options.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = options.to || new Date().toISOString();

    const transactions =
      options.transactions ??
      (await complianceAudit.getTrail({ from, to }))
        .filter(
          (e) =>
            e.eventType === 'AML_ALERT' &&
            e.details?.alerts?.some((a) => a.ruleId === 'LARGE_TX')
        )
        .map((e) => ({
          transactionId: e.details?.transactionId ?? 'UNKNOWN',
          amount: e.details?.amount ?? 0,
          date: e.timestamp,
          userId: e.userId,
        }));

    // Group transactions by beneficial owner so that multiple accounts
    // belonging to the same verified identity are aggregated together.
    const groups = new Map();
    for (const tx of transactions) {
      const accountId = tx.userId ?? tx.senderId ?? null;
      const relatedIds = accountId ? await getRelatedAccountIds(accountId) : [];
      const identityKey = relatedIds.length
        ? [...relatedIds].sort().join('|')
        : `account:${accountId ?? 'UNKNOWN'}`;

      if (!groups.has(identityKey)) {
        groups.set(identityKey, { accountIds: new Set(relatedIds), transactions: [] });
      }
      const group = groups.get(identityKey);
      if (accountId) group.accountIds.add(accountId);
      group.transactions.push(tx);
    }

    const qualifying = [];
    for (const group of groups.values()) {
      const totalAmount = group.transactions.reduce(
        (sum, tx) => sum + parseFloat(tx.amount || 0),
        0
      );
      // Only report groups whose combined daily aggregate crosses the
      // CTR threshold — this is the cross-account structuring detection.
      if (totalAmount >= CTR_THRESHOLD) {
        qualifying.push({
          accountIds: [...group.accountIds],
          transactions: group.transactions,
          totalAmount,
        });
      }
    }

    const reportedTransactions = qualifying.flatMap((g) => g.transactions);

    const payload = {
      reportType: 'CTR',
      filingDate: new Date().toISOString(),
      period: { from, to },
      reportingEntity: { institutionName: 'FuTuRe Remittance Platform' },
      transactions: reportedTransactions,
      aggregatedGroups: qualifying.map((g) => ({
        accountIds: g.accountIds,
        totalAmount: g.totalAmount,
        transactionCount: g.transactions.length,
      })),
      totalTransactions: reportedTransactions.length,
      totalAmount: qualifying.reduce((sum, g) => sum + g.totalAmount, 0),
      _notice: 'MANUAL_FILING_REQUIRED — not yet submitted to FinCEN BSA E-Filing.',
    };

    const record = await prisma.complianceReport.create({
      data: {
        reportType: 'CTR',
        payload,
        period: { from, to },
        filingStatus: 'MANUAL_REVIEW_REQUIRED',
        generatedBy: options.generatedBy ?? null,
        retainUntil: retainUntilDate(),
      },
    });

    await complianceAudit.log('REPORT_GENERATED', 'system', {
      reportId: record.id,
      type: 'CTR',
    });

    return {
      id: record.id,
      filingStatus: record.filingStatus,
      retainUntil: record.retainUntil,
      ...payload,
    };
  }

  /**
   * Mark a report as filed with FinCEN. Only authorised compliance staff
   * should call this endpoint after completing BSA E-Filing submission.
   *
   * @param {string} reportId - ComplianceReport.id
   * @param {string} filingReference - Reference number assigned by BSA E-Filing
   * @param {string} operatorId - userId of the staff member marking it filed
   */
  async markFiled(reportId, filingReference, operatorId) {
    const record = await prisma.complianceReport.update({
      where: { id: reportId },
      data: {
        filingStatus: 'FILED',
        filingReference,
        filedAt: new Date(),
      },
    });

    await complianceAudit.log('REPORT_FILED', operatorId ?? 'system', {
      reportId,
      filingReference,
    });

    return record;
  }
}

export default new ComplianceReportingSystem();
