import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mobileSessions from './sessions.js';
import { redisSet, redisGetDelete } from './redisStore.js';
import { canonicalJson } from '../utils/canonicalJson.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mobile-secret';
const TOKEN_TTL_SECONDS = 604800; // 7 days

export const BIOMETRIC_CHALLENGE_TTL_SECONDS = 60;
const TRANSACTION_HASH_RE = /^[0-9a-f]{64}$/i;

const challengeKey = (challengeId) => `mobile:biometric:tx-challenge:${challengeId}`;

export class BiometricAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BiometricAuthError';
    this.code = code;
    this.status = 401;
  }
}

/**
 * Normalise the transaction fields a biometric signature is bound to, so the
 * signed message is identical on client and server regardless of how the
 * amount was typed (string vs number) or how the hash was cased.
 */
function normalizeTransaction({ transactionHash, amount, destination } = {}) {
  if (typeof transactionHash !== 'string' || !TRANSACTION_HASH_RE.test(transactionHash)) {
    throw new BiometricAuthError(
      'transactionHash must be a 32-byte hex string',
      'INVALID_TRANSACTION',
    );
  }
  if (amount === undefined || amount === null || String(amount).trim() === '') {
    throw new BiometricAuthError('amount is required', 'INVALID_TRANSACTION');
  }
  if (typeof destination !== 'string' || destination.trim() === '') {
    throw new BiometricAuthError('destination is required', 'INVALID_TRANSACTION');
  }
  return {
    transactionHash: transactionHash.toLowerCase(),
    amount: String(amount).trim(),
    destination: destination.trim(),
  };
}

/**
 * The exact bytes the device's Secure Enclave / Keystore key must sign.
 * Binding the challenge id, nonce, user, device and full transaction payload
 * means a signature is valid for one transaction, once.
 */
export function buildBiometricSigningPayload(challenge) {
  return canonicalJson({
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    userId: challenge.userId,
    deviceId: challenge.deviceId,
    transactionHash: challenge.transactionHash,
    amount: challenge.amount,
    destination: challenge.destination,
    timestamp: challenge.timestamp,
  });
}

class MobileAuth {
  constructor() {
    // `${userId}:${deviceId}` -> { publicKey, deviceId, registeredAt }
    this.biometricKeys = new Map();
    // userId -> { pinHash, salt }
    this.pins = new Map();
  }

  /** Register or update a PIN for a user (hashed with PBKDF2) */
  setPin(userId, pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const pinHash = crypto.pbkdf2Sync(pin, salt, 100_000, 32, 'sha256').toString('hex');
    this.pins.set(userId, { pinHash, salt });
    return { set: true };
  }

  /** Verify PIN and return a device-bound session JWT */
  async verifyPin(userId, deviceId, pin, device = {}) {
    const entry = this.pins.get(userId);
    if (!entry) throw new Error('PIN not set for user');
    const hash = crypto.pbkdf2Sync(pin, entry.salt, 100_000, 32, 'sha256').toString('hex');
    if (hash !== entry.pinHash) throw new Error('Invalid PIN');
    return this.issueSessionToken(userId, deviceId, device);
  }

  /**
   * Register the device's biometric-gated public key (ECDSA P-256, generated
   * in the Secure Enclave / Android Keystore with user authentication
   * required) for a user/device.
   */
  registerBiometric(userId, deviceId, publicKeyPem) {
    if (!userId || !deviceId) throw new Error('userId and deviceId are required');
    try {
      crypto.createPublicKey(publicKeyPem);
    } catch {
      throw new Error('publicKeyPem is not a valid public key');
    }
    this.biometricKeys.set(`${userId}:${deviceId}`, {
      publicKey: publicKeyPem,
      deviceId,
      registeredAt: new Date(),
    });
    return { registered: true };
  }

