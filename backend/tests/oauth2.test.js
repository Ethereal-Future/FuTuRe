import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import oauth2Provider from '../src/security/oauth2.js';
import prisma from '../src/lib/prisma.js';

vi.mock('../src/lib/prisma.js', () => {
  const clients = new Map();
  return {
    default: {
      oAuth2Client: {
        create: vi.fn(async ({ data }) => {
          clients.set(data.clientId, { ...data });
          return { ...data };
        }),
        findUnique: vi.fn(async ({ where }) => {
          return clients.get(where.clientId) ?? null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const existing = clients.get(where.clientId) ?? {};
          const updated = { ...existing, ...data };
          clients.set(where.clientId, updated);
          return updated;
        }),
        delete: vi.fn(async ({ where }) => {
          const existing = clients.get(where.clientId);
          clients.delete(where.clientId);
          return existing;
        }),
        _clients: clients,
      },
    },
  };
});

describe('OAuth2 Provider', () => {
  const clientId = 'test-client-id';
  const clientSecret = 'test-client-secret';
  const redirectUri = 'http://localhost:3000/callback';

  beforeEach(() => {
    prisma.oAuth2Client._clients.clear();
    vi.clearAllMocks();
  });

  it('should register a client with a hashed secret', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const client = await prisma.oAuth2Client.findUnique({ where: { clientId } });

    expect(client).toBeDefined();
    expect(client.clientId).toBe(clientId);
    expect(client.clientSecret).toBeDefined();
    expect(client.clientSecret).not.toBe(clientSecret);
    expect(client.clientSecret).not.toContain(clientSecret);
  });

  it('should generate authorization code', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const scope = 'openid profile email';

    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, scope);

    expect(code).toBeDefined();
    expect(typeof code).toBe('string');
    expect(code.length).toBe(64); // 32 bytes in hex
  });

  it('should exchange code for token with the correct secret', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const scope = 'openid profile email';

    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, scope);
    const tokens = await oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.expiresIn).toBe(3600);
  });

  it('should reject invalid authorization code', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);

    await expect(
      oauth2Provider.exchangeCodeForToken('invalid-code', clientId, clientSecret)
    ).rejects.toThrow('Invalid or expired authorization code');
  });

  it('should reject mismatched client ID', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');

    await expect(
      oauth2Provider.exchangeCodeForToken(code, 'wrong-client-id', clientSecret)
    ).rejects.toThrow('Client ID mismatch');
  });

  it('should reject invalid client secret', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');

    await expect(
      oauth2Provider.exchangeCodeForToken(code, clientId, 'wrong-secret')
    ).rejects.toThrow('Invalid client credentials');
  });

  it('should verify secrets using crypto.timingSafeEqual', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    await oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should reject secrets of differing lengths without leaking timing', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');

    await expect(
      oauth2Provider.exchangeCodeForToken(code, clientId, 'x')
    ).rejects.toThrow('Invalid client credentials');

    // Differing-length inputs must not be passed to timingSafeEqual, which
    // throws on unequal buffer lengths and would otherwise leak length info.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should refresh access token', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    const { refreshToken } = await oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);

    const newTokens = await oauth2Provider.refreshAccessToken(refreshToken, clientId);

    expect(newTokens.accessToken).toBeDefined();
    expect(newTokens.expiresIn).toBe(3600);
  });

  it('should validate token', async () => {
    await oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    const { accessToken } = await oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);

    const decoded = oauth2Provider.validateToken(accessToken);

    expect(decoded.userId).toBe(userId);
    expect(decoded.clientId).toBe(clientId);
  });

  it('should generate Google auth URL', () => {
    const state = 'test-state';
    const url = oauth2Provider.getGoogleAuthURL(clientId, redirectUri, state);

    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain(`client_id=${clientId}`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
    expect(url).toContain(`state=${state}`);
    expect(url).toContain('scope=openid+profile+email');
  });
});
