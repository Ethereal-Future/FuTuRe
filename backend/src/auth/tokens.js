import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';

const ACCESS_AUDIENCE = 'access';
const REFRESH_AUDIENCE = 'refresh';

function getSecret(kind) {
  const security = getConfig()?.security ?? {};
  const base = security.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
  if (kind === 'refresh') {
    return security.jwtRefreshSecret ?? process.env.JWT_REFRESH_SECRET ?? `${base}:refresh`;
  }
  return security.jwtAccessSecret ?? process.env.JWT_ACCESS_SECRET ?? base;
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret('access'), { expiresIn: '15m', algorithm: 'HS256', audience: ACCESS_AUDIENCE });
}

/** Signs a refresh token with a unique jti and a familyId (new family if not given). */
export function signRefreshToken(payload, { familyId } = {}) {
  const jti = crypto.randomUUID();
  const family = familyId ?? crypto.randomUUID();
  const token = jwt.sign({ ...payload, familyId: family }, getSecret('refresh'), {
    expiresIn: '7d',
    algorithm: 'HS256',
    audience: REFRESH_AUDIENCE,
    jwtid: jti,
  });
  return { token, jti, familyId: family, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret('access'), { algorithms: ['HS256'], audience: ACCESS_AUDIENCE });
}

export const verifyAccessToken = verifyToken;

export function verifyRefreshToken(token) {
  return jwt.verify(token, getSecret('refresh'), { algorithms: ['HS256'], audience: REFRESH_AUDIENCE });
const TOKEN_ISSUER = 'future-app';
const ACCESS_TOKEN_AUDIENCE = 'future-api';
const REFRESH_TOKEN_AUDIENCE = 'future-refresh';

function getSecret() {
  const secret = getConfig()?.security?.jwtSecret;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: '15m',
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: '7d',
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
  });
}

export function verifyToken(token, audience = ACCESS_TOKEN_AUDIENCE) {
  return jwt.verify(token, getSecret(), {
    algorithms: ['HS256'],
    issuer: TOKEN_ISSUER,
    audience,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, getSecret(), {
    algorithms: ['HS256'],
    issuer: TOKEN_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
  });
}
