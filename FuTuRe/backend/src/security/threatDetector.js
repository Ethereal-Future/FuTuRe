class ThreatDetector {
  constructor() {
    this.failedAttempts = new Map();
    this.suspiciousPatterns = [];
    this.blockedIPs = new Set();
    this.thresholds = {
      failedLoginAttempts: 5,
      failedLoginWindow: 15 * 60 * 1000, // 15 minutes
      rapidRequests: 100,
      rapidRequestWindow: 60 * 1000 // 1 minute
    };
  }

  recordFailedLogin(userId, ipAddress) {
    const key = `${userId}:${ipAddress}`;
    const now = Date.now();

    if (!this.failedAttempts.has(key)) {
      this.failedAttempts.set(key, []);
    }

    const attempts = this.failedAttempts.get(key);
    attempts.push(now);

    // Clean old attempts
    const validAttempts = attempts.filter(
      t => now - t < this.thresholds.failedLoginWindow
    );
    this.failedAttempts.set(key, validAttempts);

    if (validAttempts.length >= this.thresholds.failedLoginAttempts) {
      this.blockIP(ipAddress, 'Excessive failed login attempts');
      return { blocked: true, reason: 'Too many failed attempts' };
    }

    return { blocked: false };
  }

  detectAnomalousActivity(userId, activity) {
    const threats = [];

    // Detect rapid location changes
    if (activity.previousLocation && activity.currentLocation) {
      if (activity.previousLocation !== activity.currentLocation) {
        threats.push({
          type: 'LOCATION_CHANGE',
          severity: 'MEDIUM',
          message: 'Unusual location change detected'
        });
      }
    }

    // Detect unusual access times
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      threats.push({
        type: 'UNUSUAL_TIME',
        severity: 'LOW',
        message: 'Access outside normal hours'
      });
    }

    // Detect large transactions
    if (activity.amount && activity.amount > 10000) {
      threats.push({
        type: 'LARGE_TRANSACTION',
        severity: 'MEDIUM',
        message: 'Unusually large transaction detected'
      });
    }

    return threats;
  }

  blockIP(ipAddress, reason) {
    this.blockedIPs.add(ipAddress);
    this.suspiciousPatterns.push({
      type: 'IP_BLOCKED',
      ipAddress,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  isIPBlocked(ipAddress) {
    return this.blockedIPs.has(ipAddress);
  }

  unblockIP(ipAddress) {
    this.blockedIPs.delete(ipAddress);
  }

  getSuspiciousPatterns() {
    return this.suspiciousPatterns;
  }

  clearOldPatterns(olderThanHours = 24) {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    this.suspiciousPatterns = this.suspiciousPatterns.filter(
      p => new Date(p.timestamp).getTime() > cutoff
    );
  }
}

export default new ThreatDetector();
