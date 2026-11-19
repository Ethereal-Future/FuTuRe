import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  oauth2,
  mfa,
  auditLogger,
  threatDetector,
  securityScanner,
  incidentResponse,
  penetrationTester,
  complianceReporter
} from '../src/security/index.js';
import { securityHeaders, helmetMiddleware, cspNonceMiddleware } from '../src/middleware/securityHeaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

const { createSecurityRouter } = await import('../src/routes/security.js');
const { auditLogger: routeAuditLogger } = await import('../src/security/index.js');

async function cleanup() {
  try {
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe('Security Features', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('OAuth 2.0', () => {
    it('should register client', () => {
      oauth2.registerClient('client-1', 'secret-1', ['http://localhost:3000/callback']);
      const client = oauth2.clients.get('client-1');
      expect(client).toBeDefined();
      expect(client.clientId).toBe('client-1');
    });

    it('should generate authorization code', () => {
      oauth2.registerClient('client-1', 'secret-1', ['http://localhost:3000/callback']);
      const code = oauth2.generateAuthorizationCode('client-1', 'user-1', 'read write');
      expect(code).toBeDefined();
      expect(code.length).toBeGreaterThan(0);
    });

    it('should exchange code for token', () => {
      oauth2.registerClient('client-1', 'secret-1', ['http://localhost:3000/callback']);
      const code = oauth2.generateAuthorizationCode('client-1', 'user-1', 'read write');
      const token = oauth2.exchangeCodeForToken(code, 'client-1', 'secret-1');
      expect(token.accessToken).toBeDefined();
      expect(token.refreshToken).toBeDefined();
    });

    it('should validate token', () => {
      oauth2.registerClient('client-1', 'secret-1', ['http://localhost:3000/callback']);
      const code = oauth2.generateAuthorizationCode('client-1', 'user-1', 'read write');
      const { accessToken } = oauth2.exchangeCodeForToken(code, 'client-1', 'secret-1');
      const payload = oauth2.validateToken(accessToken);
      expect(payload.userId).toBe('user-1');
    });
  });

  describe('MFA', () => {
    it('should generate secret', () => {
      const { secret, qrCode } = mfa.generateSecret('user-1');
      expect(secret).toBeDefined();
      expect(qrCode).toBeDefined();
    });

    it('should enable MFA', () => {
      const { secret } = mfa.generateSecret('user-1');
      const backupCodes = mfa.enableMFA('user-1', secret);
      expect(backupCodes).toHaveLength(10);
      expect(mfa.isMFAEnabled('user-1')).toBe(true);
    });

    it('should verify backup code', () => {
      const { secret } = mfa.generateSecret('user-1');
      const backupCodes = mfa.enableMFA('user-1', secret);
      const verified = mfa.verifyBackupCode('user-1', backupCodes[0]);
      expect(verified).toBe(true);
    });

    it('should disable MFA', () => {
      const { secret } = mfa.generateSecret('user-disable-test');
      mfa.enableMFA('user-disable-test', secret);
      mfa.disableMFA('user-disable-test');
      expect(mfa.isMFAEnabled('user-disable-test')).toBe(false);
    });
  });

  describe('Audit Logger', () => {
    it('should log auth attempt', async () => {
      await auditLogger.initialize();
      const entry = await auditLogger.logAuthAttempt('user-1', true, '192.168.1.1', 'Mozilla/5.0');
      expect(entry.eventType).toBe('AUTH_ATTEMPT');
      expect(entry.userId).toBe('user-1');
    });

    it('should get audit log', async () => {
      await auditLogger.initialize();
      await auditLogger.logAuthAttempt('user-1', true, '192.168.1.1', 'Mozilla/5.0');
      const logs = await auditLogger.getAuditLog();
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should get security events', async () => {
      await auditLogger.initialize();
      await auditLogger.logSecurityEvent('UNAUTHORIZED_ACCESS', 'user-1', { reason: 'Invalid token' });
      const events = await auditLogger.getSecurityEvents('CRITICAL');
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Threat Detector', () => {
    it('should record failed login', () => {
      const result = threatDetector.recordFailedLogin('user-1', '192.168.1.1');
      expect(result.blocked).toBe(false);
    });

    it('should block IP after threshold', () => {
      for (let i = 0; i < 5; i++) {
        threatDetector.recordFailedLogin('user-1', '192.168.1.1');
      }
      expect(threatDetector.isIPBlocked('192.168.1.1')).toBe(true);
    });

    it('should detect anomalous activity', () => {
      const threats = threatDetector.detectAnomalousActivity('user-1', {
        amount: 15000,
        previousLocation: 'US',
        currentLocation: 'CN'
      });
      expect(threats.length).toBeGreaterThan(0);
    });

    it('should unblock IP', () => {
      threatDetector.blockIP('192.168.1.1', 'Test block');
      threatDetector.unblockIP('192.168.1.1');
      expect(threatDetector.isIPBlocked('192.168.1.1')).toBe(false);
    });
  });

  describe('Threat Detector memory behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      threatDetector.requestTracker.clear();
      threatDetector.anomalyScores.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
      threatDetector.requestTracker.clear();
      threatDetector.anomalyScores.clear();
    });

    it('evicts inactive IPs after the evaluation window expires', () => {
      const ipCount = 500;
      for (let i = 0; i < ipCount; i++) {
        threatDetector.recordRequest(`10.0.${Math.floor(i / 256)}.${i % 256}`);
      }
      expect(threatDetector.requestTracker.size).toBe(ipCount);

      // Advance time well past the evaluation window and run the sweep.
      vi.advanceTimersByTime(60 * 60 * 1000);
      threatDetector.cleanup();

      expect(threatDetector.requestTracker.size).toBe(0);
      expect(threatDetector.anomalyScores.size).toBe(0);
      expect([...threatDetector.requestTracker.keys()]).toHaveLength(0);
      expect([...threatDetector.anomalyScores.keys()]).toHaveLength(0);
    });

    it('keeps map sizes bounded under continuous unique-IP traffic', () => {
      const windowMs = threatDetector.windowMs ?? 60 * 1000;
      const batchSize = 100;
      const batches = 20;

      for (let b = 0; b < batches; b++) {
        for (let i = 0; i < batchSize; i++) {
          threatDetector.recordRequest(`10.1.${b}.${i}`);
        }
        // Advance beyond the window so older IPs become stale.
        vi.advanceTimersByTime(windowMs + 1000);
        threatDetector.cleanup();
      }

      // After each sweep, only the most recent batch should remain.
      expect(threatDetector.requestTracker.size).toBeLessThanOrEqual(batchSize);
      expect(threatDetector.anomalyScores.size).toBeLessThanOrEqual(batchSize);
    });

    it('does not keep the process alive via the cleanup timer', () => {
      const timer = threatDetector.cleanupTimer ?? threatDetector._cleanupTimer;
      expect(timer).toBeDefined();
      // A timer with unref() returns the timer object; hasRef() should be false.
      if (typeof timer.hasRef === 'function') {
        expect(timer.hasRef()).toBe(false);
      }
    });
  });

  describe('Security Scanner', () => {
    it('should scan dependencies', async () => {
      const scan = await securityScanner.scanDependencies();
      expect(scan.type).toBe('DEPENDENCY_SCAN');
      expect(scan.vulnerabilities).toBeDefined();
    });

    it('should scan secrets', async () => {
      const scan = await securityScanner.scanSecrets();
      expect(scan.type).toBe('SECRET_SCAN');
      expect(scan.secretsFound).toBeDefined();
    });

    it('should scan code quality', async () => {
      const scan = await securityScanner.scanCodeQuality();
      expect(scan.type).toBe('CODE_QUALITY_SCAN');
      expect(scan.score).toBeGreaterThan(0);
    });

    it('should get latest scans', async () => {
      await securityScanner.scanDependencies();
      const scans = await securityScanner.getLatestScans(1);
      expect(scans.length).toBeGreaterThan(0);
    });
  });

  describe('Incident Response', () => {
    it('should create incident', async () => {
      const incident = await incidentResponse.createIncident(
        'UNAUTHORIZED_ACCESS',
        'CRITICAL',
        'Unauthorized access detected',
        ['API_SERVER']
      );
      expect(incident.id).toBeDefined();
      expect(incident.status).toBe('OPEN');
    });

    it('should complete action', async () => {
      const incident = await incidentResponse.createIncident(
        'UNAUTHORIZED_ACCESS',
        'CRITICAL',
        'Test incident',
        []
      );
      const action = incident.playbook[0];
      const updated = await incidentResponse.completeAction(incident.id, action);
      expect(updated.completedActions).toContain(action);
    });

    it('should get open incidents', async () => {
      await incidentResponse.createIncident('DATA_BREACH', 'CRITICAL', 'Test', []);
      const incidents = await incidentResponse.getOpenIncidents();
      expect(incidents.length).toBeGreaterThan(0);
    });

    it('should add note to incident', async () => {
      const incident = await incidentResponse.createIncident('DDoS_ATTACK', 'HIGH', 'Test', []);
      const updated = await incidentResponse.addNote(incident.id, 'Initial investigation started');
      expect(updated.notes.length).toBeGreaterThan(0);
    });
  });

  describe('Penetration Tester', () => {
    it('should run security tests', async () => {
      const results = await penetrationTester.runSecurityTests();
      expect(results.tests.length).toBeGreaterThan(0);
      expect(results.summary.total).toBeGreaterThan(0);
    });

    it('should get latest results', async () => {
      await penetrationTester.runSecurityTests();
      const results = await penetrationTester.getLatestResults(1);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Compliance Reporter', () => {
    it('should generate SOC2 report', async () => {
      const report = await complianceReporter.generateComplianceReport('SOC2');
      expect(report.framework).toBe('SOC2');
      expect(report.controls.length).toBeGreaterThan(0);
      expect(report.summary.compliancePercentage).toBeGreaterThan(0);
    });

    it('should generate GDPR report', async () => {
      const report = await complianceReporter.generateComplianceReport('GDPR');
      expect(report.framework).toBe('GDPR');
      expect(report.controls.length).toBeGreaterThan(0);
    });

    it('should generate annual report', async () => {
      const report = await complianceReporter.generateAnnualReport();
      expect(report.reports.length).toBe(4);
      expect(report.overallCompliance).toBeGreaterThan(0);
    });

    it('should get latest reports', async () => {
      await complianceReporter.generateComplianceReport('SOC2');
      const reports = await complianceReporter.getLatestReports(1);
      expect(reports.length).toBeGreaterThan(0);
    });
  });
});

const securedApp = express();
securedApp.use(cspNonceMiddleware());
securedApp.use(helmetMiddleware());
securedApp.use(securityHeaders());
securedApp.get('/ping', (_req, res) => res.json({ ok: true }));

describe('Security headers middleware', () => {
  it('sets X-Content-Type-Options: nosniff on API responses', async () => {
    const res = await request(securedApp).get('/ping');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY on API responses', async () => {
    const res = await request(securedApp).get('/ping');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Strict-Transport-Security on API responses', async () => {
    const res = await request(securedApp).get('/ping');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

function buildSecurityApp({ user, stepUp = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(
    '/api/security',
    createSecurityRouter({
      requireAuth: (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return next();
      },
      requireRole: (roles) => (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        return next();
      },
      requireStepUpAuth: (req, res, next) => {
        if (!stepUp || !req.user?.stepUpVerified) {
          return res.status(403).json({ error: 'Step-up authentication required' });
        }
        return next();
      }
    })
  );
  return app;
}

describe('Emergency playbook RBAC enforcement', () => {
  beforeEach(async () => {
    await cleanup();
    await routeAuditLogger.initialize();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns 403 for a standard authenticated user executing a playbook', async () => {
    const app = buildSecurityApp({
      user: { id: 'user-1', role: 'USER', stepUpVerified: true }
    });
    const res = await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'ISOLATE_SYSTEM' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a standard authenticated user triggering an incident action', async () => {
    const app = buildSecurityApp({
      user: { id: 'user-1', role: 'USER', stepUpVerified: true }
    });
    const res = await request(app)
      .post('/api/security/incidents/incident-1/actions')
      .send({ action: 'REVOKE_ALL_SESSIONS' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for SUPER_ADMIN without step-up MFA', async () => {
    const app = buildSecurityApp({
      user: { id: 'admin-1', role: 'SUPER_ADMIN', stepUpVerified: false }
    });
    const res = await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'ISOLATE_SYSTEM' });
    expect(res.status).toBe(403);
  });

  it('allows SUPER_ADMIN with valid step-up MFA to execute a playbook', async () => {
    const app = buildSecurityApp({
      user: { id: 'admin-1', role: 'SUPER_ADMIN', stepUpVerified: true }
    });
    const res = await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'ISOLATE_SYSTEM' });
    expect(res.status).toBeLessThan(400);
  });

  it('allows SECURITY_LEAD with valid step-up MFA to execute a playbook', async () => {
    const app = buildSecurityApp({
      user: { id: 'lead-1', role: 'SECURITY_LEAD', stepUpVerified: true }
    });
    const res = await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'REVOKE_ALL_SESSIONS' });
    expect(res.status).toBeLessThan(400);
  });

  it('writes denied execution attempts to the admin audit log', async () => {
    const app = buildSecurityApp({
      user: { id: 'user-1', role: 'USER', stepUpVerified: true }
    });
    await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'ISOLATE_SYSTEM' });
    const logs = await routeAuditLogger.getAuditLog();
    const denied = logs.filter(
      (entry) =>
        entry.userId === 'user-1' &&
        (entry.eventType === 'PLAYBOOK_EXECUTION_DENIED' ||
          entry.eventType === 'UNAUTHORIZED_ACCESS')
    );
    expect(denied.length).toBeGreaterThan(0);
  });

  it('writes allowed execution attempts to the admin audit log', async () => {
    const app = buildSecurityApp({
      user: { id: 'admin-1', role: 'SUPER_ADMIN', stepUpVerified: true }
    });
    await request(app)
      .post('/api/security/incidents/incident-1/playbook/execute')
      .send({ action: 'ISOLATE_SYSTEM' });
    const logs = await routeAuditLogger.getAuditLog();
    const allowed = logs.filter(
      (entry) =>
        entry.userId === 'admin-1' &&
        (entry.eventType === 'PLAYBOOK_EXECUTION' ||
          entry.eventType === 'PLAYBOOK_EXECUTED')
    );
    expect(allowed.length).toBeGreaterThan(0);
  });
});
