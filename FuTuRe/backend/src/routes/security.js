import express from 'express';
import {
  oauth2,
  mfa,
  auditLogger,
  threatDetector,
  securityScanner,
  incidentResponse,
  penetrationTester,
  complianceReporter
} from '../security/index.js';

const router = express.Router();

// OAuth 2.0 endpoints
router.post('/oauth/authorize', (req, res) => {
  try {
    const { clientId, userId, scope } = req.body;
    const code = oauth2.generateAuthorizationCode(clientId, userId, scope);
    res.json({ authorizationCode: code });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/oauth/token', (req, res) => {
  try {
    const { code, clientId, clientSecret } = req.body;
    const token = oauth2.exchangeCodeForToken(code, clientId, clientSecret);
    res.json(token);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/oauth/refresh', (req, res) => {
  try {
    const { refreshToken, clientId } = req.body;
    const token = oauth2.refreshAccessToken(refreshToken, clientId);
    res.json(token);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// MFA endpoints
router.post('/mfa/setup', async (req, res) => {
  try {
    const { userId } = req.body;
    const { secret, qrCode } = mfa.generateSecret(userId);
    res.json({ secret, qrCode });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/mfa/enable', (req, res) => {
  try {
    const { userId, secret } = req.body;
    const backupCodes = mfa.enableMFA(userId, secret);
    res.json({ backupCodes });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/mfa/verify', (req, res) => {
  try {
    const { userId, token } = req.body;
    mfa.verifyTOTP(userId, token);
    res.json({ verified: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Audit log endpoints
router.get('/audit/logs', async (req, res) => {
  try {
    const date = req.query.date;
    const logs = await auditLogger.getAuditLog(date);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/audit/security-events', async (req, res) => {
  try {
    const severity = req.query.severity || 'CRITICAL';
    const events = await auditLogger.getSecurityEvents(severity);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Threat detection endpoints
router.post('/threats/check', (req, res) => {
  try {
    const { userId, activity } = req.body;
    const threats = threatDetector.detectAnomalousActivity(userId, activity);
    res.json({ threats });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/threats/blocked-ips', (req, res) => {
  try {
    const patterns = threatDetector.getSuspiciousPatterns();
    res.json({ patterns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Security scanning endpoints
router.post('/scan/dependencies', async (req, res) => {
  try {
    const scan = await securityScanner.scanDependencies();
    res.json(scan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scan/secrets', async (req, res) => {
  try {
    const scan = await securityScanner.scanSecrets();
    res.json(scan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scan/code-quality', async (req, res) => {
  try {
    const scan = await securityScanner.scanCodeQuality();
    res.json(scan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/scan/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const scans = await securityScanner.getLatestScans(limit);
    res.json({ scans });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Incident response endpoints
router.post('/incidents/create', async (req, res) => {
  try {
    const { type, severity, description, affectedSystems } = req.body;
    const incident = await incidentResponse.createIncident(type, severity, description, affectedSystems);
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/incidents/open', async (req, res) => {
  try {
    const incidents = await incidentResponse.getOpenIncidents();
    res.json({ incidents });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/incidents/:id/action', async (req, res) => {
  try {
    const { action } = req.body;
    const incident = await incidentResponse.completeAction(req.params.id, action);
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Penetration testing endpoints
router.post('/pentest/run', async (req, res) => {
  try {
    const results = await penetrationTester.runSecurityTests();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pentest/results', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const results = await penetrationTester.getLatestResults(limit);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Compliance reporting endpoints
router.post('/compliance/report', async (req, res) => {
  try {
    const { framework } = req.body;
    const report = await complianceReporter.generateComplianceReport(framework);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/compliance/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const reports = await complianceReporter.getLatestReports(limit);
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/compliance/annual', async (req, res) => {
  try {
    const report = await complianceReporter.generateAnnualReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
