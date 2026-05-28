import auditLogger from '../security/auditLogger.js';

export async function logRecoveryEvent(eventType, userId, details, ipAddress) {
  return auditLogger.logEvent(
    `RECOVERY_${eventType}`,
    userId,
    { ...details, ipAddress },
    eventType.includes('FAIL') || eventType.includes('LOCK') ? 'WARNING' : 'INFO'
  );
}

export async function logRecoveryInitiated(userId, requestId, method, ipAddress) {
  return logRecoveryEvent('INITIATED', userId, { requestId, method }, ipAddress);
}

export async function logRecoveryAttempt(userId, requestId, success, ipAddress) {
  return logRecoveryEvent(
    success ? 'ATTEMPT_SUCCESS' : 'ATTEMPT_FAIL',
    userId,
    { requestId },
    ipAddress
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
