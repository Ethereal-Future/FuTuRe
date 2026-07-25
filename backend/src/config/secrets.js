import crypto from 'crypto';

const ENC_RE = /^ENC\((?<payload>[^)]+)\)$/;
const ENC_COLON_RE = /^enc:(?<payload>.+)$/i;

function deriveKey(encryptionKey) {
  return crypto.createHash('sha256').update(encryptionKey, 'utf8').digest();
}

export function encryptToEnvValue(plaintext, encryptionKey) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToEnvValue: plaintext must be a non-empty string');
  }
  if (typeof encryptionKey !== 'string' || encryptionKey.length === 0) {
    throw new Error('encryptToEnvValue: encryptionKey must be a non-empty string');
  }

  const iv = crypto.randomBytes(12);
  const key = deriveKey(encryptionKey);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64');
  return `ENC(${payload})`;
}

export function decryptFromEnvValue(encryptedValue, encryptionKey) {
  if (typeof encryptedValue !== 'string' || encryptedValue.length === 0) {
    throw new Error('decryptFromEnvValue: encryptedValue must be a non-empty string');
  }
  if (typeof encryptionKey !== 'string' || encryptionKey.length === 0) {
    throw new Error('decryptFromEnvValue: encryptionKey must be a non-empty string');
  }

  const encMatch = encryptedValue.match(ENC_RE) ?? encryptedValue.match(ENC_COLON_RE);
  if (!encMatch?.groups?.payload) {
    throw new Error('decryptFromEnvValue: value is not encrypted');
  }

  let payload;
  try {
    payload = Buffer.from(encMatch.groups.payload, 'base64');
  } catch {
    throw new Error('decryptFromEnvValue: invalid base64 payload');
  }

  // Format: [12-byte iv][16-byte tag][ciphertext]
  if (payload.length <= 28) {
    throw new Error('decryptFromEnvValue: payload is too short');
  }

  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);

  const key = deriveKey(encryptionKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('decryptFromEnvValue: decryption failed');
  }
}

export function maybeDecryptEnvValue(value, encryptionKey, { envVarName } = {}) {
  if (typeof value !== 'string') return value;

  const isEncrypted = ENC_RE.test(value) || ENC_COLON_RE.test(value);
  if (!isEncrypted) return value;

  if (typeof encryptionKey !== 'string' || encryptionKey.length === 0) {
    const suffix = envVarName ? ` for ${envVarName}` : '';
    throw new Error(`Missing CONFIG_ENCRYPTION_KEY${suffix}`);
  }

  return decryptFromEnvValue(value, encryptionKey);
}

