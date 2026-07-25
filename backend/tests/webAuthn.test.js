/* backend/tests/webAuthn.test.js */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockCredentials = new Map();

vi.mock('../src/db/client.js', () => ({
  default: {
    webAuthnCredential: {
      create: vi.fn(({ data }) => {
        const cred = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        mockCredentials.set(data.credentialId, cred);
        return Promise.resolve(cred);
      }),
      findUnique: vi.fn(({ where }) =>
        Promise.resolve(mockCredentials.get(where.credentialId) ?? null)
      ),
      findMany: vi.fn(({ where }) => {
        const results = [...mockCredentials.values()].filter(c => c.userId === where.userId);
        return Promise.resolve(results.map(c => ({ credentialId: c.credentialId })));
      }),
      update: vi.fn(({ where, data }) => {
        const cred = mockCredentials.get(where.credentialId);
        if (!cred) return Promise.reject(new Error('Not found'));
        Object.assign(cred, data);
        return Promise.resolve(cred);
      }),
    },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  generateRegistrationOptions,
  verifyAndStoreRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
} = await import('../src/mobile/webAuthn.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebAuthn service', () => {
  const userId = 'user-webauthn-test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockCredentials.clear();
  });

  describe('generateRegistrationOptions', () => {
    it('returns a challenge and rp info', () => {
      const options = generateRegistrationOptions(userId, 'testuser');
      expect(options).toHaveProperty('challengeId');
      expect(options).toHaveProperty('challenge');
      expect(options.rp).toHaveProperty('id');
      expect(options.rp).toHaveProperty('name');
      expect(options.pubKeyCredParams).toBeInstanceOf(Array);
    });

    it('encodes userId as base64url in user object', () => {
      const options = generateRegistrationOptions(userId, 'testuser');
      expect(options.user.id).toBe(Buffer.from(userId).toString('base64url'));
    });
  });

  describe('verifyAndStoreRegistration', () => {
    it('stores a credential in the database', async () => {
      const options = generateRegistrationOptions(userId, 'testuser');
      const { credentialId: storedId } = await verifyAndStoreRegistration(
        options.challengeId,
        { id: 'cred-id-001', publicKey: 'MFkwEw==' },
        'My iPhone'
      );
      expect(storedId).toBe('cred-id-001');
      expect(mockCredentials.has('cred-id-001')).toBe(true);
    });

    it('throws when challenge is not found', async () => {
      await expect(
        verifyAndStoreRegistration('nonexistent-challenge', { id: 'cred', publicKey: 'key' })
      ).rejects.toThrow('Registration challenge expired or not found');
    });

    it('throws when credential is missing id or publicKey', async () => {
      const options = generateRegistrationOptions(userId, 'testuser');
      await expect(
        verifyAndStoreRegistration(options.challengeId, { id: '' })
      ).rejects.toThrow('Invalid credential');
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('throws when no credentials are registered', async () => {
      await expect(generateAuthenticationOptions(userId)).rejects.toThrow(
        'No WebAuthn credentials registered'
      );
    });

    it('returns challenge and allowCredentials when credentials exist', async () => {
      mockCredentials.set('cred-auth-001', {
        credentialId: 'cred-auth-001',
        userId,
        publicKey: 'MFkwEw==',
        counter: 0n,
      });

      const options = await generateAuthenticationOptions(userId);
      expect(options).toHaveProperty('challengeId');
      expect(options).toHaveProperty('challenge');
      expect(options.allowCredentials).toHaveLength(1);
      expect(options.allowCredentials[0].id).toBe('cred-auth-001');
    });
  });

  describe('verifyAuthentication', () => {
    it('throws when challenge is not found', async () => {
      await expect(
        verifyAuthentication('bad-challenge-id', { credentialId: 'x', signature: 'y' })
      ).rejects.toThrow('Authentication challenge expired or not found');
    });

    it('throws when credential is not in database', async () => {
      // Generate options to create a valid challengeId
      mockCredentials.set('dummy', { credentialId: 'dummy', userId, publicKey: 'k', counter: 0n });
      const options = await generateAuthenticationOptions(userId);

      await expect(
        verifyAuthentication(options.challengeId, {
          credentialId: 'nonexistent-cred',
          signature: 'sig',
        })
      ).rejects.toThrow('Credential not found or user mismatch');
    });
  });
});
