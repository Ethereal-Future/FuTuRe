/**
 * k6 Load Test — Payment Endpoint
 *
 * Tests the /api/stellar/payment/send endpoint under load.
 * Run: k6 run load-tests/k6/scenarios/payment-endpoint.js
 *
 * Environment variables:
 *   BASE_URL  — default http://localhost:3001
 *   VUS       — virtual users (default 5)
 *   DURATION  — test duration (default 30s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { thresholds } from '../config/thresholds.js';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate = new Rate('payment_error_rate');
const paymentDuration = new Trend('payment_duration', true);
const totalPayments = new Counter('total_payments');

// ── Test config ───────────────────────────────────────────────────────────────
export const options = {
  vus: __ENV.VUS || 5,
  duration: __ENV.DURATION || '30s',
  thresholds: {
    ...thresholds,
    payment_error_rate: ['rate<0.05'],
    payment_duration: ['p(95)<5000', 'p(99)<8000'],
    http_req_duration: ['p(95)<5000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const HEADERS = { 'Content-Type': 'application/json' };

// ── Setup: Create test accounts ──────────────────────────────────────────────
export function setup() {
  // Create sender account
  const senderRes = http.post(`${BASE_URL}/api/stellar/account/create`, null, { headers: HEADERS });
  if (senderRes.status !== 200) {
    throw new Error('Failed to create sender account');
  }
  const sender = JSON.parse(senderRes.body);

  // Create recipient account
  const recipientRes = http.post(`${BASE_URL}/api/stellar/account/create`, null, { headers: HEADERS });
  if (recipientRes.status !== 200) {
    throw new Error('Failed to create recipient account');
  }
  const recipient = JSON.parse(recipientRes.body);

  return { sender, recipient };
}

// ── Main VU function ──────────────────────────────────────────────────────────
export default function (data) {
  totalPayments.add(1);

  const payload = JSON.stringify({
    sourceSecret: data.sender.secretKey,
    destination: data.recipient.publicKey,
    amount: '1',
    assetCode: 'XLM',
    memo: `load-test-${Date.now()}`,
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/stellar/payment/send`, payload, {
    headers: HEADERS,
    tags: { endpoint: 'payment_send' },
  });
  paymentDuration.add(Date.now() - start);

  const ok = check(res, {
    'payment: status 200': (r) => r.status === 200,
    'payment: has hash': (r) => {
      try {
        return !!JSON.parse(r.body).hash;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);

  // Realistic delay between payments
  sleep(1);
}
