/**
 * Tests for ISSUE-1685: AES-GCM decryption catches auth tag mismatch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, DecryptionAuthenticationError } from '../src/services/encryption.js';

// Provide a test key so loadEncryptionKey() doesn't throw.
const TEST_KEY_HEX = 'a'.repeat(64); // 32 bytes of 0xaa

beforeEach(() => {
  process.env.STELLAR_ENCRYPTION_KEY = TEST_KEY_HEX;
});

describe('encrypt / decrypt round-trip (ISSUE-1685)', () => {
  it('decrypts what it encrypts', () => {
    const plaintext = 'SCZANGBA2PIUSF4YTGGATitle-secret-key';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const p = 'same-plaintext';
    expect(encrypt(p)).not.toBe(encrypt(p));
  });

  it('ciphertext format is <iv>.<tag>.<data> (three base64url segments)', () => {
    const parts = encrypt('test').split('.');
    expect(parts).toHaveLength(3);
    parts.forEach((part) => expect(part).toMatch(/^[A-Za-z0-9_-]+=*$/));
  });
});

describe('DecryptionAuthenticationError (ISSUE-1685)', () => {
  it('is thrown when the ciphertext is tampered', () => {
    const payload = encrypt('sensitive-stellar-key');
    const parts = payload.split('.');
    // Corrupt one byte of the ciphertext segment.
    const corruptedData = Buffer.from(parts[2], 'base64url');
    corruptedData[0] ^= 0xff;
    const tampered = [parts[0], parts[1], corruptedData.toString('base64url')].join('.');

    expect(() => decrypt(tampered)).toThrowError(DecryptionAuthenticationError);
  });

  it('is thrown when the auth tag is tampered', () => {
    const payload = encrypt('another-secret');
    const parts = payload.split('.');
    // Corrupt one byte of the tag segment.
    const corruptedTag = Buffer.from(parts[1], 'base64url');
    corruptedTag[0] ^= 0xff;
    const tampered = [parts[0], corruptedTag.toString('base64url'), parts[2]].join('.');

    expect(() => decrypt(tampered)).toThrowError(DecryptionAuthenticationError);
  });

  it('has the expected error code and name', () => {
    const payload = encrypt('key');
    const parts = payload.split('.');
    const corruptedTag = Buffer.from(parts[1], 'base64url');
    corruptedTag[0] ^= 0x01;
    const tampered = [parts[0], corruptedTag.toString('base64url'), parts[2]].join('.');

    try {
      decrypt(tampered);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.name).toBe('DecryptionAuthenticationError');
      expect(err.code).toBe('DECRYPTION_AUTH_FAILURE');
    }
  });

  it('throws for a malformed payload (wrong number of segments)', () => {
    expect(() => decrypt('onlyone')).toThrow(/Invalid encrypted payload format/);
    expect(() => decrypt('two.parts')).toThrow(/Invalid encrypted payload format/);
  });
});
