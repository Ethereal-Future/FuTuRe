import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_DIR = path.join(__dirname, '../../data/metrics');

class EventAnalytics {
  async initialize() {
    await fs.mkdir(METRICS_DIR, { recursive: true });
  }

  async recordMetric(name, value, tags = {}) {
    await this.initialize();

    const metric = {
      name,
      value,
      tags,
      timestamp: new Date().toISOString()
    };

    const metricsFile = path.join(METRICS_DIR, `${name}.jsonl`);
    await fs.appendFile(metricsFile, JSON.stringify(metric) + '\n');
  }

  async getMetrics(name, limit = 1000) {
    await this.initialize();

    const metricsFile = path.join(METRICS_DIR, `${name}.jsonl`);
    try {
      const content = await fs.readFile(metricsFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .slice(-limit);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async getAnalytics(eventType) {
    await this.initialize();

    try {
      const files = await fs.readdir(METRICS_DIR);
      const typeMetrics = files.filter(f => f.startsWith(eventType));
      const analytics = {
        eventType,
        totalEvents: 0,
        eventsByHour: {},
        eventsByType: {}
      };

      for (const file of typeMetrics) {
        const content = await fs.readFile(path.join(METRICS_DIR, file), 'utf-8');
        const metrics = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        for (const metric of metrics) {
          analytics.totalEvents++;
          const hour = new Date(metric.timestamp).toISOString().slice(0, 13);
          analytics.eventsByHour[hour] = (analytics.eventsByHour[hour] || 0) + 1;
        }
      }

      return analytics;
    } catch (error) {
      console.error('Failed to get analytics:', error);
      return null;
    }
  }

  async getEventStats() {
    await this.initialize();

    try {
      const files = await fs.readdir(METRICS_DIR);
      const stats = {};

      for (const file of files) {
        const content = await fs.readFile(path.join(METRICS_DIR, file), 'utf-8');
        const metrics = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        const eventType = file.replace('.jsonl', '');
        stats[eventType] = {
          count: metrics.length,
          lastOccurrence: metrics[metrics.length - 1]?.timestamp
        };
      }

      return stats;
    } catch (error) {
      console.error('Failed to get event stats:', error);
      return {};
    }
  }
}

export default new EventAnalytics();
