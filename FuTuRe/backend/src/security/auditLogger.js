import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.join(__dirname, '../../data/audit');

class SecurityAuditLogger {
  async initialize() {
    await fs.mkdir(AUDIT_DIR, { recursive: true });
  }

  async logEvent(eventType, userId, details, severity = 'INFO') {
    await this.initialize();

    const auditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      userId,
      severity,
      details,
      ipAddress: details.ipAddress || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    const auditFile = path.join(AUDIT_DIR, `audit-${new Date().toISOString().split('T')[0]}.jsonl`);
    await fs.appendFile(auditFile, JSON.stringify(auditEntry) + '\n');

    return auditEntry;
  }

  async logAuthAttempt(userId, success, ipAddress, userAgent) {
    return this.logEvent(
      'AUTH_ATTEMPT',
      userId,
      { success, ipAddress, userAgent },
      success ? 'INFO' : 'WARNING'
    );
  }

  async logMFAEvent(userId, action, ipAddress) {
    return this.logEvent(
      'MFA_EVENT',
      userId,
      { action, ipAddress },
      'INFO'
    );
  }

  async logSecurityEvent(eventType, userId, details) {
    return this.logEvent(eventType, userId, details, 'CRITICAL');
  }

  async logDataAccess(userId, resource, action, ipAddress) {
    return this.logEvent(
      'DATA_ACCESS',
      userId,
      { resource, action, ipAddress },
      'INFO'
    );
  }

  async getAuditLog(date = null) {
    await this.initialize();

    const targetDate = date || new Date().toISOString().split('T')[0];
    const auditFile = path.join(AUDIT_DIR, `audit-${targetDate}.jsonl`);

    try {
      const content = await fs.readFile(auditFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async getSecurityEvents(severity = 'CRITICAL') {
    await this.initialize();

    try {
      const files = await fs.readdir(AUDIT_DIR);
      const allEvents = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(AUDIT_DIR, file), 'utf-8');
        const events = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line))
          .filter(e => e.severity === severity);
        allEvents.push(...events);
      }

      return allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Failed to get security events:', error);
      return [];
    }
  }
}

export default new SecurityAuditLogger();
