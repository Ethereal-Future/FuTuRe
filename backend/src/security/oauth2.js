import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';

class OAuth2Provider {
  constructor() {
    this.clients = new Map();
    this.tokens = new Map();
    this.authorizationCodes = new Map();
  }

  registerClient(clientId, clientSecret, redirectUris) {
    this.clients.set(clientId, {
      clientId,
      clientSecret,
      redirectUris,
      createdAt: new Date()
    });
  }

  generateAuthorizationCode(clientId, userId, scope) {
    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    this.authorizationCodes.set(code, {
      clientId,
      userId,
      scope,
      expiresAt
    });

    return code;
  }

  exchangeCodeForToken(code, clientId, clientSecret) {
    const authCode = this.authorizationCodes.get(code);

    if (!authCode || authCode.expiresAt < new Date()) {
      throw new Error('Invalid or expired authorization code');
    }

    if (authCode.clientId !== clientId) {
      throw new Error('Client ID mismatch');
    }

    const client = this.clients.get(clientId);
    if (!client || client.clientSecret !== clientSecret) {
      throw new Error('Invalid client credentials');
    }

    this.authorizationCodes.delete(code);

    const accessToken = jwt.sign(
      { userId: authCode.userId, clientId, scope: authCode.scope },
      getConfig().security.jwtSecret,
      { expiresIn: '1h' }
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');
    this.tokens.set(refreshToken, {
      userId: authCode.userId,
      clientId,
      scope: authCode.scope,
      createdAt: new Date()
    });

    return { accessToken, refreshToken, expiresIn: 3600 };
  }

  refreshAccessToken(refreshToken, clientId) {
    const tokenData = this.tokens.get(refreshToken);

    if (!tokenData || tokenData.clientId !== clientId) {
      throw new Error('Invalid refresh token');
    }

    const accessToken = jwt.sign(
      { userId: tokenData.userId, clientId, scope: tokenData.scope },
      getConfig().security.jwtSecret,
      { expiresIn: '1h' }
    );

    return { accessToken, expiresIn: 3600 };
  }

  validateToken(token) {
    try {
      return jwt.verify(token, getConfig().security.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Generate OAuth2 authorization URL for Google
   */
  getGoogleAuthURL(clientId, redirectUri, state) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange Google authorization code for tokens
   */
  async exchangeGoogleCode(code, clientId, clientSecret, redirectUri) {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: params
    });

    if (!response.ok) {
      throw new Error('Failed to exchange Google code');
    }

    return response.json();
  }

  /**
   * Get Google user info from access token
   */
  async getGoogleUserInfo(accessToken) {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error('Failed to get Google user info');
    }

    return response.json();
  }
}

export default new OAuth2Provider();
