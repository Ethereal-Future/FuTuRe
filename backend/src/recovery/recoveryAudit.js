import auditLogger from '../security/auditLogger.js';
import logger from '../config/logger.js';
import { sendEmail } from '../notifications/channels/email.js';

// Security team address — configure via env so it never needs a code change
const SECURITY_TEAM_EMAIL = process.env.SECURITY_TEAM_EMAIL || 'security@futureremit.app';

// Events that represent a potential account takeover and must alert the security team
const TAKEOVER_RISK_EVENTS = new Set([
  'COMPLETED',   // account fully recovered — could be illegitimate
  'LOCKED',      // too many bad attempts — active brute-force indicator
]);

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Dispatch an out-of-band alert email to the security team.
 * Errors are caught and logged so a mail failure never silently swallows
 * the originating audit write.
 *
 * @param {string} eventType
 * @param {string} userId
 * @param {object} details
 */
async function alertSecurityTeam(eventType, userId, details) {
  const subject = `[SECURITY ALERT] Recovery event: RECOVERY_${eventType} — user ${userId}`;
  const body =
    `A high-risk account recovery event was detected.\n\n` +
    `Event   : RECOVERY_${eventType}\n` +
    `User ID : ${userId}\n` +
    `Time    : ${new Date().toISOString()}\n` +
    `Details : ${JSON.stringify(details, null, 2)}\n\n` +
    `Review the audit log immediately and verify whether this recovery was authorised.`;

  try {
    await sendEmail({
      to: SECURITY_TEAM_EMAIL,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });
    logger.info(
      { eventType, userId },
      'Security team alerted for high-risk recovery event',
    );
  } catch (err) {
    // Log but do not re-throw — alerting failure must not roll back an audit write
    logger.error(
      { err, eventType, userId },
      'Failed to send security team alert for recovery event',
    );
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function logRecoveryEvent(eventType, userId, details, ipAddress) {
  // Escalate severity to CRITICAL for takeover-risk events so they surface in
  // getSecurityEvents() queries without needing a separate severity field scan
  const isTakeoverRisk = TAKEOVER_RISK_EVENTS.has(eventType);
  const severity = isTakeoverRisk
    ? 'CRITICAL'
    : eventType.includes('FAIL') || eventType.includes('LOCK')
      ? 'WARNING'
      : 'INFO';

  const auditEntry = await auditLogger.logEvent(
    `RECOVERY_${eventType}`,
    userId,
    { ...details, ipAddress },
    severity,
  );

  // Trigger out-of-band security team notification for account takeover risks
  if (isTakeoverRisk) {
    await alertSecurityTeam(eventType, userId, { ...details, ipAddress });
  }

  return auditEntry;
}

export async function logRecoveryInitiated(userId, requestId, method, ipAddress) {
  return logRecoveryEvent('INITIATED', userId, { requestId, method }, ipAddress);
}

export async function logRecoveryAttempt(userId, requestId, success, ipAddress) {
  return logRecoveryEvent(
    success ? 'ATTEMPT_SUCCESS' : 'ATTEMPT_FAIL',
    userId,
    { requestId },
    ipAddress,
  );
}

export async function logRecoveryCompleted(userId, requestId, ipAddress) {
  return logRecoveryEvent('COMPLETED', userId, { requestId }, ipAddress);
}

export async function logRecoveryCancelled(userId, requestId, ipAddress) {
  return logRecoveryEvent('CANCELLED', userId, { requestId }, ipAddress);
}

export async function logRecoveryLocked(userId, requestId, ipAddress) {
  return logRecoveryEvent('LOCKED', userId, { requestId }, ipAddress);
}
