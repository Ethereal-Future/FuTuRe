import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../db/client.js';
import { redisSet, redisGetDelete } from './redisStore.js';
import { parseAuthenticatorData } from './authenticatorData.js';
import mobileAuth from './auth.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mobile-secret';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'FuTuRe';
// Comma-separated list of accepted clientDataJSON origins. When unset the
// origin isn't pinned (rpIdHash is still enforced).
const ALLOWED_ORIGINS = (process.env.WEBAUTHN_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
// Biometric / PIN user verification (UV flag) is required unless explicitly
// disabled — the ceremony options already ask for userVerification: 'required'.
const REQUIRE_USER_VERIFICATION = process.env.WEBAUTHN_REQUIRE_USER_VERIFICATION !== 'false';

// Challenges live in Redis bound to the ceremony session
// (`webauthn:challenge:{sessionId}`) with a native 60s TTL (issues #1124,
// #1379). They are consumed with an atomic GETDEL the moment a response is
// presented, so each challenge can be answered at most once — a captured
// assertion cannot be replayed, even concurrently against another instance.
export const CHALLENGE_TTL_SECONDS = 60;

export class WebAuthnError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    this.name = 'WebAuthnError';
    this.code = code;
    this.status = status;
  }
}

function challengeKey(sessionId) {
  return `webauthn:challenge:${sessionId}`;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function safeEqual(a, b) {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a random 32-byte challenge and bind it to `sessionId` in Redis
 * for CHALLENGE_TTL_SECONDS. Starting a new ceremony on the same session
 * replaces (and so invalidates) any previous outstanding challenge.
 *
 * @param {string} sessionId - The ceremony/user session the challenge is bound to.
 * @param {{ userId: string, type: 'registration'|'authentication' }} context
 * @returns {Promise<string>} The base64url challenge.
 */
export async function generateChallenge(sessionId, context) {
  if (!sessionId) throw new WebAuthnError('sessionId is required', 'SessionRequired', 400);
  const challenge = crypto.randomBytes(32).toString('base64url');
  await redisSet(
    challengeKey(sessionId),
    { ...context, challenge, issuedAt: Date.now() },
    CHALLENGE_TTL_SECONDS,
  );
  return challenge;
}

/**
 * Atomically fetch-and-delete the challenge bound to `sessionId`. The
 * challenge is gone after this call regardless of whether the response that
 * follows verifies, so it can never be used twice.
 *
 * @throws {WebAuthnError} 401 ChallengeExpired when missing/expired/already used,
 *   401 ChallengeMismatch when it belongs to another user or ceremony type.
 */
export async function consumeChallenge(sessionId, { userId, type }) {
  const label = type === 'registration' ? 'Registration' : 'Authentication';
  const entry = sessionId ? await redisGetDelete(challengeKey(sessionId)) : null;
  if (!entry) {
    throw new WebAuthnError(`${label} challenge expired or not found`, 'ChallengeExpired');
  }
  if (entry.type !== type || (userId && entry.userId !== userId)) {
    throw new WebAuthnError(`${label} challenge does not match this session`, 'ChallengeMismatch');
  }
  return entry;
}

/**
 * Enforce the User Presence and User Verification flags (byte 32) of
 * `authenticatorData` per W3C WebAuthn Level 3 (issue #1380).
 *
 * @param {Buffer|string} authenticatorData
 * @param {{ requireBiometrics?: boolean }} [options]
 * @returns {ReturnType<typeof parseAuthenticatorData>}
 */
export function assertAuthenticatorFlags(
  authenticatorData,
  { requireBiometrics = REQUIRE_USER_VERIFICATION } = {},
) {
  let parsed;
  try {
    parsed = parseAuthenticatorData(authenticatorData);
  } catch (err) {
    throw new WebAuthnError(
      `Invalid authenticatorData: ${err.message}`,
      'InvalidAuthenticatorData',
    );
  }
  if (!parsed.userPresence) {
    throw new WebAuthnError(
      'User presence (UP) flag not set in authenticatorData',
      'UserPresenceRequired',
    );
  }
  if (requireBiometrics && !parsed.userVerification) {
    throw new WebAuthnError(
      'User verification (UV) flag not set — biometric or PIN verification is required',
      'UserVerificationRequired',
    );
  }
  return parsed;
}

function assertRpIdHash(parsed) {
  if (!safeEqual(parsed.rpIdHash, sha256(RP_ID))) {
    throw new WebAuthnError(
      'authenticatorData rpIdHash does not match this relying party',
      'RpIdMismatch',
    );
  }
}

/**
 * Decode clientDataJSON and check type, challenge and (optionally) origin.
 * @returns {Buffer} The raw clientDataJSON bytes.
 */
function verifyClientData(clientDataJSON, expectedType, expectedChallenge) {
  const raw = Buffer.from(clientDataJSON, 'base64');
  let clientData;
  try {
    clientData = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebAuthnError('clientDataJSON is not valid JSON', 'InvalidClientData');
  }
  if (clientData.type !== expectedType) {
    throw new WebAuthnError(`clientDataJSON type must be ${expectedType}`, 'InvalidClientData');
  }
  if (
    typeof clientData.challenge !== 'string' ||
    !safeEqual(clientData.challenge, expectedChallenge)
  ) {
    throw new WebAuthnError('Challenge mismatch', 'ChallengeMismatch');
  }
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(clientData.origin)) {
    throw new WebAuthnError('clientDataJSON origin is not allowed', 'OriginMismatch');
  }
  return raw;
}

function toPublicKey(stored) {
  if (typeof stored === 'string' && stored.includes('-----BEGIN')) {
    return crypto.createPublicKey(stored);
  }
  return crypto.createPublicKey({
    key: Buffer.from(stored, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Generate registration options for the client to call
 * navigator.credentials.create({ publicKey: options }).
 *
 * @param {string} userId
 * @param {string} [username]
 * @param {{ sessionId?: string }} [options] - Session to bind the challenge to;
 *   a fresh ceremony id is generated when omitted.
 */
export async function generateRegistrationOptions(userId, username, { sessionId } = {}) {
  const ceremonyId = sessionId || crypto.randomUUID();
  const challenge = await generateChallenge(ceremonyId, { userId, type: 'registration' });

  return {
    sessionId: ceremonyId,
    challengeId: ceremonyId,
    challenge,
    rp: { id: RP_ID, name: RP_NAME },
    user: { id: Buffer.from(userId).toString('base64url'), name: username || userId, displayName: username || userId },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    attestation: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
  };
}

/**
 * Verify and store a new WebAuthn credential in the database.
 * @param {string} sessionId - The session the registration challenge was bound to
 * @param {object} credential - The PublicKeyCredential from the client
 * @param {string} [deviceName] - Optional label for this device
 * @param {{ userId?: string, requireBiometrics?: boolean }} [options]
 */
export async function verifyAndStoreRegistration(sessionId, credential, deviceName, options = {}) {
  const entry = await consumeChallenge(sessionId, { userId: options.userId, type: 'registration' });

  const { id: credentialId, publicKey, authenticatorData, clientDataJSON } = credential || {};
  if (!credentialId || !publicKey) {
    throw new WebAuthnError(
      'Invalid credential: missing id or publicKey',
      'InvalidCredential',
      400,
    );
  }
  if (clientDataJSON) verifyClientData(clientDataJSON, 'webauthn.create', entry.challenge);
  if (authenticatorData) {
    const parsed = assertAuthenticatorFlags(authenticatorData, options);
    assertRpIdHash(parsed);
  }

  const stored = await prisma.webAuthnCredential.create({
    data: {
      userId: entry.userId,
      credentialId,
      publicKey,
      counter: 0,
      deviceName: deviceName || null,
    },
  });

  return { registered: true, credentialId: stored.credentialId };
}

/**
 * Generate authentication options for the client to call
 * navigator.credentials.get({ publicKey: options }).
 *
 * @param {string} userId
 * @param {{ sessionId?: string }} [options] - Session to bind the challenge to.
 */
export async function generateAuthenticationOptions(userId, { sessionId } = {}) {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true },
  });

  if (credentials.length === 0) {
    throw new WebAuthnError(
      'No WebAuthn credentials registered for this user',
      'NoCredentials',
      404,
    );
  }

  const ceremonyId = sessionId || crypto.randomUUID();
  const challenge = await generateChallenge(ceremonyId, { userId, type: 'authentication' });

  return {
    sessionId: ceremonyId,
    challengeId: ceremonyId,
    challenge,
    rpId: RP_ID,
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      type: 'public-key',
      id: c.credentialId,
    })),
  };
}

