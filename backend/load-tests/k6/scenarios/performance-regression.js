/**
 * k6 Load Test — Performance Regression Gate
 *
 * Designed to run in CI. Fails the build if thresholds are breached.
 * Keeps load light (10 VUs, 30s) — just enough to catch regressions.
 *
 * Run: k6 run load-tests/k6/scenarios/performance-regression.js
 * Exit code 0 = pass, non-zero = regression detected.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('regression_error_rate');
const p95Health = new Trend('p95_health_ms', true);
const p95Create = new Trend('p95_create_ms', true);
const p95Status = new Trend('p95_status_ms', true);

// ── Strict CI thresholds ──────────────────────────────────────────────────────
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    // Error rate must stay below 1%
    regression_error_rate: ['rate<0.01'],
    // p95 latency budgets per endpoint
    p95_health_ms:  ['p(95)<200'],
    p95_create_ms:  ['p(95)<3000'],
    p95_status_ms:  ['p(95)<500'],
    // Overall http_req_duration
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    // At least 95% of requests must succeed
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Health
  {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/health`);
    p95Health.add(Date.now() - start);
    errorRate.add(!check(res, { 'health 200': (r) => r.status === 200 }));
  }

  sleep(0.1);

  // Network status
  {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/stellar/network/status`);
    p95Status.add(Date.now() - start);
    errorRate.add(!check(res, { 'status 200': (r) => r.status === 200 }));
  }

  sleep(0.1);

  // Account creation
  {
    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/stellar/account/create`, null, {
      headers: { 'Content-Type': 'application/json' },
    });
    p95Create.add(Date.now() - start);
    errorRate.add(!check(res, {
      'create 200':    (r) => r.status === 200,
      'has publicKey': (r) => !!JSON.parse(r.body).publicKey,
    }));
  }

  sleep(0.3);
}
