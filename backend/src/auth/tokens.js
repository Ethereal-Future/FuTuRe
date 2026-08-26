import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';

const TOKEN_ISSUER = 'future-app';
const ACCESS_TOKEN_AUDIENCE = 'future-api';
const REFRESH_TOKEN_AUDIENCE = 'future-refresh';

function getSecret() {
  return getConfig().auth?.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
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
