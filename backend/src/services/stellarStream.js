/**
 * backend/src/services/stellarStream.js
 *
 * SSE-based listener for incoming Stellar payment events via Horizon.
 *
 * Fix for ISSUE-309: The previous onerror handler reconnected synchronously
 * on every failure, exhausting file descriptors (EMFILE) during Horizon
 * restarts. This module now applies exponential backoff with randomized jitter
 * (1 s base, 60 s cap) before each reconnection attempt.
 */

import { horizonServer } from '../config/stellar.js';
import logger from '../config/logger.js';

/** Minimum delay (ms) before the first reconnection attempt. */
const BACKOFF_BASE_MS = 1_000;

/** Maximum delay (ms) between reconnection attempts. */
const BACKOFF_MAX_MS = 60_000;

/**
 * Compute the next backoff interval using exponential backoff with full jitter.
 *
 * Formula: random value in [0, min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2^attempt)]
 *
 * @param {number} attempt - Zero-based reconnection attempt index.
 * @returns {number} Milliseconds to wait before the next attempt.
 */
export function computeBackoff(attempt) {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  return Math.floor(Math.random() * ceiling);
}

/**
 * Open an SSE stream that calls `onPayment` for each incoming payment directed
 * at `publicKey`. Reconnects automatically with exponential backoff on error.
 *
 * @param {string}   publicKey  - Stellar public key to monitor.
 * @param {Function} onPayment  - Called with each payment record.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {{ close: () => void }} Handle whose `close()` stops reconnection.
 */
export function listenForPayments(publicKey, onPayment, { signal } = {}) {
  let attempt = 0;
  let timeoutId = null;
  let closeStream = null;
  let stopped = false;

  function stop() {
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (typeof closeStream === 'function') {
      closeStream();
      closeStream = null;
    }
  }

  signal?.addEventListener('abort', stop, { once: true });

  function connect() {
    if (stopped) return;

    closeStream = horizonServer
      .payments()
      .forAccount(publicKey)
      .stream({
        onmessage(payment) {
          attempt = 0; // reset backoff on successful message
          try {
            onPayment(payment);
          } catch (err) {
            logger.error('stellarStream.onPayment.error', {
              publicKey,
              error: err.message,
            });
          }
        },

        onerror(err) {
          if (stopped) return;

          const delay = computeBackoff(attempt);
          logger.warn('stellarStream.reconnect', {
            publicKey,
            attempt,
            delayMs: delay,
            error: err?.message ?? String(err),
          });

          attempt += 1;

          // Close the current EventSource before scheduling the reconnect to
          // release the file descriptor immediately rather than waiting for GC.
          if (typeof closeStream === 'function') {
            closeStream();
            closeStream = null;
          }

          timeoutId = setTimeout(() => {
            timeoutId = null;
            connect();
          }, delay);
        },
      });
  }

  connect();

  return { close: stop };
}
