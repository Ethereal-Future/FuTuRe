import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifySignature, signPayload } from './verifySignature.js';

const SECRET = 'test-signing-secret';
const PAYLOAD = JSON.stringify({ event: 'delivery.created', id: 'evt_123' });

function headerFor(payload, secret) {
  return `sha256=${signPayload(secret, payload)}`;
}

describe('verifySignature', () => {
  it('accepts a matching signature', () => {
    const header = headerFor(PAYLOAD, SECRET);
    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  it('accepts a matching signature without the sha256= prefix', () => {
    const header = signPayload(SECRET, PAYLOAD);
    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  it('rejects a mismatched signature', () => {
    const header = headerFor(PAYLOAD, 'wrong-secret');
    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  it('rejects a signature for a different payload', () => {
    const header = headerFor('other-payload', SECRET);
    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(() => verifySignature(PAYLOAD, 'sha256=deadbeef', SECRET)).not.toThrow();
    expect(verifySignature(PAYLOAD, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('rejects malformed headers safely', () => {
    const malformed = [
      '',
      'sha256=',
      'sha256=zzzz',
      'not-a-signature',
      'sha256=abc123',
    ];
    for (const header of malformed) {
      expect(() => verifySignature(PAYLOAD, header, SECRET)).not.toThrow();
      expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
    }
  });

  it('rejects non-string signature headers safely', () => {
    for (const header of [undefined, null, 12345, {}]) {
      expect(() => verifySignature(PAYLOAD, header, SECRET)).not.toThrow();
      expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
    }
  });

  it('uses constant-time comparison via crypto.timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const header = headerFor(PAYLOAD, SECRET);
    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
