import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
      process.env.JWT_SECRET || 'secret',
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
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1h' }
    );

    return { accessToken, expiresIn: 3600 };
  }

  validateToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET || 'secret');
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}

export default new OAuth2Provider();
