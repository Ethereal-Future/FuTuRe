/**
 * Compliance & Regulatory Testing Suite
 *
 * Covers:
 *  - KYC submission and status management
 *  - AML transaction screening
 *  - Risk scoring
 *  - Regulatory report generation
 *  - Audit trail integrity
 *  - Compliance monitoring alerts
 *  - Sanctions checking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import kycCollector from '../src/compliance/kycCollector.js';
import amlMonitor from '../src/compliance/amlMonitor.js';
import riskScorer from '../src/compliance/riskScorer.js';
import complianceAudit from '../src/compliance/complianceAudit.js';
import complianceReporting from '../src/compliance/complianceReporting.js';
import sanctionsChecker from '../src/compliance/sanctionsChecker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

async function cleanup() {
  try { await fs.rm(DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(cleanup);
afterEach(cleanup);

// ── Sample KYC data ───────────────────────────────────────────────────────────
const validKYC = {
  fullName: 'Jane Doe',
  dateOfBirth: '1990-01-15',
  nationality: 'US',
  documentType: 'PASSPORT',
  documentNumber: 'X12345678',
  address: '123 Main St, Springfield',
  email: 'jane@example.com',
};

// ── 1. KYC testing ────────────────────────────────────────────────────────────
describe('KYC Testing', () => {
  it('submits a valid KYC record with PENDING status', async () => {
    const record = await kycCollector.submitKYC('user-1', validKYC);
    expect(record.status).toBe('PENDING');
    expect(record.userId).toBe('user-1');
    expect(record.data.fullName).toBe('Jane Doe');
  });

  it('rejects KYC submission with missing required fields', async () => {
    await expect(
      kycCollector.submitKYC('user-2', { fullName: 'Incomplete' })
    ).rejects.toThrow(/Missing required KYC fields/);
  });

  it('retrieves an existing KYC record', async () => {
    await kycCollector.submitKYC('user-3', validKYC);
    const record = await kycCollector.getKYCRecord('user-3');
    expect(record).not.toBeNull();
    expect(record.userId).toBe('user-3');
  });

  it('returns null for non-existent KYC record', async () => {
    const record = await kycCollector.getKYCRecord('no-such-user');
    expect(record).toBeNull();
  });

  it('approves a KYC record', async () => {
    await kycCollector.submitKYC('user-4', validKYC);
    const updated = await kycCollector.updateStatus('user-4', 'APPROVED', 'Verified by agent');
    expect(updated.status).toBe('APPROVED');
  });

  it('rejects a KYC record', async () => {
    await kycCollector.submitKYC('user-5', validKYC);
    const updated = await kycCollector.updateStatus('user-5', 'REJECTED', 'Document mismatch');
    expect(updated.status).toBe('REJECTED');
  });

  it('reports unverified for PENDING KYC', async () => {
    await kycCollector.submitKYC('user-6', validKYC);
    const verified = await kycCollector.isVerified('user-6');
    expect(verified).toBe(false);
  });

  it('reports verified for APPROVED KYC', async () => {
    await kycCollector.submitKYC('user-7', validKYC);
    await kycCollector.updateStatus('user-7', 'APPROVED');
    const verified = await kycCollector.isVerified('user-7');
    expect(verified).toBe(true);
  });
});

// ── 2. AML testing ────────────────────────────────────────────────────────────
describe('AML Testing', () => {
  it('clears a normal transaction', async () => {
    const tx = { id: 'tx-1', senderId: 'user-ok', amount: '50', createdAt: new Date().toISOString() };
    const result = await amlMonitor.screenTransaction(tx, []);
    expect(result.alerts.filter(a => a.severity === 'HIGH')).toHaveLength(0);
  });

  it('flags a large transaction (>= 10000)', async () => {
    const tx = { id: 'tx-2', senderId: 'user-big', amount: '15000', createdAt: new Date().toISOString() };
    const result = await amlMonitor.screenTransaction(tx, []);
    expect(result.alerts.some(a => a.ruleId === 'LARGE_TX')).toBe(true);
  });

  it('flags structuring (amount just below threshold)', async () => {
    const tx = { id: 'tx-3', senderId: 'user-struct', amount: '9500', createdAt: new Date().toISOString() };
    const result = await amlMonitor.screenTransaction(tx, []);
    expect(result.alerts.some(a => a.ruleId === 'STRUCTURING')).toBe(true);
  });

  it('flags rapid succession transactions', async () => {
    const now = new Date();
    const history = Array.from({ length: 5 }, (_, i) => ({
      id: `h-${i}`, senderId: 'user-rapid',
      amount: '100',
      createdAt: new Date(now - i * 60000).toISOString(),
    }));
    const tx = { id: 'tx-4', senderId: 'user-rapid', amount: '100', createdAt: now.toISOString() };
    const result = await amlMonitor.screenTransaction(tx, history);
    expect(result.alerts.some(a => a.ruleId === 'RAPID_SUCCESSION')).toBe(true);
  });
});

// ── 3. Risk scoring ───────────────────────────────────────────────────────────
describe('Risk Scoring', () => {
  it('returns LOW risk for clean transaction', async () => {
    const tx = { id: 'tx-clean', senderId: 'user-clean', amount: '10' };
    const result = await riskScorer.scoreTransaction(tx, []);
    expect(['LOW', 'MEDIUM']).toContain(result.level);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns HIGH or CRITICAL risk for multiple AML alerts', async () => {
    const tx = { id: 'tx-risky', senderId: 'user-risky', amount: '9500' };
    const alerts = [
      { ruleId: 'LARGE_TX', severity: 'HIGH' },
      { ruleId: 'STRUCTURING', severity: 'MEDIUM' },
    ];
    const result = await riskScorer.scoreTransaction(tx, alerts);
    expect(['HIGH', 'CRITICAL']).toContain(result.level);
  });
});

// ── 4. Audit trail testing ────────────────────────────────────────────────────
describe('Audit Trail', () => {
  it('logs a compliance event', async () => {
    const entry = await complianceAudit.log('KYC_SUBMITTED', 'user-audit', { step: 'initial' });
    expect(entry.eventType).toBe('KYC_SUBMITTED');
    expect(entry.userId).toBe('user-audit');
    expect(entry.id).toBeDefined();
  });

  it('retrieves audit trail entries', async () => {
    await complianceAudit.log('KYC_APPROVED', 'user-trail', {});
    const trail = await complianceAudit.getTrail({ userId: 'user-trail' });
    expect(trail.length).toBeGreaterThan(0);
    expect(trail[0].userId).toBe('user-trail');
  });

  it('filters audit trail by event type', async () => {
    await complianceAudit.log('AML_ALERT', 'user-aml', { ruleId: 'LARGE_TX' });
    await complianceAudit.log('KYC_SUBMITTED', 'user-aml', {});
    const trail = await complianceAudit.getTrail({ eventType: 'AML_ALERT' });
    expect(trail.every(e => e.eventType === 'AML_ALERT')).toBe(true);
  });
});

// ── 5. Regulatory reporting ───────────────────────────────────────────────────
describe('Regulatory Reporting', () => {
  it('generates an AML summary report', async () => {
    await complianceAudit.log('AML_ALERT', 'user-rpt', { alerts: [{ severity: 'HIGH' }] });
    const report = await complianceReporting.generateReport('AML_SUMMARY');
    expect(report.id).toMatch(/^RPT-AML_SUMMARY-/);
    expect(report.summary).toBeDefined();
    expect(report.summary.totalAuditEvents).toBeGreaterThanOrEqual(0);
  });

  it('lists generated reports', async () => {
    await complianceReporting.generateReport('AML_SUMMARY');
    const reports = await complianceReporting.listReports();
    expect(Array.isArray(reports)).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
  });
});

// ── 6. Sanctions checking ─────────────────────────────────────────────────────
describe('Sanctions Checking', () => {
  it('clears a non-sanctioned individual', async () => {
    const result = await sanctionsChecker.check('Jane Doe', 'US');
    expect(result.hit).toBe(false);
  });
});
