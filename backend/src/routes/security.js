import express from 'express';
import {
  oauth2,
  mfa,
  auditLogger,
  securityScanner,
  incidentResponse,
  penetrationTester,
  complianceReporter
} from '../security/index.js';
import {
  isIPBlocked,
  blockIP,
  unblockIP,
  getSuspiciousPatterns,
  clearOldPatterns,
  detectAnomalousActivity,
} from '../security/accountLockout.js';
import { requireRole } from '../middleware/adminAuth.js';
import { requireMFA } from '../middleware/mfa.js';
import { logAdminAction } from '../db/adminAuditLog.js';

const router = express.Router();

// Roles permitted to perform incident response and playbook execution.
const INCIDENT_RESPONSE_ROLES = ['SUPER_ADMIN', 'SECURITY_LEAD'];

// Disruptive playbook actions that require step-up MFA verification.
const DISRUPTIVE_ACTIONS = [
  'system_isolation',
  'isolate_system',
  'revoke_sessions',
  'revoke_all_sessions',
  'session_revocation',
  'freeze_transfers',
  'freeze_outgoing_transfers',
  'transfer_freeze',
];

function isDisruptiveAction(action) {
  if (!action || typeof action !== 'string') {
    return false;
  }
  return DISRUPTIVE_ACTIONS.includes(action.toLowerCase());
}

// OAuth 2.0 endpoints
router.post('/oauth/authorize', async (req, res) => {
  try {
    const { clientId, userId, scope, codeChallenge, codeChallengeMethod } = req.body;
    const code = await oauth2.generateAuthorizationCode(
      clientId,
      userId,
      scope,
      codeChallenge,
      codeChallengeMethod,
    );
    res.json({ authorizationCode: code });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/oauth/token', async (req, res) => {
  try {
    const { code, clientId, clientSecret, codeVerifier } = req.body;
    const token = await oauth2.exchangeCodeForToken(code, clientId, clientSecret, codeVerifier);
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
router.get('/audit-log', async (req, res) => {
  try {
    // Restrict to authenticated users (admin role check can be added)
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId, actionType, severity, limit, offset } = req.query;
    const logs = await auditLogger.getAuditLog({
      userId,
      actionType,
      severity,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/audit/logs', async (req, res) => {
  try {
    const filters = {
      userId: req.query.userId,
      actionType: req.query.actionType,
      severity: req.query.severity,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    };
    const logs = await auditLogger.getAuditLog(filters);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/audit/security-events', async (req, res) => {
  try {
    const severity = req.query.severity || 'CRITICAL';
    const limit = parseInt(req.query.limit) || 100;
    const events = await auditLogger.getSecurityEvents(severity, limit);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Threat detection endpoints
router.post('/threats/check', (req, res) => {
  try {
    const { userId, activity } = req.body;
    const threats = detectAnomalousActivity(userId, activity);
    res.json({ threats });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/threats/blocked-ips', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const patterns = await getSuspiciousPatterns(limit);
    res.json({ patterns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/threats/block-ip', async (req, res) => {
  try {
    const { ipAddress, reason } = req.body;
    if (!ipAddress) {
      return res.status(400).json({ error: 'IP address required' });
    }
    await blockIP(ipAddress, reason);
    res.json({ message: 'IP blocked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/threats/unblock-ip', async (req, res) => {
  try {
    const { ipAddress } = req.body;
    if (!ipAddress) {
      return res.status(400).json({ error: 'IP address required' });
    }
    await unblockIP(ipAddress);
    res.json({ message: 'IP unblocked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/threats/clear-old-patterns', async (req, res) => {
  try {
    const hours = parseInt(req.body.hours) || 24;
    const cleared = await clearOldPatterns(hours);
    res.json({ message: `Cleared ${cleared} old patterns` });
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
router.post(
  '/incidents/create',
  requireRole(INCIDENT_RESPONSE_ROLES),
  async (req, res) => {
    try {
      const { type, severity, description, affectedSystems } = req.body;
      const incident = await incidentResponse.createIncident(type, severity, description, affectedSystems);
      res.json(incident);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get(
  '/incidents/open',
  requireRole(INCIDENT_RESPONSE_ROLES),
  async (req, res) => {
    try {
      const incidents = await incidentResponse.getOpenIncidents();
      res.json({ incidents });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/incidents/:id/action',
  requireRole(INCIDENT_RESPONSE_ROLES),
  async (req, res) => {
    try {
      const { action } = req.body;
      const incident = await incidentResponse.completeAction(req.params.id, action);
      res.json(incident);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Emergency incident playbook execution.
// Requires elevated RBAC plus step-up MFA for disruptive actions, and every
// attempt (allowed or denied) is written to the immutable admin audit log.
router.post(
  '/incidents/:id/playbook/execute',
  requireRole(INCIDENT_RESPONSE_ROLES),
  async (req, res) => {
    const incidentId = req.params.id;
    const { action } = req.body || {};
    const actorId = req.user && (req.user.id || req.user.userId);

    const audit = async (outcome, details = {}) => {
      try {
        await logAdminAction({
          actorId,
          action: 'INCIDENT_PLAYBOOK_EXECUTE',
          targetType: 'incident',
          targetId: incidentId,
          playbookAction: action,
          outcome,
          ...details,
        });
      } catch (auditError) {
        // Never let audit logging failures mask the authorization decision.
        console.error('Failed to write admin audit log entry:', auditError);
      }
    };

    if (isDisruptiveAction(action)) {
      return requireMFA(req, res, async () => {
        try {
          const incident = await incidentResponse.executePlaybook(incidentId, action);
          await audit('ALLOWED', { disruptive: true });
          res.json(incident);
        } catch (error) {
          await audit('ERROR', { disruptive: true, error: error.message });
          res.status(500).json({ error: error.message });
        }
      });
    }

    try {
      const incident = await incidentResponse.executePlaybook(incidentId, action);
      await audit('ALLOWED', { disruptive: false });
      res.json(incident);
    } catch (error) {
      await audit('ERROR', { disruptive: false, error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
);

// Penetration testing endpoints
router.post('/pentest/run', async (req, res) => {
  try {
    // runSecurityTests persists results to the database (SecurityScanResult)
    // and returns the persisted results so all cluster nodes can read them.
    const results = await penetrationTester.runSecurityTests();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/pentest/results', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    // Reads from the database-backed SecurityScanResult table so historical
    // scan results are available across all cluster nodes.
    const results = await penetrationTester.getLatestResults(limit);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alias endpoint for historical scan results (database-backed)
router.get('/pentest/history', async (req, res) => {
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
