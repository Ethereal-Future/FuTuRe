/**
 * Shared k6 threshold and stage configuration.
 * Import into individual scenario files.
 */

/** Default ramp-up → sustain → ramp-down stages */
export const stages = [
  { duration: '10s', target: 5  }, // ramp up
  { duration: '20s', target: 10 }, // sustain
  { duration: '10s', target: 0  }, // ramp down
];

/**
 * Shared performance thresholds applied to all scenarios.
 * These are the baseline SLOs for the Stellar API.
 */
export const thresholds = {
  // 95th percentile of all requests must complete within 3s
  http_req_duration: ['p(95)<3000', 'p(99)<5000'],
  // Less than 1% of requests may fail
  http_req_failed: ['rate<0.01'],
  // At least 1 req/s throughput
  http_reqs: ['rate>1'],
};
