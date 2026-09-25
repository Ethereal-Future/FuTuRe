/**
 * Tests for ISSUE-060: AES-256-GCM key rotation and versioned ciphertext
 *
 * WARNING: Do NOT run these tests against a production database.
 * All tests are pure unit tests — no DB or network access required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a fresh random 32-byte hex key string. */
function randomHexKey() {
  return randomBytes(32).toString('hex');
}

// Save / restore env around each test
let savedEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
});
afterEach(() => {
  process.env = savedEnv;
  vi.resetModules(); // force fresh module load so getKeyRing() re-reads env
});

async function loadEncryption() {
  return import('../src/db/encryption.js');
}

// ── getKeyRing() ──────────────────────────────────────────────────────────────

describe('ISSUE-060: getKeyRing()', () => {
  it('throws when DATABASE_ENCRYPTION_KEY is absent', async () => {
    delete process.env.DATABASE_ENCRYPTION_KEY;
    const { getKeyRing } = await loadEncryption();
    expect(() => getKeyRing()).toThrow('DATABASE_ENCRYPTION_KEY environment variable is required');
  });

  it('throws when the key is not 32 bytes (64 hex chars)', async () => {
    process.env.DATABASE_ENCRYPTION_KEY = 'tooshort';
    const { getKeyRing } = await loadEncryption();
    expect(() => getKeyRing()).toThrow();
  });

  it('returns currentKeyId "1" by default', async () => {
    process.env.DATABASE_ENCRYPTION_KEY = randomHexKey();
    delete process.env.DATABASE_ENCRYPTION_KEY_ID;
    const { getKeyRing } = await loadEncryption();
    const ring = getKeyRing();
    expect(ring.currentKeyId).toBe('1');
  });

  it('respects DATABASE_ENCRYPTION_KEY_ID', async () => {
    process.env.DATABASE_ENCRYPTION_KEY = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY_ID = '3';
    const { getKeyRing } = await loadEncryption();
    const ring = getKeyRing();
    expect(ring.currentKeyId).toBe('3');
    expect(ring.keys['3']).toBeInstanceOf(Buffer);
  });

  it('merges DATABASE_ENCRYPTION_KEY_RING with the current key', async () => {
    const k1 = randomHexKey();
    const k2 = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY = k2;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '2';
    process.env.DATABASE_ENCRYPTION_KEY_RING = JSON.stringify({ '1': k1 });
    const { getKeyRing } = await loadEncryption();
    const ring = getKeyRing();
    expect(ring.keys['1']).toBeInstanceOf(Buffer);
    expect(ring.keys['2']).toBeInstanceOf(Buffer);
  });

  it('throws on malformed DATABASE_ENCRYPTION_KEY_RING JSON', async () => {
    process.env.DATABASE_ENCRYPTION_KEY = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY_RING = 'not-json';
    const { getKeyRing } = await loadEncryption();
    expect(() => getKeyRing()).toThrow('DATABASE_ENCRYPTION_KEY_RING must be valid JSON');
  });
});

// ── encrypt() / decrypt() — versioned format ─────────────────────────────────

describe('ISSUE-060: encrypt() and decrypt()', () => {
  beforeEach(() => {
    process.env.DATABASE_ENCRYPTION_KEY = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY_ID = '1';
    delete process.env.DATABASE_ENCRYPTION_KEY_RING;
  });

  it('produces a versioned ciphertext starting with v<keyId>:', async () => {
    const { encrypt } = await loadEncryption();
    const ct = encrypt('hello world');
    expect(ct).toMatch(/^v1:/);
  });

  it('roundtrips plaintext correctly', async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plain = 'sensitive data 🔐';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('every encrypt() call produces a unique ciphertext (IV uniqueness)', async () => {
    const { encrypt } = await loadEncryption();
    const ct1 = encrypt('same plaintext');
    const ct2 = encrypt('same plaintext');
    expect(ct1).not.toBe(ct2);
  });

  it('decrypt() rejects tampered ciphertext', async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const ct = encrypt('tamper me');
    const tampered = ct.slice(0, -4) + 'ffff';
    expect(() => decrypt(tampered)).toThrow();
  });

  it('decrypt() throws when key id is not in the keyring', async () => {
    const { decrypt, getKeyRing } = await loadEncryption();
    const ring = getKeyRing();
    // Craft a ciphertext that claims key id "99" (not in ring)
    const { encrypt } = await loadEncryption();
    const ct = encrypt('data').replace(/^v\d+:/, 'v99:');
    expect(() => decrypt(ct, ring)).toThrow('No key found for key id "99"');
  });
});

