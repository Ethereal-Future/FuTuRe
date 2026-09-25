'use strict';

/**
 * Lightweight in-process metrics registry.
 *
 * Counters are kept in memory and exposed via `snapshot()` so they can be
 * scraped by the metrics endpoint or flushed to an external system.
 */

const counters = new Map();

/**
 * Increment a named counter.
 *
 * @param {string} name  Metric name, e.g. `aml_alert_persistence_failures_total`.
 * @param {number} [value=1] Amount to add.
 * @param {Object} [labels] Optional label set (currently unused, reserved for future use).
 */
function increment(name, value = 1, labels) {
  if (!name) return;
  const current = counters.get(name) || 0;
  counters.set(name, current + value);
  if (labels) {
    // Labels are accepted for API compatibility; aggregation is by name only.
  }
}

/**
 * Read the current value of a counter.
 *
 * @param {string} name
 * @returns {number}
 */
function get(name) {
  return counters.get(name) || 0;
}

/**
 * Return a plain object snapshot of all counters.
 *
 * @returns {Object<string, number>}
 */
function snapshot() {
  const out = {};
  for (const [name, value] of counters.entries()) {
    out[name] = value;
  }
  return out;
}

/**
 * Reset all counters. Primarily useful in tests.
 */
function reset() {
  counters.clear();
}

module.exports = {
  increment,
  get,
  snapshot,
  reset,
};