/**
 * Verify a WebAuthn authentication assertion and return a JWT on success.
 *
 * @param {string} sessionId - The session the authentication challenge was bound to
 * @param {{ credentialId: string, signature: string, authenticatorData: string,
 *           clientDataJSON: string }} assertion - base64url-encoded
 *   AuthenticatorAssertionResponse fields
 * @param {{ userId?: string, requireBiometrics?: boolean, deviceId?: string,
 *           device?: object }} [options] - Pass `deviceId` to issue a device-bound
 *   mobile session token.
 */
export async function verifyAuthentication(sessionId, assertion, options = {}) {
  // Consume first: the challenge is burned even if verification fails below.
  const entry = await consumeChallenge(sessionId, {
    userId: options.userId,
    type: 'authentication',
  });

  const { credentialId, signature, authenticatorData, clientDataJSON } = assertion || {};
  if (!credentialId || !signature) {
    throw new WebAuthnError(
      'Invalid assertion: missing credentialId or signature',
      'InvalidAssertion',
      400,
    );
  }

  const stored = await prisma.webAuthnCredential.findUnique({
    where: { credentialId },
  });
  if (!stored || stored.userId !== entry.userId) {
    throw new WebAuthnError('Credential not found or user mismatch', 'CredentialNotFound');
  }

  if (!authenticatorData || !clientDataJSON) {
    throw new WebAuthnError(
      'Invalid assertion: missing authenticatorData or clientDataJSON',
      'InvalidAssertion',
      400,
    );
  }

  const clientDataRaw = verifyClientData(clientDataJSON, 'webauthn.get', entry.challenge);
  const parsed = assertAuthenticatorFlags(authenticatorData, options);
  assertRpIdHash(parsed);

  // WebAuthn signature covers authenticatorData || SHA-256(clientDataJSON).
  const signedData = Buffer.concat([parsed.raw, sha256(clientDataRaw)]);
  let valid = false;
  try {
    valid = crypto.verify(
      'sha256',
      signedData,
      toPublicKey(stored.publicKey),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new WebAuthnError('WebAuthn signature verification failed', 'SignatureInvalid');

  // Signature counter must strictly increase; a non-increasing value means a
  // cloned authenticator or a replayed assertion. Authenticators that don't
  // implement counters report 0 forever, which is allowed.
  const storedCounter = Number(stored.counter);
  if ((parsed.signCount !== 0 || storedCounter !== 0) && parsed.signCount <= storedCounter) {
    throw new WebAuthnError('Authenticator signature counter did not increase', 'CounterReplay');
  }
  await prisma.webAuthnCredential.update({
    where: { credentialId },
    data: { counter: BigInt(parsed.signCount) },
  });

  if (options.deviceId) {
    return mobileAuth.issueSessionToken(entry.userId, options.deviceId, options.device, {
      type: 'webauthn',
      credentialId,
    });
  }

  const token = jwt.sign(
    { userId: entry.userId, credentialId, type: 'webauthn' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  return { token, expiresIn: 604800 };
}