// ── Key rotation — decrypt old key, encrypt with new key ─────────────────────

describe('ISSUE-060: key rotation', () => {
  it('decrypts ciphertext produced with old key using a keyring', async () => {
    const oldKey = randomHexKey();
    const newKey = randomHexKey();

    // Encrypt with old key (id=1)
    process.env.DATABASE_ENCRYPTION_KEY = oldKey;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '1';
    delete process.env.DATABASE_ENCRYPTION_KEY_RING;
    vi.resetModules();
    const { encrypt: encryptV1 } = await import('../src/db/encryption.js');
    const ct = encryptV1('rotate me');

    // Now rotate to new key (id=2), keeping old key in ring
    process.env.DATABASE_ENCRYPTION_KEY = newKey;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '2';
    process.env.DATABASE_ENCRYPTION_KEY_RING = JSON.stringify({ '1': oldKey });
    vi.resetModules();
    const { decrypt, getKeyRing } = await import('../src/db/encryption.js');

    const ring = getKeyRing();
    expect(decrypt(ct, ring)).toBe('rotate me');
  });

  it('reencryptValue() produces a ciphertext under the new key', async () => {
    const oldKey = randomHexKey();
    const newKey = randomHexKey();

    // Encrypt with old key
    process.env.DATABASE_ENCRYPTION_KEY = oldKey;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '1';
    delete process.env.DATABASE_ENCRYPTION_KEY_RING;
    vi.resetModules();
    const { encrypt: encryptOld } = await import('../src/db/encryption.js');
    const oldCt = encryptOld('my secret value');

    // Reencrypt with new key
    process.env.DATABASE_ENCRYPTION_KEY = newKey;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '2';
    process.env.DATABASE_ENCRYPTION_KEY_RING = JSON.stringify({ '1': oldKey });
    vi.resetModules();
    const { reencryptValue, decrypt, getKeyRing } = await import('../src/db/encryption.js');

    const ring = getKeyRing();
    const newCt = reencryptValue(oldCt, ring);

    expect(newCt).toMatch(/^v2:/);
    expect(decrypt(newCt, ring)).toBe('my secret value');
  });

  it('reencryptValue() is idempotent — already-current ciphertext decrypts correctly', async () => {
    const key = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY = key;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '2';
    delete process.env.DATABASE_ENCRYPTION_KEY_RING;
    vi.resetModules();
    const { encrypt, reencryptValue, decrypt, getKeyRing } = await import('../src/db/encryption.js');

    const ct = encrypt('already current');
    const ring = getKeyRing();
    const ct2 = reencryptValue(ct, ring);

    expect(ct2).toMatch(/^v2:/);
    expect(decrypt(ct2, ring)).toBe('already current');
  });
});

// ── Legacy bare-format compatibility ──────────────────────────────────────────

describe('ISSUE-060: legacy format compatibility', () => {
  it('decrypts bare iv:tag:ciphertext when key "0" is in the ring', async () => {
    // Simulate a value that was encrypted before the versioning change.
    // We build it directly using the crypto primitives.
    const { createCipheriv, randomBytes } = await import('crypto');

    const legacyKeyHex = randomHexKey();
    const legacyKey = Buffer.from(legacyKeyHex, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', legacyKey, iv);
    const ciphertext = Buffer.concat([cipher.update('legacy secret', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacyCt = `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;

    // Now set up the current env with the legacy key mapped to id "0"
    const currentKey = randomHexKey();
    process.env.DATABASE_ENCRYPTION_KEY = currentKey;
    process.env.DATABASE_ENCRYPTION_KEY_ID = '2';
    process.env.DATABASE_ENCRYPTION_KEY_RING = JSON.stringify({ '0': legacyKeyHex });
    vi.resetModules();
    const { decrypt, getKeyRing } = await import('../src/db/encryption.js');

    const ring = getKeyRing();
    expect(decrypt(legacyCt, ring)).toBe('legacy secret');
  });
});

// ── validateEncryptionKey() ───────────────────────────────────────────────────

describe('ISSUE-060: validateEncryptionKey()', () => {
  it('does not throw when config is valid', async () => {
    process.env.DATABASE_ENCRYPTION_KEY = randomHexKey();
    const { validateEncryptionKey } = await loadEncryption();
    expect(() => validateEncryptionKey()).not.toThrow();
  });

  it('throws when config is invalid', async () => {
    delete process.env.DATABASE_ENCRYPTION_KEY;
    const { validateEncryptionKey } = await loadEncryption();
    expect(() => validateEncryptionKey()).toThrow();
  });
});
