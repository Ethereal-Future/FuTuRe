/**
 * backend/src/eventSourcing/eventValidator.js
 *
 * Validates domain event envelopes before they are appended to the event store.
 *
 * Fix for ISSUE-313: The previous validator did not require `aggregateId`,
 * allowing events without aggregate context to be persisted. Such events break
 * stream rehydration because there is no key under which they can be replayed.
 * This module now enforces a strict UUID/non-empty-string check on `aggregateId`
 * and rejects any envelope that is missing or carries a null/empty value.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when a domain event envelope fails schema validation.
 * Includes a `details` array of Zod issue objects for structured error reporting.
 */
export class EventValidationError extends Error {
  /**
   * @param {string} message
   * @param {import('zod').ZodIssue[]} issues
   */
  constructor(message, issues = []) {
    super(message);
    this.name = 'EventValidationError';
    this.code = 'EVENT_VALIDATION_FAILED';
    this.statusCode = 400;
    this.details = issues;
  }
}

// ---------------------------------------------------------------------------
// Envelope schema
// ---------------------------------------------------------------------------

/**
 * Loose UUID pattern that also accepts any non-empty string identifier.
 * Accepts both canonical UUIDs and application-specific composite keys.
 */
const aggregateIdSchema = z
  .string({ required_error: 'aggregateId is required' })
  .trim()
  .min(1, 'aggregateId must not be empty');

/**
 * Full envelope schema. Every field that the event store requires before
 * appending an event must be validated here.
 *
 * - `aggregateId` — required, non-empty string (enforces ISSUE-313 fix)
 * - `type`        — required, non-empty event-type name
 * - `data`        — required object (may be empty `{}`)
 * - `metadata`    — optional arbitrary key/value bag
 */
export const eventEnvelopeSchema = z.object({
  aggregateId: aggregateIdSchema,
  type: z
    .string({ required_error: 'type is required' })
    .trim()
    .min(1, 'type must not be empty'),
  data: z
    .record(z.unknown())
    .or(z.object({}).passthrough())
    .default({}),
  metadata: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a domain event envelope.
 *
 * Returns the parsed (and coerced) envelope on success. Throws an
 * `EventValidationError` on failure so callers can respond with 400 and
 * structured error details without catching generic errors.
 *
 * @param {unknown} envelope - Raw envelope object from the caller.
 * @returns {{ aggregateId: string, type: string, data: Record<string, unknown>, metadata?: Record<string, unknown> }}
 * @throws {EventValidationError}
 */
export function validateEventEnvelope(envelope) {
  const result = eventEnvelopeSchema.safeParse(envelope);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new EventValidationError(
      firstIssue?.message ?? 'Invalid event envelope',
      result.error.issues,
    );
  }

  return result.data;
}

/**
 * Returns `true` when the envelope is valid, `false` otherwise.
 * Useful in guard clauses that prefer a boolean check over exception handling.
 *
 * @param {unknown} envelope
 * @returns {boolean}
 */
export function isValidEventEnvelope(envelope) {
  return eventEnvelopeSchema.safeParse(envelope).success;
}
