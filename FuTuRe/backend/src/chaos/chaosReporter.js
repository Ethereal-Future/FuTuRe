import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '../../data/chaos/reports');

class ChaosReporter {
  async generateReport(experimentId, results, metrics) {
    await fs.mkdir(REPORTS_DIR, { recursive: true });

    const report = {
      experimentId,
      timestamp: new Date().toISOString(),
      duration: results.endTime - results.startTime,
      results: {
        status: results.status,
        failuresInjected: results.failuresInjected || 0,
        servicesAffected: results.servicesAffected || [],
        errorRate: results.errorRate || 0,
        downtime: results.downtime || 0
      },
      metrics: {
        mttr: metrics.mttr,
        mtbf: metrics.mtbf,
        availability: metrics.availability,
        recoveryTime: metrics.recoveryTime
      },
      insights: this.generateInsights(results, metrics),
      recommendations: this.generateRecommendations(results, metrics)
    };

    const file = path.join(REPORTS_DIR, `report-${experimentId}-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(report, null, 2));

    return report;
  }

  generateInsights(results, metrics) {
    const insights = [];

    if (metrics.availability < 99.9) {
      insights.push({
        severity: 'HIGH',
        message: `Availability (${metrics.availability}%) is below 99.9% SLA target`
      });
    }

    if (metrics.mttr > 60000) {
      insights.push({
        severity: 'MEDIUM',
        message: `MTTR (${Math.round(metrics.mttr / 1000)}s) is high, recovery process needs optimization`
      });
    }

    if (results.errorRate > 5) {
      insights.push({
        severity: 'HIGH',
        message: `Error rate (${results.errorRate}%) exceeds acceptable threshold`
      });
    }

    if (results.servicesAffected.length > 3) {
      insights.push({
        severity: 'CRITICAL',
        message: `${results.servicesAffected.length} services affected - blast radius too large`
      });
    }

    return insights;
  }

  generateRecommendations(results, metrics) {
    const recommendations = [];

    if (metrics.mttr > 60000) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Improve recovery procedures',
        details: 'Implement automated recovery mechanisms and reduce manual intervention'
      });
    }

    if (results.errorRate > 5) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Improve error handling',
        details: 'Add circuit breakers and retry logic with exponential backoff'
      });
    }

    if (results.servicesAffected.length > 3) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'Reduce blast radius',
        details: 'Implement service isolation and bulkheads to limit failure propagation'
      });
    }

    if (metrics.availability < 99.9) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Improve reliability',
        details: 'Implement redundancy and failover mechanisms'
      });
    }

    return recommendations;
  }

  async getReports(experimentId = null, limit = 10) {
    try {
      await fs.mkdir(REPORTS_DIR, { recursive: true });
      const files = await fs.readdir(REPORTS_DIR);
      let matching = files;

      if (experimentId) {
        matching = files.filter(f => f.includes(experimentId));
      }

      const reports = [];
      for (const file of matching.sort().reverse().slice(0, limit)) {
        const content = await fs.readFile(path.join(REPORTS_DIR, file), 'utf-8');
        reports.push(JSON.parse(content));
      }

      return reports;
    } catch (error) {
      return [];
    }
  }

  async generateSummaryReport(experimentIds = null) {
    const reports = await this.getReports(null, 100);
    let filtered = reports;

    if (experimentIds) {
      filtered = reports.filter(r => experimentIds.includes(r.experimentId));
    }

    const summary = {
      totalExperiments: filtered.length,
      averageAvailability: filtered.length > 0 
        ? (filtered.reduce((sum, r) => sum + parseFloat(r.metrics.availability), 0) / filtered.length).toFixed(2)
        : 0,
      averageMTTR: filtered.length > 0
        ? Math.round(filtered.reduce((sum, r) => sum + r.metrics.mttr, 0) / filtered.length)
        : 0,
      criticalIssues: filtered.flatMap(r => r.insights.filter(i => i.severity === 'CRITICAL')).length,
      highIssues: filtered.flatMap(r => r.insights.filter(i => i.severity === 'HIGH')).length,
      timestamp: new Date().toISOString()
    };

    return summary;
  }
}

export default new ChaosReporter();
