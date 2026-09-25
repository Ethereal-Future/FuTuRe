/**
 * Field encryption + blind index search tokens (ISSUE-066)
 * BLIND_INDEX_KEY must be distinct from FIELD_ENCRYPTION_KEY.
 */
import crypto from 'crypto';

const key = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return Buffer.from(v, 'hex');
};

function assertSegregated() {
  if (process.env.BLIND_INDEX_KEY === process.env.FIELD_ENCRYPTION_KEY) {
    throw new Error('BLIND_INDEX_KEY must differ from FIELD_ENCRYPTION_KEY');
  }
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key('FIELD_ENCRYPTION_KEY'), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join(':');
}

export function decrypt(payload) {
  const [iv, tag, data] = payload.split(':').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key('FIELD_ENCRYPTION_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const normalize = (v) => String(v).trim().toLowerCase().replace(/[\s\-().]/g, '');

/** Deterministic HMAC-SHA256 search token for equality lookups. */
export function generateBlindIndex(plaintext, salt = '') {
  assertSegregated();
  return crypto.createHmac('sha256', key('BLIND_INDEX_KEY')).update(salt + normalize(plaintext)).digest('hex');
}

/** Returns { [field]: ciphertext, [field + 'Hash']: blindIndex } for persistence. */
export function encryptSearchable(field, plaintext, salt = field) {
  return { [field]: encrypt(plaintext), [`${field}Hash`]: generateBlindIndex(plaintext, salt) };
 * AES-256-GCM column encryption with key-version metadata.
 *
 * ISSUE-060 changes
 * ─────────────────
 * • Ciphertext envelope is now  v<keyId>:<iv>:<authTag>:<ciphertext>  (all hex).
 *   The previous bare  iv:tag:ciphertext  format is handled transparently by
 *   decrypt() as the legacy "v0" format so existing rows keep working.
 * • encrypt() always writes the current key version into the envelope.
 * • decrypt() reads the version prefix, selects the matching key from the
 *   keyring, and decrypts — supporting an arbitrary number of historical keys.
 * • getKeyRing() assembles a multi-key ring from environment variables:
 *     DATABASE_ENCRYPTION_KEY       → current key  (id = "1" by default)
 *     DATABASE_ENCRYPTION_KEY_ID    → numeric id for the current key
 *     DATABASE_ENCRYPTION_KEY_RING  → JSON map { "0": "<hex>", "1": "<hex>" … }
 *       (used when multiple old keys need to be readable at the same time)
 *
 * Environment variables
 * ─────────────────────
 *   DATABASE_ENCRYPTION_KEY        Required.  Hex-encoded 32-byte AES-256 key.
 *   DATABASE_ENCRYPTION_KEY_ID     Optional.  Numeric id for the current key.
 *                                  Defaults to "1".
 *   DATABASE_ENCRYPTION_KEY_RING   Optional.  JSON { "<id>": "<hexKey>", … }
 *                                  for additional historical keys used only for
 *                                  decryption.  The current key is merged in
 *                                  automatically.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM

// ── Key ring helpers ──────────────────────────────────────────────────────────

/**
 * Parse and validate a raw hex key string.
 * Throws with a descriptive message if the input is invalid.
 */
function parseHexKey(hex, label) {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`${label} must be 32 bytes (64 hex characters); got ${key.length} bytes`);
  }
  return key;
}

/**
 * Build the keyring from environment variables.
 *
 * Returns:
 *   {
 *     currentKeyId: string,
 *     keys: { [id: string]: Buffer }
 *   }
 */
export function getKeyRing() {
  const rawCurrent = process.env.DATABASE_ENCRYPTION_KEY;
  if (!rawCurrent) {
    throw new Error('DATABASE_ENCRYPTION_KEY environment variable is required');
  }

  const currentKeyId = (process.env.DATABASE_ENCRYPTION_KEY_ID ?? '1').trim();
  const currentKey = parseHexKey(rawCurrent, `DATABASE_ENCRYPTION_KEY (id=${currentKeyId})`);

  // Start with any explicitly provided historical keys
  const keys = {};
  const rawRing = process.env.DATABASE_ENCRYPTION_KEY_RING;
  if (rawRing) {
    let parsed;
    try {
      parsed = JSON.parse(rawRing);
    } catch {
      throw new Error('DATABASE_ENCRYPTION_KEY_RING must be valid JSON ({ "<id>": "<hexKey>" })');
    }
    for (const [id, hex] of Object.entries(parsed)) {
      keys[id] = parseHexKey(hex, `DATABASE_ENCRYPTION_KEY_RING[${id}]`);
    }
  }

  // Always overwrite with the authoritative current key
  keys[currentKeyId] = currentKey;

  return { currentKeyId, keys };
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` with the current key.
 *
 * Returns a string with format:
 *   v<keyId>:<ivHex>:<authTagHex>:<ciphertextHex>
 *
 * Example:
 *   v1:a1b2c3...:d4e5f6...:7a8b9c...
 */
export function encrypt(plaintext) {
  const { currentKeyId, keys } = getKeyRing();
  const key = keys[currentKeyId];

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v${currentKeyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Decrypt a value produced by encrypt() — or by the legacy bare format.
 *
 * Versioned format (new):   v<id>:<iv>:<tag>:<ciphertext>
 * Legacy format (old rows): <iv>:<tag>:<ciphertext>   (treated as key id "0")
 *
 * The legacy "v0" path allows existing database rows encrypted before this
 * change to keep decrypting without a forced migration.  To retire legacy
 * rows, run the re-encryption utility (npm run db:rotate-encryption-keys).
 *
 * @param {string} encryptedValue
 * @param {object} [keyRingOverride]  Optional keyring (used in tests / CLI).
 */
export function decrypt(encryptedValue, keyRingOverride = null) {
  const { keys } = keyRingOverride ?? getKeyRing();

  let keyId, ivHex, tagHex, ciphertextHex;

  if (encryptedValue.startsWith('v')) {
    // Versioned format: v<id>:<iv>:<tag>:<ciphertext>
    const firstColon = encryptedValue.indexOf(':');
    keyId = encryptedValue.slice(1, firstColon); // strip leading 'v'
    const rest = encryptedValue.slice(firstColon + 1).split(':');
    if (rest.length !== 3) {
      throw new Error('Invalid encrypted value: expected v<id>:<iv>:<tag>:<ciphertext>');
    }
    [ivHex, tagHex, ciphertextHex] = rest;
  } else {
    // Legacy bare format: <iv>:<tag>:<ciphertext>
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value: expected <iv>:<tag>:<ciphertext> (legacy) or v<id>:<iv>:<tag>:<ciphertext>');
    }
    keyId = '0';
    [ivHex, tagHex, ciphertextHex] = parts;
  }

  const key = keys[keyId];
  if (!key) {
    throw new Error(
      `No key found for key id "${keyId}". ` +
        'Add it to DATABASE_ENCRYPTION_KEY_RING or set DATABASE_ENCRYPTION_KEY_ID.'
    );
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Re-encryption utility helper ──────────────────────────────────────────────

/**
 * Re-encrypt a single already-encrypted value from `oldKeyId` to the current
 * key.  Returns the new ciphertext string, or throws if the old key is missing.
 *
 * Used by the CLI utility `npm run db:rotate-encryption-keys`.
 *
 * @param {string} encryptedValue  - Existing ciphertext (any supported format)
 * @param {object} keyRing         - Full keyring including both old and new keys
 */
export function reencryptValue(encryptedValue, keyRing) {
  // Decrypt with the full keyring (which includes the old key)
  const plaintext = decrypt(encryptedValue, keyRing);

  // Re-encrypt using the current key from the keyring
  const { currentKeyId, keys } = keyRing;
  const key = keys[currentKeyId];

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v${currentKeyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

// ── Startup validation ────────────────────────────────────────────────────────

/**
 * Call at startup — fails fast with a clear error if the key is missing,
 * invalid, or the keyring JSON is malformed.
 */
export function validateEncryptionKey() {
  getKeyRing(); // throws on any misconfiguration
}
