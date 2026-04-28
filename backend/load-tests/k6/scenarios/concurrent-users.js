/**
 * k6 Load Test — Concurrent User Scenarios
 *
 * Simulates realistic concurrent user behaviour:
 * - Ramp up to peak load
 * - Sustain peak
 * - Ramp down
 *
 * Run: k6 run load-tests/k6/scenarios/concurrent-users.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { thresholds } from '../config/thresholds.js';

const errorRate    = new Rate('concurrent_error_rate');
const sessionTime  = new Trend('user_session_duration', true);

export const options = {
  scenarios: {
    // Scenario A: steady low load
    steady_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      tags: { scenario: 'steady' },
    },
    // Scenario B: ramping load
    ramping_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      tags: { scenario: 'ramping' },
    },
    // Scenario C: spike test
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages: [
        { duration: '5s',  target: 1  },
        { duration: '5s',  target: 30 }, // spike
        { duration: '10s', target: 5  }, // recover
      ],
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    ...thresholds,
    concurrent_error_rate: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const HEADERS  = { 'Content-Type': 'application/json' };

export default function () {
  const sessionStart = Date.now();

  group('user session', () => {
    // Step 1: check network
    group('check network', () => {
      const res = http.get(`${BASE_URL}/api/stellar/network/status`);
      const ok = check(res, { 'network online': (r) => r.status === 200 });
      errorRate.add(!ok);
    });

    sleep(0.2);

    // Step 2: create account
    let account = null;
    group('create account', () => {
      const res = http.post(`${BASE_URL}/api/stellar/account/create`, null, { headers: HEADERS });
      const ok = check(res, {
        'account created':   (r) => r.status === 200,
        'has public key':    (r) => !!JSON.parse(r.body).publicKey,
      });
      errorRate.add(!ok);
      if (ok) account = JSON.parse(res.body);
    });

    sleep(0.3);

    // Step 3: check exchange rate (read-heavy, concurrent-safe)
    group('exchange rate', () => {
      const res = http.get(`${BASE_URL}/api/stellar/exchange-rate/XLM/USD`);
      const ok = check(res, { 'rate returned': (r) => r.status === 200 });
      errorRate.add(!ok);
    });

    sleep(0.2);

    // Step 4: health check
    group('health check', () => {
      const res = http.get(`${BASE_URL}/health`);
      const ok = check(res, { 'healthy': (r) => r.status === 200 });
      errorRate.add(!ok);
    });
  });

  sessionTime.add(Date.now() - sessionStart);
  sleep(0.5);
}
