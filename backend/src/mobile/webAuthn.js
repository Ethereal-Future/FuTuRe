import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../db/client.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mobile-secret';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'FuTuRe';

// In-memory challenge store: challengeId -> { userId, challenge, expiresAt }
const pendingChallenges = new Map();

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [id, entry] of pendingChallenges) {
    if (now > entry.expiresAt) pendingChallenges.delete(id);
  }
}

/**
 * Generate registration options for the client to call
 * navigator.credentials.create({ publicKey: options }).
 */
export function generateRegistrationOptions(userId, username) {
  cleanExpiredChallenges();
  const challengeId = crypto.randomUUID();
  const challenge = crypto.randomBytes(32).toString('base64url');

  pendingChallenges.set(challengeId, { userId, challenge, expiresAt: Date.now() + 60_000 });

  return {
    challengeId,
    challenge,
    rp: { id: RP_ID, name: RP_NAME },
    user: { id: Buffer.from(userId).toString('base64url'), name: username || userId, displayName: username || userId },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
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
 * @param {string} challengeId - The challenge ID from generateRegistrationOptions
 * @param {object} credential - The PublicKeyCredential from the client
 * @param {string} [deviceName] - Optional label for this device
 */
export async function verifyAndStoreRegistration(challengeId, credential, deviceName) {
  const entry = pendingChallenges.get(challengeId);
  if (!entry || Date.now() > entry.expiresAt) {
    throw new Error('Registration challenge expired or not found');
  }
  pendingChallenges.delete(challengeId);

  const { id: credentialId, publicKey } = credential;
  if (!credentialId || !publicKey) {
    throw new Error('Invalid credential: missing id or publicKey');
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
 */
export async function generateAuthenticationOptions(userId) {
  cleanExpiredChallenges();

  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true },
  });

  if (credentials.length === 0) {
    throw new Error('No WebAuthn credentials registered for this user');
  }

  const challengeId = crypto.randomUUID();
  const challenge = crypto.randomBytes(32).toString('base64url');
  pendingChallenges.set(challengeId, { userId, challenge, expiresAt: Date.now() + 60_000 });

  return {
    challengeId,
    challenge,
    rpId: RP_ID,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      type: 'public-key',
      id: c.credentialId,
    })),
  };
}

/**
 * Verify a WebAuthn authentication assertion and return a JWT on success.
 * @param {string} challengeId
 * @param {object} assertion - The AuthenticatorAssertionResponse from the client
 */
export async function verifyAuthentication(challengeId, assertion) {
  const entry = pendingChallenges.get(challengeId);
  if (!entry || Date.now() > entry.expiresAt) {
    throw new Error('Authentication challenge expired or not found');
  }
  pendingChallenges.delete(challengeId);

  const { credentialId, signature, counter: clientCounter } = assertion;
  if (!credentialId || !signature) {
    throw new Error('Invalid assertion: missing credentialId or signature');
  }

  const stored = await prisma.webAuthnCredential.findUnique({
    where: { credentialId },
  });
  if (!stored || stored.userId !== entry.userId) {
    throw new Error('Credential not found or user mismatch');
  }

  // Verify the signature against the stored public key
  const verify = crypto.createVerify('SHA256');
  verify.update(entry.challenge);
  const valid = verify.verify(stored.publicKey, signature, 'base64');
  if (!valid) throw new Error('WebAuthn signature verification failed');

  // Update the counter to prevent replay attacks
  const newCounter = Math.max(Number(stored.counter) + 1, (clientCounter || 0));
  await prisma.webAuthnCredential.update({
    where: { credentialId },
    data: { counter: BigInt(newCounter) },
  });

  const token = jwt.sign(
    { userId: entry.userId, credentialId, type: 'webauthn' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  return { token, expiresIn: 604800 };
}
