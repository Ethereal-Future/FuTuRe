import axios from 'axios';
import { getConfig } from '../config/env.js';

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

  getFailureRate() {
    const cutoffTime = Date.now() - this.failureWindow;
    const recentFailures = this.recentFailures.filter(f => f.timestamp > cutoffTime);
    return recentFailures.length > 0 ? recentFailures.length / 100 : 0;
  }

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

  async sendEmailAlert(alert) {
    try {
      const config = getConfig();
      if (!config.alerts?.email) return;

      // Stub implementation — integrate with your email service
      console.log('[Alert Email]', {
        to: config.alerts.email,
        subject: `FuTuRe Alert: ${alert.type}`,
        body: JSON.stringify(alert, null, 2),
      });

      // Example using axios to send via email service:
      // await axios.post('https://api.mailgun.net/v3/...', {...})
    } catch (error) {
      console.error('[Alert Email Failed]', error.message);
    }
  }

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
      console.error('[Alert Slack Failed]', error.message);
    }
  }

  resetFailures() {
    this.recentFailures = [];
    this.horizonHealthChecks = [];
  }

  getAlertStats() {
    return {
      recentFailureRate: (this.getFailureRate() * 100).toFixed(2),
      recentFailureCount: this.recentFailures.length,
      horizonConsecutiveFailures: this.horizonHealthChecks.length,
    };
  }
}

export default new PaymentAlertingService();
