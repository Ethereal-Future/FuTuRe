import { describe, it, expect } from 'vitest';
import oauth2Provider from '../src/security/oauth2.js';

describe('OAuth2 Provider', () => {
  const clientId = 'test-client-id';
  const clientSecret = 'test-client-secret';
  const redirectUri = 'http://localhost:3000/callback';

  it('should register a client', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const client = oauth2Provider.clients.get(clientId);
    
    expect(client).toBeDefined();
    expect(client.clientId).toBe(clientId);
    expect(client.clientSecret).toBe(clientSecret);
  });

  it('should generate authorization code', () => {
    const userId = 'user-123';
    const scope = 'openid profile email';
    
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, scope);
    
    expect(code).toBeDefined();
    expect(typeof code).toBe('string');
    expect(code.length).toBe(64); // 32 bytes in hex
  });

  it('should exchange code for token', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const scope = 'openid profile email';
    
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, scope);
    const tokens = oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);
    
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.expiresIn).toBe(3600);
  });

  it('should reject invalid authorization code', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    
    expect(() => {
      oauth2Provider.exchangeCodeForToken('invalid-code', clientId, clientSecret);
    }).toThrow('Invalid or expired authorization code');
  });

  it('should reject mismatched client ID', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    
    expect(() => {
      oauth2Provider.exchangeCodeForToken(code, 'wrong-client-id', clientSecret);
    }).toThrow('Client ID mismatch');
  });

  it('should reject invalid client secret', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    
    expect(() => {
      oauth2Provider.exchangeCodeForToken(code, clientId, 'wrong-secret');
    }).toThrow('Invalid client credentials');
  });

  it('should refresh access token', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    const { refreshToken } = oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);
    
    const newTokens = oauth2Provider.refreshAccessToken(refreshToken, clientId);
    
    expect(newTokens.accessToken).toBeDefined();
    expect(newTokens.expiresIn).toBe(3600);
  });

  it('should validate token', () => {
    oauth2Provider.registerClient(clientId, clientSecret, [redirectUri]);
    const userId = 'user-123';
    const code = oauth2Provider.generateAuthorizationCode(clientId, userId, 'scope');
    const { accessToken } = oauth2Provider.exchangeCodeForToken(code, clientId, clientSecret);
    
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
