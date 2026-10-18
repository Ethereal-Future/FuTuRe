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
}
