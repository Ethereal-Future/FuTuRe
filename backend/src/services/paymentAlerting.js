import axios from 'axios';
import { getConfig } from '../config/env.js';
import logger from '../config/logger.js';

/**
 * Payment Alerting Service.
 * Tracks recent payment failures and Horizon health check results, and fires
 * throttled email/Slack alerts when failure-rate or health thresholds are crossed.
 */
class PaymentAlertingService {
  constructor() {
    this.failureWindow = 5 * 60 * 1000; // 5-minute window
    this.failureThreshold = 0.05; // 5% failure rate
    this.recentFailures = [];
    this.horizonHealthChecks = [];
    this.horizonFailureThreshold = 3; // 3 consecutive failures
    this.alertEmailCooldown = 60 * 1000; // 1 minute between duplicate alerts
    this.lastAlertTime = {};
  }

  /**
   * Record a payment failure and trigger a HIGH_FAILURE_RATE alert if the rolling
   * failure rate exceeds `failureThreshold`.
   * @param {Error|string} error - The failure to record
   * @param {object} [metadata={}] - Additional context to attach to the recorded failure
   * @returns {void}
   */
  recordPaymentFailure(error, metadata = {}) {
    this.recentFailures.push({
      timestamp: Date.now(),
      error,
      metadata,
    });

    // Cleanup old entries
    const cutoffTime = Date.now() - this.failureWindow;
    this.recentFailures = this.recentFailures.filter(f => f.timestamp > cutoffTime);

    // Check if we should trigger alert
    const failureRate = this.getFailureRate();
    if (failureRate > this.failureThreshold) {
      this.triggerAlert('HIGH_FAILURE_RATE', {
        failureRate: (failureRate * 100).toFixed(2),
        failureCount: this.recentFailures.length,
        window: '5 minutes',
      });
    }
  }

  /**
   * Compute the failure rate over the current rolling window (failure count / 100).
   * @returns {number} Failure rate as a fraction (e.g. 0.05 for 5%)
   */
  getFailureRate() {
    const cutoffTime = Date.now() - this.failureWindow;
    const recentFailures = this.recentFailures.filter(f => f.timestamp > cutoffTime);
    return recentFailures.length > 0 ? recentFailures.length / 100 : 0;
  }

  /**
   * Ping a Horizon server's health endpoint and trigger a HORIZON_HEALTH_DEGRADED
   * alert after `horizonFailureThreshold` consecutive failures.
   * @param {string} horizonUrl - Base URL of the Horizon server to check
   * @returns {Promise<boolean>} True if the health check succeeded (HTTP 200)
   */
  async checkHorizonHealth(horizonUrl) {
    try {
      const response = await axios.get(`${horizonUrl}/health`, { timeout: 5000 });
      const isHealthy = response.status === 200;

      if (!isHealthy) {
        this.horizonHealthChecks.push({
          timestamp: Date.now(),
          healthy: false,
          url: horizonUrl,
        });
      } else {
        this.horizonHealthChecks = [];
      }

      if (this.horizonHealthChecks.length >= this.horizonFailureThreshold) {
        this.triggerAlert('HORIZON_HEALTH_DEGRADED', {
          consecutiveFailures: this.horizonHealthChecks.length,
          url: horizonUrl,
          message: 'Horizon server health checks failing',
        });
      }

      return isHealthy;
    } catch (error) {
      this.horizonHealthChecks.push({
        timestamp: Date.now(),
        healthy: false,
        url: horizonUrl,
        error: error.message,
      });

      if (this.horizonHealthChecks.length >= this.horizonFailureThreshold) {
        this.triggerAlert('HORIZON_HEALTH_DEGRADED', {
          consecutiveFailures: this.horizonHealthChecks.length,
          url: horizonUrl,
          error: error.message,
        });
      }

      return false;
    }
  }

  /**
   * Dispatch an alert of the given type, subject to a per-type cooldown to prevent spam.
   * @param {string} alertType - Alert type key (e.g. "HIGH_FAILURE_RATE", "HORIZON_HEALTH_DEGRADED")
   * @param {object} details - Alert-specific details to include in the notification
   * @returns {void}
   */
  triggerAlert(alertType, details) {
    const alertKey = `${alertType}`;
    const lastAlertTime = this.lastAlertTime[alertKey] || 0;
    const timeSinceLastAlert = Date.now() - lastAlertTime;

    // Prevent alert spam
    if (timeSinceLastAlert < this.alertEmailCooldown) {
      return;
    }

    this.lastAlertTime[alertKey] = Date.now();

    const alert = {
      type: alertType,
      severity: 'CRITICAL',
      timestamp: new Date().toISOString(),
      details,
    };

    this.sendAlert(alert);
  }

  /**
   * Fan an alert out to all configured channels (email, Slack).
   * @param {{type: string, severity: string, timestamp: string, details: object}} alert - Alert to send
   * @returns {Promise<void>}
   */
  async sendAlert(alert) {
    const config = getConfig();
    const promises = [];

    // Send email notification
    if (config.alerts?.email) {
      promises.push(this.sendEmailAlert(alert));
    }

    // Send Slack notification
    if (config.alerts?.slackWebhookUrl) {
      promises.push(this.sendSlackAlert(alert));
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Send an alert via email. Currently a logging stub — wire up a real email
   * provider before relying on this in production.
   * @param {{type: string, timestamp: string, details: object}} alert - Alert to send
   * @returns {Promise<void>} Never throws; failures are logged
   */
  async sendEmailAlert(alert) {
    try {
      const config = getConfig();
      if (!config.alerts?.email) return;

      // Stub implementation — integrate with your email service
      logger.info('paymentAlerting.emailAlert.sent', {
        to: config.alerts.email,
        subject: `FuTuRe Alert: ${alert.type}`,
        body: JSON.stringify(alert),
      });

      // Example using axios to send via email service:
      // await axios.post('https://api.mailgun.net/v3/...', {...})
    } catch (error) {
      logger.error('paymentAlerting.emailAlert.failed', { error: error.message });
    }
  }

  /**
   * Send an alert to the configured Slack webhook.
   * @param {{type: string, timestamp: string, details: object}} alert - Alert to send
   * @returns {Promise<void>} Never throws; failures are logged
   */
  async sendSlackAlert(alert) {
    try {
      const config = getConfig();
      if (!config.alerts?.slackWebhookUrl) return;

      const message = {
        text: `🚨 FuTuRe Alert: ${alert.type}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${alert.type}*\n_${alert.timestamp}_`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `\`\`\`${JSON.stringify(alert.details, null, 2)}\`\`\``,
            },
          },
        ],
      };

      await axios.post(config.alerts.slackWebhookUrl, message, { timeout: 5000 });
    } catch (error) {
      logger.error('paymentAlerting.slackAlert.failed', { error: error.message });
    }
  }

  /**
   * Clear recorded payment failures and Horizon health check history.
   * @returns {void}
   */
  resetFailures() {
    this.recentFailures = [];
    this.horizonHealthChecks = [];
  }

  /**
   * Get a snapshot of current failure-rate and Horizon health statistics.
   * @returns {{recentFailureRate: string, recentFailureCount: number, horizonConsecutiveFailures: number}} Alert stats
   */
  getAlertStats() {
    return {
      recentFailureRate: (this.getFailureRate() * 100).toFixed(2),
      recentFailureCount: this.recentFailures.length,
      horizonConsecutiveFailures: this.horizonHealthChecks.length,
    };
  }
}

export default new PaymentAlertingService();
