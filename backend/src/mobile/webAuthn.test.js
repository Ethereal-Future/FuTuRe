/**
 * WebAuthn service — session-bound single-use challenges (#1379) and
 * authenticatorData UP/UV flag enforcement (#1380).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockCredentials = new Map();
const mockSessions = new Map();

vi.mock('../db/client.js', () => ({
  default: {
    webAuthnCredential: {
      create: vi.fn(({ data }) => {
        const cred = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        mockCredentials.set(data.credentialId, cred);
        return Promise.resolve(cred);
      }),
      findUnique: vi.fn(({ where }) => Promise.resolve(mockCredentials.get(where.credentialId) ?? null)),
      findMany: vi.fn(({ where }) => {
        const results = [...mockCredentials.values()].filter((c) => c.userId === where.userId);
        return Promise.resolve(results.map((c) => ({ credentialId: c.credentialId })));
      }),
      update: vi.fn(({ where, data }) => {
        const cred = mockCredentials.get(where.credentialId);
        if (!cred) return Promise.reject(new Error('Not found'));
        Object.assign(cred, data);
        return Promise.resolve(cred);
      }),
    },
    session: {
      create: vi.fn(({ data }) => {
        const now = new Date();
        const session = { id: crypto.randomUUID(), createdAt: now, lastActiveAt: now, revokedAt: null, ...data };
        mockSessions.set(session.id, session);
        return Promise.resolve(session);
      }),
    },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
process.env.WEBAUTHN_RP_ID = 'localhost';

const {
  generateChallenge,
  consumeChallenge,
  assertAuthenticatorFlags,
  generateRegistrationOptions,
  verifyAndStoreRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  CHALLENGE_TTL_SECONDS,
} = await import('./webAuthn.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const RP_ID = 'localhost';
const CRED_ID = 'cred-assert-001';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC_KEY_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const sha256 = (d) => crypto.createHash('sha256').update(d).digest();

function makeAuthData({ flags = 0x05, signCount = 1, rpId = RP_ID } = {}) {
  const buf = Buffer.alloc(37);
  sha256(rpId).copy(buf, 0);
  buf[32] = flags;
  buf.writeUInt32BE(signCount, 33);
  return buf;
}

function buildAssertion(challenge, opts = {}) {
  const authData = makeAuthData(opts);
  const clientData = Buffer.from(
    JSON.stringify({
      type: opts.type ?? 'webauthn.get',
      challenge: opts.challenge ?? challenge,
      origin: 'https://localhost',
    }),
  );
  const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), opts.signer ?? privateKey);
  return {
    credentialId: opts.credentialId ?? CRED_ID,
    authenticatorData: authData.toString('base64url'),
    clientDataJSON: clientData.toString('base64url'),
    signature: signature.toString('base64url'),
  };
}

function seedCredential(userId, overrides = {}) {
  mockCredentials.set(CRED_ID, {
    credentialId: CRED_ID,
    userId,
    publicKey: PUBLIC_KEY_B64,
    counter: 0n,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebAuthn service', () => {
  const userId = 'user-webauthn-test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentials.clear();
    mockSessions.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateRegistrationOptions', () => {
    it('returns a challenge and rp info', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      expect(options).toHaveProperty('sessionId');
      expect(options).toHaveProperty('challengeId', options.sessionId);
      expect(options).toHaveProperty('challenge');
      expect(options.rp).toHaveProperty('id');
      expect(options.rp).toHaveProperty('name');
      expect(options.pubKeyCredParams).toBeInstanceOf(Array);
    });

    it('encodes userId as base64url in user object', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      expect(options.user.id).toBe(Buffer.from(userId).toString('base64url'));
    });

    it('binds the challenge to a caller-supplied session id', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser', { sessionId: 'sess-reg-1' });
      expect(options.sessionId).toBe('sess-reg-1');
    });
  });

  describe('verifyAndStoreRegistration', () => {
    it('stores a credential in the database', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      const { credentialId: storedId } = await verifyAndStoreRegistration(
        options.sessionId,
        { id: 'cred-id-001', publicKey: 'MFkwEw==' },
        'My iPhone',
      );
      expect(storedId).toBe('cred-id-001');
      expect(mockCredentials.has('cred-id-001')).toBe(true);
    });

    it('throws when challenge is not found', async () => {
      await expect(
        verifyAndStoreRegistration('nonexistent-session', { id: 'cred', publicKey: 'key' }),
      ).rejects.toThrow('Registration challenge expired or not found');
    });

    it('throws when credential is missing id or publicKey', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      await expect(verifyAndStoreRegistration(options.sessionId, { id: '' })).rejects.toThrow('Invalid credential');
    });

    it('cannot reuse a registration challenge twice', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      await verifyAndStoreRegistration(options.sessionId, { id: 'cred-a', publicKey: 'MFkwEw==' });
      await expect(
        verifyAndStoreRegistration(options.sessionId, { id: 'cred-b', publicKey: 'MFkwEw==' }),
      ).rejects.toMatchObject({ code: 'ChallengeExpired', status: 401 });
      expect(mockCredentials.has('cred-b')).toBe(false);
    });

    it('enforces the UP flag when authenticatorData is supplied', async () => {
      const options = await generateRegistrationOptions(userId, 'testuser');
      await expect(
        verifyAndStoreRegistration(options.sessionId, {
          id: 'cred-up0',
          publicKey: 'MFkwEw==',
          authenticatorData: makeAuthData({ flags: 0x04 }).toString('base64url'),
        }),
      ).rejects.toMatchObject({ code: 'UserPresenceRequired' });
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('throws when no credentials are registered', async () => {
      await expect(generateAuthenticationOptions(userId)).rejects.toThrow('No WebAuthn credentials registered');
    });

    it('returns challenge and allowCredentials when credentials exist', async () => {
      seedCredential(userId);
      const options = await generateAuthenticationOptions(userId);
      expect(options).toHaveProperty('sessionId');
      expect(options).toHaveProperty('challenge');
      expect(options.allowCredentials).toHaveLength(1);
      expect(options.allowCredentials[0].id).toBe(CRED_ID);
    });
  });

  // ── #1379: session binding, TTL and single use ────────────────────────────

  describe('challenge session binding (#1379)', () => {
    it('stores challenges per session id', async () => {
      const a = await generateChallenge('sess-a', { userId, type: 'authentication' });
      const b = await generateChallenge('sess-b', { userId, type: 'authentication' });
      expect(a).not.toBe(b);
      expect(Buffer.from(a, 'base64url')).toHaveLength(32);

      expect((await consumeChallenge('sess-b', { userId, type: 'authentication' })).challenge).toBe(b);
      expect((await consumeChallenge('sess-a', { userId, type: 'authentication' })).challenge).toBe(a);
    });

    it('expires challenges after the 60 second TTL', async () => {
      vi.useFakeTimers();
      expect(CHALLENGE_TTL_SECONDS).toBe(60);
      await generateChallenge('sess-ttl', { userId, type: 'authentication' });
      vi.advanceTimersByTime(61_000);
      await expect(consumeChallenge('sess-ttl', { userId, type: 'authentication' })).rejects.toMatchObject({
        code: 'ChallengeExpired',
        status: 401,
      });
    });

    it('a new ceremony on the same session invalidates the previous challenge', async () => {
      seedCredential(userId);
      const first = await generateAuthenticationOptions(userId, { sessionId: 'sess-reissue' });
      await generateAuthenticationOptions(userId, { sessionId: 'sess-reissue' });

      await expect(
        verifyAuthentication('sess-reissue', buildAssertion(first.challenge), { userId }),
      ).rejects.toMatchObject({ code: 'ChallengeMismatch' });
    });

    it('rejects replaying an assertion whose challenge was already consumed', async () => {
      seedCredential(userId);
      const options = await generateAuthenticationOptions(userId, { sessionId: 'sess-replay' });
      const assertion = buildAssertion(options.challenge, { signCount: 1 });

      const first = await verifyAuthentication('sess-replay', assertion, { userId });
      expect(first.token).toBeDefined();

      await expect(verifyAuthentication('sess-replay', assertion, { userId })).rejects.toMatchObject({
        code: 'ChallengeExpired',
        status: 401,
      });
    });

    it('burns the challenge even when verification fails', async () => {
      seedCredential(userId);
      const options = await generateAuthenticationOptions(userId, { sessionId: 'sess-burn' });

      await expect(
        verifyAuthentication('sess-burn', buildAssertion(options.challenge, { flags: 0x00 }), { userId }),
      ).rejects.toMatchObject({ code: 'UserPresenceRequired' });

      await expect(
        verifyAuthentication('sess-burn', buildAssertion(options.challenge), { userId }),
      ).rejects.toMatchObject({ code: 'ChallengeExpired' });
    });

    it('rejects a challenge presented for a different user', async () => {
      seedCredential(userId);
      const options = await generateAuthenticationOptions(userId, { sessionId: 'sess-user' });
      await expect(
        verifyAuthentication('sess-user', buildAssertion(options.challenge), { userId: 'someone-else' }),
      ).rejects.toMatchObject({ code: 'ChallengeMismatch', status: 401 });
    });

    it('rejects a registration challenge used for authentication', async () => {
      seedCredential(userId);
      const options = await generateRegistrationOptions(userId, 'u', { sessionId: 'sess-type' });
      await expect(
        verifyAuthentication('sess-type', buildAssertion(options.challenge), { userId }),
      ).rejects.toMatchObject({ code: 'ChallengeMismatch' });
    });

    it('rejects clientDataJSON signed over a different challenge', async () => {
      seedCredential(userId);
      await generateAuthenticationOptions(userId, { sessionId: 'sess-mismatch' });
      const forged = buildAssertion('x', { challenge: crypto.randomBytes(32).toString('base64url') });
      await expect(verifyAuthentication('sess-mismatch', forged, { userId })).rejects.toMatchObject({
        code: 'ChallengeMismatch',
      });
    });

    it('throws when challenge is not found', async () => {
      await expect(
        verifyAuthentication('bad-session-id', { credentialId: 'x', signature: 'y' }),
      ).rejects.toThrow('Authentication challenge expired or not found');
    });

    it('throws when credential is not in database', async () => {
      seedCredential(userId);
      const options = await generateAuthenticationOptions(userId);
      await expect(
        verifyAuthentication(options.sessionId, buildAssertion(options.challenge, { credentialId: 'nope' })),
      ).rejects.toThrow('Credential not found or user mismatch');
    });
  });

  // ── #1380: authenticatorData flags ────────────────────────────────────────

  describe('assertAuthenticatorFlags (#1380)', () => {
    it('rejects UP=0', () => {
      expect(() => assertAuthenticatorFlags(makeAuthData({ flags: 0x04 }))).toThrow(/User presence/);
    });

    it('rejects UV=0 when biometrics are required', () => {
      expect(() => assertAuthenticatorFlags(makeAuthData({ flags: 0x01 }), { requireBiometrics: true })).toThrow(
        /User verification/,
      );
    });

    it('accepts UV=0 when biometrics are not required', () => {
      const parsed = assertAuthenticatorFlags(makeAuthData({ flags: 0x01 }), { requireBiometrics: false });
      expect(parsed.userPresence).toBe(true);
      expect(parsed.userVerification).toBe(false);
    });

    it('accepts UP=1, UV=1', () => {
      const parsed = assertAuthenticatorFlags(makeAuthData({ flags: 0x05, signCount: 7 }), { requireBiometrics: true });
      expect(parsed.userPresence).toBe(true);
      expect(parsed.userVerification).toBe(true);
      expect(parsed.signCount).toBe(7);
    });

    it('only inspects bits 0 and 2 — other flags do not satisfy UP/UV', () => {
      // RFU1 | BE | BS | ED set, but neither UP nor UV.
      expect(() => assertAuthenticatorFlags(makeAuthData({ flags: 0x9a }))).toThrow(/User presence/);
    });

    it('rejects truncated authenticatorData', () => {
      expect(() => assertAuthenticatorFlags(Buffer.alloc(32))).toThrow(/Invalid authenticatorData/);
    });
  });

  describe('verifyAuthentication', () => {
    beforeEach(() => seedCredential(userId));

    async function authenticate(assertionOpts, verifyOpts = {}) {
      const options = await generateAuthenticationOptions(userId);
      return verifyAuthentication(options.sessionId, buildAssertion(options.challenge, assertionOpts), {
        userId,
        ...verifyOpts,
      });
    }

    it('rejects an assertion with UP=0', async () => {
      await expect(authenticate({ flags: 0x04 })).rejects.toMatchObject({ code: 'UserPresenceRequired' });
    });

    it('rejects an assertion with UV=0 (biometrics required by default)', async () => {
      await expect(authenticate({ flags: 0x01 })).rejects.toMatchObject({ code: 'UserVerificationRequired' });
    });

    it('accepts a valid UP=1, UV=1 assertion and issues a JWT', async () => {
      const result = await authenticate({ flags: 0x05, signCount: 3 });
      const payload = jwt.decode(result.token);
      expect(payload).toMatchObject({ userId, credentialId: CRED_ID, type: 'webauthn' });
      expect(mockCredentials.get(CRED_ID).counter).toBe(3n);
    });

    it('rejects a tampered signature', async () => {
      const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
      await expect(authenticate({ signer: other })).rejects.toMatchObject({ code: 'SignatureInvalid' });
    });

    it('rejects authenticatorData for a different relying party', async () => {
      await expect(authenticate({ rpId: 'evil.example' })).rejects.toMatchObject({ code: 'RpIdMismatch' });
    });

    it('rejects a signature counter that did not increase', async () => {
      mockCredentials.get(CRED_ID).counter = 5n;
      await expect(authenticate({ signCount: 5 })).rejects.toMatchObject({ code: 'CounterReplay' });
    });

    it('issues a device-bound session token when a deviceId is supplied', async () => {
      const result = await authenticate({}, { deviceId: 'device-123', device: { osVersion: '17.4' } });
      const payload = jwt.decode(result.token);
      expect(payload.deviceId).toBe('device-123');
      expect(payload.sid).toBe(result.sessionId);
      expect(mockSessions.get(result.sessionId)).toMatchObject({ userId, deviceId: 'device-123', osVersion: '17.4' });
    });
  });
});
