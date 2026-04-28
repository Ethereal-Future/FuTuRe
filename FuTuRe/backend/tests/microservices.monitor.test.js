/**
 * Example: Service Monitoring
 */

import { describe, it, expect } from 'vitest';
import { createServiceMonitor } from '../src/microservices/monitor.js';

describe('Service Monitoring', () => {
  it('should record metrics', () => {
    const monitor = createServiceMonitor();

    monitor.recordMetric('user-service', 'response_time', 100);
    monitor.recordMetric('user-service', 'response_time', 150);

    const metrics = monitor.getMetrics('user-service');
    expect(metrics.response_time).toBeDefined();
    expect(metrics.response_time.count).toBe(2);
  });

  it('should register health checks', () => {
    const monitor = createServiceMonitor();

    monitor.registerHealthCheck('user-service', async () => true);

    expect(monitor.healthChecks.has('user-service')).toBe(true);
  });

  it('should check service health', async () => {
    const monitor = createServiceMonitor();

    monitor.registerHealthCheck('user-service', async () => true);

    const health = await monitor.checkHealth('user-service');

    expect(health.service).toBe('user-service');
    expect(health.status).toBe('healthy');
  });

  it('should check all services health', async () => {
    const monitor = createServiceMonitor();

    monitor.registerHealthCheck('user-service', async () => true);
    monitor.registerHealthCheck('order-service', async () => false);

    const results = await monitor.checkAllHealth();

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('healthy');
    expect(results[1].status).toBe('unhealthy');
  });

  it('should add alerts', () => {
    const monitor = createServiceMonitor();

    monitor.addAlert('user-service', 'warning', 'High response time');
    monitor.addAlert('user-service', 'error', 'Service down');

    const alerts = monitor.getAlerts();
    expect(alerts).toHaveLength(2);
  });
});
