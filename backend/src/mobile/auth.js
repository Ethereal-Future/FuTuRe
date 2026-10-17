import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mobileSessions from './sessions.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mobile-secret';
const TOKEN_TTL_SECONDS = 604800; // 7 days

class MobileAuth {
  constructor() {
    // userId -> { publicKey, deviceId, registeredAt }
    this.biometricKeys = new Map();
    // challengeId -> { userId, deviceId, expiresAt }
    this.challenges = new Map();
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

  /** Register a biometric public key (ECDSA P-256) for a user/device */
  registerBiometric(userId, deviceId, publicKeyPem) {
    this.biometricKeys.set(`${userId}:${deviceId}`, {
      publicKey: publicKeyPem,
      deviceId,
      registeredAt: new Date(),
    });
    return { registered: true };
  }

  /** Issue a random challenge the client must sign with their biometric key */
  createChallenge(userId, deviceId) {
    const challengeId = crypto.randomUUID();
    const challenge = crypto.randomBytes(32).toString('base64url');
    this.challenges.set(challengeId, {
      userId,
      deviceId,
      challenge,
      expiresAt: Date.now() + 60_000, // 1 min
    });
    return { challengeId, challenge };
  }

  /** Verify the signed challenge and return a device-bound session JWT */
  async verifyBiometric(challengeId, signatureBase64, device = {}) {
    const entry = this.challenges.get(challengeId);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new Error('Challenge expired or not found');
    }
    this.challenges.delete(challengeId);

    const keyEntry = this.biometricKeys.get(`${entry.userId}:${entry.deviceId}`);
    if (!keyEntry) throw new Error('Biometric key not registered');

    const verify = crypto.createVerify('SHA256');
    verify.update(entry.challenge);
    const valid = verify.verify(keyEntry.publicKey, signatureBase64, 'base64');
    if (!valid) throw new Error('Biometric verification failed');

    return this.issueSessionToken(entry.userId, entry.deviceId, device);
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
