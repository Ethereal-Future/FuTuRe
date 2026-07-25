/**
 * Simple circuit breaker for Stellar Horizon calls.
 *
 * States:
 *  CLOSED  — normal operation; failures are counted.
 *  OPEN    — failing fast; all calls return 503 immediately.
 *  HALF    — one probe request allowed; resets on success, opens on failure.
 *
 * Config (env vars):
 *  CIRCUIT_FAILURE_THRESHOLD  — consecutive failures to open circuit (default: 5)
 *  CIRCUIT_WINDOW_MS          — window in which failures must occur (default: 30000)
 *  CIRCUIT_PROBE_INTERVAL_MS  — probe interval when open (default: 30000)
 */

const FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD ?? '5', 10);
const WINDOW_MS = parseInt(process.env.CIRCUIT_WINDOW_MS ?? '30000', 10);
const PROBE_INTERVAL_MS = parseInt(process.env.CIRCUIT_PROBE_INTERVAL_MS ?? '30000', 10);

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF: 'HALF_OPEN' };

let state = STATE.CLOSED;
let failures = 0;
let windowStart = Date.now();
let openedAt = null;
let probeTimer = null;

function scheduleProbe() {
  clearTimeout(probeTimer);
  probeTimer = setTimeout(() => {
    state = STATE.HALF;
  }, PROBE_INTERVAL_MS);
  // Don't keep the process alive just for the probe
  if (probeTimer.unref) probeTimer.unref();
}

function recordSuccess() {
  failures = 0;
  windowStart = Date.now();
  openedAt = null;
  state = STATE.CLOSED;
  clearTimeout(probeTimer);
}

function recordFailure() {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    // Reset window
    failures = 1;
    windowStart = now;
    return;
  }
  failures += 1;
  if (failures >= FAILURE_THRESHOLD) {
    state = STATE.OPEN;
    openedAt = now;
    scheduleProbe();
  }
}

/** Execute fn through the circuit breaker. */
export async function callWithCircuitBreaker(fn) {
  if (state === STATE.OPEN) {
    const err = new Error('Horizon circuit breaker is open — service unavailable');
    err.circuitOpen = true;
    throw err;
  }

  const wasHalf = state === STATE.HALF;
  if (wasHalf) {
    // Only one probe allowed; re-open immediately if another call sneaks in
    state = STATE.OPEN;
    scheduleProbe();
  }

  try {
    const result = await fn();
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure();
    throw err;
  }
}

/** Return a snapshot of circuit state for health/monitoring. */
export function getCircuitState() {
  return {
    state,
    failures,
    openedAt: openedAt ? new Date(openedAt).toISOString() : null,
  };
}

/** Reset circuit (useful in tests). */
export function resetCircuit() {
  clearTimeout(probeTimer);
  state = STATE.CLOSED;
  failures = 0;
  windowStart = Date.now();
  openedAt = null;
}