  /**
   * Issue a single-use biometric challenge bound to one transaction
   * (issue #1383). Replaces the general-purpose biometric challenge whose
   * result could be reused across operations.
   *
   * @param {string} userId
   * @param {string} deviceId
   * @param {{ transactionHash: string, amount: string|number, destination: string }} transaction
   * @returns {Promise<{ challengeId: string, challenge: object, payload: string, expiresIn: number }>}
   *   `payload` is the exact string the device must sign.
   */
  async createTransactionChallenge(userId, deviceId, transaction) {
    if (!userId || !deviceId) throw new Error('userId and deviceId are required');
    if (!this.biometricKeys.has(`${userId}:${deviceId}`)) {
      throw new BiometricAuthError('Biometric key not registered', 'BIOMETRIC_KEY_NOT_REGISTERED');
    }

    const challenge = {
      challengeId: crypto.randomUUID(),
      nonce: crypto.randomBytes(32).toString('base64url'),
      userId,
      deviceId,
      ...normalizeTransaction(transaction),
      timestamp: Date.now(),
    };
    await redisSet(
      challengeKey(challenge.challengeId),
      challenge,
      BIOMETRIC_CHALLENGE_TTL_SECONDS,
    );

    return {
      challengeId: challenge.challengeId,
      challenge,
      payload: buildBiometricSigningPayload(challenge),
      expiresIn: BIOMETRIC_CHALLENGE_TTL_SECONDS,
    };
  }

  /**
   * Verify a Secure Enclave / Keystore signature for exactly one transaction.
   * The challenge is consumed atomically before any check runs, so it can
   * never be replayed or retried, and the signature is only accepted when
   * the transaction being executed matches the one it was issued for.
   *
   * @param {string} challengeId
   * @param {string} signatureBase64 - DER ECDSA signature over the signing payload.
   * @param {{ transactionHash: string, amount: string|number, destination: string }} transaction
   *   The transaction about to be executed.
   * @param {{ userId?: string, deviceId?: string }} [caller] - Authenticated caller to bind to.
   */
  async verifyTransactionSignature(challengeId, signatureBase64, transaction, caller = {}) {
    const entry = challengeId ? await redisGetDelete(challengeKey(challengeId)) : null;
    if (!entry || Date.now() > entry.timestamp + BIOMETRIC_CHALLENGE_TTL_SECONDS * 1000) {
      throw new BiometricAuthError(
        'Challenge expired, already used, or not found',
        'CHALLENGE_INVALID',
      );
    }
    if (
      (caller.userId && caller.userId !== entry.userId) ||
      (caller.deviceId && caller.deviceId !== entry.deviceId)
    ) {
      throw new BiometricAuthError(
        'Challenge was issued to a different user or device',
        'CHALLENGE_MISMATCH',
      );
    }

    const executing = normalizeTransaction(transaction);
    if (
      executing.transactionHash !== entry.transactionHash ||
      executing.amount !== entry.amount ||
      executing.destination !== entry.destination
    ) {
      throw new BiometricAuthError(
        'Biometric signature is not bound to this transaction',
        'TRANSACTION_MISMATCH',
      );
    }

    const keyEntry = this.biometricKeys.get(`${entry.userId}:${entry.deviceId}`);
    if (!keyEntry) {
      throw new BiometricAuthError('Biometric key not registered', 'BIOMETRIC_KEY_NOT_REGISTERED');
    }

    let valid = false;
    try {
      valid =
        typeof signatureBase64 === 'string' &&
        crypto.verify(
          'sha256',
          Buffer.from(buildBiometricSigningPayload(entry)),
          keyEntry.publicKey,
          Buffer.from(signatureBase64, 'base64'),
        );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new BiometricAuthError('Biometric verification failed', 'SIGNATURE_INVALID');
    }

    return {
      authorized: true,
      userId: entry.userId,
      deviceId: entry.deviceId,
      transactionHash: entry.transactionHash,
      amount: entry.amount,
      destination: entry.destination,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a device-bound session row (issue #1381) and sign a JWT that
   * references it via `sid`. The token is only honoured when presented
   * together with a matching `X-Device-Id` while the session is active.
   */
  async issueSessionToken(userId, deviceId, device = {}, extraClaims = {}) {
    if (!deviceId) throw new Error('deviceId is required to issue a mobile token');
    const sessionId = await mobileSessions.create(userId, deviceId, {
      ...device,
      ttlMs: TOKEN_TTL_SECONDS * 1000,
    });
    const token = jwt.sign(
      { type: 'mobile', ...extraClaims, userId, deviceId, sid: sessionId },
      JWT_SECRET,
      { expiresIn: TOKEN_TTL_SECONDS },
    );
    return { token, expiresIn: TOKEN_TTL_SECONDS, sessionId };
  }

  verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }
}

export default new MobileAuth();
