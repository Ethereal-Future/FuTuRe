/**
 * Tests for ISSUE-1687: eventValidator rejects null/missing aggregateId.
 */
import { describe, it, expect } from 'vitest';
import {
  validateEventEnvelope,
  isValidEventEnvelope,
  EventValidationError,
} from '../src/eventSourcing/eventValidator.js';

describe('validateEventEnvelope (ISSUE-1687)', () => {
  it('accepts a well-formed envelope', () => {
    const result = validateEventEnvelope({
      aggregateId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'AccountCreated',
      data: { publicKey: 'GCEZWKCA' },
    });
    expect(result.aggregateId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.type).toBe('AccountCreated');
  });

  it('throws EventValidationError when aggregateId is missing', () => {
    expect(() =>
      validateEventEnvelope({ type: 'AccountCreated', data: {} }),
    ).toThrowError(EventValidationError);
  });

  it('throws EventValidationError when aggregateId is null', () => {
    expect(() =>
      validateEventEnvelope({ aggregateId: null, type: 'AccountCreated', data: {} }),
    ).toThrowError(EventValidationError);
  });

  it('throws EventValidationError when aggregateId is an empty string', () => {
    expect(() =>
      validateEventEnvelope({ aggregateId: '', type: 'AccountCreated', data: {} }),
    ).toThrowError(EventValidationError);
  });

  it('throws EventValidationError when aggregateId is whitespace only', () => {
    expect(() =>
      validateEventEnvelope({ aggregateId: '   ', type: 'AccountCreated', data: {} }),
    ).toThrowError(EventValidationError);
  });

  it('throws EventValidationError when type is missing', () => {
    expect(() =>
      validateEventEnvelope({ aggregateId: 'agg-1', data: {} }),
    ).toThrowError(EventValidationError);
  });

  it('error has statusCode 400', () => {
    try {
      validateEventEnvelope({ type: 'AccountCreated', data: {} });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('EVENT_VALIDATION_FAILED');
    }
  });

  it('error includes details array with Zod issues', () => {
    try {
      validateEventEnvelope({ type: 'AccountCreated', data: {} });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(Array.isArray(err.details)).toBe(true);
      expect(err.details.length).toBeGreaterThan(0);
    }
  });

  it('defaults data to {} when omitted', () => {
    const result = validateEventEnvelope({
      aggregateId: 'agg-1',
      type: 'SomeEvent',
    });
    expect(result.data).toEqual({});
  });

  it('accepts non-UUID string identifiers', () => {
    const result = validateEventEnvelope({
      aggregateId: 'account:alice:v2',
      type: 'PaymentSent',
      data: { amount: '10' },
    });
    expect(result.aggregateId).toBe('account:alice:v2');
  });
});

describe('isValidEventEnvelope (ISSUE-1687)', () => {
  it('returns true for valid envelopes', () => {
    expect(
      isValidEventEnvelope({ aggregateId: 'agg-1', type: 'T', data: {} }),
    ).toBe(true);
  });

  it('returns false when aggregateId is missing', () => {
    expect(isValidEventEnvelope({ type: 'T', data: {} })).toBe(false);
  });

  it('returns false when aggregateId is null', () => {
    expect(isValidEventEnvelope({ aggregateId: null, type: 'T', data: {} })).toBe(false);
  });

  it('returns false when aggregateId is empty', () => {
    expect(isValidEventEnvelope({ aggregateId: '', type: 'T', data: {} })).toBe(false);
  });
});
