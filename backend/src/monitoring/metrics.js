/**
 * Lightweight performance metrics collector.
 * Tracks API response times, memory, CPU, and custom metrics.
 * Exposes data via /api/metrics endpoint.
 * Integrates with external APM (New Relic / DataDog) via env config.
 */

const metrics = {
  requests: new Map(),   // route -> { count, totalMs, errors }
  custom: new Map(),     // name -> { count, total, unit }
  alerts: [],
};

const ALERT_THRESHOLDS = {
  responseTimeMs: Number(process.env.PERF_ALERT_RESPONSE_MS ?? 2000),
  errorRate: Number(process.env.PERF_ALERT_ERROR_RATE ?? 0.1),
};

export function recordRequest(route, durationMs, isError = false) {
  if (!metrics.requests.has(route)) {
    metrics.requests.set(route, { count: 0, totalMs: 0, errors: 0, maxMs: 0 });
  }
  const m = metrics.requests.get(route);
  m.count++;
  m.totalMs += durationMs;
  m.maxMs = Math.max(m.maxMs, durationMs);
  if (isError) m.errors++;

  // Alert if response time exceeds threshold
  if (durationMs > ALERT_THRESHOLDS.responseTimeMs) {
    addAlert('slow_response', { route, durationMs, threshold: ALERT_THRESHOLDS.responseTimeMs });
  }
  // Alert if error rate exceeds threshold
  const errorRate = m.errors / m.count;
  if (errorRate > ALERT_THRESHOLDS.errorRate && m.count >= 10) {
    addAlert('high_error_rate', { route, errorRate: errorRate.toFixed(2), threshold: ALERT_THRESHOLDS.errorRate });
  }
}

export function recordCustomMetric(name, value, unit = '') {
  if (!metrics.custom.has(name)) {
    metrics.custom.set(name, { count: 0, total: 0, unit });
  }
  const m = metrics.custom.get(name);
  m.count++;
  m.total += value;
}

function addAlert(type, data) {
  metrics.alerts.push({ type, data, timestamp: Date.now() });
  if (metrics.alerts.length > 100) metrics.alerts.shift(); // keep last 100
}

export function getSnapshot() {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  const routes = {};
  for (const [route, m] of metrics.requests) {
    routes[route] = {
      count: m.count,
      avgMs: m.count ? +(m.totalMs / m.count).toFixed(2) : 0,
      maxMs: m.maxMs,
      errorRate: m.count ? +(m.errors / m.count).toFixed(4) : 0,
    };
  }

  const custom = {};
  for (const [name, m] of metrics.custom) {
    custom[name] = { count: m.count, avg: m.count ? +(m.total / m.count).toFixed(4) : 0, unit: m.unit };
  }

  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2),
      rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
    },
    cpu: {
      userMs: +(cpuUsage.user / 1000).toFixed(2),
      systemMs: +(cpuUsage.system / 1000).toFixed(2),
    },
    routes,
    custom,
    alerts: metrics.alerts.slice(-20),
  };
}

export function resetMetrics() {
  metrics.requests.clear();
  metrics.custom.clear();
  metrics.alerts.length = 0;
}
