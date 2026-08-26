import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';
import prisma from '../db/client.js';

const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

class OAuth2Provider {
  /**
   * Register a new OAuth2 client
   * Persists to database, replacing in-memory Map (fixes #968)
   */
  async registerClient(clientId, clientSecret, redirectUris) {
    return await prisma.oAuth2Client.create({
      data: {
        clientId,
        clientSecret,
        redirectUris
      }
    });
  }

  /**
   * Generate an authorization code for OAuth2 flow
   * Persists to database with 10-minute expiry (fixes #968)
   */
  async generateAuthorizationCode(clientId, userId, scope) {
    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.oAuth2AuthorizationCode.create({
      data: {
        code,
        clientId,
        userId,
        scope,
        expiresAt
      }
    });

    return code;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * Validates code, issues tokens with database persistence (fixes #968, #967)
   */
  async exchangeCodeForToken(code, clientId, clientSecret) {
    // Find and validate authorization code
    const authCode = await prisma.oAuth2AuthorizationCode.findUnique({
      where: { code }
    });

    if (!authCode || authCode.expiresAt < new Date()) {
      throw new Error('Invalid or expired authorization code');
    }

    if (authCode.clientId !== clientId) {
      throw new Error('Client ID mismatch');
    }

    // Validate client credentials
    const client = await prisma.oAuth2Client.findUnique({
      where: { clientId }
    });

    if (!client || client.clientSecret !== clientSecret) {
      throw new Error('Invalid client credentials');
    }

    // Delete used authorization code
    await prisma.oAuth2AuthorizationCode.delete({
      where: { code }
    });

    // Generate access token (short-lived JWT)
    const accessToken = jwt.sign(
      { userId: authCode.userId, clientId, scope: authCode.scope },
      getConfig().security.jwtSecret,
      { expiresIn: '1h' }
    );

    // Generate and persist refresh token with expiry (fixes #967)
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await prisma.oAuth2Token.create({
      data: {
        refreshToken,
        clientId,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt
      }
    });

    return { accessToken, refreshToken, expiresIn: 3600 };
  }

  /**
   * Refresh an access token using a refresh token
   * Validates expiry and revocation status (fixes #967)
   */
  async refreshAccessToken(refreshToken, clientId) {
    // Find refresh token with expiry and revocation checks
    const tokenData = await prisma.oAuth2Token.findUnique({
      where: { refreshToken }
    });

    if (!tokenData || tokenData.clientId !== clientId) {
      throw new Error('Invalid refresh token');
    }

    // Check if refresh token is expired (fixes #967)
    if (tokenData.expiresAt < new Date()) {
      throw new Error('Refresh token expired');
    }

    // Check if refresh token is revoked
    if (tokenData.revokedAt) {
      throw new Error('Refresh token revoked');
    }

    // Issue new access token
    const accessToken = jwt.sign(
      { userId: tokenData.userId, clientId, scope: tokenData.scope },
      getConfig().security.jwtSecret,
      { expiresIn: '1h' }
    );

    return { accessToken, expiresIn: 3600 };
  }

  /**
   * Revoke a refresh token (logout)
   */
  async revokeRefreshToken(refreshToken) {
    const result = await prisma.oAuth2Token.updateMany({
      where: { 
        refreshToken,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    return result.count > 0;
  }

  /**
   * Clean up expired authorization codes and tokens
   * Should be run periodically as a maintenance job
   */
  async cleanupExpired() {
    const now = new Date();

    const [deletedCodes, deletedTokens] = await Promise.all([
      prisma.oAuth2AuthorizationCode.deleteMany({
        where: { expiresAt: { lt: now } }
      }),
      prisma.oAuth2Token.deleteMany({
        where: { 
          expiresAt: { lt: now },
          revokedAt: { not: null }
        }
      })
    ]);

    return {
      deletedCodes: deletedCodes.count,
      deletedTokens: deletedTokens.count
    };
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
