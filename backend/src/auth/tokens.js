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
}
