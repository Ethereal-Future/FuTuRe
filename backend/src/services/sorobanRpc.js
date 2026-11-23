import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../config/logger.js';

/**
 * Decode a Soroban simulation error from the RPC response.
 *
 * When `simulateTransaction` returns an error result, the payload contains:
 *   - `error`: a human-readable contract abort message
 *   - `diagnosticEventsXdr`: base64-encoded diagnostic events that detail the
 *     contract execution trace leading up to the failure
 *
 * This function extracts both fields and returns a structured object so callers
 * can surface a descriptive message instead of swallowing the failure as a
 * generic 500.
 *
 * @param {object} simulationResult - Raw response object from `server.simulateTransaction()`
 * @returns {{ isError: boolean, errorMessage: string, diagnosticEvents: string[] }}
 */
export function decodeSimulationError(simulationResult) {
  if (!simulationResult) {
    return { isError: false, errorMessage: null, diagnosticEvents: [] };
  }

  // The Stellar SDK marks failed simulations with a top-level `error` string.
  const rawError = simulationResult.error;
  if (!rawError) {
    return { isError: false, errorMessage: null, diagnosticEvents: [] };
  }

  const diagnosticEvents = [];

  // `diagnosticEventsXdr` is an array of base64-encoded XDR DiagnosticEvent entries.
  const xdrEvents = simulationResult.diagnosticEventsXdr ?? simulationResult.events ?? [];
  for (const xdrEntry of xdrEvents) {
    try {
      const decoded = StellarSDK.xdr.DiagnosticEvent.fromXDR(xdrEntry, 'base64');
      // Convert to a readable JSON representation so the client UI can display it.
      const eventJson = decoded.toXDR('base64'); // keep as base64 for serialisation
      diagnosticEvents.push(eventJson);
    } catch (decodeErr) {
      // If a single event cannot be decoded, include the raw value with a note
      // rather than aborting the whole decode pass.
      logger.warn('sorobanRpc.decodeSimulationError.eventDecodeFailure', {
        raw: xdrEntry,
        error: decodeErr.message,
      });
      diagnosticEvents.push(xdrEntry);
    }
  }

  return {
    isError: true,
    errorMessage: String(rawError),
    diagnosticEvents,
  };
}

/**
 * Simulate a Soroban transaction and throw a descriptive error on simulation failure.
 *
 * Without this wrapper every simulation failure bubbles up as a generic 500 because
 * the raw RPC error object is not inspected. This function:
 *   1. Runs `server.simulateTransaction(tx)`.
 *   2. Calls `decodeSimulationError` on the result.
 *   3. Throws a structured `SorobanSimulationError` whose `message` and
 *      `diagnosticEvents` fields can be forwarded directly to the client.
 *
 * @param {import('@stellar/stellar-sdk').SorobanRpc.Server} server
 * @param {import('@stellar/stellar-sdk').Transaction} tx
 * @returns {Promise<import('@stellar/stellar-sdk').SorobanRpc.SimulateTransactionResponse>}
 * @throws {SorobanSimulationError} when simulation reports an error
 */
export async function simulateAndDecode(server, tx) {
  const result = await server.simulateTransaction(tx);

  const { isError, errorMessage, diagnosticEvents } = decodeSimulationError(result);

  if (isError) {
    logger.warn('sorobanRpc.simulation.failed', {
      error: errorMessage,
      diagnosticEventCount: diagnosticEvents.length,
    });

    const err = new SorobanSimulationError(errorMessage, diagnosticEvents);
    throw err;
  }

  return result;
}

/**
 * Structured error thrown when Soroban transaction simulation fails.
 *
 * Carries the decoded contract abort message and any diagnostic event XDR
 * strings so upstream error handlers can return them verbatim to the caller.
 */
export class SorobanSimulationError extends Error {
  /**
   * @param {string} message - Human-readable contract error string from the RPC response
   * @param {string[]} diagnosticEvents - Array of base64 XDR diagnostic event strings
   */
  constructor(message, diagnosticEvents = []) {
    super(message);
    this.name = 'SorobanSimulationError';
    this.status = 422;
    this.statusCode = 422;
    this.diagnosticEvents = diagnosticEvents;
  }
}
