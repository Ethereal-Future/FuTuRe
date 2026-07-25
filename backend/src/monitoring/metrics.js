/**
 * Lightweight performance metrics collector.
 * Tracks API response times, memory, CPU, custom metrics, and business KPIs.
 * Exposes data via /api/metrics endpoint (JSON or Prometheus text format).
 */

const metrics = {
  requests: new Map(),   // route -> { count, totalMs, errors }
  custom: new Map(),     // name -> { count, total, unit }
  alerts: [],
};

// ── Business counters ────────────────────────────────────────────────────────
const counters = {
  payments_total: 0,
  payments_failed_total: 0,
  accounts_created_total: 0,
};

// ── Business gauges ──────────────────────────────────────────────────────────
const gauges = {
  active_streams: 0,
  pending_multisig_transactions: 0,
};

// ── Business histograms ──────────────────────────────────────────────────────
// Each histogram stores { sum, count, buckets: Map<le, count> }
const PAYMENT_AMOUNT_BUCKETS = [1, 10, 100, 1000, 10000, Infinity];
const STELLAR_API_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5, Infinity];

function makeHistogram(bounds) {
  const buckets = new Map(bounds.map((b) => [b, 0]));
  return { sum: 0, count: 0, buckets };
}

const histograms = {
  payment_amount_xlm: makeHistogram(PAYMENT_AMOUNT_BUCKETS),
  stellar_api_duration_seconds: makeHistogram(STELLAR_API_DURATION_BUCKETS),
};

function observeHistogram(name, value) {
  const h = histograms[name];
  if (!h) return;
  h.sum += value;
  h.count += 1;
  for (const [le] of h.buckets) {
    if (value <= le) h.buckets.set(le, h.buckets.get(le) + 1);
  }
}

// ── Public business-metric helpers ───────────────────────────────────────────

export function incrementCounter(name, by = 1) {
  if (name in counters) counters[name] += by;
}

export function setGauge(name, value) {
  if (name in gauges) gauges[name] = value;
}

export function recordPayment({ amountXlm, failed = false }) {
  if (failed) {
    counters.payments_failed_total += 1;
  } else {
    counters.payments_total += 1;
    if (amountXlm != null) observeHistogram('payment_amount_xlm', Number(amountXlm));
  }
}

export function recordStellarApiCall(durationSeconds) {
  observeHistogram('stellar_api_duration_seconds', durationSeconds);
}

export function recordAccountCreated() {
  counters.accounts_created_total += 1;
}

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

// ── Prometheus text format ───────────────────────────────────────────────────

export function toPrometheusText() {
  const lines = [];

  function counter(name, help, value, labels = '') {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
  }

  function gauge(name, help, value, labels = '') {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
  }

  function histogram(name, help, h) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const [le, count] of h.buckets) {
      const leLabel = le === Infinity ? '+Inf' : String(le);
      lines.push(`${name}_bucket{le="${leLabel}"} ${count}`);
    }
    lines.push(`${name}_sum ${h.sum}`);
    lines.push(`${name}_count ${h.count}`);
  }

  // Business counters
  counter('payments_total', 'Total number of successful payments', counters.payments_total);
  counter('payments_failed_total', 'Total number of failed payments', counters.payments_failed_total);
  counter('accounts_created_total', 'Total number of accounts created', counters.accounts_created_total);

  // Business gauges
  gauge('active_streams', 'Number of currently active payment streams', gauges.active_streams);
  gauge('pending_multisig_transactions', 'Number of pending multisig transactions', gauges.pending_multisig_transactions);

  // Business histograms
  histogram('payment_amount_xlm', 'Distribution of payment amounts in XLM', histograms.payment_amount_xlm);
  histogram('stellar_api_duration_seconds', 'Duration of Stellar API calls in seconds', histograms.stellar_api_duration_seconds);

  // Infrastructure: memory
  const mem = process.memoryUsage();
  gauge('nodejs_heap_used_bytes', 'Node.js heap used in bytes', mem.heapUsed);
  gauge('nodejs_heap_total_bytes', 'Node.js heap total in bytes', mem.heapTotal);
  gauge('nodejs_rss_bytes', 'Node.js resident set size in bytes', mem.rss);

  // Infrastructure: uptime
  gauge('nodejs_process_uptime_seconds', 'Node.js process uptime in seconds', process.uptime());

  // Per-route request counters
  lines.push('# HELP http_requests_total Total HTTP requests per route');
  lines.push('# TYPE http_requests_total counter');
  for (const [route, m] of metrics.requests) {
    lines.push(`http_requests_total{route="${route}"} ${m.count}`);
  }
  lines.push('# HELP http_errors_total Total HTTP errors per route');
  lines.push('# TYPE http_errors_total counter');
  for (const [route, m] of metrics.requests) {
    lines.push(`http_errors_total{route="${route}"} ${m.errors}`);
  }

  return lines.join('\n') + '\n';
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
  for (const k of Object.keys(counters)) counters[k] = 0;
  for (const k of Object.keys(gauges)) gauges[k] = 0;
  histograms.payment_amount_xlm = makeHistogram(PAYMENT_AMOUNT_BUCKETS);
  histograms.stellar_api_duration_seconds = makeHistogram(STELLAR_API_DURATION_BUCKETS);
}
