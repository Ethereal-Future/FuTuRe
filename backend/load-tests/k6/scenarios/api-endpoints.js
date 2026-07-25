/**
 * k6 Load Test — API Endpoint Performance
 *
 * Tests all Stellar API endpoints under load.
 * Run: k6 run load-tests/k6/scenarios/api-endpoints.js
 *
 * Environment variables:
 *   BASE_URL  — default http://localhost:3001
 *   VUS       — virtual users (default 10)
 *   DURATION  — test duration (default 30s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { thresholds, stages } from '../config/thresholds.js';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate       = new Rate('error_rate');
const createAccountDuration = new Trend('create_account_duration', true);
const getBalanceDuration    = new Trend('get_balance_duration', true);
const networkStatusDuration = new Trend('network_status_duration', true);
const totalRequests   = new Counter('total_requests');

// ── Test config ───────────────────────────────────────────────────────────────
export const options = {
  stages,
  thresholds: {
    ...thresholds,
    create_account_duration: ['p(95)<2000'],
    get_balance_duration:    ['p(95)<1000'],
    network_status_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const HEADERS  = { 'Content-Type': 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────
function tag(name) { return { tags: { endpoint: name } }; }

// ── Main VU function ──────────────────────────────────────────────────────────
export default function () {
  totalRequests.add(1);

  // 1. Health check
  {
    const res = http.get(`${BASE_URL}/health`, tag('health'));
    const ok = check(res, {
      'health: status 200':        (r) => r.status === 200,
      'health: body has status ok': (r) => JSON.parse(r.body).status === 'ok',
    });
    errorRate.add(!ok);
  }

  sleep(0.1);

  // 2. Network status
  {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/stellar/network/status`, tag('network_status'));
    networkStatusDuration.add(Date.now() - start);
    const ok = check(res, {
      'network/status: status 200':    (r) => r.status === 200,
      'network/status: has online key': (r) => JSON.parse(r.body).hasOwnProperty('online'),
    });
    errorRate.add(!ok);
  }

  sleep(0.1);

  // 3. Create account
  {
    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/stellar/account/create`, null, {
      headers: HEADERS,
      ...tag('create_account'),
    });
    createAccountDuration.add(Date.now() - start);
    const ok = check(res, {
      'create_account: status 200':      (r) => r.status === 200,
      'create_account: has publicKey':   (r) => !!JSON.parse(r.body).publicKey,
      'create_account: has secretKey':   (r) => !!JSON.parse(r.body).secretKey,
    });
    errorRate.add(!ok);
  }

  sleep(0.2);

  // 4. Exchange rate
  {
    const res = http.get(`${BASE_URL}/api/stellar/exchange-rate/XLM/USD`, tag('exchange_rate'));
    const ok = check(res, {
      'exchange_rate: status 200': (r) => r.status === 200,
      'exchange_rate: has rate':   (r) => JSON.parse(r.body).hasOwnProperty('rate'),
    });
    errorRate.add(!ok);
  }

  sleep(0.1);

  // 5. Validation — invalid public key (expect 422)
  {
    const res = http.get(`${BASE_URL}/api/stellar/account/INVALID_KEY`, tag('validation'));
    const ok = check(res, {
      'validation: returns 422': (r) => r.status === 422,
    });
    errorRate.add(!ok);
  }

  sleep(0.3);
}
