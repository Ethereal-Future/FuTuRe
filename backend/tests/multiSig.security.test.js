import { describe, expect, it } from 'vitest';
import { normalizeSigner, validateThresholds } from '../src/services/multiSigValidation.js';

describe('multi-signature security validation', () => {
  it('normalizes pre-authorized transaction and SHA-256 hash signers', () => {
    const hash = 'ab'.repeat(32);
    expect(normalizeSigner({ type: 'preAuthTx', preAuthTx: hash, weight: 1 }).signer).toMatchObject(
      {
        preAuthTx: Buffer.from(hash, 'hex'),
        weight: 1,
      },
    );
    expect(
      normalizeSigner({ type: 'sha256Hash', sha256Hash: hash, weight: 2 }).signer,
    ).toMatchObject({
      sha256Hash: Buffer.from(hash, 'hex'),
      weight: 2,
    });
  });

  it('rejects thresholds that exceed available signing weight', () => {
    expect(() => validateThresholds({ low: 1, medium: 2, high: 3 }, 2)).toThrow(
      'Thresholds cannot exceed the total signer weight (2)',
    );
    expect(() => validateThresholds({ low: 3, medium: 2, high: 2 }, 3)).toThrow(
      'Thresholds must be ordered low <= medium <= high',
    );
  });
});
